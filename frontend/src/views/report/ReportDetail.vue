<template>
  <section class="page" data-module="report-detail">
    <header class="page-head">
      <div>
        <h2>灾情速报详情</h2>
        <p class="page-desc">
          按当前数据版本执行核实 / 上报。已上报、已归档记录只读；两个人员并发核实时，后提交的请求会收到明确版本冲突。
        </p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" :to="{ name: 'report-list' }">返回列表</RouterLink>
      </div>
    </header>

    <div v-if="notFound" class="batch-failures">未找到该灾情速报，可能已被重置。<RouterLink class="link" :to="{ name: 'report-list' }">返回列表</RouterLink></div>

    <template v-else-if="report">
      <div class="detail-grid">
        <article class="detail-card span-2">
          <h3>{{ report.code }}
            <span class="status-tag">{{ report.status }}</span>
            <span v-if="isLocked" class="lock-tag">历史只读</span>
            <span class="version-tag">v{{ report.version }}</span>
          </h3>
          <dl class="detail-dl">
            <dt>隐患点编号</dt><dd>{{ report.hazardCode }}</dd>
            <dt>发生时间</dt><dd>{{ report.occurredAt }}</dd>
            <dt>灾害类型</dt><dd>{{ report.disasterType }}</dd>
            <dt>受灾范围</dt><dd>{{ report.affectedArea || '—' }}</dd>
            <dt>伤亡人数</dt><dd>{{ report.casualties || '—' }}</dd>
            <dt>经济损失</dt><dd>{{ report.economicLoss || '—' }}</dd>
            <dt>登记人</dt><dd>{{ report.reporter }}（{{ report.createdAt }}）</dd>
          </dl>
        </article>

        <article class="detail-card">
          <h3>核实信息</h3>
          <dl class="detail-dl">
            <dt>核实人</dt><dd>{{ report.verifier || '尚未核实' }}</dd>
            <dt>核实时间</dt><dd>{{ report.verifiedAt || '—' }}</dd>
            <dt>核实意见</dt><dd>{{ report.verifyOpinion || '—' }}</dd>
          </dl>
        </article>

        <article class="detail-card">
          <h3>上报信息</h3>
          <dl class="detail-dl">
            <dt>上报人</dt><dd>{{ report.submittedBy || '尚未上报' }}</dd>
            <dt>上报时间</dt><dd>{{ report.submittedAt || '—' }}</dd>
            <dt>关联待办</dt>
            <dd>
              <span v-if="linkedTodo">{{ linkedTodo.status === 'open' ? '待办处理中' : '待办已关闭' }}</span>
              <span v-else>无</span>
            </dd>
          </dl>
        </article>
      </div>

      <!-- 历史已上报记录：整块操作区禁用并明确提示，不提供任何改写入口。 -->
      <section v-if="isLocked" class="locked-banner">
        该速报已{{ report.status }}，属于历史已上报记录，核实意见、上报信息均不允许改写。
      </section>

      <section v-else class="action-panel">
        <h3>状态流转</h3>

        <div v-if="report.status === '已录入'" class="action-row">
          <p>录入完成后提交核实，进入待核实队列。</p>
          <button class="btn primary" type="button" @click="onSubmitVerify">提交核实（基于 v{{ report.version }}）</button>
        </div>

        <div v-if="report.status === '待核实'" class="action-row verify-box">
          <label>
            核实人
            <input v-model="verifier" :placeholder="store.operator" />
          </label>
          <label class="opinion">
            核实意见
            <textarea v-model="opinion" rows="3" placeholder="现场核实情况与处置建议"></textarea>
          </label>
          <div class="verify-actions">
            <button class="btn primary" type="button" @click="onVerify">
              确认核实（基于 v{{ report.version }}）
            </button>
            <button class="btn" type="button" @click="onSimulateRace">
              模拟另一人抢先核实
            </button>
          </div>
          <p class="hint">
            点击「模拟另一人抢先核实」后，本页仍持有旧版本 v{{ report.version }}，
            再点「确认核实」将收到版本冲突——同一编号只允许先提交的版本生效。
          </p>
        </div>

        <div v-if="report.status === '已核实'" class="action-row">
          <p>已核实通过，跨模块待办已生成。确认后上报灾情，记录进入历史只读区。</p>
          <button class="btn primary" type="button" @click="onSubmitDisaster">
            上报灾情（基于 v{{ report.version }}）
          </button>
        </div>

        <div v-if="report.status === '已上报'" class="action-row">
          <button class="btn" type="button" @click="onArchive">归档（基于 v{{ report.version }}）</button>
        </div>

        <p v-if="actionMessage" :class="actionOk ? 'ok-text' : 'error-text'">{{ actionMessage }}</p>
      </section>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'

import { useSessionStore } from '@/stores/session'
import {
  archiveReport,
  getReport,
  listTodos,
  simulateConcurrentVerify,
  submitDisaster,
  submitForVerify,
  verifyReport,
} from '@/data/report/service'
import { ReportServiceError } from '@/data/report/types'

