import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import Anthropic from '@anthropic-ai/sdk'
import { ANNUITY_SYSTEM_PROMPT, ANNUITY_USER_PROMPT } from '@/lib/financial-review/annuity-prompt'

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
    return appendInsight(supabase, id, summary, undefined, body.url)
  }

  // ── PDF mode ─────────────────────────────────────────────────────────────────
  const formData = await request.formData()
  const file = formData.get('pdf') as File | null
  const mode = (formData.get('mode') as string | null) ?? 'statement'

  if (!file) return Response.json({ error: 'No PDF provided' }, { status: 400 })

  const bytes = await file.arrayBuffer()
  const base64 = Buffer.from(bytes).toString('base64')
  const filename = file.name

  if (mode === 'statement') {
    return parseAndAppendContracts(supabase, id, base64, filename)
  } else {
    const summary = await summarizePdf(base64)
    return appendInsight(supabase, id, summary, filename)
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function parseAndAppendContracts(
  supabase: ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>,
  reviewId: string,
  base64: string,
  filename: string
) {
  const systemPrompt = ANNUITY_SYSTEM_PROMPT
  const userPrompt = ANNUITY_USER_PROMPT

  let newContracts: unknown[] = []
  try {
    const response = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 8192,
      thinking: { type: 'adaptive' },
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
          { type: 'text', text: ANNUITY_USER_PROMPT },
        ],
      }],
    })

    const textBlock = response.content.find(b => b.type === 'text')
    if (textBlock?.type === 'text') {
      // Strip markdown code fences if Claude wrapped its JSON
      const raw = textBlock.text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()
      console.log('[supplement] raw Claude output:', raw.slice(0, 500))
      const parsed = JSON.parse(raw) as { contracts?: unknown[] }
      // Filter out completely empty entries (all key fields null)
      newContracts = (parsed.contracts ?? []).filter((c: unknown) => {
        const ct = c as Record<string, unknown>
        return ct.carrier || ct.contract_number || ct.account_value != null || ct.owner
      })
      console.log('[supplement] extracted contracts:', newContracts.length, newContracts.map((c: unknown) => (c as Record<string, unknown>).carrier))
    }
  } catch (err) {
    console.error('[supplement] parse error:', err)
    return Response.json({ error: err instanceof Error ? err.message : 'Parse failed' }, { status: 500 })
  }

  // Fetch existing contracts + documents and merge
  const { data: existing } = await supabase
    .from('financial_reviews')
    .select('contracts, documents')
    .eq('id', reviewId)
    .single()

  const ex = existing as { contracts?: unknown[]; documents?: unknown[] } | null
  const existingContracts = Array.isArray(ex?.contracts) ? ex!.contracts : []
  const existingDocs      = Array.isArray(ex?.documents) ? ex!.documents : []

  const newDoc = { filename, uploaded_at: new Date().toISOString(), mode: 'statement' }

  const { data, error } = await supabase
    .from('financial_reviews')
    .update({
      contracts:   [...existingContracts, ...newContracts],
      documents:   [...existingDocs, newDoc],
      updated_at:  new Date().toISOString(),
    })
    .eq('id', reviewId)
    .select('id, contracts, documents')
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
  insight: string,
  filename?: string,
  url?: string
) {
  const { data: existing } = await supabase
    .from('financial_reviews')
    .select('recommendation_notes, documents')
    .eq('id', reviewId)
    .single()

  const ex = existing as { recommendation_notes?: string | null; documents?: unknown[] } | null
  const currentNotes  = ex?.recommendation_notes ?? ''
  const existingDocs  = Array.isArray(ex?.documents) ? ex!.documents : []

  const separator = currentNotes.trim() ? '\n\n---\n\n' : ''
  const newNotes  = `${currentNotes}${separator}${insight}`
  const newDoc    = filename
    ? { filename, uploaded_at: new Date().toISOString(), mode: 'info' }
    : url
    ? { filename: url, uploaded_at: new Date().toISOString(), mode: 'url', url }
    : null

  const { data, error } = await supabase
    .from('financial_reviews')
    .update({
      recommendation_notes: newNotes,
      documents:            newDoc ? [...existingDocs, newDoc] : existingDocs,
      updated_at:           new Date().toISOString(),
    })
    .eq('id', reviewId)
    .select('id, recommendation_notes, documents')
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ data, insight })
}
