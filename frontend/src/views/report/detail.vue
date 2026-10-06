<template>
  <section class="page" data-module="report-detail">
    <header class="page-head">
      <div>
        <h2>灾情速报详情</h2>
        <p class="page-desc">查看速报完整信息、核实结论与上报去向；已上报/已归档为历史记录，页面上不提供任何改写入口。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="router.push('/report')">返回列表</button>
      </div>
    </header>

    <div v-if="!row" class="empty-state card-box">
      没有找到这条灾情速报，可能已被重置数据。
      <button class="btn" type="button" @click="router.push('/report')">返回列表</button>
    </div>

    <template v-else>
      <div class="detail-grid">
        <article v-for="field in meta.fields" :key="field" class="detail-item">
          <span class="detail-label">{{ field }}</span>
          <strong class="detail-value">{{ row[field] ?? '—' }}</strong>
        </article>
        <article class="detail-item">
          <span class="detail-label">核实人</span>
          <strong class="detail-value">{{ row['核实人'] || '—' }}</strong>
        </article>
        <article class="detail-item">
          <span class="detail-label">核实时间</span>
          <strong class="detail-value">{{ row['核实时间'] || '—' }}</strong>
        </article>
        <article class="detail-item">
          <span class="detail-label">上报人</span>
          <strong class="detail-value">{{ row['上报人'] || '—' }}</strong>
        </article>
        <article class="detail-item">
          <span class="detail-label">上报时间</span>
          <strong class="detail-value">{{ row['上报时间'] || '—' }}</strong>
        </article>
        <article class="detail-item">
          <span class="detail-label">记录版本</span>
          <strong class="detail-value">v{{ Number(row.version ?? 1) }}</strong>
        </article>
        <article class="detail-item">
          <span class="detail-label">当前状态</span>
          <strong class="detail-value status-tag">{{ row.status }}</strong>
        </article>
      </div>

      <div v-if="frozen" class="frozen-banner">
        该速报已于 {{ row['上报时间'] || '归档时' }} 由 {{ row['上报人'] || '—' }} 上报，属于历史已上报记录，字段、核实人与状态均已锁定。
      </div>

      <div class="detail-actions">
        <button v-if="String(row.status) === '已录入'" class="btn" type="button" @click="doSubmitVerify">提交核实</button>
        <button v-if="String(row.status) === '待核实'" class="btn primary" type="button" @click="openVerify">确认核实</button>
        <button v-if="String(row.status) === '已核实'" class="btn primary" type="button" @click="openReport">上报灾情</button>
      </div>

      <section v-if="todo" class="todo-box">
        <h3>跨模块待办</h3>
        <p>
          {{ todo.title }} —— {{ todo.status }}
          <span v-if="todo.completedAt">（完成于 {{ todo.completedAt }}）</span>
        </p>
      </section>

      <footer class="page-foot">
        <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
        <span v-else-if="successMessage" class="success-text">{{ successMessage }}</span>
      </footer>

      <PromptDialog
        :open="dialog.open"
        :title="dialog.title"
        label="姓名"
        :initial="session.operator"
        :error="dialog.error"
        placeholder="请输入姓名"
        @confirm="confirmDialog"
        @cancel="dialog.open = false"
      />
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import {
  getReport,
  listReportTodos,
  submitForVerify,
  submitReport,
  verifyReport,
} from '@/api/report-service'
import { moduleMeta } from '@/api/local-service'
import { subscribe } from '@/data/local-store'
import type { EntryRow, TodoItem } from '@/data/types'
import { useSessionStore } from '@/stores/session'
import PromptDialog from '@/components/PromptDialog.vue'

const route = useRoute()
const router = useRouter()
const session = useSessionStore()
const meta = moduleMeta('report')

const row = ref<EntryRow | undefined>(undefined)
const todo = ref<TodoItem | undefined>(undefined)
const errorMessage = ref('')
const successMessage = ref('')

const frozen = computed(() =>
  row.value ? ['已上报', '已归档'].includes(String(row.value.status)) : false,
)

const dialog = reactive({
  open: false,
  mode: 'verify' as 'verify' | 'report',
  title: '',
  error: undefined as string | undefined,
})

function reload() {
  const id = Number(route.params.id)
  row.value = getReport(id)
  todo.value = listReportTodos().find((item) => item.refId === id)
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

function doSubmitVerify() {
  if (!row.value) {
    return
  }
  const result = submitForVerify(Number(row.value.id), Number(row.value.version ?? 1))
  flash(result.message, result.ok)
  reload()
}

function openVerify() {
  dialog.open = true
  dialog.mode = 'verify'
  dialog.title = `确认核实速报 ${row.value?.['速报编号']}`
  dialog.error = undefined
}

function openReport() {
  dialog.open = true
  dialog.mode = 'report'
  dialog.title = `上报灾情速报 ${row.value?.['速报编号']}`
  dialog.error = undefined
}

function confirmDialog(value: string) {
  if (!row.value) {
    dialog.open = false
    return
  }
  const current = row.value
  if (!value.trim()) {
    dialog.error = dialog.mode === 'verify' ? '请填写核实人' : '请填写上报人'
    return
  }
  const result =
    dialog.mode === 'verify'
      ? verifyReport({
          id: Number(current.id),
          verifier: value,
          expectedVersion: Number(current.version ?? 1),
        })
      : submitReport({
          id: Number(current.id),
          reporter: value,
          expectedVersion: Number(current.version ?? 1),
        })
  if (!result.ok) {
    dialog.error = result.message
    if (result.code === 409) {
      dialog.open = false
    }
    flash(result.message, false)
    reload()
    return
  }
  dialog.open = false
  flash(result.message, true)
  reload()
}

let unsubscribe: (() => void) | null = null
onMounted(() => {
  reload()
  unsubscribe = subscribe(reload)
})
onBeforeUnmount(() => {
  unsubscribe?.()
})
</script>

<style scoped>
.card-box { padding: 24px; background: #fff; border: 1px solid var(--border); border-radius: 8px; }
.detail-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px;
}
.detail-item { display: flex; flex-direction: column; gap: 4px; }
.detail-label { color: var(--muted); font-size: 12px; }
.detail-value { font-size: 14px; }
.status-tag { color: var(--brand); }
.frozen-banner {
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  background: #fff7ed;
  border: 1px solid #fdba74;
  color: #9a3412;
  font-size: 13px;
}
.detail-actions { display: flex; gap: 8px; margin-top: 14px; }
.todo-box { margin-top: 14px; background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 10px 14px; }
.todo-box h3 { margin: 0 0 6px; font-size: 14px; }
.todo-box p { margin: 0; font-size: 13px; }
.success-text { color: #067647; }
</style>
