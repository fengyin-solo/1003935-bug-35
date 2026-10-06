/**
 * 灾情速报领域模型。
 *
 * 设计约定（与本次缺陷修复一一对应，勿破坏）：
 * 1. 每条速报是独立记录：批量核实时按 id 就地更新自己，禁止用循环外共享变量承接，
 *    从根上杜绝「后一条的核实人写到前一条」的数据串位。
 * 2. version 为乐观锁版本号：两个人员同时核实同一条速报时，后到请求携带的 expectedVersion
 *    与库内不一致即判定冲突，该编号只允许一个版本生效。
 * 3. 已上报 / 已归档为历史记录：任何写路径（含批量）命中都直接拒绝，历史不可改写。
 * 4. 跨模块待办 todoKey 幂等：同一速报同一待办类型只有一条，核实失败整批回滚，
 *    不会留下已生成的待办，避免「部分成功后重复生成上报事项」。
 */

export type ReportStatus = '已录入' | '待核实' | '已核实' | '已上报' | '已归档'

/** 历史终态：进入这两个状态后记录只读。 */
export const LOCKED_STATUSES: ReadonlySet<ReportStatus> = new Set(['已上报', '已归档'])

/** 状态机：列出每个来源状态允许的合法迁移，越界迁移一律拒绝。 */
export const STATUS_TRANSITIONS: Readonly<Record<ReportStatus, ReportStatus[]>> = {
  已录入: ['待核实'],
  待核实: ['已核实'],
  已核实: ['已上报'],
  已上报: ['已归档'],
  已归档: [],
}

export type DisasterType = '滑坡' | '崩塌' | '泥石流' | '地面塌陷' | '地裂缝' | '地面沉降'

/** 一条灾情速报。核实相关字段与录入字段同记录承载，各写各的行，不共享引用。 */
export type DisasterReport = {
  id: number
  /** 业务编号，全库唯一；唯一约束冲突时拒绝写入。 */
  code: string
  hazardCode: string
  occurredAt: string
  disasterType: string
  affectedArea: string
  casualties: string
  economicLoss: string
  status: ReportStatus
  /** 乐观锁：每次成功写迁移自增；并发核实靠它判定后到请求。 */
  version: number

  reporter: string
  createdAt: string
  /** 核实人：只由执行「确认核实」的那一次事务写入。 */
  verifier: string
  verifiedAt: string
  verifyOpinion: string
  /** 上报人 / 上报时间：上报后记录进入历史只读区。 */
  submittedBy: string
  submittedAt: string
}

/** 录入新速报的表单载荷；登记人由当前登录操作员带入，不在表单内填写。 */
export type ReportDraft = {
  code: string
  hazardCode: string
  occurredAt: string
  disasterType: string
  affectedArea: string
  casualties: string
  economicLoss: string
  /** 录入后是否立即提交核实。 */
  submitForVerify: boolean
}

/** 跨模块待办：核实通过后给「上报灾情」环节登记，归档类模块消费后关闭。 */
export type ModuleTodo = {
  /** 业务幂等键，`report:<速报id>:<type>`；同键重复登记只保留一条。 */
  todoKey: string
  sourceModule: string
  refReportId: number
  reportCode: string
  title: string
  type: 'report-disaster'
  createdAt: string
  status: 'open' | 'closed'
}

/** 整个本地库，一次写入一个不可变快照（模拟数据库事务提交点）。 */
export type ReportDatabase = {
  reports: DisasterReport[]
  todos: ModuleTodo[]
  seq: number
}

/** 业务错误：携带机器可读 code，页面据此区分冲突 / 终态 / 状态机非法等。 */
export class ReportServiceError extends Error {
  code:
    | 'NOT_FOUND'
    | 'CONFLICT'
    | 'LOCKED_RECORD'
    | 'INVALID_TRANSITION'
    | 'DUPLICATE_CODE'
    | 'EMPTY_BATCH'
    | 'BATCH_CONFLICT'
    | 'VALIDATION'
  constructor(code: ReportServiceError['code'], message: string) {
    super(message)
    this.name = 'ReportServiceError'
    this.code = code
  }
}

export type BatchVerifyFailure = {
  reportId: number
  reportCode: string
  reason: string
}

export type BatchVerifyResult = {
  ok: boolean
  /** 整批成功时生效的记录；失败时为空数组（全部退回，不留半批）。 */
  verified: DisasterReport[]
  /** 整批失败时逐条说明原因，便于核实人定位后整批重来。 */
  failures: BatchVerifyFailure[]
  message: string
}
