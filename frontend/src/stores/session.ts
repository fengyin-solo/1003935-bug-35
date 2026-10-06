import { defineStore } from 'pinia'

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
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
    // 模拟两名值班员在不同终端上核实：页面切换当前操作员，提交时随动作带上核实人。
    setOperator(name: string) {
      this.operator = name.trim() || '值班管理员'
    },
  },
})
