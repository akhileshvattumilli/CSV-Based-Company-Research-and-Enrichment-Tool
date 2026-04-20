import Firecrawl from '@mendable/firecrawl-js'

export interface ScrapeResult {
  markdown: string
}

function normalizeUrl(url: string): string {
  const trimmed = url.trim()
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

export async function scrape(website: string): Promise<ScrapeResult> {
  const apiKey = process.env.FIRECRAWL_API_KEY
  if (!apiKey) {
    throw new Error('FIRECRAWL_API_KEY is not set')
  }

  const app = new Firecrawl({ apiKey })
  const url = normalizeUrl(website)

  const doc = await app.scrape(url, { formats: ['markdown'] })

  return { markdown: doc.markdown ?? '' }
}
