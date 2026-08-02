import { ref } from 'vue'

/**
 * Global singleton state for the QuickAdd modal (rendered once in the layout).
 *
 * Two open modes:
 *  - `open()`      — add a new transaction (clears any edit state)
 *  - `openEdit(id)` — edit an existing transaction (prefills from the cache)
 *
 * `close()` always clears the edit state so the next `open()` is a clean add.
 */
const opened = ref(false)
const editingTransactionId = ref<string | null>(null)

export function useQuickAddModal() {
  function open() {
    editingTransactionId.value = null
    opened.value = true
  }
  function openEdit(id: string) {
    editingTransactionId.value = id
    opened.value = true
  }
  function close() {
    opened.value = false
    editingTransactionId.value = null
  }
  return { opened, editingTransactionId, open, openEdit, close }
}
