import { ref } from 'vue'

const opened = ref(false)

export function useQuickAddModal() {
  function open() {
    opened.value = true
  }
  function close() {
    opened.value = false
  }
  return { opened, open, close }
}
