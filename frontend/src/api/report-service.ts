import { MODULE_BY_KEY } from '@/data/modules'
import {
  listRows,
  listTodos,
  runTransaction,
  StoreError,
} from '@/data/local-store'
import type { ActionResult, EntryRow, TodoItem } from '@/data/types'

const MODULE_KEY = 'report'
const TODO_KIND = 'report'

const STATUS = {
  entered: '已录入',
  toVerify: '待核实',
  verified: '已核实',
  reported: '已上报',
  archived: '已归档',
} as const

/** 已上报、已归档属于历史已上报记录，任何动作都不许再改写。 */
const FROZEN_STATUSES = [STATUS.reported, STATUS.archived]

export type VerifyItem = {
  id: number
  /** 每条记录带自己的核实人与版本号，逐条从入参取，杜绝共享变量串行导致的核实人串位。 */
  verifier: string
  expectedVersion: number
}

export type ReportDraft = {
  速报编号: string
  隐患点编号: string
  发生时间: string
  灾害类型: string
  受灾范围: string
  伤亡人数: string
  经济损失: string
}

function meta() {
  const value = MODULE_BY_KEY.get(MODULE_KEY)
  if (!value) {
    throw new Error('灾情速报模块未登记')
  }
  return value
}

export function nowStamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function toResult(error: unknown): ActionResult {
  if (error instanceof StoreError) {
    return { ok: false, code: error.code, message: error.message }
  }
  return { ok: false, message: error instanceof Error ? error.message : '操作失败' }
}

function todoIdOf(reportId: number): string {
  return `todo-${MODULE_KEY}-${reportId}-${TODO_KIND}`
}

/** 幂等建待办：同一速报只保留一条待上报待办，重复核实/重试都不会再生成。 */
function ensureReportTodo(todos: TodoItem[], row: EntryRow, stamp: string): void {
  const id = todoIdOf(Number(row.id))
  if (todos.some((item) => item.id === id)) {
    return
  }
  todos.push({
    id,
    moduleKey: MODULE_KEY,
    refId: Number(row.id),
    refCode: String(row['速报编号'] ?? ''),
    title: `灾情速报 ${row['速报编号']} 已核实，待上报灾情`,
    status: '待办',
    createdAt: stamp,
  })
}

function completeReportTodo(todos: TodoItem[], reportId: number, stamp: string): void {
  const id = todoIdOf(reportId)
  for (const todo of todos) {
    if (todo.id === id && todo.status === '待办') {
      todo.status = '已完成'
      todo.completedAt = stamp
    }
  }
}

function assertNotFrozen(row: EntryRow): void {
  if (FROZEN_STATUSES.includes(String(row.status) as (typeof FROZEN_STATUSES)[number])) {
    throw new StoreError(
      422,
      `速报 ${row['速报编号']} 已${row.status}，历史已上报记录不允许改写`,
    )
  }
}

function assertVerifier(row: EntryRow, verifier: string): void {
  if (!verifier.trim()) {
    throw new StoreError(422, `速报 ${row['速报编号']} 缺少核实人，无法核实`)
  }
}

function verifyOne(
  tx: { expectVersion: (key: string, id: number, v: number) => void; todos: TodoItem[] },
  row: EntryRow,
  item: VerifyItem,
  stamp: string,
): void {
  // 顺序很重要：历史冻结 → 版本冲突（409）→ 状态机校验。
  // 这样他人先核实后，后到请求拿到的是明确冲突，而不是笼统的「已核实，请勿重复」。
  assertNotFrozen(row)
  tx.expectVersion(MODULE_KEY, Number(row.id), item.expectedVersion)
  if (String(row.status) === STATUS.verified) {
    throw new StoreError(422, `速报 ${row['速报编号']} 已经核实，请勿重复操作`)
  }
  if (String(row.status) !== STATUS.toVerify) {
    throw new StoreError(422, `速报 ${row['速报编号']} 当前为「${row.status}」，需先提交核实才能确认核实`)
  }
  assertVerifier(row, item.verifier)
  row.status = STATUS.verified
  row.pending = true
  row['核实人'] = item.verifier.trim()
  row['核实时间'] = stamp
  ensureReportTodo(tx.todos, row, stamp)
}

export function listReports(): EntryRow[] {
  return listRows(MODULE_KEY)
}

export function getReport(id: number): EntryRow | undefined {
  return listRows(MODULE_KEY).find((row) => Number(row.id) === id)
}

export function listReportTodos(status?: TodoItem['status']): TodoItem[] {
  const todos = listTodos().filter((todo) => todo.moduleKey === MODULE_KEY)
  return typeof status === 'string' ? todos.filter((todo) => todo.status === status) : todos
}

