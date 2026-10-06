import { SEED_ROWS, SEED_TODOS } from './seed'
import type { EntryRow, TodoItem } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'geohazard-monitor-prevention:entries'
const TODOS_NAMESPACE = '__todos__'

export type Database = {
  entries: Record<string, EntryRow[]>
  todos: TodoItem[]
}

/** 业务错误：422 表示状态/数据不允许操作，409 表示乐观锁冲突（后到请求）。 */
export class StoreError extends Error {
  constructor(
    readonly code: 409 | 422,
    message: string,
  ) {
    super(message)
    this.name = 'StoreError'
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function freshSeed(): Database {
  return { entries: clone(SEED_ROWS), todos: clone(SEED_TODOS) }
}

/** 给历史数据补齐乐观锁版本号：老记录一律视为第 1 版。 */
function withVersion(row: EntryRow): EntryRow {
  return typeof row.version === 'number' ? row : { ...row, version: 1 }
}

/**
 * 兼容旧版存储：旧版直接把「模块 -> 记录数组」平铺在 localStorage 里，
 * 没有版本号也没有跨模块待办；读出来时归一化成 { entries, todos }，待办只播种一次。
 */
function normalize(raw: unknown): Database {
  const seed = freshSeed()
  if (!raw || typeof raw !== 'object') {
    return seed
  }
  const value = raw as Record<string, unknown>
  const isNewShape = 'entries' in value && typeof value.entries === 'object'
  const entries: Record<string, EntryRow[]> = {}
  const source = (isNewShape ? value.entries : value) as Record<string, unknown>
  for (const [key, rows] of Object.entries(seed.entries)) {
    const saved = source[key]
    const list = Array.isArray(saved) ? (saved as EntryRow[]).map(withVersion) : clone(rows)
    entries[key] = list.map(withVersion)
  }
  let todos: TodoItem[]
  if (isNewShape && Array.isArray(value.todos)) {
    todos = value.todos as TodoItem[]
  } else if (Array.isArray((value as Record<string, unknown>)[TODOS_NAMESPACE])) {
    todos = (value as Record<string, TodoItem[]>)[TODOS_NAMESPACE]
  } else {
    todos = seed.todos
  }
  return { entries, todos }
}

let memoryStore: Storage | null = null

/** 测试环境注入内存版 Storage；浏览器环境用 localStorage。 */
export function bindStorage(store: Storage | null): void {
  memoryStore = store
  cache = null
}

function storage(): Storage | null {
  if (memoryStore) {
    return memoryStore
  }
  if (typeof window === 'undefined' || !window.localStorage) {
    return null
  }
  return window.localStorage
}

function readStorage(): Database {
  const backing = storage()
  if (!backing) {
    return freshSeed()
  }
  const raw = backing.getItem(STORAGE_KEY)
  if (!raw) {
    const seed = freshSeed()
    backing.setItem(STORAGE_KEY, JSON.stringify(seed))
    return seed
  }
  try {
    return normalize(JSON.parse(raw))
  } catch {
    const seed = freshSeed()
    backing.setItem(STORAGE_KEY, JSON.stringify(seed))
    return seed
  }
}

let cache: Database | null = null

export function all(): Database {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function allRows(): Record<string, EntryRow[]> {
  return all().entries
}

export function listRows(key: string): EntryRow[] {
  return all().entries[key] ?? []
}

export function listTodos(): TodoItem[] {
  return all().todos
}

function persist(db: Database): void {
  cache = db
  const backing = storage()
  if (backing) {
    backing.setItem(STORAGE_KEY, JSON.stringify(db))
  }
}

/** 单个模块恢复示例数据；其它模块与跨模块待办不受影响。 */
export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  runTransaction((tx) => {
    const draftRows = tx.rows(key)
    draftRows.splice(0, draftRows.length, ...rows.map(withVersion))
  })
  return rows
}

/** 测试与「恢复演示数据」用：整库回到种子状态。 */
export function resetDatabase(): Database {
  const db = freshSeed()
  persist(db)
  return clone(db)
}

export function storageKey(): string {
  return STORAGE_KEY
}

// ---------------------------------------------------------------------------
// 事务：所有会改数据的业务动作（单条/批量核实、上报、登记）都走 runTransaction。
// mutate 阶段只在深拷贝的草稿上做「前置校验 + 修改」，任何一条抛错都不落盘，
// 天然杜绝「前几条已保存、后几条失败」的半批状态；提交阶段再按版本号做乐观锁校验。
// ---------------------------------------------------------------------------

type Expectation = { key: string; id: number; expectedVersion: number }

export type Transaction = {
  rows: (key: string) => EntryRow[]
  findRow: (key: string, id: number) => EntryRow | undefined
  /** 取出要修改的已有记录；不存在抛 422。版本校验请显式走 expectVersion。 */
  requireRow: (key: string, id: number) => EntryRow
  /**
   * 乐观锁校验：当前版本与调用方依据的 expectedVersion 不一致时立即抛 409，
   * 说明同一编号已被他人先一步提交；同时登记到提交前的终检里做双重防护。
   * 业务侧应先完成「历史记录冻结」等硬性拦截，再调用本方法。
   */
  expectVersion: (key: string, id: number, expectedVersion: number) => void
  insertRow: (key: string, row: EntryRow) => void
  todos: TodoItem[]
}

export function runTransaction<T>(mutate: (tx: Transaction) => T): T {
  // 每次事务都从当前已提交状态重新克隆，跨标签页写入会先让缓存失效。
  const committed = all()
  const draft: Database = clone(committed)
  const expectations: Expectation[] = []

  const versionConflict = (id: number, expected: number, actual: number): StoreError =>
    new StoreError(
      409,
      `编号 ${id} 的记录已被他人先一步核实（当前版本 ${actual}，你提交依据的是版本 ${expected}），本次操作未生效，请刷新后重试`,
    )

  const tx: Transaction = {
    rows: (key) => draft.entries[key] ?? [],
    findRow: (key, id) => draft.entries[key]?.find((row) => Number(row.id) === id),
    requireRow: (key, id) => {
      const row = draft.entries[key]?.find((item) => Number(item.id) === id)
      if (!row) {
        throw new StoreError(422, `没有找到编号为 ${id} 的记录`)
      }
      return row
    },
    expectVersion: (key, id, expectedVersion) => {
      const row = draft.entries[key]?.find((item) => Number(item.id) === id)
      if (!row) {
        throw new StoreError(422, `没有找到编号为 ${id} 的记录`)
      }
      const actual = Number(row.version ?? 1)
      if (actual !== expectedVersion) {
        throw versionConflict(id, expectedVersion, actual)
      }
      expectations.push({ key, id, expectedVersion })
    },
    insertRow: (key, row) => {
      if (!draft.entries[key]) {
        draft.entries[key] = []
      }
      draft.entries[key].push(row)
    },
    get todos() {
      return draft.todos
    },
  }

  // 阶段一：前置校验与全部修改都发生在内存草稿上，抛错即整体放弃。
  const result = mutate(tx)

  // 阶段二：提交前重新读取已提交数据，逐条比对版本号。
  // 另一值班员（或另一标签页）在事务构造期间提交过同一编号时，后到请求在此明确冲突，整笔退回。
  const latest = all()
  for (const exp of expectations) {
    const live = latest.entries[exp.key]?.find((row) => Number(row.id) === exp.id)
    if (!live) {
      throw new StoreError(409, `编号 ${exp.id} 的记录已被他人删除，请刷新后重试`)
    }
    if (Number(live.version ?? 1) !== exp.expectedVersion) {
      throw versionConflict(exp.id, exp.expectedVersion, Number(live.version ?? 1))
    }
    const updated = draft.entries[exp.key]?.find((row) => Number(row.id) === exp.id)
    if (updated) {
      updated.version = exp.expectedVersion + 1
    }
  }

  persist(draft)
  return result
}

// ---------------------------------------------------------------------------
// 跨标签页并发：A 页提交后 B 页收到 storage 事件，缓存立即失效并通知页面刷新；
// B 页若仍用旧版本号提交，会在 runTransaction 提交阶段拿到明确的 409 冲突。
// ---------------------------------------------------------------------------

type Listener = () => void
const listeners = new Set<Listener>()

export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY) {
      cache = null
      for (const listener of listeners) {
        listener()
      }
    }
  })
}
