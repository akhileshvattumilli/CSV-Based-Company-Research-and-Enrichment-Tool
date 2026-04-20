export interface SearchResult {
  title: string
  url: string
  snippet: string
}

export interface SearchResponse {
  results: SearchResult[]
}

interface SerperOrganicItem {
  title?: unknown
  link?: unknown
  snippet?: unknown
}

interface SerperSearchResponse {
  organic?: SerperOrganicItem[]
}

const SERPER_ENDPOINT = 'https://api.serper.dev/search'
const MAX_RESULTS = 5

export async function search(companyName: string): Promise<SearchResponse> {
  const apiKey = process.env.SERPER_API_KEY
  if (!apiKey) {
    throw new Error('SERPER_API_KEY is not set')
  }

  const response = await fetch(SERPER_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify({ q: companyName }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(
      `Serper request failed (${response.status} ${response.statusText}): ${body}`,
    )
  }

  const data = (await response.json()) as SerperSearchResponse
  const organic = Array.isArray(data.organic) ? data.organic : []

  const results: SearchResult[] = organic.slice(0, MAX_RESULTS).map((item) => ({
    title: typeof item.title === 'string' ? item.title : '',
    url: typeof item.link === 'string' ? item.link : '',
    snippet: typeof item.snippet === 'string' ? item.snippet : '',
  }))

  return { results }
}
