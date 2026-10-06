/**
 * 灾情速报服务层行为测试（临时脚本，验证后删除）。
 * 用内存 Map 模拟 localStorage，逐条核对本次缺陷修复要求：
 * A. 批量核实核实人不串位
 * B. 批量部分失败 → 整批退回，库不变、待办不重复
 * C. 历史已上报/已归档不可改写
 * D. 同编号并发核实只一个版本生效，后到请求 CONFLICT
 * E. 待办幂等
 * F. 单条事务独立
 */
const mem = new Map<string, string>()
;(globalThis as any).window = {
  localStorage: {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => void mem.set(k, v),
  },
}

import { buildSeedDatabase } from '../src/data/report/seed'
import { commit, resetReportDatabase } from '../src/data/report/store'
import {
  archiveReport,
  batchVerify,
  createReport,
  getReport,
  listReports,
  listTodos,
  submitDisaster,
  submitForVerify,
  verifyReport,
} from '../src/data/report/service'
import { ReportServiceError } from '../src/data/report/types'

let passed = 0
let failed = 0
function check(name: string, cond: boolean, extra = '') {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name} ${extra}`)
  }
}

// 直接用种子库初始化（绕过首次 localStorage 写入差异）
commit(buildSeedDatabase())

// ---- A. 批量核实：每条独立核实人，不串位 ----
console.log('A. 批量核实验收人归属')
{
  const pending = listReports({ status: '待核实' })
  check('种子含3条待核实', pending.length === 3, `实际 ${pending.length}`)
  const versions = new Map(pending.map((r) => [r.id, r.version]))
  // 给每条指定不同核实人
  const verifiers: Record<number, string> = { 101: '核实员-A', 102: '核实员-B', 103: '核实员-C' }
  const items = pending.map((r) => ({ id: r.id, expectedVersion: versions.get(r.id)!, verifier: verifiers[r.id] }))
  const res = batchVerify(items, '默认人', '整批意见')
  check('整批成功', res.ok === true)
  check('返回3条', res.verified.length === 3)
  check('101 核实人=A 不被后条覆盖', getReport(101).verifier === '核实员-A', getReport(101).verifier)
  check('102 核实人=B', getReport(102).verifier === '核实员-B', getReport(102).verifier)
  check('103 核实人=C', getReport(103).verifier === '核实员-C', getReport(103).verifier)
  check('三条均为已核实', [101, 102, 103].every((id) => getReport(id).status === '已核实'))
  check('三条版本各自+1', getReport(101).version === versions.get(101)! + 1)
  check('核实意见写入且不串字段', getReport(101).verifyOpinion === '整批意见')
  // 待办各生成一条，共 105 原有 + 101/102/103
  const openTodos = listTodos('open')
  check('待办新增3条且按编号独立', openTodos.length === 4, `实际 ${openTodos.length}`)
  check('待办键唯一无重复', new Set(openTodos.map((t) => t.todoKey)).size === openTodos.length)
}

// ---- B. 部分失败 → 整批回滚，不留半批，不产生重复待办 ----
console.log('B. 批量部分失败整批原子退回')
{
  resetReportDatabase()
  // 104 已录入（非法迁移到已核实），101/102 待核实合法
  const ids = [101, 102, 104]
  const before = ids.map((id) => ({ ...getReport(id) }))
  const todosBefore = listTodos('all').length
  const items = ids.map((id) => ({ id, expectedVersion: getReport(id).version }))
  const res = batchVerify(items, '默认人', '意见')
  check('整批判定失败', res.ok === false)
  check('失败明细含104', res.failures.some((f) => f.reportId === 104))
  check('失败明细标注非法迁移原因', res.failures.find((f) => f.reportId === 104)!.reason.includes('不能流转'))
  // 库内 101/102 即使循环中算过也必须保持原样
  check('101 状态回滚未被核实', getReport(101).status === '待核实', getReport(101).status)
  check('102 状态回滚未被核实', getReport(102).status === '待核实')
  check('101 核实人保持空', getReport(101).verifier === '', getReport(101).verifier)
  check('104 仍为已录入', getReport(104).status === '已录入')
  ids.forEach((id, i) => check(`${id} 版本未自增`, getReport(id).version === before[i].version))
  check('无新增待办（不会重复生成上报事项）', listTodos('all').length === todosBefore)
  check('verified 为空数组', res.verified.length === 0)
}

// B2. 批次内版本冲突 → 整批退回
{
  resetReportDatabase()
  // 另一人先核实 101
  verifyReport({ id: 101, expectedVersion: getReport(101).version, verifier: '抢先者', opinion: 'x' })
  const items = [
    // 101 用过期版本
    { id: 101, expectedVersion: 2 },
    { id: 102, expectedVersion: getReport(102).version },
  ]
  const res = batchVerify(items, '默认人', '意见')
  check('含冲突时整批失败', res.ok === false)
  check('101 报冲突原因', res.failures.find((f) => f.reportId === 101)!.reason.includes('冲突') || res.failures.find((f) => f.reportId === 101)!.reason.includes('版本'))
  check('102 未被连带核实', getReport(102).status === '待核实')
  check('101 保持抢先者结果不被覆盖', getReport(101).verifier === '抢先者')
}

// B3. 批次含历史已上报记录 → 整批退回，且历史不动
{
  resetReportDatabase()
  const res = batchVerify(
    [
      { id: 101, expectedVersion: getReport(101).version },
      { id: 106, expectedVersion: getReport(106).version },
    ],
    '默认人',
    '意见',
  )
  check('混入已上报记录则整批失败', res.ok === false)
  check('106 提示历史只读', res.failures.find((f) => f.reportId === 106)!.reason.includes('历史'))
  check('101 未被核实（整批退回）', getReport(101).status === '待核实')
  check('106 核实人未改', getReport(106).verifier === '核实员-王建国')
}

// B4. 空批次
{
  const res = batchVerify([], 'x', 'x')
  check('空批次不生效', res.ok === false)
}

// B5. 批次内重复 id
{
  resetReportDatabase()
  const v = getReport(101).version
  const res = batchVerify(
    [
      { id: 101, expectedVersion: v },
      { id: 101, expectedVersion: v },
    ],
    '默认人',
    '意见',
  )
  check('重复id整批失败', res.ok === false)
  check('101 未被写两遍', getReport(101).status === '待核实')
}

// ---- C. 历史已上报/已归档不许改写 ----
console.log('C. 历史记录只读')
{
  resetReportDatabase()
  const tryCall = (fn: () => unknown) => {
    try {
      fn()
      return null
    } catch (e) {
      return e as ReportServiceError
    }
  }
  const r106 = getReport(106)
  let err = tryCall(() => verifyReport({ id: 106, expectedVersion: r106.version, verifier: 'X', opinion: 'x' }))
  check('已上报拒绝核实', err?.code === 'LOCKED_RECORD', err?.message)
  err = tryCall(() => submitForVerify(106, r106.version, 'X'))
  check('已上报拒绝提交核实', err?.code === 'LOCKED_RECORD' || err?.code === 'INVALID_TRANSITION')
  const r107 = getReport(107)
  err = tryCall(() => submitDisaster(107, r107.version, 'X'))
  check('已归档拒绝上报', err?.code === 'LOCKED_RECORD' || err?.code === 'INVALID_TRANSITION')
  err = tryCall(() => archiveReport(107, r107.version))
  check('已归档不可再归档', err?.code === 'INVALID_TRANSITION')
  check('106 字段原样', getReport(106).submittedBy === '上报员-陈丽' && getReport(106).verifier === '核实员-王建国')
}

// ---- D. 并发核实同编号：只一个版本生效 ----
console.log('D. 乐观锁并发冲突')
{
  resetReportDatabase()
  const v = getReport(101).version
  // 两人读取同一版本 v；甲先提交成功
  const ok = verifyReport({ id: 101, expectedVersion: v, verifier: '甲', opinion: '甲的意见' })
  check('先到请求成功', ok.verifier === '甲' && ok.version === v + 1)
  // 乙仍拿旧版本 v 提交
  let err: ReportServiceError | null = null
  try {
    verifyReport({ id: 101, expectedVersion: v, verifier: '乙', opinion: '乙的意见' })
  } catch (e) {
    err = e as ReportServiceError
  }
  check('后到请求明确冲突 CONFLICT', err?.code === 'CONFLICT', err?.message)
  check('生效版本仍是甲，乙未覆盖', getReport(101).verifier === '甲', getReport(101).verifier)
  check('意见仍是甲的', getReport(101).verifyOpinion === '甲的意见')
  check('版本只前进一次', getReport(101).version === v + 1)
  // 乙刷新拿到新版本后可以…但状态机已到已核实，再核实被状态机拒绝（而非静默）
  let err2: ReportServiceError | null = null
  try {
    verifyReport({ id: 101, expectedVersion: v + 1, verifier: '乙', opinion: '乙的意见' })
  } catch (e) {
    err2 = e as ReportServiceError
  }
  check('乙刷新后重复核实被状态机拒绝', err2?.code === 'INVALID_TRANSITION')
}

// ---- E. 待办幂等 + 上报同事务关闭 ----
console.log('E. 跨模块待办幂等与关闭')
{
  resetReportDatabase()
  // 105 种子已核实且已有一条 open 待办
  const todosBefore = listTodos('all').filter((t) => t.refReportId === 105).length
  check('105 初始恰有1条待办', todosBefore === 1)
  // 上报 105：同事务关闭待办
  const submitted = submitDisaster(105, getReport(105).version, '上报员')
  check('上报成功', submitted.status === '已上报')
  const t105 = listTodos('all').filter((t) => t.refReportId === 105)
  check('待办关闭且仍只有1条（不重复）', t105.length === 1 && t105[0].status === 'closed')
  check('无开放待办残留', listTodos('open').filter((t) => t.refReportId === 105).length === 0)
}

// E2. 整批成功时待办与状态同一事务可见
{
  resetReportDatabase()
  const items = [101, 102, 103].map((id) => ({ id, expectedVersion: getReport(id).version, verifier: `V${id}` }))
  const res = batchVerify(items, 'd', 'op')
  check('批量成功后待办立即可见', res.ok && listTodos('open').filter((t) => [101, 102, 103].includes(t.refReportId)).length === 3)
}

// ---- F. 登记：唯一编号、独立事务 ----
console.log('F. 登记新速报')
{
  resetReportDatabase()
  const created = createReport(
    {
      code: 'ZQSB-2026-900',
      hazardCode: 'YH-9999',
      occurredAt: '2026-10-06 08:00',
      disasterType: '滑坡',
      affectedArea: '测试',
      casualties: '无',
      economicLoss: '0',
      submitForVerify: true,
    },
    '登记员',
  )
  check('登记成功进入待核实', created.status === '待核实' && created.version === 1)
  let err: ReportServiceError | null = null
  try {
    createReport(
      {
        code: 'ZQSB-2026-900',
        hazardCode: 'YH-9998',
        occurredAt: '2026-10-06 09:00',
        disasterType: '崩塌',
        affectedArea: '',
        casualties: '',
        economicLoss: '',
        submitForVerify: false,
      },
      '登记员',
    )
  } catch (e) {
    err = e as ReportServiceError
  }
  check('重复编号被拒绝', err?.code === 'DUPLICATE_CODE')
  check('重复编号未插入', listReports().filter((r) => r.code === 'ZQSB-2026-900').length === 1)
  // 与已有种子编号冲突
  let err2: ReportServiceError | null = null
  try {
    createReport(
      {
        code: 'ZQSB-2026-001',
        hazardCode: 'YH-1',
        occurredAt: 'x',
        disasterType: '滑坡',
        affectedArea: '',
        casualties: '',
        economicLoss: '',
        submitForVerify: false,
      },
      '登记员',
    )
  } catch (e) {
    err2 = e as ReportServiceError
  }
  check('与种子编号冲突被拒绝', err2?.code === 'DUPLICATE_CODE')
  // 必填校验
  let err3: ReportServiceError | null = null
  try {
    createReport(
      { code: '', hazardCode: 'Y', occurredAt: 'x', disasterType: '滑坡', affectedArea: '', casualties: '', economicLoss: '', submitForVerify: false },
      '登记员',
    )
  } catch (e) {
    err3 = e as ReportServiceError
  }
  check('必填校验', err3?.code === 'VALIDATION')
}

// ---- G. 单条事务：失败不影响其它记录 ----
console.log('G. 单条操作独立性')
{
  resetReportDatabase()
  const v102 = getReport(102).version
  let err: ReportServiceError | null = null
  try {
    // 101 用错误版本触发冲突
    verifyReport({ id: 101, expectedVersion: 999, verifier: 'X', opinion: 'x' })
  } catch (e) {
    err = e as ReportServiceError
  }
  check('单条冲突报错', err?.code === 'CONFLICT')
  check('102 版本不受影响', getReport(102).version === v102)
  // 不存在的 id
  let err4: ReportServiceError | null = null
  try {
    verifyReport({ id: 99999, expectedVersion: 0, verifier: 'X', opinion: 'x' })
  } catch (e) {
    err4 = e as ReportServiceError
  }
  check('不存在记录 NOT_FOUND', err4?.code === 'NOT_FOUND')
}

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) {
  process.exit(1)
}
