// 灾情速报修复点的端到端校验：直接跑业务服务层（localStorage 用内存版替身）。
import { assert } from 'node:console'
import { bindStorage, resetDatabase } from '@/data/local-store'
import {
  batchVerifyReports,
  createReport,
  getReport,
  listReportTodos,
  listReports,
  submitForVerify,
  submitReport,
  verifyReport,
} from '@/api/report-service'

let passed = 0
function check(name: string, cond: boolean, detail = '') {
  if (!cond) {
    console.error(`✗ ${name}${detail ? ` —— ${detail}` : ''}`)
    process.exit(1)
  }
  passed += 1
  console.log(`✓ ${name}`)
}

class MemoryStorage {
  private map = new Map<string, string>()
  get length() { return this.map.size }
  clear() { this.map.clear() }
  getItem(key: string) { return this.map.has(key) ? this.map.get(key)! : null }
  key(index: number) { return [...this.map.keys()][index] ?? null }
  removeItem(key: string) { this.map.delete(key) }
  setItem(key: string, value: string) { this.map.set(key, String(value)) }
}

bindStorage(new MemoryStorage() as unknown as Storage)
resetDatabase()

// --- 1. 单条核实：核实人写到正确的记录上，且生成一条待办 --------------------
let r2 = getReport(2)!
let one = verifyReport({ id: 2, verifier: '张三', expectedVersion: Number(r2.version) })
check('单条核实成功', one.ok, one.message)
r2 = getReport(2)!
check('核实人=张三 写到 REPO-0002', r2['核实人'] === '张三', String(r2['核实人']))
check('核实后版本号 +1', Number(r2.version) === 2)
check('生成恰好一条待上报待办', listReportTodos('待办').filter((t) => t.refId === 2).length === 1)

// 重复核实被拒，待办不重复生成
const dup = verifyReport({ id: 2, verifier: '李四', expectedVersion: 2 })
check('重复核实被拒绝', !dup.ok && dup.code === 422, dup.message)
check('拒绝后待办仍是一条', listReportTodos('待办').filter((t) => t.refId === 2).length === 1)

// --- 2. 批量核实：后一条的核实人不能写到前一条（数据不串位） -----------------
// 先补造一批待核实速报
for (const code of ['REPO-T1', 'REPO-T2', 'REPO-T3']) {
  createReport({
    速报编号: code, 隐患点编号: 'HAZA-X', 发生时间: '',
    灾害类型: '滑坡', 受灾范围: '', 伤亡人数: '0', 经济损失: '',
  })
}
const created = listReports().filter((r) => ['REPO-T1', 'REPO-T2', 'REPO-T3'].includes(String(r['速报编号'])))
for (const r of created) {
  const s = submitForVerify(Number(r.id))
  check(`提交核实 ${r['速报编号']}`, s.ok, s.message)
}
const pending = listReports()
  .filter((r) => ['REPO-T1', 'REPO-T2', 'REPO-T3'].includes(String(r['速报编号'])))
  .map((r) => ({ id: Number(r.id), verifier: '', expectedVersion: Number(r.version) }))
// 每条带各自不同的核实人，顺序故意打乱
const verifiers = ['核实人甲', '核实人乙', '核实人丙']
pending.forEach((p, i) => (p.verifier = verifiers[i]))

const batch = batchVerifyReports(pending)
check('批量核实整体成功', batch.ok, batch.message)
for (const p of pending) {
  const after = getReport(p.id)!
  const code = String(after['速报编号'])
  const want = verifiers[pending.findIndex((x) => x.id === p.id)]
  check(`核实人不串位：${code} 的核实人是 ${want}`, after['核实人'] === want, `实际=${String(after['核实人'])}`)
  check(`${code} 版本号递增`, Number(after.version) === p.expectedVersion + 1)
  check(`${code} 恰好一条待办`, listReportTodos().filter((t) => t.refId === p.id).length === 1)
}

// --- 3. 整批原子性：中间一条不合法（已被核实过），整批退回，不落任何半批 ------
resetDatabase()
// 构造：id=2、3 待核实；先把 id=3 核实掉
let r3 = getReport(3)!
verifyReport({ id: 3, verifier: '王五', expectedVersion: Number(r3.version) })
const before2 = JSON.stringify(getReport(2))
const before3 = JSON.stringify(getReport(3))
const todosBefore = listReportTodos().length
const failBatch = batchVerifyReports([
  { id: 2, verifier: '赵六', expectedVersion: Number(getReport(2)!.version) },
  { id: 3, verifier: '钱七', expectedVersion: Number(getReport(3)!.version) }, // 已是已核实
])
check('混入非法记录时批量失败', !failBatch.ok, failBatch.message)
check('失败信息说明整批退回', failBatch.message.includes('整批退回'))
check('前一条未被半批改写（无串位/无半批）', JSON.stringify(getReport(2)) === before2)
check('后一条保持原样', JSON.stringify(getReport(3)) === before3)
check('失败后没有新增任何待办（不重复生成上报事项）', listReportTodos().length === todosBefore)
check('REPO-0002 上没有错误的核实人', getReport(2)!['核实人'] == null)

