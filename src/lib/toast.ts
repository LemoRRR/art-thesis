// Tiny dependency-free toast store. Lets any module (including non-React code
// like storage/api) surface a user-visible message instead of failing silently.
export type ToastType = 'info' | 'success' | 'error' | 'warning'

export interface ToastItem {
  id: number
  message: string
  type: ToastType
}

type Listener = (toasts: ToastItem[]) => void

let toasts: ToastItem[] = []
let nextId = 1
const listeners = new Set<Listener>()

function emit() {
  const snapshot = [...toasts]
  listeners.forEach(listener => listener(snapshot))
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener)
  listener([...toasts])
  return () => {
    listeners.delete(listener)
  }
}

export function dismissToast(id: number): void {
  toasts = toasts.filter(item => item.id !== id)
  emit()
}

export function toast(message: string, type: ToastType = 'info', durationMs = 5000): number {
  // Dedupe: if an identical message is already on screen, don't stack copies
  // (e.g. a sync failure that retries repeatedly).
  const existing = toasts.find(item => item.message === message && item.type === type)
  if (existing) return existing.id

  const id = nextId++
  toasts = [...toasts, { id, message, type }]
  emit()
  if (durationMs > 0) {
    setTimeout(() => dismissToast(id), durationMs)
  }
  return id
}
