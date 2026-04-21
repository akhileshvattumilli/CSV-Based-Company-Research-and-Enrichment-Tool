export interface NewsArticle {
  title: string
  publishedAt: string
  description: string
}

export interface NewsResult {
  articles: NewsArticle[]
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

  const response = await fetch(`${GNEWS_API_URL}?${params.toString()}`, {
    method: 'GET',
  })

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

  return { articles }
}
