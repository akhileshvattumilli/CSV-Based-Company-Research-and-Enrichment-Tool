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

const MODEL = 'claude-haiku-4-5'

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
    .map((r) => `- Title: ${r.title}\n  URL: ${r.url}\n  Snippet: ${r.snippet}`)
    .join('\n')

  const userMessage = `You are a senior B2B market analyst building a sales-ready profile of a company. Read the raw web data below, then produce a precise, evidence-based profile.

=== COMPANY ===
Name: ${companyName}
Website: ${website}

=== WEBSITE CONTENT (markdown) ===
${scrape.markdown || '(no website content retrieved)'}

=== SEARCH RESULTS ===
${searchBlock || '(no search results)'}

=== YOUR TASK ===
Think carefully before answering. Synthesize across BOTH the website content and the search results. Do not hallucinate — if a data point isn't present, say "Unknown" for that portion rather than invent.

Be SPECIFIC, not generic. Bad: "SaaS". Good: "Vertical SaaS for mid-market logistics operators" or "Enterprise collaboration platform for distributed engineering teams".

For each field, capture what a sales rep would actually need to qualify and pitch this account:

1. "industry": The broad industry category (e.g., "Software", "Healthcare Technology", "Financial Services", "E-commerce Infrastructure", "Industrial Manufacturing"). One line.

2. "subIndustry": A narrow, specific vertical or category that positions them in the market (e.g., "Vertical SaaS for logistics", "Developer tools / observability", "Fintech / B2B payments", "AI-native customer support platform"). One line. Avoid one-word answers like "SaaS" — always qualify with the vertical or functional niche.

3. "primaryProduct": One-line description of their flagship product or service. Include what it IS and who USES it (e.g., "All-in-one project management workspace used by product and design teams").

4. "targetCustomer": Their Ideal Customer Profile. Include: (a) B2B vs B2C vs B2B2C, (b) company size / segment (SMB, mid-market, enterprise, consumer), (c) functional buyer or department, and (d) vertical if relevant. Example: "B2B, mid-market to enterprise (500–5,000 employees), engineering leaders at SaaS companies".

5. "estimatedSize": Combine every maturity signal you can infer: headcount range, funding stage (seed / Series A–D / public / bootstrapped), revenue hints if any, founded year if visible, and growth indicators (hiring, recent raises, press mentions). Example: "~200–500 employees, Series C (~$100M raised), founded 2018, growing headcount". If unknown, say "Unknown size, early-stage signals" rather than leaving blank.

6. "keyOffering": 3–4 sentences. Cover (a) the core value proposition in the company's own framing, (b) what makes them differentiated vs alternatives, and (c) their market position (leader / challenger / niche / new entrant). Ground every claim in the source material.

=== OUTPUT FORMAT ===
Respond with ONLY a single valid JSON object, no prose, no markdown fences, no commentary. Use this exact shape:

{
  "industry": "...",
  "subIndustry": "...",
  "primaryProduct": "...",
  "targetCustomer": "...",
  "estimatedSize": "...",
  "keyOffering": "..."
}`

  const message = await getClient().messages.create({
    model: MODEL,
    max_tokens: 2048,
    temperature: 0,
    system:
      'You are a senior B2B market analyst producing sales-ready company profiles. You ground every claim in the provided source material, prefer specific vertical/functional detail over generic labels, and use "Unknown" instead of fabricating. You always respond with valid JSON only — no prose, no markdown fences.',
    messages: [{ role: 'user', content: userMessage }],
  })

  const raw = extractText(message)
  const json = parseJson<unknown>(raw, 'extractProfile')
  return ProfileSchema.parse(json)
}

