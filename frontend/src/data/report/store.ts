import { buildSeedDatabase } from './seed'
import type { ReportDatabase } from './types'

/**
 * 灾情速报本地持久化（模拟数据库）。
 * 关键约束：
 * - 全程只通过 `commit` 落盘：服务层先在内存快照上把「整批结果」算好，
 *   校验全部通过后只调用一次 commit。任一记录失败都不会走到 commit，
 *   从而保证整批原子提交，不存在半批改一半没改的中间态。
 * - read() 返回的是快照引用，服务层内一律先深拷贝再改，禁止就地变更。
 * - inflight 版本锁模拟同一会话内两个人员请求交叉：同一记录前一个写事务
 *   未提交时，后到写请求立即冲突失败（见 service 的 expectedVersion 校验）。
 */

const STORAGE_KEY = 'geohazard-monitor-prevention:disaster-report-db:v1'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function loadInitial(): ReportDatabase {
  if (typeof window === 'undefined' || !window.localStorage) {
    return buildSeedDatabase()
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    const seed = buildSeedDatabase()
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seed))
    return seed
  }
  try {
    const parsed = JSON.parse(raw) as ReportDatabase
    if (!Array.isArray(parsed.reports) || !Array.isArray(parsed.todos)) {
      throw new Error('灾情速报库结构损坏')
    }
    return parsed
  } catch {
    const seed = buildSeedDatabase()
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seed))
    return seed
  }
}

let cache: ReportDatabase | null = null

/** 读取当前已提交快照（只读语义；调用方不得就地修改）。 */
export function read(): ReportDatabase {
  if (cache === null) {
    cache = loadInitial()
  }
  return cache
}

/**
 * 事务提交的唯一落盘点。next 必须是基于 read() 深拷贝构建出的完整新库，
 * 一次写入整体替换，模拟数据库事务的原子提交。
 */
export function commit(next: ReportDatabase): void {
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

/** 在内存快照副本上构建新库，供服务层做「先全部算好、再一次提交」。 */
export function draftFrom(snapshot: ReportDatabase): ReportDatabase {
  return clone(snapshot)
}

export function resetReportDatabase(): ReportDatabase {
  const seed = buildSeedDatabase()
  commit(seed)
  return seed
}

export function reportStorageKey(): string {
  return STORAGE_KEY
}
