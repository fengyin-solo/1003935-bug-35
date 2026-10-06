<template>
  <section class="page" data-module="report-new">
    <header class="page-head">
      <div>
        <h2>登记灾情速报</h2>
        <p class="page-desc">新登记的速报从「已录入」起步，经提交核实、确认核实后才能上报灾情；登记成功与列表保存走同一事务。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="router.push('/report')">返回列表</button>
      </div>
    </header>

    <form class="form-card" @submit.prevent="submit">
      <label v-for="field in fields" :key="field.key" class="form-item">
        <span>{{ field.label }}<i v-if="field.required">*</i></span>
        <input
          v-model="form[field.key]"
          :type="field.type ?? 'text'"
          :placeholder="field.placeholder ?? `请输入${field.label}`"
        />
      </label>

      <footer class="form-foot">
        <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
        <span v-else-if="successMessage" class="success-text">{{ successMessage }}</span>
        <div class="form-actions">
          <button class="btn ghost" type="button" @click="resetForm">清空</button>
          <button class="btn primary" type="submit">保存登记</button>
        </div>
      </footer>
    </form>
  </section>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'

import { createReport, type ReportDraft } from '@/api/report-service'

const router = useRouter()

const fields: { key: keyof ReportDraft; label: string; required?: boolean; type?: string; placeholder?: string }[] = [
  { key: '速报编号', label: '速报编号', required: true, placeholder: '例如 REPO-0006' },
  { key: '隐患点编号', label: '隐患点编号', required: true, placeholder: '例如 HAZA-0012' },
  { key: '发生时间', label: '发生时间', placeholder: '留空则取当前时间' },
  { key: '灾害类型', label: '灾害类型', required: true, placeholder: '滑坡 / 泥石流 / 崩塌 / 地面塌陷' },
  { key: '受灾范围', label: '受灾范围' },
  { key: '伤亡人数', label: '伤亡人数', placeholder: '无伤亡填 0' },
  { key: '经济损失', label: '经济损失' },
]

const emptyForm: ReportDraft = {
  速报编号: '',
  隐患点编号: '',
  发生时间: '',
  灾害类型: '',
  受灾范围: '',
  伤亡人数: '',
  经济损失: '',
}

const form = reactive<ReportDraft>({ ...emptyForm })
const errorMessage = ref('')
const successMessage = ref('')

function resetForm() {
  Object.assign(form, emptyForm)
  errorMessage.value = ''
  successMessage.value = ''
}

function submit() {
  errorMessage.value = ''
  successMessage.value = ''
  const result = createReport({ ...form })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  successMessage.value = result.message
  resetForm()
  setTimeout(() => router.push('/report'), 600)
}
</script>

<style scoped>
.form-card {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 16px;
  max-width: 860px;
}
.form-item span { display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px; }
.form-item i { color: #b42318; font-style: normal; margin-left: 2px; }
.form-item input { width: 100%; padding: 7px 9px; border: 1px solid var(--border); border-radius: 6px; }
.form-foot {
  grid-column: 1 / -1;
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 4px;
}
.form-actions { display: flex; gap: 8px; }
.success-text { color: #067647; }
</style>
