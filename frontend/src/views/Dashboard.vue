<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常。</p>
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
    <section class="todo-panel">
      <h3>跨模块待办 · 灾情上报事项</h3>
      <p v-if="!openTodos.length" class="empty-state">暂无待处理的灾情上报事项</p>
      <ul v-else class="todo-list">
        <li v-for="todo in openTodos" :key="todo.todoKey" class="todo-item">
          <span class="todo-title">{{ todo.title }}</span>
          <span class="todo-meta">由灾情速报核实生成 · {{ todo.createdAt }}</span>
          <RouterLink class="link" :to="{ name: 'report-detail', params: { id: todo.refReportId } }">
            前往处理
          </RouterLink>
        </li>
      </ul>
    </section>
    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { loadOverview } from '@/api/local-service'
import { listTodos } from '@/data/report/service'
import type { OverviewResult } from '@/data/types'
import type { ModuleTodo } from '@/data/report/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const openTodos = ref<ModuleTodo[]>([])

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  openTodos.value = listTodos('open')
}

onMounted(refresh)
</script>

<style scoped>
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
</style>
