const MIN_SAFE_PORT = 49152
const SAFE_PORT_SPAN = 12000

export async function listenOnSafePort(app) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const port = MIN_SAFE_PORT + Math.floor(Math.random() * SAFE_PORT_SPAN)
    const server = await new Promise((resolve, reject) => {
      const candidate = app.listen(port, '127.0.0.1')
      candidate.once('listening', () => resolve(candidate))
      candidate.once('error', reject)
    }).catch(() => null)
    if (server) return { server, port }
  }
  throw new Error('Unable to start smoke test server on a safe local port')
}

function fallbackSectionIdForRole(role) {
  if (role === 'method' || role === 'sample') return 's3'
  if (role === 'discussion' || role === 'conclusion') return 's5'
  return 's4'
}

export function idsByResolvedSection(sections, placements) {
  const idsBySection = new Map(sections.map(section => [section.id, new Set()]))
  for (const placement of placements) {
    const target = sections.find(section => section.id === placement.targetSectionId)
      ?? sections.find(section => section.title === placement.targetSectionTitle)
      ?? sections.find(section => section.title.includes(placement.targetSectionTitle ?? '') || String(placement.targetSectionTitle ?? '').includes(section.title))
      ?? sections.find(section => section.id === fallbackSectionIdForRole(placement.role))
    if (!target || !idsBySection.has(target.id)) continue
    for (const id of placement.componentIds ?? []) idsBySection.get(target.id).add(id)
  }
  return idsBySection
}