const route = useRoute()
const store = useSessionStore()

const report = ref(getReportSafe(Number(route.params.id)))
const notFound = ref(report.value === null)
const verifier = ref('')
const opinion = ref('现场复核，情况属实')
const actionMessage = ref('')
const actionOk = ref(false)

const isLocked = computed(() => {
  const status = report.value?.status
  return status === '已上报' || status === '已归档'
})

const linkedTodo = computed(() => {
  if (!report.value) {
    return null
  }
  return listTodos('all').find((todo) => todo.refReportId === report.value?.id) ?? null
})

function getReportSafe(id: number) {
  try {
    return getReport(id)
  } catch {
    return null
  }
}

function refresh(): void {
  actionMessage.value = ''
  try {
    report.value = getReport(Number(route.params.id))
    notFound.value = false
  } catch (error) {
    notFound.value = true
    actionMessage.value = error instanceof ReportServiceError ? error.message : '读取失败'
  }
}

function guard(action: () => unknown, okMessage: string): void {
  actionMessage.value = ''
  try {
    action()
    actionOk.value = true
    actionMessage.value = okMessage
    refresh()
  } catch (error) {
    actionOk.value = false
    actionMessage.value =
      error instanceof ReportServiceError
        ? `操作被拒绝：${error.message}`
        : error instanceof Error
          ? error.message
          : '操作失败'
  }
}

function onSubmitVerify(): void {
  if (!report.value) {
    return
  }
  const { id, version } = report.value
  guard(() => submitForVerify(id, version, store.operator), '已提交核实')
}

function onVerify(): void {
  if (!report.value) {
    return
  }
  const { id, version } = report.value
  guard(
    () =>
      verifyReport({
        id,
        expectedVersion: version,
        verifier: verifier.value.trim() || store.operator,
        opinion: opinion.value,
      }),
    '核实成功：状态已置为已核实，跨模块上报待办已登记',
  )
}

function onSimulateRace(): void {
  if (!report.value) {
    return
  }
  // 模拟另一人员基于同一版本抢先完成核实；本页 report.version 已落后，随后核实必冲突。
  try {
    const other = store.operator === '核实员-赵强' ? '核实员-王建国' : '核实员-赵强'
    simulateConcurrentVerify(report.value.id, other)
    report.value = getReportSafe(report.value.id)
    actionOk.value = false
    actionMessage.value =
      `模拟完成：${other} 已抢先核实，库内版本已前进；请点「确认核实」验证冲突被明确拒绝。`
  } catch (error) {
    actionOk.value = false
    actionMessage.value = error instanceof Error ? error.message : '模拟失败'
  }
}

function onSubmitDisaster(): void {
  if (!report.value) {
    return
  }
  const { id, version } = report.value
  guard(() => submitDisaster(id, version, store.operator), '已上报灾情，记录进入历史只读区，待办已关闭')
}

function onArchive(): void {
  if (!report.value) {
    return
  }
  const { id, version } = report.value
  guard(() => archiveReport(id, version), '已归档')
}
</script>

<style scoped>
.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}
.detail-card {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 14px;
}
.detail-card.span-2 {
  grid-column: span 2;
}
.detail-card h3 {
  margin: 0 0 10px;
  font-size: 15px;
}
.detail-dl {
  display: grid;
  grid-template-columns: 110px 1fr;
  gap: 6px 12px;
  margin: 0;
  font-size: 13px;
}
.detail-dl dt {
  color: var(--muted);
}
.detail-dl dd {
  margin: 0;
}
.status-tag {
  font-size: 12px;
  background: #e8f0fe;
  color: var(--brand);
  border-radius: 999px;
  padding: 1px 10px;
  margin-left: 8px;
}
.version-tag {
  font-size: 12px;
  color: var(--muted);
  margin-left: 6px;
}
.lock-tag {
  display: inline-block;
  margin-left: 6px;
  font-size: 11px;
  color: #7a5b00;
  background: #fdf0c8;
  border-radius: 999px;
  padding: 1px 8px;
}
.locked-banner {
  margin-top: 12px;
  background: #fdf6e3;
  border: 1px solid #ecd9a0;
  color: #7a5b00;
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 13px;
}
.action-panel {
  margin-top: 12px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 14px;
}
.action-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
}
.verify-box label {
  display: flex;
  flex-direction: column;
  font-size: 12px;
  color: var(--muted);
  width: 100%;
  max-width: 480px;
}
.verify-box .opinion textarea {
  width: 100%;
}
.verify-actions {
  display: flex;
  gap: 10px;
}
.hint {
  font-size: 12px;
  color: var(--muted);
  margin: 0;
}
.ok-text {
  color: #067647;
}
.batch-failures {
  border: 1px solid #f0b8b0;
  background: #fdf3f2;
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 13px;
  color: #7a271a;
}
</style>
