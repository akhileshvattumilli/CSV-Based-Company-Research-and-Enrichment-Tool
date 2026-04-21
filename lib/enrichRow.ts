import { scrape, type ScrapeResult } from './scrape'
import { search, type SearchResponse } from './search'
import { getNews, type NewsResult, type NewsArticle } from './news'
import {
  extractProfile,
  generateInsights,
  type ProfileResult,
  type InsightsResult,
} from './ai'

export interface CompanyInput {
  'Company Name': string
  Website: string
}

export interface EnrichedCompany extends CompanyInput {
  Industry: string
  'Sub-Industry': string
  'Primary Product / Service': string
  'Target Customer (ICP)': string
  'Estimated Company Size': string
  'Recent News Summary': string
  'Key Offering Summary': string
  'Sales Angle 1': string
  'Sales Angle 2': string
  'Sales Angle 3': string
  'Risk Signal 1': string
  'Risk Signal 2': string
  'Risk Signal 3': string
  'Data Sources Used': string
}

const UNAVAILABLE = 'Data unavailable'

const emptyProfile: ProfileResult = {
  industry: UNAVAILABLE,
  subIndustry: UNAVAILABLE,
  primaryProduct: UNAVAILABLE,
  targetCustomer: UNAVAILABLE,
  estimatedSize: UNAVAILABLE,
  keyOffering: UNAVAILABLE,
}

const emptyInsights: InsightsResult = {
  salesAngle1: UNAVAILABLE,
  salesAngle2: UNAVAILABLE,
  salesAngle3: UNAVAILABLE,
  riskSignal1: UNAVAILABLE,
  riskSignal2: UNAVAILABLE,
  riskSignal3: UNAVAILABLE,
  recentNewsSummary: UNAVAILABLE,
}

function hostFromUrl(url: string): string {
  try {
    const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`
    return new URL(normalized).hostname.replace(/^www\./i, '')
  } catch {
    return url
  }
}

export async function enrichRow(company: CompanyInput): Promise<EnrichedCompany> {
  const companyName = company['Company Name']
  const website = company.Website
  const sources: string[] = []

  const websiteHost = hostFromUrl(website)

  let scrapeData: ScrapeResult = { markdown: '' }
  let scrapeOk = false
  try {
    scrapeData = await scrape(website)
    scrapeOk = scrapeData.markdown.length > 0
    sources.push(
      scrapeOk
        ? `Firecrawl (${websiteHost})`
        : `Firecrawl (attempted: ${websiteHost} - no content)`,
    )
  } catch (error) {
    console.error(`[enrichRow] scrape failed for ${companyName}:`, error)
    sources.push(`Firecrawl (attempted: ${websiteHost} - failed)`)
  }

  let searchData: SearchResponse = { results: [] }
  try {
    searchData = await search(companyName)
    if (searchData.results.length > 0) {
      const topHosts = Array.from(
        new Set(searchData.results.slice(0, 3).map((r) => hostFromUrl(r.url))),
      )
        .filter(Boolean)
        .join(', ')
      sources.push(`Serper (search results from ${topHosts})`)
    } else {
      sources.push('Serper (no results)')
    }
  } catch (error) {
    console.error(`[enrichRow] search failed for ${companyName}:`, error)
    sources.push('Serper (failed)')
  }

  let newsData: NewsResult = { articles: [] }
  let newsArticles: NewsArticle[] = []
  let hasRealNews = false
  try {
    newsData = await getNews(companyName)
    newsArticles = newsData.articles
    hasRealNews =
      newsArticles.length > 0 &&
      !newsArticles[0].title.includes('No recent news')
    sources.push(
      hasRealNews
        ? `GNews (${newsArticles.length} news article${newsArticles.length === 1 ? '' : 's'})`
        : 'GNews (no recent news)',
    )
  } catch (error) {
    console.error(`[enrichRow] getNews failed for ${companyName}:`, error)
    sources.push('GNews (failed)')
  }

  let profile: ProfileResult = emptyProfile
  let profileOk = false
  try {
    profile = await extractProfile({
      companyName,
      website,
      scrape: scrapeData,
      search: searchData,
    })
    profileOk = true
  } catch (error) {
    console.error(`[enrichRow] extractProfile failed for ${companyName}:`, error)
  }

  let insights: InsightsResult = emptyInsights
  let insightsOk = false
  try {
    insights = await generateInsights({
      companyName,
      profile,
      newsArticles,
      hasRealNews,
    })
    insightsOk = true
  } catch (error) {
    console.error(`[enrichRow] generateInsights failed for ${companyName}:`, error)
  }

  const claudeCallsOk = Number(profileOk) + Number(insightsOk)
  if (claudeCallsOk === 2) {
    sources.push('Claude (2 AI calls)')
  } else if (claudeCallsOk === 1) {
    sources.push(
      profileOk ? 'Claude (profile only)' : 'Claude (insights only)',
    )
  } else {
    sources.push('Claude (failed)')
  }

  return {
    'Company Name': companyName,
    Website: website,
    Industry: profile.industry || UNAVAILABLE,
    'Sub-Industry': profile.subIndustry || UNAVAILABLE,
    'Primary Product / Service': profile.primaryProduct || UNAVAILABLE,
    'Target Customer (ICP)': profile.targetCustomer || UNAVAILABLE,
    'Estimated Company Size': profile.estimatedSize || UNAVAILABLE,
    'Recent News Summary': insights.recentNewsSummary || UNAVAILABLE,
    'Key Offering Summary': profile.keyOffering || UNAVAILABLE,
    'Sales Angle 1': insights.salesAngle1 || UNAVAILABLE,
    'Sales Angle 2': insights.salesAngle2 || UNAVAILABLE,
    'Sales Angle 3': insights.salesAngle3 || UNAVAILABLE,
    'Risk Signal 1': insights.riskSignal1 || UNAVAILABLE,
    'Risk Signal 2': insights.riskSignal2 || UNAVAILABLE,
    'Risk Signal 3': insights.riskSignal3 || UNAVAILABLE,
    'Data Sources Used': sources.length > 0 ? sources.join(', ') : 'None',
  }
}
