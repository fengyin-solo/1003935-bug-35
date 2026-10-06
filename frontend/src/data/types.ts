/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  /** 乐观锁版本号：每次落盘 +1，保存时按「编号 + 版本」做并发冲突校验。 */
  version?: number
  /** 灾情速报专用：核实人 / 核实时间 / 上报人 / 上报时间。 */
  核实人?: string
  核实时间?: string
  上报人?: string
  上报时间?: string
  [field: string]: string | number | boolean | undefined
}

/** 跨模块待办事项：由灾情速报核实/上报动作生成，看板统一汇总，避免和速报记录混存导致串位。 */
export type TodoItem = {
  id: string
  moduleKey: string
  /** 产生待办的业务记录编号（report 模块里即 EntryRow.id）。 */
  refId: number
  /** 业务编号，例如速报编号 REPO-0002，用于列表展示。 */
  refCode: string
  title: string
  status: '待办' | '已完成'
  createdAt: string
  completedAt?: string
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
  /** 乐观锁冲突时为 409，前端据此提示「后到请求冲突」并刷新。 */
  code?: 409 | 422
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
