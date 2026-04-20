import Papa from 'papaparse'
import { enrichRow, type CompanyInput, type EnrichedCompany } from '@/lib/enrichRow'
import { sendEmail } from '@/lib/email'

export const maxDuration = 60

interface EnrichResponseBody {
  success: boolean
  message: string
  companiesProcessed: number
  failureCount: number
}

function jsonResponse(body: EnrichResponseBody, status = 200): Response {
  return Response.json(body, { status })
}

function isValidCompanyRow(row: unknown): row is CompanyInput {
  if (!row || typeof row !== 'object') return false
  const record = row as Record<string, unknown>
  return (
    typeof record['Company Name'] === 'string' &&
    typeof record['Website'] === 'string'
  )
}

export async function POST(request: Request): Promise<Response> {
  try {
    const formData = await request.formData()
    const file = formData.get('file')
    const emailField = formData.get('email')

    if (!(file instanceof File) || file.size === 0) {
      return jsonResponse(
        {
          success: false,
          message: 'Missing CSV file upload (field "file").',
          companiesProcessed: 0,
          failureCount: 0,
        },
        400,
      )
    }

    if (typeof emailField !== 'string' || emailField.trim().length === 0) {
      return jsonResponse(
        {
          success: false,
          message: 'Missing recipient email (field "email").',
          companiesProcessed: 0,
          failureCount: 0,
        },
        400,
      )
    }

    const recipientEmail = emailField.trim()
    const csvText = await file.text()

    const parsed = Papa.parse<Record<string, unknown>>(csvText, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.replace(/^\uFEFF/, '').trim(),
    })

    const companies: CompanyInput[] = parsed.data.filter(isValidCompanyRow) as unknown as CompanyInput[]

    if (companies.length === 0) {
      return jsonResponse(
        {
          success: false,
          message:
            'CSV had no valid rows. Expected headers "Company Name" and "Website".',
          companiesProcessed: 0,
          failureCount: 0,
        },
        400,
      )
    }

    const settled = await Promise.allSettled(
      companies.map((company) => enrichRow(company)),
    )

    const enrichedCompanies: EnrichedCompany[] = settled.map((result, index) => {
      if (result.status === 'fulfilled') return result.value
      console.error(
        `[api/enrich] enrichRow failed for row ${index} (${companies[index]['Company Name']}):`,
        result.reason,
      )
      return buildFallbackRow(companies[index], result.reason)
    })

    const failureCount = settled.filter((r) => r.status === 'rejected').length

    const csvOutput = Papa.unparse(enrichedCompanies, { header: true })
    const csvBuffer = Buffer.from(csvOutput, 'utf-8')

    let emailResult
    try {
      emailResult = await sendEmail(recipientEmail, csvBuffer)
    } catch (error) {
      console.error('[api/enrich] sendEmail threw:', error)
      emailResult = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }

    if (!emailResult.success) {
      return jsonResponse(
        {
          success: false,
          message: `Pipeline completed but email failed: ${emailResult.error ?? 'unknown error'}`,
          companiesProcessed: enrichedCompanies.length,
          failureCount,
        },
        500,
      )
    }

    return jsonResponse({
      success: true,
      message: `Enriched CSV sent to ${recipientEmail}`,
      companiesProcessed: enrichedCompanies.length,
      failureCount,
    })
  } catch (error) {
    console.error('[api/enrich] unexpected error:', error)
    return jsonResponse(
      {
        success: false,
        message: `Pipeline failed: ${error instanceof Error ? error.message : String(error)}`,
        companiesProcessed: 0,
        failureCount: 0,
      },
      500,
    )
  }
}

function buildFallbackRow(company: CompanyInput, reason: unknown): EnrichedCompany {
  const errorMsg = reason instanceof Error ? reason.message : String(reason)
  const unavailable = `Data unavailable (${errorMsg})`
  return {
    'Company Name': company['Company Name'],
    Website: company.Website,
    Industry: unavailable,
    'Sub-Industry': unavailable,
    'Primary Product / Service': unavailable,
    'Target Customer (ICP)': unavailable,
    'Estimated Company Size': unavailable,
    'Recent News Summary': unavailable,
    'Key Offering Summary': unavailable,
    'Sales Angle 1': unavailable,
    'Sales Angle 2': unavailable,
    'Sales Angle 3': unavailable,
    'Risk Signal 1': unavailable,
    'Risk Signal 2': unavailable,
    'Risk Signal 3': unavailable,
    'Data Sources Used': 'None',
  }
}
