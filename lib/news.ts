export interface NewsArticle {
  title: string
  publishedAt: string
  description: string
  source?: string
}

export interface NewsResult {
  articles: NewsArticle[]
}

function noNewsPlaceholder(companyName: string): NewsArticle {
  return {
    title: `No recent news found for ${companyName}`,
    publishedAt: new Date().toISOString(),
    description:
      'Claude will analyze company position and recent developments based on website content',
    source: 'Claude (backup analysis)',
  }
}

interface GNewsArticle {
  title?: string | null
  publishedAt?: string | null
  description?: string | null
}

interface GNewsResponse {
  totalArticles?: number
  articles?: GNewsArticle[]
  errors?: string[]
}

const GNEWS_API_URL = 'https://gnews.io/api/v4/search'
const MAX_ARTICLES = 5

const MAX_RETRIES = 3
const BASE_DELAY_MS = 600
const INITIAL_JITTER_MS = 1200

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchWithRetry(url: string): Promise<Response> {
  await sleep(Math.random() * INITIAL_JITTER_MS)

  let attempt = 0
  let lastError: unknown
  let lastResponseBody = ''
  let lastStatus = 0
  let lastStatusText = ''

  while (attempt <= MAX_RETRIES) {
    try {
      const response = await fetch(url, { method: 'GET' })

      if (response.status !== 429 && response.status !== 503) {
        return response
      }

      lastStatus = response.status
      lastStatusText = response.statusText
      lastResponseBody = await response.text().catch(() => '')
    } catch (error) {
      lastError = error
    }

    if (attempt === MAX_RETRIES) break

    const backoff = BASE_DELAY_MS * Math.pow(2, attempt)
    const jitter = Math.random() * BASE_DELAY_MS
    await sleep(backoff + jitter)
    attempt += 1
  }

  if (lastError) throw lastError
  throw new Error(
    `GNews request failed (${lastStatus} ${lastStatusText}) after ${MAX_RETRIES + 1} attempts: ${lastResponseBody}`,
  )
}

export async function getNews(companyName: string): Promise<NewsResult> {
  const apiKey = process.env.GNEWS_API_KEY
  if (!apiKey) {
    throw new Error('GNEWS_API_KEY is not set')
  }

  const params = new URLSearchParams({
    q: companyName,
    lang: 'en',
    max: String(MAX_ARTICLES),
    apikey: apiKey,
  })

  const response = await fetchWithRetry(`${GNEWS_API_URL}?${params.toString()}`)

  if (!response.ok) {
    const body = await response.text()
    throw new Error(
      `GNews request failed (${response.status} ${response.statusText}): ${body}`,
    )
  }

  const data = (await response.json()) as GNewsResponse

  if (Array.isArray(data.errors) && data.errors.length > 0) {
    throw new Error(`GNews returned error: ${data.errors.join(', ')}`)
  }

  const rawArticles = Array.isArray(data.articles) ? data.articles : []

  const articles: NewsArticle[] = rawArticles.slice(0, MAX_ARTICLES).map((article) => ({
    title: article.title ?? '',
    publishedAt: article.publishedAt ?? '',
    description: article.description ?? '',
  }))

  if (articles.length === 0) {
    return { articles: [noNewsPlaceholder(companyName)] }
  }

  return { articles }
}
