import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

/**
 * POST /api/financial-review/[id]/supplement
 *
 * Accepts either:
 *   - multipart/form-data with field "pdf" (File) + optional "mode" ("statement"|"info")
 *   - application/json with { url: string }
 *
 * mode "statement" (default): parses PDF as a carrier statement and appends
 *   extracted contracts to the review's contracts array.
 * mode "info": summarizes the PDF or URL as supplemental product insight and
 *   appends the summary to recommendation_notes.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createAdminClient()

  const contentType = request.headers.get('content-type') ?? ''

  // ── URL mode ────────────────────────────────────────────────────────────────
  if (contentType.includes('application/json')) {
    let body: { url?: string }
    try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }

    if (!body.url?.trim()) return Response.json({ error: 'url is required' }, { status: 400 })

    let pageText = ''
    try {
      const res = await fetch(body.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RPAS/1.0)' },
        signal: AbortSignal.timeout(15000),
      })
      pageText = await res.text()
      // Strip HTML tags to plain text
      pageText = pageText
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s{3,}/g, '\n\n')
        .slice(0, 40000)
    } catch (err) {
      return Response.json({ error: `Failed to fetch URL: ${err instanceof Error ? err.message : 'Unknown error'}` }, { status: 400 })
    }

    const summary = await summarizeText(pageText, body.url)
    return appendInsight(supabase, id, summary)
  }

  // ── PDF mode ─────────────────────────────────────────────────────────────────
  const formData = await request.formData()
  const file = formData.get('pdf') as File | null
  const mode = (formData.get('mode') as string | null) ?? 'statement'

  if (!file) return Response.json({ error: 'No PDF provided' }, { status: 400 })

  const bytes = await file.arrayBuffer()
  const base64 = Buffer.from(bytes).toString('base64')

  if (mode === 'statement') {
    // Parse as a carrier statement and append contracts
    return parseAndAppendContracts(supabase, id, base64)
  } else {
    // Summarize as product info and append to notes
    const summary = await summarizePdf(base64)
    return appendInsight(supabase, id, summary)
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function parseAndAppendContracts(
  supabase: ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>,
  reviewId: string,
  base64: string
) {
  const systemPrompt = `You are an expert financial analyst specializing in annuity contracts.
Extract structured data from annuity carrier statements.
Always respond with valid JSON only — no markdown, no prose, no code fences.`

  const userPrompt = `Extract all annuity contract information from this document and return a JSON object with this exact shape:

{
  "contracts": [
    {
      "contract_number": "string or null",
      "carrier": "string — insurance company name",
      "product_name": "string — product or series name, or null",
      "annuity_type": "one of: Fixed, Fixed Indexed, Variable, RILA, SPIA, MYGA, DIA, or null",
      "owner": "string — owner name(s)",
      "joint_owner": "string or null",
      "insured": "string or null",
      "account_type": "one of: Non-Qualified, Traditional IRA, Roth IRA, SEP IRA, SIMPLE IRA, Inherited IRA, or null",
      "issue_date": "YYYY-MM-DD or null",
      "valuation_date": "YYYY-MM-DD or null — the AS-OF date of this statement",
      "account_value": "number or null — CURRENT ending balance as of statement date",
      "surrender_value": "number or null — net surrender value after charges",
      "initial_premium": "number or null — first premium paid at contract issue",
      "total_premiums_paid": "number or null — ALL premiums and contributions paid to date",
      "surrender_period": "string or null",
      "surrender_schedule": [{ "year": 1, "charge_pct": 8 }],
      "current_surrender_charge_pct": "number or null",
      "current_surrender_charge_amt": "number or null",
      "free_withdrawal_pct": "number or null",
      "income_benefit": {
        "rider_name": "string or null",
        "benefit_base": "number or null",
        "guaranteed_rollup_rate": "number or null",
        "withdrawal_pct": "number or null",
        "annual_income": "number or null",
        "income_start_date": "YYYY-MM-DD or null",
        "income_status": "one of: not started, active, or null"
      },
      "notes": "string or null"
    }
  ]
}

Return ONLY the JSON object — nothing else.`

  let newContracts: unknown[] = []
  try {
    const response = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 4096,
      thinking: { type: 'adaptive' },
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
          { type: 'text', text: userPrompt },
        ],
      }],
    })

    const textBlock = response.content.find(b => b.type === 'text')
    if (textBlock?.type === 'text') {
      const parsed = JSON.parse(textBlock.text) as { contracts?: unknown[] }
      newContracts = parsed.contracts ?? []
    }
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Parse failed' }, { status: 500 })
  }

  // Fetch existing contracts and merge
  const { data: existing } = await supabase
    .from('financial_reviews')
    .select('contracts')
    .eq('id', reviewId)
    .single()

  const existingContracts = Array.isArray((existing as { contracts?: unknown[] } | null)?.contracts)
    ? (existing as { contracts: unknown[] }).contracts
    : []

  const merged = [...existingContracts, ...newContracts]

  const { data, error } = await supabase
    .from('financial_reviews')
    .update({ contracts: merged, updated_at: new Date().toISOString() })
    .eq('id', reviewId)
    .select('id, contracts')
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ data, added: newContracts.length })
}

async function summarizePdf(base64: string): Promise<string> {
  const response = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
        { type: 'text', text: 'Summarize the key product features, benefits, fees, and any important terms from this document. Focus on what would be most relevant to a financial advisor reviewing this product for a client. Be concise — 3 to 6 bullet points.' },
      ],
    }],
  })
  const textBlock = response.content.find(b => b.type === 'text')
  return textBlock?.type === 'text' ? textBlock.text : ''
}

async function summarizeText(text: string, url: string): Promise<string> {
  const response = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `From the following webpage content (${url}), extract the key product features, benefits, fees, crediting strategies, and any important terms relevant to an annuity advisor.\n\nBe concise — 3 to 6 bullet points.\n\n---\n${text}`,
    }],
  })
  const textBlock = response.content.find(b => b.type === 'text')
  return textBlock?.type === 'text' ? textBlock.text : ''
}

async function appendInsight(
  supabase: ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>,
  reviewId: string,
  insight: string
) {
  const { data: existing } = await supabase
    .from('financial_reviews')
    .select('recommendation_notes')
    .eq('id', reviewId)
    .single()

  const currentNotes = (existing as { recommendation_notes?: string | null } | null)?.recommendation_notes ?? ''
  const separator = currentNotes.trim() ? '\n\n---\n\n' : ''
  const newNotes = `${currentNotes}${separator}${insight}`

  const { data, error } = await supabase
    .from('financial_reviews')
    .update({ recommendation_notes: newNotes, updated_at: new Date().toISOString() })
    .eq('id', reviewId)
    .select('id, recommendation_notes')
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ data, insight })
}
