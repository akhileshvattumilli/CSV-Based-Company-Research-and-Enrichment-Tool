import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import type { ScrapeResult } from './scrape'
import type { SearchResponse } from './search'
import type { NewsResult } from './news'

export interface ProfileInput {
  companyName: string
  website: string
  scrape: ScrapeResult
  search: SearchResponse
}

export interface ProfileResult {
  industry: string
  subIndustry: string
  primaryProduct: string
  targetCustomer: string
  estimatedSize: string
  keyOffering: string
}

export interface InsightsInput {
  companyName: string
  profile: ProfileResult
  news: NewsResult
}

export interface InsightsResult {
  salesAngle1: string
  salesAngle2: string
  salesAngle3: string
  riskSignal1: string
  riskSignal2: string
  riskSignal3: string
  recentNewsSummary: string
}

const MODEL = 'claude-sonnet-4-5'

const ProfileSchema = z.object({
  industry: z.string(),
  subIndustry: z.string(),
  primaryProduct: z.string(),
  targetCustomer: z.string(),
  estimatedSize: z.string(),
  keyOffering: z.string(),
})

const InsightsSchema = z.object({
  salesAngle1: z.string(),
  salesAngle2: z.string(),
  salesAngle3: z.string(),
  riskSignal1: z.string(),
  riskSignal2: z.string(),
  riskSignal3: z.string(),
  recentNewsSummary: z.string(),
})

let cachedClient: Anthropic | null = null
function getClient(): Anthropic {
  if (cachedClient) return cachedClient
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
  cachedClient = new Anthropic({ apiKey })
  return cachedClient
}

function extractText(message: Anthropic.Message): string {
  const parts = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
  return parts.join('').trim()
}

function stripJsonFences(raw: string): string {
  let text = raw.trim()
  const fenceMatch = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fenceMatch) text = fenceMatch[1].trim()
  const firstBrace = text.indexOf('{')
  const lastBrace = text.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    text = text.slice(firstBrace, lastBrace + 1)
  }
  return text
}

function parseJson<T>(raw: string, context: string): T {
  const cleaned = stripJsonFences(raw)
  try {
    return JSON.parse(cleaned) as T
  } catch (error) {
    throw new Error(
      `Failed to parse ${context} JSON response: ${(error as Error).message}. Raw: ${raw.slice(0, 300)}`,
    )
  }
}

export async function extractProfile(input: ProfileInput): Promise<ProfileResult> {
  const { companyName, website, scrape, search } = input

  const searchBlock = search.results
    .map((r) => `Title: ${r.title}, URL: ${r.url}, Snippet: ${r.snippet}`)
    .join('\n')

  const userMessage = `You are a business analyst. Analyze the following company data and extract a structured profile.
Company: ${companyName}
Website: ${website}
Website Content:
${scrape.markdown}
Search Results:
${searchBlock}
Extract and return ONLY a valid JSON object (no markdown, no explanation) with these exact fields:
{
"industry": "e.g., SaaS, Manufacturing, Finance",
"subIndustry": "e.g., Project Management, Supply Chain, Fintech",
"primaryProduct": "one-line description of main product/service",
"targetCustomer": "who this company sells to, e.g., Mid-market tech teams",
"estimatedSize": "e.g., 50-200 employees, $10M ARR",
"keyOffering": "2-3 sentence summary of value proposition"
}`

  const message = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1024,
    temperature: 0,
    system:
      'You are a business analyst extracting company profiles from web data. Always respond with valid JSON only.',
    messages: [{ role: 'user', content: userMessage }],
  })

  const raw = extractText(message)
  const json = parseJson<unknown>(raw, 'extractProfile')
  return ProfileSchema.parse(json)
}

export async function generateInsights(input: InsightsInput): Promise<InsightsResult> {
  const { companyName, profile, news } = input

  const newsBlock = news.articles
    .map(
      (a) => `Title: ${a.title}, Date: ${a.publishedAt}, Summary: ${a.description}`,
    )
    .join('\n')

  const userMessage = `You are a sales strategist and business analyst. Given a company profile and recent news, generate actionable insights.
Company: ${companyName}
Profile: ${JSON.stringify(profile)}
Recent News:
${newsBlock}
Generate and return ONLY a valid JSON object (no markdown, no explanation) with these exact fields:
{
"salesAngle1": "first unique sales angle to pitch this company",
"salesAngle2": "second unique sales angle",
"salesAngle3": "third unique sales angle",
"riskSignal1": "first risk or challenge this company may face",
"riskSignal2": "second risk or challenge",
"riskSignal3": "third risk or challenge",
"recentNewsSummary": "one-sentence summary of most important recent news, or 'No recent news' if articles is empty"
}`

  const message = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1024,
    temperature: 0,
    system:
      'You are a sales strategist and business analyst. Always respond with valid JSON only. Generate exactly 3 sales angles and 3 risk signals.',
    messages: [{ role: 'user', content: userMessage }],
  })

  const raw = extractText(message)
  const json = parseJson<unknown>(raw, 'generateInsights')
  return InsightsSchema.parse(json)
}
