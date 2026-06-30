// Turn raw/technical errors (e.g. "/api/research/analyze 500: ...") into a
// clean, user-facing Chinese message. Keeps already-friendly Chinese text.
export function friendlyMessage(err: unknown, fallback = '操作失败，请稍后重试。'): string {
  const raw = (err instanceof Error ? err.message : String(err ?? '')).trim()
  if (!raw) return fallback

  // Strip a leading technical prefix like "/api/x 500:" or "POST /api/x 503:".
  const stripped = raw
    .replace(/^(?:[A-Z]+\s+)?\/?\S*\s+\d{3}:\s*/, '')
    .trim()
  const text = stripped || raw

  if (/timed out|timeout|超时/i.test(text)) return 'AI 生成时间较长或已超时，请稍后重试（可尝试拆分章节）。'
  if (/cannot connect|failed to fetch|networkerror|连接/i.test(text)) return '网络连接不畅，请检查网络后重试。'
  if (/\b401\b|未登录|登录已过期|token/i.test(text)) return '登录已过期，请重新登录后继续。'
  if (/\b503\b|唤醒|unavailable|正在唤醒/i.test(text)) return '服务正在唤醒或暂时不可用，请约 30 秒后重试。'
  if (/\b5\d{2}\b/.test(raw)) return '服务暂时出错，请稍后重试。'

  // Already-clean short Chinese message: show as-is. Otherwise use the fallback
  // so internal/English details never reach the user.
  if (/[一-龥]/.test(text) && text.length <= 120 && !/\/api\//.test(text)) return text
  return fallback
}
