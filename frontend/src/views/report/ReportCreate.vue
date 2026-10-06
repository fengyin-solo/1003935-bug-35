<template>
  <section class="page" data-module="report-create">
    <header class="page-head">
      <div>
        <h2>登记灾情速报</h2>
        <p class="page-desc">
          录入灾情速报。速报编号全库唯一；可在保存时一并提交核实，录入与状态流转在同一事务内完成。
        </p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" :to="{ name: 'report-list' }">返回列表</RouterLink>
      </div>
    </header>

    <form class="create-form" @submit.prevent="onSubmit">
      <label>
        <span>速报编号 <em>*</em></span>
        <input v-model="form.code" placeholder="如 ZQSB-2026-008" />
      </label>
      <label>
        <span>隐患点编号 <em>*</em></span>
        <input v-model="form.hazardCode" placeholder="如 YH-0217" />
      </label>
      <label>
        <span>发生时间 <em>*</em></span>
        <input v-model="form.occurredAt" placeholder="2026-10-06 08:30" />
      </label>
      <label>
        <span>灾害类型 <em>*</em></span>
        <select v-model="form.disasterType">
          <option value="" disabled>请选择</option>
          <option v-for="type in disasterTypes" :key="type" :value="type">{{ type }}</option>
        </select>
      </label>
      <label class="wide">
        <span>受灾范围</span>
        <textarea v-model="form.affectedArea" rows="2" placeholder="具体位置、影响范围"></textarea>
      </label>
      <label>
        <span>伤亡人数</span>
        <input v-model="form.casualties" placeholder="如 无人员伤亡" />
      </label>
      <label>
        <span>经济损失</span>
        <input v-model="form.economicLoss" placeholder="如 约10万元 / 待评估" />
      </label>
      <label class="wide checkbox">
        <input v-model="form.submitForVerify" type="checkbox" />
        保存后立即提交核实（否则保持「已录入」，稍后在列表提交）
      </label>

      <div class="form-foot">
        <button class="btn primary" type="submit">保存灾情速报</button>
        <span v-if="message" :class="ok ? 'ok-text' : 'error-text'">{{ message }}</span>
      </div>
    </form>
  </section>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'

import { useSessionStore } from '@/stores/session'
import { createReport } from '@/data/report/service'
import { ReportServiceError, type DisasterType } from '@/data/report/types'

const router = useRouter()
const store = useSessionStore()

const disasterTypes: DisasterType[] = ['滑坡', '崩塌', '泥石流', '地面塌陷', '地裂缝', '地面沉降']

const form = reactive({
  code: '',
  hazardCode: '',
  occurredAt: '',
  disasterType: '',
  affectedArea: '',
  casualties: '',
  economicLoss: '',
  submitForVerify: true,
})

const message = ref('')
const ok = ref(false)

function onSubmit(): void {
  message.value = ''
  ok.value = false
  try {
    const created = createReport({ ...form }, store.operator)
    ok.value = true
    message.value = form.submitForVerify
      ? `速报 ${created.code} 已登记并提交核实（v${created.version}）`
      : `速报 ${created.code} 已登记，状态为已录入`
    router.push({ name: 'report-detail', params: { id: created.id } })
  } catch (error) {
    message.value =
      error instanceof ReportServiceError
        ? `登记被拒绝：${error.message}`
        : error instanceof Error
          ? error.message
          : '登记失败'
  }
}
</script>

<style scoped>
.create-form {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px 16px;
  display: grid;
  grid-template-columns: repeat(2, minmax(240px, 1fr));
  gap: 12px 16px;
  max-width: 860px;
}
.create-form label {
  display: flex;
  flex-direction: column;
  font-size: 12px;
  color: var(--muted);
  gap: 4px;
}
.create-form .wide {
  grid-column: span 2;
}
.create-form label.checkbox {
  flex-direction: row;
  align-items: center;
  gap: 8px;
}
.create-form em {
  color: #b42318;
  font-style: normal;
}
.form-foot {
  grid-column: span 2;
  display: flex;
  align-items: center;
  gap: 12px;
}
.ok-text {
  color: #067647;
}
</style>
