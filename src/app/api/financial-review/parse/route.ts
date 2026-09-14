import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

/**
 * POST /api/financial-review/parse
 *
 * Accepts a multipart/form-data with a PDF file (field name: "pdf").
 * Sends the PDF to Claude Opus 5 for structured annuity contract extraction.
 * Returns parsed contract data as JSON.
 */
export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const file = formData.get('pdf') as File | null

  if (!file) {
    return Response.json({ error: 'No PDF file provided' }, { status: 400 })
  }

  const bytes = await file.arrayBuffer()
  const base64 = Buffer.from(bytes).toString('base64')

  const systemPrompt = `You are an expert financial analyst specializing in annuity contracts.
Extract structured data from annuity carrier statements and fact sheets.
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
      "valuation_date": "YYYY-MM-DD or null — statement date",
      "account_value": "number or null — total account/accumulation value",
      "surrender_value": "number or null — net surrender value after charges",
      "cost_basis": "number or null — owner's cost basis / premium paid",
      "surrender_period": "string or null — e.g. '7 years' or 'ends 2027'",
      "surrender_schedule": [
        { "year": 1, "charge_pct": 8 },
        { "year": 2, "charge_pct": 7 }
      ],
      "current_surrender_charge_pct": "number or null — current applicable surrender charge %",
      "current_surrender_charge_amt": "number or null — dollar amount of current surrender charge",
      "free_withdrawal_pct": "number or null — typical 10%",
      "income_benefit": {
        "rider_name": "string or null — e.g. 'Guaranteed Lifetime Withdrawal Benefit'",
        "benefit_base": "number or null — income base / protected benefit value",
        "guaranteed_rollup_rate": "number or null — annual rollup % during accumulation phase",
        "withdrawal_pct": "number or null — payout % applied to benefit base",
        "annual_income": "number or null — guaranteed annual income amount",
        "income_start_date": "YYYY-MM-DD or null",
        "income_status": "one of: not started, active, or null"
      },
      "notes": "string or null — any important contract details not captured above"
    }
  ],
  "document_summary": "string — brief description of what this document is",
  "statement_date": "YYYY-MM-DD or null",
  "account_holder": "string — primary account holder name(s)"
}

If there is only one contract, the contracts array will have one entry.
If there are multiple contracts (e.g. from a brokerage statement), include all of them.
Use null for any field you cannot find or determine.
Return ONLY the JSON object — nothing else.`

  try {
    const response = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 4096,
      thinking: { type: 'adaptive' },
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: base64,
              },
            },
            { type: 'text', text: userPrompt },
          ],
        },
      ],
    })

    // Find the text block (thinking block may precede it)
    const textBlock = response.content.find(b => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      return Response.json({ error: 'No text response from AI' }, { status: 500 })
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(textBlock.text)
    } catch {
      return Response.json({ error: 'AI returned non-JSON response', raw: textBlock.text }, { status: 500 })
    }

    return Response.json({ data: parsed })
  } catch (err) {
    console.error('Claude parse error:', err)
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ error: message }, { status: 500 })
  }
}
