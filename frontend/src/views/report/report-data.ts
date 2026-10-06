import { ref, type Ref } from 'vue'

import {
  exportReportCsv,
  listReports,
  listTodos,
} from '@/data/report/service'
import { resetReportDatabase } from '@/data/report/store'
import { ReportServiceError } from '@/data/report/types'
import type { DisasterReport, ModuleTodo } from '@/data/report/types'
import type { ReportQuery } from '@/data/report/service'

/** 灾情速报页面共享的只读数据与通用动作，避免列表/详情各自拼读写逻辑。 */
export function useReportData(): {
  rows: Ref<DisasterReport[]>
  openTodos: Ref<ModuleTodo[]>
  reload: (query?: ReportQuery) => void
  resetDemo: () => void
  runGuarded: (
    action: () => unknown,
    onOk: () => void,
    errorRef: Ref<string>,
  ) => boolean
} {
  const rows = ref<DisasterReport[]>([]) as Ref<DisasterReport[]>
  const openTodos = ref<ModuleTodo[]>([]) as Ref<ModuleTodo[]>

  function reload(query: ReportQuery = {}): void {
    rows.value = listReports(query)
    openTodos.value = listTodos('open')
  }

  function resetDemo(): void {
    resetReportDatabase()
    reload()
  }

  // 统一异常出口：服务层错误（含 CONFLICT / LOCKED_RECORD）原样展示给操作人。
  function runGuarded(action: () => unknown, onOk: () => void, errorRef: Ref<string>): boolean {
    errorRef.value = ''
    try {
      action()
      onOk()
      return true
    } catch (error) {
      errorRef.value =
        error instanceof ReportServiceError ? error.message : error instanceof Error ? error.message : '操作失败'
      return false
    }
  }

  return { rows, openTodos, reload, resetDemo, runGuarded }
}

export function downloadReportCsv(): void {
  const { filename, content } = exportReportCsv()
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}
