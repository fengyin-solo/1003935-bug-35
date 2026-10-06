<template>
  <div v-if="open" class="dialog-mask" @click.self="cancel">
    <div class="dialog">
      <h3 class="dialog-title">{{ title }}</h3>
      <p v-if="hint" class="dialog-hint">{{ hint }}</p>
      <label class="dialog-field">
        <span>{{ label }}</span>
        <input ref="inputEl" v-model="value" :placeholder="placeholder" @keyup.enter="confirm" />
      </label>
      <p v-if="error" class="error-text">{{ error }}</p>
      <div class="dialog-actions">
        <button class="btn ghost" type="button" @click="cancel">取消</button>
        <button class="btn primary" type="button" @click="confirm">确定</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'

const props = defineProps<{
  open: boolean
  title: string
  label: string
  initial?: string
  hint?: string
  placeholder?: string
  error?: string
}>()

const emit = defineEmits<{
  confirm: [value: string]
  cancel: []
}>()

const value = ref(props.initial ?? '')
const inputEl = ref<HTMLInputElement | null>(null)

watch(
  () => props.open,
  async (open) => {
    if (open) {
      value.value = props.initial ?? ''
      await nextTick()
      inputEl.value?.focus()
    }
  },
)

function confirm() {
  emit('confirm', value.value)
}

function cancel() {
  emit('cancel')
}
</script>

<style scoped>
.dialog-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.dialog {
  width: 360px;
  background: #fff;
  border-radius: 8px;
  padding: 18px 20px;
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.2);
}
.dialog-title { margin: 0 0 6px; font-size: 15px; }
.dialog-hint { margin: 0 0 10px; font-size: 12px; color: var(--muted); }
.dialog-field span { display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px; }
.dialog-field input { width: 100%; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; }
.dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
</style>
