import { defineStore } from 'pinia'

// 灾情速报涉及多角色核实 / 上报；切换当前操作员用于演示两人并发核实同一条速报时的版本冲突。
export const OPERATORS = ['核实员-王建国', '核实员-赵强', '上报员-陈丽', '值班员-周敏'] as const

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '核实员-王建国',
    shiftLabel: '白班 08:00-20:00',
    scope: '地质灾害隐患点监测防治管理系统',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setOperator(operator: string) {
      this.operator = operator
    },
  },
})