export async function generateInsights(input: InsightsInput): Promise<InsightsResult> {
  const { companyName, profile, news } = input

  const newsBlock =
    news.articles.length > 0
      ? news.articles
          .map(
            (a, i) =>
              `${i + 1}. [${a.publishedAt}] ${a.title}\n   ${a.description}`,
          )
          .join('\n')
      : '(no recent news articles retrieved)'

  const userMessage = `You are a senior sales strategist preparing an outbound playbook for ${companyName}. A rep is about to pitch this account and needs sharp, specific, evidence-grounded insights they can actually use on a call today.

=== COMPANY PROFILE (extracted from their website + search) ===
${JSON.stringify(profile, null, 2)}

=== RECENT NEWS ===
${newsBlock}

=== YOUR TASK ===
Generate 3 sales angles, 3 risk signals, and a recent-news summary. Quality rules below — follow them carefully.

--- SALES ANGLES ---
Each angle must answer THREE things in 2–3 sentences:
  (a) WHICH specific pain or opportunity at THIS company (cite evidence from their industry, size, stage, target customer, or recent news — never generic).
  (b) WHY it matters to them right now (growth stage, competitive pressure, scaling challenge, recent funding, hiring signal, regulatory/market shift, etc.).
  (c) HOW a seller could frame the opening hook — the angle of approach, not a generic pitch. Start each angle with a crisp label in plain prose, then the 2–3 sentence explanation.

Anti-patterns to avoid:
  - Generic phrases like "improve efficiency", "drive growth", "leverage AI" unless tied to concrete evidence about THIS company.
  - Re-stating what the company does as if it's an insight.
  - Three angles that are three rewordings of the same idea — each angle must attack a DIFFERENT vector (e.g., one could be timing-based around recent news, one could be scale-driven around their ICP, one could be competitive/positioning).

Good example pattern: "Capitalize on Series C scale-up — Their recent $80M Series C and aggressive engineering hiring signal a migration off homegrown tooling as teams cross 200 engineers. Lead with a POC on [specific workflow] tied to their new VP Eng's public goals around developer velocity."

--- RISK SIGNALS ---
Each risk must be a CONCRETE, real threat specific to this company's situation — 1–2 sentences. Cover real categories:
  - Competitive threats (name actual or likely competitors if inferrable from the profile/industry).
  - Market saturation, commoditization, or category shifts.
  - Customer concentration, churn risk, or segment risk.
  - Funding / runway pressure (if early stage) or margin pressure (if mature).
  - Platform / technology dependency risk (e.g., heavy reliance on a single cloud, API, or partner).
  - Regulatory or geographic exposure.
  - Hiring / talent / culture risks surfaced by recent news.

Avoid generic warnings like "economic downturn could hurt them" or "must keep innovating". Tie each risk to their industry, size, stage, or news. Each of the three risks must address a DIFFERENT category.

--- RECENT NEWS SUMMARY ---
One sentence, concrete, mentions the SPECIFIC signal and its implication for a seller. If there are articles, synthesize the most sales-relevant one (not just the most recent). If no articles, write exactly: "No recent news available."

=== OUTPUT FORMAT ===
Respond with ONLY a single valid JSON object, no prose, no markdown fences, no commentary. Use this exact shape:

{
  "salesAngle1": "...",
  "salesAngle2": "...",
  "salesAngle3": "...",
  "riskSignal1": "...",
  "riskSignal2": "...",
  "riskSignal3": "...",
  "recentNewsSummary": "..."
}`

  const message = await getClient().messages.create({
    model: MODEL,
    max_tokens: 2048,
    temperature: 0.3,
    system:
      'You are a senior B2B sales strategist. You generate concrete, evidence-grounded sales angles and risk signals that cite specific details from the profile and news provided. You avoid generic platitudes, never invent facts, and make every angle/risk attack a different vector so the three are genuinely distinct. You always respond with valid JSON only — no prose, no markdown fences.',
    messages: [{ role: 'user', content: userMessage }],
  })

  const raw = extractText(message)
  const json = parseJson<unknown>(raw, 'generateInsights')
  return InsightsSchema.parse(json)
}
