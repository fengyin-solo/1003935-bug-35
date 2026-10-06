<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常；下方是跨模块待办，由各模块核实动作生成、完成后自动关闭。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>
    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>今日新增</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>

    <h3 class="queue-title">跨模块待办（{{ openTodos.length }} 条待办）</h3>
    <table class="data-table">
      <thead>
        <tr><th>来源模块</th><th>关联编号</th><th>待办事项</th><th>生成时间</th><th>状态</th><th>操作</th></tr>
      </thead>
      <tbody>
        <tr v-for="todo in todos" :key="todo.id">
          <td>{{ moduleName(todo.moduleKey) }}</td>
          <td>{{ todo.refCode }}</td>
          <td>{{ todo.title }}</td>
          <td>{{ todo.createdAt }}</td>
          <td>
            <span :class="todo.status === '待办' ? 'tag-open' : 'tag-done'">{{ todo.status }}</span>
          </td>
          <td><RouterLink class="link" :to="`/report/${todo.refId}`">查看速报</RouterLink></td>
        </tr>
        <tr v-if="!todos.length">
          <td colspan="6" class="empty-state">暂无跨模块待办</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据；同一编号被他人先核实时本页会自动刷新</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { loadOverview, moduleMeta } from '@/api/local-service'
import { listTodos, subscribe } from '@/data/local-store'
import type { OverviewResult, TodoItem } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const todos = ref<TodoItem[]>([])

const openTodos = computed(() => todos.value.filter((todo) => todo.status === '待办'))

function moduleName(key: string): string {
  try {
    return moduleMeta(key).name
  } catch {
    return key
  }
}

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  todos.value = listTodos()
}

let unsubscribe: (() => void) | null = null
onMounted(() => {
  refresh()
  unsubscribe = subscribe(refresh)
})
onBeforeUnmount(() => {
  unsubscribe?.()
})
</script>

<style scoped>
.queue-title { margin: 18px 0 8px; font-size: 15px; }
.tag-open { color: #b54708; background: #fffaeb; border-radius: 999px; padding: 2px 10px; font-size: 12px; }
.tag-done { color: #067647; background: #ecfdf3; border-radius: 999px; padding: 2px 10px; font-size: 12px; }
</style>
