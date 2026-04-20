import { Resend } from 'resend'

export interface SendEmailResult {
  success: boolean
  messageId?: string
  error?: string
}

const ATTACHMENT_FILENAME = 'enriched_companies.csv'

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10)
}

export async function sendEmail(
  recipientEmail: string,
  csvBuffer: Buffer,
): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not set')
  }

  const fromEmail = process.env.RESEND_FROM_EMAIL
  if (!fromEmail) {
    throw new Error('RESEND_FROM_EMAIL is not set')
  }

  const resend = new Resend(apiKey)

  try {
    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: recipientEmail,
      subject: `Enriched Company Data - ${todayStamp()}`,
      html: '<p>Your enriched CSV is attached.</p>',
      attachments: [
        {
          filename: ATTACHMENT_FILENAME,
          content: csvBuffer,
        },
      ],
    })

    if (error) {
      return { success: false, error: error.message }
    }

    return { success: true, messageId: data?.id }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