export function submitForVerify(id: number, expectedVersion?: number): ActionResult {
  try {
    runTransaction((tx) => {
      const row = tx.requireRow(MODULE_KEY, id)
      assertNotFrozen(row)
      if (typeof expectedVersion === 'number') {
        tx.expectVersion(MODULE_KEY, id, expectedVersion)
      }
      if (String(row.status) === STATUS.toVerify) {
        throw new StoreError(422, `速报 ${row['速报编号']} 已在待核实队列`)
      }
      if (String(row.status) !== STATUS.entered) {
        throw new StoreError(422, `速报 ${row['速报编号']} 当前为「${row.status}」，不能提交核实`)
      }
      row.status = STATUS.toVerify
    })
    return { ok: true, message: '已提交核实' }
  } catch (error) {
    return toResult(error)
  }
}

export function verifyReport(item: VerifyItem): ActionResult {
  try {
    runTransaction((tx) => {
      const row = tx.requireRow(MODULE_KEY, item.id)
      verifyOne(tx, row, item, nowStamp())
    })
    return { ok: true, message: `速报已确认核实，核实人：${item.verifier.trim()}` }
  } catch (error) {
    return toResult(error)
  }
}

/**
 * 批量核实：先在同一事务的内存草稿上逐条校验、逐条修改，每条都用入参自带的核实人；
 * 任何一条不满足条件（状态不对、缺核实人、版本冲突）都整体抛错，一条都不会落盘，
 * 不存在「前几条已保存成功、后几条失败」的半批，也就不会重复生成上报待办。
 */
export function batchVerifyReports(items: VerifyItem[]): ActionResult {
  if (items.length === 0) {
    return { ok: false, code: 422, message: '未选择任何速报' }
  }
  // 同一编号在一批里出现两次时直接拒绝，避免批内自我覆盖。
  const ids = items.map((item) => item.id)
  if (new Set(ids).size !== ids.length) {
    return { ok: false, code: 422, message: '批量核实中存在重复的速报编号，已整批退回' }
  }
  try {
    const stamp = nowStamp()
    const codes: string[] = []
    runTransaction((tx) => {
      for (const item of items) {
        const row = tx.requireRow(MODULE_KEY, item.id)
        codes.push(String(row['速报编号'] ?? item.id))
        verifyOne(tx, row, item, stamp)
      }
    })
    return { ok: true, message: `已批量核实 ${items.length} 条速报（${codes.join('、')}），每条各生成一条上报待办` }
  } catch (error) {
    const result = toResult(error)
    return { ...result, message: `批量核实已整批退回，未保留任何半批结果：${result.message}` }
  }
}

export function submitReport(input: {
  id: number
  reporter: string
  expectedVersion?: number
}): ActionResult {
  if (!input.reporter.trim()) {
    return { ok: false, code: 422, message: '缺少上报人，无法上报灾情' }
  }
  try {
    const stamp = nowStamp()
    runTransaction((tx) => {
      const row = tx.requireRow(MODULE_KEY, input.id)
      assertNotFrozen(row)
      if (typeof input.expectedVersion === 'number') {
        tx.expectVersion(MODULE_KEY, input.id, input.expectedVersion)
      }
      if (String(row.status) !== STATUS.verified) {
        throw new StoreError(422, `速报 ${row['速报编号']} 当前为「${row.status}」，只有已核实速报才能上报`)
      }
      row.status = STATUS.reported
      row.pending = false
      row['上报人'] = input.reporter.trim()
      row['上报时间'] = stamp
      completeReportTodo(tx.todos, input.id, stamp)
    })
    return { ok: true, message: `速报已上报灾情，上报人：${input.reporter.trim()}` }
  } catch (error) {
    return toResult(error)
  }
}

export function createReport(draft: ReportDraft): ActionResult {
  if (!draft['速报编号'].trim()) {
    return { ok: false, code: 422, message: '速报编号不能为空' }
  }
  try {
    const stamp = nowStamp()
    runTransaction((tx) => {
      const rows = tx.rows(MODULE_KEY)
      const code = draft['速报编号'].trim()
      if (rows.some((row) => String(row['速报编号']) === code)) {
        throw new StoreError(422, `速报编号 ${code} 已存在，不能重复登记`)
      }
      const nextId = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
      tx.insertRow(MODULE_KEY, {
        id: nextId,
        status: STATUS.entered,
        pending: true,
        abnormal: false,
        version: 1,
        '速报编号': code,
        '隐患点编号': draft['隐患点编号'].trim(),
        '发生时间': draft['发生时间'].trim() || stamp,
        '灾害类型': draft['灾害类型'].trim(),
        '受灾范围': draft['受灾范围'].trim(),
        '伤亡人数': draft['伤亡人数'].trim() || '0',
        '经济损失': draft['经济损失'].trim(),
      })
    })
    return { ok: true, message: `灾情速报 ${draft['速报编号'].trim()} 已登记，状态为「${STATUS.entered}」` }
  } catch (error) {
    return toResult(error)
  }
}

// 供页面复用模块元数据（字段、状态枚举），避免页面各写一份。
export { meta as reportMeta, STATUS as REPORT_STATUS }
