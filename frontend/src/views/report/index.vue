<template>
  <section class="page" data-module="report">
    <header class="page-head">
      <div>
        <h2>灾情速报管理</h2>
        <p class="page-desc">围绕速报编号、隐患点编号、发生时间、灾害类型做登记、批量核实与上报；每条记录独立事务，批量核实整批成功或整批退回。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="router.push('/report/new')">登记灾情速报</button>
        <button class="btn" type="button" @click="exportRows">导出灾情速报清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <!-- 批量核实工具条：勾选的必须是待核实速报；核实人逐条带给后端，不会共用一个可变引用 -->
    <div class="batch-bar">
      <label class="batch-check">
        <input
          type="checkbox"
          :checked="allVerifiableChecked"
          :indeterminate.prop="someVerifiableChecked"
          @change="toggleAll"
        />
        全选待核实（{{ verifiableRows.length }} 条）
      </label>
      <span class="batch-count">已选 {{ selectedIds.size }} 条</span>
      <label class="filter-item">
        <span>批量核实人</span>
        <input v-model="batchVerifier" placeholder="填写核实人姓名" />
      </label>
      <button class="btn primary" type="button" :disabled="selectedIds.size === 0" @click="runBatchVerify">
        批量确认核实
      </button>
      <button class="btn ghost" type="button" :disabled="selectedIds.size === 0" @click="clearSelection">
        清空选择
      </button>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th class="col-check">选择</th>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>核实人</th>
          <th>核实时间</th>
          <th>版本</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td>
            <input
              v-if="String(row.status) === '待核实'"
              type="checkbox"
              :value="Number(row.id)"
              v-model="selectedModel"
            />
            <span v-else class="check-disabled">—</span>
          </td>
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row['核实人'] || '—' }}</td>
          <td>{{ row['核实时间'] || '—' }}</td>
          <td>v{{ Number(row.version ?? 1) }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="router.push(`/report/${row.id}`)">详情</button>
            <template v-if="String(row.status) === '已录入'">
              <button class="link" type="button" @click="submitVerify(row)">提交核实</button>
            </template>
            <template v-else-if="String(row.status) === '待核实'">
              <button class="link" type="button" @click="openVerifyDialog(row)">确认核实</button>
            </template>
            <template v-else-if="String(row.status) === '已核实'">
              <button class="link" type="button" @click="openReportDialog(row)">上报灾情</button>
            </template>
            <template v-else>
              <span class="frozen-hint">历史已{{ row.status }}，锁定</span>
            </template>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 6" class="empty-state">暂无灾情速报数据，可先登记灾情速报</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条灾情速报记录；已上报/已归档为历史记录，任何操作都不会改写</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="successMessage" class="success-text">{{ successMessage }}</span>
    </footer>

    <PromptDialog
      :open="dialog.open"
      :title="dialog.title"
      :label="dialog.label"
      :hint="dialog.hint"
      :initial="dialog.initial"
      :error="dialog.error"
      placeholder="请输入姓名"
      @confirm="confirmDialog"
      @cancel="closeDialog"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'

import {
  batchVerifyReports,
  listReports,
  submitForVerify,
  submitReport,
  verifyReport,
} from '@/api/report-service'
import { downloadEntries, moduleMeta } from '@/api/local-service'
import { subscribe } from '@/data/local-store'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'
import PromptDialog from '@/components/PromptDialog.vue'

const router = useRouter()
const session = useSessionStore()

const meta = moduleMeta('report')
const columns = ['速报编号', '隐患点编号', '发生时间', '灾害类型', '受灾范围', '伤亡人数', '经济损失']
const statuses = ['已录入', '待核实', '已核实', '已上报', '已归档']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const successMessage = ref('')
const filters = reactive<Record<string, string>>({})
const filterFields = ['速报编号', '隐患点编号', '发生时间']

// 选中集合只存编号；真正发起批量核实时，逐条从最新列表取版本号、逐条附核实人。
const selectedIds = ref<Set<number>>(new Set())
const selectedModel = computed<number[]>({
  get: () => [...selectedIds.value],
  set: (next: number[]) => {
    selectedIds.value = new Set(next)
  },
})
const batchVerifier = ref(session.operator)

const verifiableRows = computed(() => rows.value.filter((row) => String(row.status) === '待核实'))
const verifiableIds = computed(() => verifiableRows.value.map((row) => Number(row.id)))
const allVerifiableChecked = computed(
  () => verifiableIds.value.length > 0 && verifiableIds.value.every((id) => selectedIds.value.has(id)),
)
const someVerifiableChecked = computed(
  () => !allVerifiableChecked.value && verifiableIds.value.some((id) => selectedIds.value.has(id)),
)

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const stats = computed(() => [
  { label: '速报总数', value: rows.value.length },
  { label: '已核实数', value: rows.value.filter((row) => ['已核实', '已上报', '已归档'].includes(String(row.status))).length },
  { label: '待上报数', value: rows.value.filter((row) => String(row.status) === '已核实').length },
])

type DialogState = {
  open: boolean
  mode: 'verify' | 'report'
  title: string
  label: string
  hint?: string
  initial: string
  error?: string
  row: EntryRow | null
}

const dialog = reactive<DialogState>({
  open: false,
  mode: 'verify',
  title: '',
  label: '',
  initial: '',
  row: null,
})

function toggleAll(event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  const next = new Set(selectedIds.value)
  for (const id of verifiableIds.value) {
    if (checked) {
      next.add(id)
    } else {
      next.delete(id)
    }
  }
  selectedIds.value = next
}

function clearSelection() {
  selectedIds.value = new Set()
}

function exportRows() {
  downloadEntries(meta.key)
}

function flash(message: string, ok: boolean) {
  if (ok) {
    successMessage.value = message
    errorMessage.value = ''
  } else {
    errorMessage.value = message
    successMessage.value = ''
  }
}

function resetFilters() {
  for (const key of Object.keys(filters)) {
    filters[key] = ''
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  successMessage.value = ''
  // 每次重新读取都拿最新数据；跨标签页有新提交时由 subscribe 触发，确保版本号不过期。
  rows.value = listReports()
  total.value = rows.value.length
  // 清掉已经不在「待核实」状态的选择，避免把别人核实过的记录再带进批量。
  selectedIds.value = new Set(
    [...selectedIds.value].filter((id) =>
      verifiableRows.value.some((row) => Number(row.id) === id),
    ),
  )
}

function submitVerify(row: EntryRow) {
  const result = submitForVerify(Number(row.id), Number(row.version ?? 1))
  flash(result.message, result.ok)
  if (result.ok) {
    reload()
  } else if (result.code === 409) {
    reload()
  }
}

function openVerifyDialog(row: EntryRow) {
  Object.assign(dialog, {
    open: true,
    mode: 'verify',
    row,
    title: `确认核实速报 ${row['速报编号']}`,
    label: '核实人',
    hint: `记录版本 v${Number(row.version ?? 1)}，提交时带版本校验，他人先核实将明确冲突`,
    initial: session.operator,
    error: undefined,
  })
}

function openReportDialog(row: EntryRow) {
  Object.assign(dialog, {
    open: true,
    mode: 'report',
    row,
    title: `上报灾情速报 ${row['速报编号']}`,
    label: '上报人',
    hint: '上报后该速报成为历史记录，内容与状态锁定不可改写',
    initial: session.operator,
    error: undefined,
  })
}

function closeDialog() {
  dialog.open = false
  dialog.row = null
  dialog.error = undefined
}

function confirmDialog(value: string) {
  if (!dialog.row) {
    closeDialog()
    return
  }
  const row = dialog.row
  if (!value.trim()) {
    dialog.error = dialog.mode === 'verify' ? '请填写核实人' : '请填写上报人'
    return
  }
  const result =
    dialog.mode === 'verify'
      ? verifyReport({
          id: Number(row.id),
          verifier: value,
          expectedVersion: Number(row.version ?? 1),
        })
      : submitReport({
          id: Number(row.id),
          reporter: value,
          expectedVersion: Number(row.version ?? 1),
        })
  if (!result.ok) {
    dialog.error = result.message
    if (result.code === 409) {
      closeDialog()
      reload()
      flash(result.message, false)
    }
    return
  }
  closeDialog()
  flash(result.message, true)
  reload()
}

function runBatchVerify() {
  const verifier = batchVerifier.value.trim()
  if (!verifier) {
    flash('请先填写批量核实人', false)
    return
  }
  // 关键：逐条从当前最新列表快照构造入参，每条各持一份核实人与版本号，
  // 服务端在同一事务里独立处理，任何一条失败整批退回。
  const items = [...selectedIds.value]
    .map((id) => rows.value.find((row) => Number(row.id) === id))
    .filter((row): row is EntryRow => Boolean(row) && String(row!.status) === '待核实')
    .map((row) => ({
      id: Number(row.id),
      verifier,
      expectedVersion: Number(row.version ?? 1),
    }))
  if (items.length === 0) {
    flash('所选记录已不是待核实状态，请重新选择', false)
    clearSelection()
    return
  }
  const result = batchVerifyReports(items)
  flash(result.message, result.ok)
  clearSelection()
  reload()
}

let unsubscribe: (() => void) | null = null
onMounted(() => {
  reload()
  // 另一标签页（第二名值班员）提交后，本页立即重载并暴露最新版本号。
  unsubscribe = subscribe(reload)
})
onBeforeUnmount(() => {
  unsubscribe?.()
})
</script>

<style scoped>
.col-check { width: 42px; }
.check-disabled { color: var(--muted); }
.batch-bar {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  background: #eef4ff;
  border: 1px solid #c7d9f7;
  border-radius: 8px;
  padding: 8px 12px;
  margin-bottom: 10px;
  font-size: 13px;
}
.batch-check { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.batch-count { color: var(--muted); white-space: nowrap; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.frozen-hint { color: var(--muted); font-size: 12px; }
.success-text { color: #067647; }
</style>