// 整批失败后可原样重试整批（现在两条都是待核实 -> 把3退回做不到，改为2和新建的合法记录）
// 直接验证：重新批量合法集合可以成功
const retry = batchVerifyReports([{ id: 2, verifier: '赵六', expectedVersion: Number(getReport(2)!.version) }])
check('整批退回后可正常重试', retry.ok, retry.message)
check('重试只产生一条待办', listReportTodos().filter((t) => t.refId === 2).length === 1)

// --- 4. 历史已上报记录不许改写 ------------------------------------------------
resetDatabase()
const r5 = getReport(5)! // 种子里已是已上报
const frozen5 = JSON.stringify(r5)
const tries = [
  submitForVerify(5, Number(r5.version)),
  verifyReport({ id: 5, verifier: '黑客', expectedVersion: Number(r5.version) }),
  submitReport({ id: 5, reporter: '黑客', expectedVersion: Number(r5.version) }),
]
check('已上报记录的提交核实/确认核实/上报全部被拒', tries.every((t) => !t.ok && t.code === 422))
check('被拒后记录字节级不变', JSON.stringify(getReport(5)) === frozen5)
const archivedLike = getReport(5)!
check('已上报记录核实人未被覆盖', archivedLike['核实人'] === '值班管理员')

// --- 5. 两人同时核实同一编号：只允许一个版本生效，后到请求明确冲突 ------------
resetDatabase()
const v = Number(getReport(2)!.version)
const first = verifyReport({ id: 2, verifier: '值班员甲', expectedVersion: v })
check('先到请求生效', first.ok, first.message)
const second = verifyReport({ id: 2, verifier: '值班员乙', expectedVersion: v })
check('后到请求返回 409 冲突', !second.ok && second.code === 409, second.message)
check('冲突信息标明版本与冲突原因', second.message.includes('已被他人先一步核实'))
const winner = getReport(2)!
check('只有甲的版本生效', winner['核实人'] === '值班员甲' && Number(winner.version) === v + 1,
  `核实人=${String(winner['核实人'])} version=${winner.version}`)
check('冲突的后到请求没有多生成待办', listReportTodos().filter((t) => t.refId === 2).length === 1)

// 乙刷新到新版本后可以做后续动作（上报），不会被永久阻塞
const afterRefresh = submitReport({ id: 2, reporter: '值班员乙', expectedVersion: v + 1 })
check('基于新版本的后续上报成功', afterRefresh.ok, afterRefresh.message)
check('上报后待办关闭', listReportTodos().find((t) => t.refId === 2)!.status === '已完成')

// 上报后再次冲突尝试：对已上报记录的旧版本写也被挡（422 冻结优先）
const stale = verifyReport({ id: 2, verifier: '值班员甲', expectedVersion: v })
check('历史记录的陈旧请求被拒', !stale.ok)

// --- 6. 状态机：只有待核实才能确认核实，只有已核实才能上报 ----------------------
resetDatabase()
check('已录入不能直接确认核实', !verifyReport({ id: 1, verifier: '甲', expectedVersion: 1 }).ok)
check('已录入不能直接上报', !submitReport({ id: 1, reporter: '甲', expectedVersion: 1 }).ok)
check('待核实不能直接上报', !submitReport({ id: 2, reporter: '甲', expectedVersion: 1 }).ok)

// --- 7. 登记重复编号被拒，且失败不留脏数据 ------------------------------------
resetDatabase()
const dupCode = createReport({
  速报编号: 'REPO-0001', 隐患点编号: '', 发生时间: '',
  灾害类型: '滑坡', 受灾范围: '', 伤亡人数: '0', 经济损失: '',
})
check('重复速报编号登记被拒', !dupCode.ok && dupCode.code === 422, dupCode.message)
check('拒绝后总数不变', listReports().length === 5)

// 批内重复选择直接拒绝
const dupInBatch = batchVerifyReports([
  { id: 2, verifier: '甲', expectedVersion: 1 },
  { id: 2, verifier: '乙', expectedVersion: 1 },
])
check('批内重复编号整批退回', !dupInBatch.ok && dupInBatch.message.includes('重复'))

console.log(`\n全部 ${passed} 项校验通过`)
