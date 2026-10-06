<template>
  <section class="page" data-module="report">
    <header class="page-head">
      <div>
        <h2>灾情速报管理</h2>
        <p class="page-desc">
          灾情速报的登记、批量核实与上报。批量核实整批原子生效：任一条不过则全部退回；同一编号并发核实时以先提交的版本为准。
        </p>
      </div>
      <div class="page-actions">
        <label class="operator-switch">
          当前操作员
          <select :value="store.operator" @change="onOperatorChange">
            <option v-for="name in OPERATORS" :key="name" :value="name">{{ name }}</option>
          </select>
        </label>
        <RouterLink class="btn primary" :to="{ name: 'report-create' }">登记灾情速报</RouterLink>
        <button class="btn" type="button" @click="exportRows">导出清单</button>
        <button class="btn ghost" type="button" @click="resetDemo">重置演示数据</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <!-- 跨模块待办：核实通过的速报在此生成「上报灾情」事项，上报后同事务关闭。 -->
    <section class="todo-panel">
      <h3>跨模块待办 · 上报事项</h3>
      <p v-if="!openTodos.length" class="empty-state">暂无待上报事项</p>
      <ul v-else class="todo-list">
        <li v-for="todo in openTodos" :key="todo.todoKey" class="todo-item">
          <span class="todo-title">{{ todo.title }}</span>
          <span class="todo-meta">来源：灾情速报核实 · 生成于 {{ todo.createdAt }}</span>
          <RouterLink class="link" :to="{ name: 'report-detail', params: { id: todo.refReportId } }">
            前往处理
          </RouterLink>
        </li>
      </ul>
    </section>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reloadView">
      <label class="filter-item">
        <span>关键字</span>
        <input v-model="keyword" placeholder="按速报编号/隐患点/灾害类型检索" />
      </label>
      <label class="filter-item">
        <span>状态</span>
        <select v-model="statusFilter">
          <option value="">全部</option>
          <option v-for="status in statuses" :key="status" :value="status">{{ status }}</option>
        </select>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <!-- 批量核实条：每条核实人单独绑定，随批次按 id 提交，不再共用一个循环变量。 -->
    <div class="batch-bar">
      <label>
        <input type="checkbox" :checked="allPendingSelected" @change="toggleAll" />
        全选待核实
      </label>
      <label class="batch-verifier">
        默认核实人
        <input v-model="batchVerifier" :placeholder="store.operator" />
      </label>
      <label class="batch-opinion">
        核实意见（整批共用）
        <input v-model="batchOpinion" placeholder="如：现场复核属实" />
      </label>
      <button class="btn primary" type="button" :disabled="!selected.size" @click="onBatchVerify">
        批量核实（{{ selected.size }} 条）
      </button>
      <span v-if="batchMessage" :class="batchOk ? 'ok-text' : 'error-text'">{{ batchMessage }}</span>
    </div>

    <div v-if="batchFailures.length" class="batch-failures">
      <strong>整批已退回，以下记录未通过（库内无任何变更，也未生成待办）：</strong>
      <ul>
        <li v-for="failure in batchFailures" :key="failure.reportId">
          {{ failure.reportCode }}（#{{ failure.reportId }}）：{{ failure.reason }}
        </li>
      </ul>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th>选择</th>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>核实人</th>
          <th>数据版本</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id" :class="{ 'row-locked': isLocked(row) }">
          <td>
            <input
              v-if="row.status === '待核实'"
              type="checkbox"
              :checked="selected.has(row.id)"
              @change="toggleOne(row)"
            />
          </td>
          <td>
            <RouterLink class="link" :to="{ name: 'report-detail', params: { id: row.id } }">
              {{ row.code }}
            </RouterLink>
          </td>
          <td>{{ row.hazardCode }}</td>
          <td>{{ row.occurredAt }}</td>
          <td>{{ row.disasterType }}</td>
          <td>{{ row.affectedArea || '—' }}</td>
          <td>{{ row.casualties || '—' }}</td>
          <td>{{ row.economicLoss || '—' }}</td>
          <td>
            <template v-if="row.status === '待核实'">
              <input
                class="cell-verifier"
                :value="rowVerifierMap[row.id] ?? ''"
                :placeholder="store.operator"
                @input="setRowVerifier(row.id, ($event.target as HTMLInputElement).value)"
              />
            </template>
            <span v-else>{{ row.verifier || '—' }}</span>
          </td>
          <td>v{{ row.version }}</td>
          <td>
            {{ row.status }}
            <span v-if="isLocked(row)" class="lock-tag">历史只读</span>
          </td>
          <td class="row-actions">
            <RouterLink class="link" :to="{ name: 'report-detail', params: { id: row.id } }">详情</RouterLink>
            <button v-if="row.status === '已录入'" class="link" type="button" @click="onSubmitVerify(row)">
              提交核实
            </button>
            <button v-if="row.status === '待核实'" class="link" type="button" @click="onSingleVerify(row)">
              确认核实
            </button>
            <button v-if="row.status === '已核实'" class="link" type="button" @click="onSubmitDisaster(row)">
              上报灾情
            </button>
            <button v-if="row.status === '已上报'" class="link" type="button" @click="onArchive(row)">
              归档
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 5" class="empty-state">暂无符合条件的灾情速报</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条灾情速报记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'

