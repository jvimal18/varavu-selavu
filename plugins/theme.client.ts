/**
 * Theme init plugin — runs only on the client.
 * Sets the initial `.dark` class before the first paint and keeps it in sync.
 */
import { useUiStore } from '~/stores/ui'

export default defineNuxtPlugin(() => {
  const ui = useUiStore()
  ui.init()
})
