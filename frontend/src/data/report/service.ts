import { commit, draftFrom, read } from './store'
import {
  LOCKED_STATUSES,
  STATUS_TRANSITIONS,
  ReportServiceError,
  type BatchVerifyFailure,
  type BatchVerifyResult,
  type DisasterReport,
  type ModuleTodo,
  type ReportDraft,
  type ReportStatus,
} from './types'

export { ReportServiceError }
export type { BatchVerifyFailure }

function nowText(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function assertTransition(report: DisasterReport, target: ReportStatus): void {
  const allowed = STATUS_TRANSITIONS[report.status]
  if (!allowed.includes(target)) {
    throw new ReportServiceError(
      'INVALID_TRANSITION',
      `速报 ${report.code} 当前为「${report.status}」，不能流转到「${target}」`,
    )
  }
}

function assertNotLocked(report: DisasterReport): void {
  if (LOCKED_STATUSES.has(report.status)) {
    throw new ReportServiceError(
      'LOCKED_RECORD',
      `速报 ${report.code} 已${report.status}，属于历史已上报记录，不允许改写`,
    )
  }
}

/**
 * 乐观锁校验：页面在自己读取的版本上发起操作；库内版本若已被他人推进，
 * 说明该编号已有另一个版本生效，后到请求必须明确报冲突，不得覆盖。
 */
function assertVersion(report: DisasterReport, expectedVersion: number): void {
  if (report.version !== expectedVersion) {
    throw new ReportServiceError(
      'CONFLICT',
      `速报 ${report.code} 数据已被他人更新（页面版本 v${expectedVersion}，当前版本 v${report.version}），请刷新后重试`,
    )
  }
}

function todoKeyFor(reportId: number): string {
  return `report:${reportId}:report-disaster`
}

/** 幂等登记待办：同 key 已存在（含历史关闭记录）时绝不重复插入。 */
function ensureTodo(draft: ReturnType<typeof read>, report: DisasterReport): void {
  const key = todoKeyFor(report.id)
  const existing = draft.todos.find((todo) => todo.todoKey === key)
  if (existing) {
    existing.status = 'open'
    return
  }
  const todo: ModuleTodo = {
    todoKey: key,
    sourceModule: 'report',
    refReportId: report.id,
    reportCode: report.code,
    title: `核实通过，待上报灾情：${report.code}（${report.disasterType}）`,
    type: 'report-disaster',
    createdAt: nowText(),
    status: 'open',
  }
  draft.todos.push(todo)
}

function closeTodo(draft: ReturnType<typeof read>, reportId: number): void {
  const key = todoKeyFor(reportId)
  for (const todo of draft.todos) {
    if (todo.todoKey === key) {
      todo.status = 'closed'
    }
  }
}

export type ReportQuery = {
  keyword?: string
  status?: string
}

export function listReports(query: ReportQuery = {}): DisasterReport[] {
  const keyword = query.keyword?.trim() ?? ''
  const status = query.status?.trim() ?? ''
  return read().reports.filter((row) => {
    if (status && row.status !== status) {
      return false
    }
    if (!keyword) {
      return true
    }
    const haystack = [row.code, row.hazardCode, row.disasterType, row.affectedArea, row.verifier].join(' ')
    return haystack.includes(keyword)
  })
}

export function getReport(id: number): DisasterReport {
  const report = read().reports.find((item) => item.id === id)
  if (!report) {
    throw new ReportServiceError('NOT_FOUND', `没有找到编号为 ${id} 的灾情速报`)
  }
  return report
}

export function listTodos(status: 'open' | 'closed' | 'all' = 'all'): ModuleTodo[] {
  return read().todos.filter((todo) => status === 'all' || todo.status === status)
}

export function createReport(draft: ReportDraft, operator: string): DisasterReport {
  const trimmedCode = draft.code.trim()
  const trimmedHazard = draft.hazardCode.trim()
  if (!trimmedCode || !trimmedHazard || !draft.occurredAt || !draft.disasterType) {
    throw new ReportServiceError('VALIDATION', '速报编号、隐患点编号、发生时间、灾害类型为必填项')
  }
  const db = read()
  if (db.reports.some((row) => row.code === trimmedCode)) {
    throw new ReportServiceError('DUPLICATE_CODE', `速报编号 ${trimmedCode} 已存在，同一编号不允许重复登记`)
  }

  const next = draftFrom(db)
  next.seq += 1
  const initialStatus: ReportStatus = draft.submitForVerify ? '待核实' : '已录入'
  const report: DisasterReport = {
    id: next.seq,
    code: trimmedCode,
    hazardCode: trimmedHazard,
    occurredAt: draft.occurredAt,
    disasterType: draft.disasterType,
    affectedArea: draft.affectedArea.trim(),
    casualties: draft.casualties.trim(),
    economicLoss: draft.economicLoss.trim(),
    status: initialStatus,
    version: 1,
    reporter: operator,
    createdAt: nowText(),
    verifier: '',
    verifiedAt: '',
    verifyOpinion: '',
    submittedBy: '',
    submittedAt: '',
  }
  next.reports.push(report)
  // 录入与（可选的）提交核实在同一事务落盘，不会出现登记成功但状态没跟上的半成品。
  commit(next)
  return report
}

/** 已录入 → 待核实。 */
export function submitForVerify(id: number, expectedVersion: number, operator: string): DisasterReport {
  const db = read()
  const current = db.reports.find((item) => item.id === id)
  if (!current) {
    throw new ReportServiceError('NOT_FOUND', `没有找到编号为 ${id} 的灾情速报`)
  }
  assertVersion(current, expectedVersion)
  assertNotLocked(current)
  assertTransition(current, '待核实')

  const next = draftFrom(db)
  const target = next.reports.find((item) => item.id === id) as DisasterReport
  target.status = '待核实'
  target.version += 1
  void operator
  commit(next)
  return target
}

export type VerifyInput = {
  id: number
  expectedVersion: number
  verifier: string
  opinion: string
}

function applyVerify(draft: ReturnType<typeof read>, input: VerifyInput): DisasterReport {
  const report = draft.reports.find((item) => item.id === input.id)
  if (!report) {
    throw new ReportServiceError('NOT_FOUND', `没有找到编号为 ${input.id} 的灾情速报`)
  }
  // 下面三道闸与顺序固定：先版本、再历史终态、再状态机。任何一道不过都不产生写入。
  assertVersion(report, input.expectedVersion)
  assertNotLocked(report)
  assertTransition(report, '已核实')

  // 核实人只取自本条输入，按 id 显式归属到本行，不经过任何循环外共享变量。
  report.status = '已核实'
  report.verifier = input.verifier
  report.verifiedAt = nowText()
  report.verifyOpinion = input.opinion.trim()
  report.version += 1

  ensureTodo(draft, report)
  return report
}

/** 单条核实：独立事务，失败直接抛错，库内无任何变化。 */
export function verifyReport(input: VerifyInput): DisasterReport {
  const db = read()
  const next = draftFrom(db)
  const verified = applyVerify(next, input)
  commit(next)
  return verified
}

export type BatchVerifyItem = {
  id: number
  /** 选中那一刻的版本；批量提交时逐条乐观锁比对。 */
  expectedVersion: number
  /** 每条可指定各自核实人；不传则用默认操作员。按 id 显式对应，绝不串行错位。 */
  verifier?: string
}

/**
 * 批量核实（本缺陷修复的核心）。
 *
 * 处理方式：
 * 1. 先在内存草稿上逐条独立校验 + 变更（按 id 查找自己的行、写自己的核实人），
 *    失败原因逐条收集，任何一条失败都标记整批失败；
 * 2. 只要存在一条失败，直接返回失败明细，绝不 commit —— 已在循环里处理成功的
 *    那些草稿随草稿对象一并丢弃，库里一条都不改，已成功记录也不会生成待办，
 *    因此不会出现「部分失败后已成功记录又重复生成上报事项」；
 * 3. 全部通过才做唯一一次 commit：状态变更与跨模块待办在同一事务原子生效。
 */
export function batchVerify(
  items: BatchVerifyItem[],
  defaultVerifier: string,
  opinion: string,
): BatchVerifyResult {
  if (items.length === 0) {
    return {
      ok: false,
      verified: [],
      failures: [],
      message: '未勾选任何速报，批量核实未执行',
    }
  }

  // 同一批次内 id 去重：重复勾选同一条按整批失败处理，避免一条被写两遍。
  const seen = new Set<number>()
  const duplicateIds = new Set<number>()
  for (const item of items) {
    if (seen.has(item.id)) {
      duplicateIds.add(item.id)
    }
    seen.add(item.id)
  }

  const db = read()
  const draft = draftFrom(db)
  const verified: DisasterReport[] = []
  const failures: BatchVerifyFailure[] = []

  for (const item of items) {
    const current = db.reports.find((row) => row.id === item.id)
    const code = current?.code ?? `#${item.id}`
    if (duplicateIds.has(item.id)) {
      failures.push({ reportId: item.id, reportCode: code, reason: '同一速报在批次中重复出现' })
      continue
    }
    if (!current) {
      failures.push({ reportId: item.id, reportCode: code, reason: '速报不存在或已被删除' })
      continue
    }
    // 关键：每条用自己的输入独立处理，核实人按 id 取本条的值，杜绝串行错位。
    try {
      const row = applyVerify(draft, {
        id: item.id,
        expectedVersion: item.expectedVersion,
        verifier: item.verifier?.trim() || defaultVerifier,
        opinion,
      })
      verified.push(row)
    } catch (error) {
      failures.push({
        reportId: item.id,
        reportCode: code,
        reason: error instanceof ReportServiceError ? error.message : '核实失败',
      })
    }
  }

  if (failures.length > 0) {
    // 整批退回：不 commit，草稿（含已算出的变更与待办）整体丢弃，库内保持原样。
    return {
      ok: false,
      verified: [],
      failures,
      message: `批量核实未生效：${failures.length} 条未通过，整批已退回，请修正后重新整批提交`,
    }
  }

  commit(draft)
  return {
    ok: true,
    verified,
    failures: [],
    message: `批量核实完成，本批 ${verified.length} 条全部生效，已同步登记上报待办`,
  }
}

/** 已核实 → 已上报：上报后进入历史只读区，并关闭对应跨模块待办（同一事务）。 */
export function submitDisaster(id: number, expectedVersion: number, operator: string): DisasterReport {
  const db = read()
  const current = db.reports.find((item) => item.id === id)
  if (!current) {
    throw new ReportServiceError('NOT_FOUND', `没有找到编号为 ${id} 的灾情速报`)
  }
  assertVersion(current, expectedVersion)
  assertNotLocked(current)
  assertTransition(current, '已上报')

  const next = draftFrom(db)
  const target = next.reports.find((item) => item.id === id) as DisasterReport
  target.status = '已上报'
  target.submittedBy = operator
  target.submittedAt = nowText()
  target.version += 1
  closeTodo(next, id)
  commit(next)
  return target
}

/** 已上报 → 已归档：仅流转状态，不改写任何已上报内容。 */
export function archiveReport(id: number, expectedVersion: number): DisasterReport {
  const db = read()
  const current = db.reports.find((item) => item.id === id)
  if (!current) {
    throw new ReportServiceError('NOT_FOUND', `没有找到编号为 ${id} 的灾情速报`)
  }
  assertVersion(current, expectedVersion)
  // 状态机本身只允许 已上报 → 已归档；已归档等历史终态到此即被拒绝，不改写历史内容。
  assertTransition(current, '已归档')

  const next = draftFrom(db)
  const target = next.reports.find((item) => item.id === id) as DisasterReport
  target.status = '已归档'
  target.version += 1
  commit(next)
  return target
}

/**
 * 并发冲突演示：模拟「另一个人员」基于同一版本先完成核实并提交。
 * 之后页面拿着旧 expectedVersion 再核实，就会收到 CONFLICT —— 同一编号只一个版本生效。
 */
export function simulateConcurrentVerify(id: number, otherVerifier: string): DisasterReport {
  const current = getReport(id)
  return verifyReport({
    id,
    expectedVersion: current.version,
    verifier: otherVerifier,
    opinion: '另一值班端先完成的现场核实',
  })
}

export function exportReportCsv(): { filename: string; content: string } {
  const header = ['速报编号', '隐患点编号', '发生时间', '灾害类型', '受灾范围', '伤亡人数', '经济损失', '状态', '核实人', '上报人']
  const lines = [header.join(',')]
  for (const row of listReports()) {
    lines.push(
      [row.code, row.hazardCode, row.occurredAt, row.disasterType, row.affectedArea, row.casualties, row.economicLoss, row.status, row.verifier, row.submittedBy]
        .map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`)
        .join(','),
    )
  }
  return { filename: '灾情速报-清单.csv', content: `﻿${lines.join('\n')}` }
}