import { OPERATORS, useSessionStore } from '@/stores/session'
import {
  archiveReport,
  batchVerify,
  submitDisaster,
  submitForVerify,
  verifyReport,
} from '@/data/report/service'
import type { BatchVerifyItem } from '@/data/report/service'
import type { DisasterReport } from '@/data/report/types'
import { downloadReportCsv, useReportData } from './report-data'

const store = useSessionStore()
const { rows, openTodos, reload, resetDemo: resetData, runGuarded } = useReportData()

const columns = ['速报编号', '隐患点编号', '发生时间', '灾害类型', '受灾范围', '伤亡人数', '经济损失']
const statuses = ['已录入', '待核实', '已核实', '已上报', '已归档']

const keyword = ref('')
const statusFilter = ref('')
const errorMessage = ref('')

// 选中集合与「每条核实人」均按速报 id 建索引：勾选、填写核实人、提交批次三者
// 通过 id 一一对应，循环处理时各写各的行，不会把后一条的核实人带到前一条（串位根因修复点）。
const selected = reactive(new Set<number>())
// 勾选那一刻冻结的版本：批量提交做乐观锁比对，他人先核实时本批整体冲突退回。
const selectedVersions = new Map<number, number>()
const rowVerifierMap = reactive<Record<number, string>>({})

const batchVerifier = ref('')
const batchOpinion = ref('现场批量复核，情况属实')
const batchMessage = ref('')
const batchOk = ref(false)
const batchFailures = ref<{ reportId: number; reportCode: string; reason: string }[]>([])

const total = computed(() => rows.value.length)
const stats = computed(() => [
  { label: '速报总数', value: rows.value.length },
  { label: '待核实', value: rows.value.filter((row) => row.status === '待核实').length },
  { label: '已核实待上报', value: rows.value.filter((row) => row.status === '已核实').length },
  { label: '跨模块待办', value: openTodos.value.length },
])
const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => row.status === status).length,
  })),
)

const pendingRows = computed(() => rows.value.filter((row) => row.status === '待核实'))
const allPendingSelected = computed(
  () => pendingRows.value.length > 0 && pendingRows.value.every((row) => selected.has(row.id)),
)

function isLocked(row: Pick<DisasterReport, 'status'>): boolean {
  return row.status === '已上报' || row.status === '已归档'
}

function setRowVerifier(id: number, value: string): void {
  rowVerifierMap[id] = value
}

function toggleOne(row: Pick<DisasterReport, 'id' | 'version'>): void {
  if (selected.has(row.id)) {
    selected.delete(row.id)
    selectedVersions.delete(row.id)
  } else {
    selected.add(row.id)
    selectedVersions.set(row.id, row.version)
  }
}

function toggleAll(event: Event): void {
  const checked = (event.target as HTMLInputElement).checked
  selected.clear()
  selectedVersions.clear()
  if (checked) {
    for (const row of pendingRows.value) {
      selected.add(row.id)
      selectedVersions.set(row.id, row.version)
    }
  }
}

