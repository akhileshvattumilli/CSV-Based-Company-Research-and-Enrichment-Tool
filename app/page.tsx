'use client'

import { useState, type FormEvent } from 'react'

interface EnrichApiResponse {
  success: boolean
  message: string
  companiesProcessed: number
  failureCount: number
}

interface Result {
  success: boolean
  message: string
  stats?: {
    companiesProcessed: number
    failureCount: number
  }
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null)
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<Result | null>(null)

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()

    if (!file || !email) {
      setResult({
        success: false,
        message: 'Please upload a CSV and enter an email.',
      })
      return
    }

    setLoading(true)
    setResult(null)

    const formData = new FormData()
    formData.append('file', file)
    formData.append('email', email)

    try {
      const res = await fetch('/api/enrich', { method: 'POST', body: formData })
      const data = (await res.json()) as EnrichApiResponse
      setResult({
        success: data.success,
        message: data.message,
        stats: {
          companiesProcessed: data.companiesProcessed,
          failureCount: data.failureCount,
        },
      })
    } catch (error) {
      setResult({
        success: false,
        message: `Error: ${error instanceof Error ? error.message : String(error)}`,
      })
    } finally {
      setLoading(false)
    }
  }

  const handleReset = () => {
    setResult(null)
    setFile(null)
    setEmail('')
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-2xl p-8 w-full max-w-md">
        <h1 className="text-3xl font-bold text-slate-900 mb-2">
          Lead Enrichment
        </h1>
        <p className="text-slate-600 mb-6">
          Upload a CSV of companies. We&apos;ll enrich each row with web data
          and AI insights, then email the results back to you.
        </p>

        {!result ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="csv-file"
                className="block text-sm font-medium text-slate-700 mb-2"
              >
                CSV File
              </label>
              <input
                id="csv-file"
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                disabled={loading}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-slate-900 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
              />
              {file && (
                <p className="text-sm text-slate-600 mt-1">
                  Selected: {file.name}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="recipient-email"
                className="block text-sm font-medium text-slate-700 mb-2"
              >
                Recipient Email
              </label>
              <input
                id="recipient-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@example.com"
                required
                disabled={loading}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
              />
            </div>

            <button
              type="submit"
              disabled={loading || !file || !email}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 disabled:cursor-not-allowed text-white font-semibold py-2.5 rounded-lg transition flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <svg
                    className="animate-spin h-4 w-4 text-white"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                    />
                  </svg>
                  Processing...
                </>
              ) : (
                'Enrich CSV'
              )}
            </button>

            {loading && (
              <p className="text-xs text-slate-500 text-center">
                Scraping sites, searching news, and running AI analysis. This
                can take up to a minute.
              </p>
            )}
          </form>
        ) : (
          <div
            className={`p-4 rounded-lg border ${
              result.success
                ? 'bg-green-50 border-green-200'
                : 'bg-red-50 border-red-200'
            }`}
          >
            <p
              className={`font-semibold ${
                result.success ? 'text-green-900' : 'text-red-900'
              }`}
            >
              {result.success ? 'Success' : 'Error'}
            </p>
            <p
              className={`text-sm mt-2 ${
                result.success ? 'text-green-800' : 'text-red-800'
              }`}
            >
              {result.message}
            </p>

            {result.stats && result.stats.companiesProcessed > 0 && (
              <div className="mt-3 text-sm text-slate-700 space-y-1">
                <p>Companies processed: {result.stats.companiesProcessed}</p>
                {result.stats.failureCount > 0 && (
                  <p className="text-orange-600">
                    Enrichment failures: {result.stats.failureCount}
                  </p>
                )}
              </div>
            )}

            <button
              onClick={handleReset}
              className="mt-4 w-full bg-slate-700 hover:bg-slate-800 text-white font-semibold py-2 rounded-lg transition"
            >
              Upload Another
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
