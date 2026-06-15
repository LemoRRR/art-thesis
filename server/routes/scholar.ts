import { Router } from 'express'

const router = Router()

interface OpenAlexWork {
  id?: string
  doi?: string
  title?: string
  display_name?: string
  publication_year?: number
  cited_by_count?: number
  abstract_inverted_index?: Record<string, number[]>
  authorships?: Array<{
    author?: {
      display_name?: string
    }
  }>
  primary_location?: {
    source?: {
      display_name?: string
    }
    landing_page_url?: string
  }
  locations?: Array<{
    landing_page_url?: string
  }>
}

interface CrossrefWork {
  DOI?: string
  URL?: string
  title?: string[]
  author?: Array<{
    given?: string
    family?: string
  }>
  issued?: {
    'date-parts'?: number[][]
  }
  'container-title'?: string[]
  abstract?: string
  'is-referenced-by-count'?: number
}

function abstractFromInvertedIndex(index?: Record<string, number[]>): string {
  if (!index) return ''
  const words: Array<{ word: string; position: number }> = []
  Object.entries(index).forEach(([word, positions]) => {
    positions.forEach(position => words.push({ word, position }))
  })
  return words
    .sort((a, b) => a.position - b.position)
    .map(item => item.word)
    .join(' ')
}

function normalizeOpenAlexWork(work: OpenAlexWork) {
  const authors = work.authorships
    ?.map(item => item.author?.display_name)
    .filter((name): name is string => Boolean(name))
    .slice(0, 5) ?? []
  const url = work.primary_location?.landing_page_url || work.locations?.find(item => item.landing_page_url)?.landing_page_url || work.id || ''
  return {
    id: work.id ?? work.doi ?? work.title ?? '',
    title: work.title || work.display_name || 'Untitled',
    authors,
    year: work.publication_year,
    source: work.primary_location?.source?.display_name ?? '',
    doi: work.doi ?? '',
    url,
    citedByCount: work.cited_by_count ?? 0,
    abstract: abstractFromInvertedIndex(work.abstract_inverted_index),
  }
}

function normalizeCrossrefWork(work: CrossrefWork) {
  const authors = work.author
    ?.map(author => [author.given, author.family].filter(Boolean).join(' '))
    .filter(Boolean)
    .slice(0, 5) ?? []
  const year = work.issued?.['date-parts']?.[0]?.[0]
  return {
    id: work.DOI ? `https://doi.org/${work.DOI}` : work.URL ?? work.title?.[0] ?? '',
    title: work.title?.[0] ?? 'Untitled',
    authors,
    year,
    source: work['container-title']?.[0] ?? '',
    doi: work.DOI ? `https://doi.org/${work.DOI}` : '',
    url: work.URL ?? (work.DOI ? `https://doi.org/${work.DOI}` : ''),
    citedByCount: work['is-referenced-by-count'] ?? 0,
    abstract: work.abstract?.replace(/<[^>]+>/g, '').trim() ?? '',
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function searchOpenAlex(query: string, limit: number) {
  const params = new URLSearchParams({
    search: query,
    'per-page': String(limit),
    sort: 'relevance_score:desc',
  })
  const response = await fetchWithTimeout(`https://api.openalex.org/works?${params.toString()}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'paper-ai-tool/1.0 (mailto:demo@example.com)',
    },
  }, 6000)
  if (!response.ok) {
    throw new Error(`OpenAlex search failed: ${response.statusText}`)
  }
  const data = await response.json() as { results?: OpenAlexWork[] }
  return (data.results ?? []).map(normalizeOpenAlexWork)
}

async function searchCrossref(query: string, limit: number) {
  const params = new URLSearchParams({
    'query.bibliographic': query,
    rows: String(limit),
  })
  const response = await fetchWithTimeout(`https://api.crossref.org/works?${params.toString()}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'paper-ai-tool/1.0 (mailto:demo@example.com)',
    },
  }, 10000)
  if (!response.ok) {
    throw new Error(`Crossref search failed: ${response.statusText}`)
  }
  const data = await response.json() as { message?: { items?: CrossrefWork[] } }
  return (data.message?.items ?? []).map(normalizeCrossrefWork)
}

router.get('/search', async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  const limit = Math.min(Math.max(Number(req.query.limit ?? 12), 1), 25)

  if (!query) {
    res.status(400).json({ error: 'Missing search query' })
    return
  }

  try {
    const results = await searchOpenAlex(query, limit)
    if (results.length > 0) {
      res.json({ provider: 'OpenAlex', query, results })
      return
    }
    const fallbackResults = await searchCrossref(query, limit)
    res.json({ provider: 'Crossref', query, results: fallbackResults })
  } catch (error) {
    try {
      const fallbackResults = await searchCrossref(query, limit)
      res.json({ provider: 'Crossref', query, results: fallbackResults })
    } catch (fallbackError) {
      res.status(500).json({
        error: [
          error instanceof Error ? error.message : 'OpenAlex search failed',
          fallbackError instanceof Error ? fallbackError.message : 'Crossref search failed',
        ].join('；'),
      })
    }
  }
})

export default router
