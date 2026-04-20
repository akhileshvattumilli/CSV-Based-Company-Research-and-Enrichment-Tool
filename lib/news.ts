export interface NewsArticle {
  title: string
  publishedAt: string
  description: string
}

export interface NewsResult {
  articles: NewsArticle[]
}

interface NewsApiArticle {
  title?: string | null
  publishedAt?: string | null
  description?: string | null
}

interface NewsApiResponse {
  status?: string
  articles?: NewsApiArticle[]
  totalResults?: number
  code?: string
  message?: string
}

const NEWS_API_URL = 'https://newsapi.org/v2/everything'
const MAX_ARTICLES = 5

export async function getNews(companyName: string): Promise<NewsResult> {
  const apiKey = process.env.NEWS_API_KEY
  if (!apiKey) {
    throw new Error('NEWS_API_KEY is not set')
  }

  const params = new URLSearchParams({
    q: companyName,
    sortBy: 'publishedAt',
    language: 'en',
    pageSize: String(MAX_ARTICLES),
  })

  const response = await fetch(`${NEWS_API_URL}?${params.toString()}`, {
    method: 'GET',
    headers: {
      'X-Api-Key': apiKey,
    },
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(
      `NewsAPI request failed (${response.status} ${response.statusText}): ${body}`,
    )
  }

  const data = (await response.json()) as NewsApiResponse

  if (data.status && data.status !== 'ok') {
    throw new Error(
      `NewsAPI returned error: ${data.code ?? 'unknown'} - ${data.message ?? 'unknown error'}`,
    )
  }

  const rawArticles = Array.isArray(data.articles) ? data.articles : []

  const articles: NewsArticle[] = rawArticles.slice(0, MAX_ARTICLES).map((article) => ({
    title: article.title ?? '',
    publishedAt: article.publishedAt ?? '',
    description: article.description ?? '',
  }))

  return { articles }
}