function clearSelection(): void {
  selected.clear()
  selectedVersions.clear()
}

function onOperatorChange(event: Event): void {
  store.setOperator((event.target as HTMLSelectElement).value)
}

function reloadView(): void {
  reload({ keyword: keyword.value, status: statusFilter.value })
}

function resetFilters(): void {
  keyword.value = ''
  statusFilter.value = ''
  reloadView()
}

function resetDemo(): void {
  resetData()
  keyword.value = ''
  statusFilter.value = ''
  batchMessage.value = ''
  batchFailures.value = []
  clearSelection()
  reloadView()
}

function exportRows(): void {
  downloadReportCsv()
}

function onSubmitVerify(row: Pick<DisasterReport, 'id' | 'version'>): void {
  runGuarded(
    () => submitForVerify(row.id, row.version, store.operator),
    reloadView,
    errorMessage,
  )
}

function onSingleVerify(row: Pick<DisasterReport, 'id' | 'version'>): void {
  runGuarded(
    () =>
      verifyReport({
        id: row.id,
        expectedVersion: row.version,
        verifier: rowVerifierMap[row.id]?.trim() || store.operator,
        opinion: batchOpinion.value,
      }),
    reloadView,
    errorMessage,
  )
}

function onBatchVerify(): void {
  batchMessage.value = ''
  batchOk.value = false
  batchFailures.value = []
  const items: BatchVerifyItem[] = [...selected].map((id) => ({
    id,
    expectedVersion: selectedVersions.get(id) as number,
    verifier: rowVerifierMap[id] ?? '',
  }))
  const result = batchVerify(items, batchVerifier.value.trim() || store.operator, batchOpinion.value)
  if (result.ok) {
    batchOk.value = true
    batchMessage.value = result.message
    clearSelection()
  } else {
    batchOk.value = false
    batchMessage.value = result.message
    batchFailures.value = result.failures
    // 整批失败后清空勾选快照：必须重新按最新版本勾选提交，避免拿旧版本反复撞冲突。
    clearSelection()
  }
  reloadView()
}

function onSubmitDisaster(row: Pick<DisasterReport, 'id' | 'version'>): void {
  runGuarded(() => submitDisaster(row.id, row.version, store.operator), reloadView, errorMessage)
}

function onArchive(row: Pick<DisasterReport, 'id' | 'version'>): void {
  runGuarded(() => archiveReport(row.id, row.version), reloadView, errorMessage)
}

reloadView()
</script>

<style scoped>
.page-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
.operator-switch {
  font-size: 12px;
  color: var(--muted);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.todo-panel {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 12px;
}
.todo-panel h3 {
  margin: 0 0 8px;
  font-size: 14px;
}
.todo-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.todo-item {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  background: #f3f8ff;
  border: 1px solid #cfe0f7;
  border-radius: 6px;
  padding: 6px 10px;
}
.todo-title {
  font-weight: 600;
}
.todo-meta {
  color: var(--muted);
  font-size: 12px;
  flex: 1;
}
.batch-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  background: #fff;
  border: 1px dashed var(--border);
  border-radius: 8px;
  padding: 8px 10px;
  margin-bottom: 10px;
  font-size: 13px;
}
.batch-verifier,
.batch-opinion {
  display: flex;
  flex-direction: column;
  font-size: 12px;
  color: var(--muted);
}
.batch-opinion {
  flex: 1;
  min-width: 220px;
}
.cell-verifier {
  width: 110px;
  padding: 2px 4px;
}
.batch-failures {
  border: 1px solid #f0b8b0;
  background: #fdf3f2;
  border-radius: 8px;
  padding: 8px 12px;
  margin-bottom: 10px;
  font-size: 13px;
  color: #7a271a;
}
.batch-failures ul {
  margin: 6px 0 0;
  padding-left: 18px;
}
.row-locked {
  background: #fafafa;
}
.lock-tag {
  display: inline-block;
  margin-left: 6px;
  font-size: 11px;
  color: #7a5b00;
  background: #fdf0c8;
  border-radius: 999px;
  padding: 0 8px;
}
.ok-text {
  color: #067647;
}
</style>
