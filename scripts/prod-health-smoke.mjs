const baseUrl = (process.argv[2] || process.env.PROD_HEALTH_BASE_URL || 'https://paper-ai-tool.vercel.app').replace(/\/$/, '')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function main() {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetch(`${baseUrl}/api/health`, { signal: controller.signal })
    const text = await response.text()
    assert(response.ok, `GET /api/health ${response.status}: ${text.slice(0, 1000)}`)
    const health = JSON.parse(text)

    assert(health.ok === true, `Health did not return ok=true: ${text}`)
    assert(health.service === 'paper-ai-tool-api', `Unexpected service: ${health.service}`)
    assert(health.configured?.supabase === true, 'Supabase client env is not configured')
    assert(health.configured?.ai === true, 'No AI provider is configured')

    console.log(JSON.stringify({
      ok: true,
      baseUrl,
      runtime: health.runtime,
      version: health.version,
      configured: health.configured,
    }, null, 2))
  } finally {
    clearTimeout(timer)
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
