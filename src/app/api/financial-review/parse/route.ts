import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { ANNUITY_SYSTEM_PROMPT, ANNUITY_USER_PROMPT } from '@/lib/financial-review/annuity-prompt'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const file = formData.get('pdf') as File | null

  if (!file) {
    return Response.json({ error: 'No PDF file provided' }, { status: 400 })
  }

  const bytes = await file.arrayBuffer()
  const base64 = Buffer.from(bytes).toString('base64')

  try {
    const response = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 8192,
      thinking: { type: 'adaptive' },
      system: ANNUITY_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
          { type: 'text', text: ANNUITY_USER_PROMPT },
        ],
      }],
    })

    const textBlock = response.content.find(b => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      return Response.json({ error: 'No text response from AI' }, { status: 500 })
    }

    let parsed: unknown
    try {
      const raw = textBlock.text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()
      parsed = JSON.parse(raw)
    } catch {
      return Response.json({ error: 'AI returned non-JSON response', raw: textBlock.text }, { status: 500 })
    }

    // Filter truly empty contract entries
    const p = parsed as { contracts?: unknown[] }
    if (Array.isArray(p.contracts)) {
      p.contracts = p.contracts.filter((c: unknown) => {
        const ct = c as Record<string, unknown>
        return ct.carrier || ct.contract_number || ct.account_value != null || ct.owner
      })
    }

    return Response.json({ data: parsed })
  } catch (err) {
    console.error('Claude parse error:', err)
    return Response.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}
