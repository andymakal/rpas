/**
 * Policy Review Prep Engine
 *
 * Generates call scripts and talking-point flags from a service_policy record.
 * Branches on product_type — Term gets a different prep than UL or WL/PERM.
 * Tobacco flag is a cross-cutting overlay applied to any policy type.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type ReviewType = 'term' | 'permanent_ul' | 'permanent_wl'

export type FlagSeverity = 'critical' | 'warning' | 'opportunity' | 'info'

export type ReviewFlag = {
  severity:    FlagSeverity
  label:       string
  description: string
}

/** Minimal policy shape the prep engine needs — populated from service_policies */
export type PolicyForPrep = {
  client_name:           string
  policy_number:         string
  carrier:               string
  product_type:          string | null
  issue_date:            string | null
  term_length:           string | null
  face_amount:           number | null
  death_benefit_amount:  number | null   // current DB (Option 2 > face_amount)
  cash_value_amount:     number | null   // from portal / import
  cost_basis:            number | null
  annual_premium:        number | null
  premium_mode:          string | null
  rate_class:            string | null
  riders:                string | null
  insured_first_name:    string | null
  insured_last_name:     string | null
  primary_beneficiary:   string | null   // from most recent review if available
}

// ── Review type classification ────────────────────────────────────────────────

export function getReviewType(productType: string | null): ReviewType {
  if (!productType) return 'term'
  const p = productType.toUpperCase()
  if (p === 'TERM')            return 'term'
  if (p === 'UL' || p === 'VUL') return 'permanent_ul'
  if (p === 'WL' || p === 'PERM') return 'permanent_wl'
  return 'term'
}

export function reviewTypeLabel(t: ReviewType): string {
  if (t === 'term')         return 'Term Life'
  if (t === 'permanent_ul') return 'Universal Life'
  return 'Whole Life'
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtAmt(v: number | null | undefined): string {
  if (v == null) return '[amount]'
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
  if (v >= 1_000)     return `$${Math.round(v / 1_000)}K`
  return `$${Math.round(v)}`
}

function fmtAmtFull(v: number | null | undefined): string {
  if (v == null) return '[amount]'
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  }).format(v)
}

function issueYear(iso: string | null): number | null {
  if (!iso) return null
  const d = iso.includes('T') ? new Date(iso) : new Date(iso + 'T12:00:00')
  return d.getFullYear()
}

function yearsRemaining(issueIso: string | null, termStr: string | null): number | null {
  if (!issueIso || !termStr) return null
  const match  = termStr.match(/\d+/)
  if (!match) return null
  const years  = parseInt(match[0], 10)
  const expiry = (issueYear(issueIso) ?? 0) + years
  return expiry - new Date().getFullYear()
}

function expirationYear(issueIso: string | null, termStr: string | null): number | null {
  const yr = issueYear(issueIso)
  if (!yr || !termStr) return null
  const match = termStr.match(/\d+/)
  if (!match) return null
  return yr + parseInt(match[0], 10)
}

function firstName(policy: PolicyForPrep): string {
  return policy.insured_first_name
    || policy.client_name.split(' ')[0]
    || 'there'
}

function isTobacco(rateClass: string | null): boolean {
  if (!rateClass) return false
  const r = rateClass.toLowerCase()
  return r.includes('tobacco') || r.includes('smoker') || r.includes('table')
}

function hasChildRider(riders: string | null): boolean {
  if (!riders) return false
  const r = riders.toLowerCase()
  return r.includes('child') || r.includes('cltr') || r.includes('ctr')
}

// ── Call script generator ─────────────────────────────────────────────────────

export function generateCallScript(policy: PolicyForPrep): string {
  const type = getReviewType(policy.product_type)
  const fn   = firstName(policy)
  const iy   = issueYear(policy.issue_date)
  const issueStr = iy ? `back in ${iy}` : 'some years ago'

  // Death benefit: if Option 2 has grown it above face, use death_benefit_amount
  const currentDB = policy.death_benefit_amount ?? policy.face_amount
  const dbGrown   = policy.death_benefit_amount
    && policy.face_amount
    && policy.death_benefit_amount > policy.face_amount

  const premiumStr = policy.annual_premium
    ? `${fmtAmtFull(policy.annual_premium)}${policy.premium_mode ? ` ${policy.premium_mode.toLowerCase()}` : ' annually'}`
    : '[premium]'

  const beneStr = policy.primary_beneficiary
    ? `I have ${policy.primary_beneficiary} listed as the primary beneficiary`
    : 'I want to confirm your beneficiary designation with you'

  const riderStr = hasChildRider(policy.riders)
    ? `\n\nThere's also a Children's Rider still attached to the policy — we'll want to take a quick look at that.`
    : ''

  // ── Term script ──────────────────────────────────────────────────────────────
  if (type === 'term') {
    const expYr  = expirationYear(policy.issue_date, policy.term_length)
    const yrLeft = yearsRemaining(policy.issue_date, policy.term_length)
    const termStr = policy.term_length ?? 'term'

    const expirationNote = expYr
      ? yrLeft != null && yrLeft <= 5
        ? `\n\nOne thing I want to make sure we discuss — this policy expires in ${expYr}, so we have ${yrLeft > 0 ? `about ${yrLeft} year${yrLeft !== 1 ? 's' : ''}` : 'very little time'} left on it. You do have options before that date, and I want to make sure you know what they are.`
        : `\n\nThis policy runs through ${expYr}.`
      : ''

    return `Hi ${fn}, this is [YOUR NAME] with Makal Financial Services. How are you today?

[AFTER PLEASANTRIES]

The reason I'm calling is that we do periodic reviews on the life insurance policies in our book of business — just a quick 5-minute check to make sure everything is still working for you.

I'm looking at your ${policy.carrier} ${termStr} term policy — policy number ${policy.policy_number}. You took this out ${issueStr} with a ${fmtAmt(policy.face_amount)} death benefit. You're currently paying ${premiumStr}.

${beneStr}.${riderStr}${expirationNote}

Does all of that still sound right to you?

— PAUSE — LISTEN — CONFIRM —

Is there anything there you'd like to take a look at today?`
  }

  // ── Universal Life script ────────────────────────────────────────────────────
  if (type === 'permanent_ul') {
    const dbNote = dbGrown
      ? `With the way this policy is structured — it uses an Option 2 death benefit — that amount has grown along with the cash value. Your current death benefit is right around ${fmtAmt(currentDB)}.`
      : `Your death benefit is ${fmtAmt(currentDB)}.`

    const cashNote = policy.cash_value_amount
      ? `You've got approximately ${fmtAmtFull(policy.cash_value_amount)} in cash value built up in the policy right now.`
      : ''

    const basisNote = policy.cost_basis
      ? ` Your cost basis — what you've actually paid in — is about ${fmtAmtFull(policy.cost_basis)}.`
      : ''

    return `Hi ${fn}, this is [YOUR NAME] with Makal Financial Services. How are you today?

[AFTER PLEASANTRIES]

The reason I'm calling is that we do periodic reviews on the life insurance policies in our book — just a quick check to make sure everything is still performing the way you need it to.

I'm looking at your ${policy.carrier} Universal Life policy — policy number ${policy.policy_number}. You took this out ${issueStr} with a ${fmtAmt(policy.face_amount)} face amount. ${dbNote}

${cashNote}${basisNote}

You're currently paying ${premiumStr}.

${beneStr}.${riderStr}

Does all of that still sound right to you?

— PAUSE — LISTEN — CONFIRM —

Is there anything you'd like to take a look at today?`
  }

  // ── Whole Life script ────────────────────────────────────────────────────────
  const cashNote = policy.cash_value_amount
    ? `You've got approximately ${fmtAmtFull(policy.cash_value_amount)} in cash value in the policy.`
    : ''

  return `Hi ${fn}, this is [YOUR NAME] with Makal Financial Services. How are you today?

[AFTER PLEASANTRIES]

The reason I'm calling is that we like to do a quick annual check on the life insurance policies in our book to make sure everything is still in order.

I'm looking at your ${policy.carrier} Whole Life policy — policy number ${policy.policy_number}. You've had this since ${issueStr}, and your death benefit is ${fmtAmt(policy.face_amount)}. ${cashNote}

You're currently paying ${premiumStr}.

${beneStr}.${riderStr}

Does all of that still sound right to you?

— PAUSE — LISTEN — CONFIRM —

Is there anything you'd like to take a look at today?`
}

// ── Talking point flags generator ────────────────────────────────────────────

export function generateFlags(policy: PolicyForPrep): ReviewFlag[] {
  const flags: ReviewFlag[] = []
  const type = getReviewType(policy.product_type)

  // ── TOBACCO — applies to any policy type ────────────────────────────────────
  if (isTobacco(policy.rate_class)) {
    flags.push({
      severity:    'critical',
      label:       `Tobacco Rate — ${policy.rate_class}`,
      description: 'Ask directly: "Are you still using tobacco products?" — LBL was strict; cigars, chew, and patches may qualify as non-tobacco with Lincoln today.',
    })
  }

  // ── TERM-SPECIFIC FLAGS ─────────────────────────────────────────────────────
  if (type === 'term') {
    const expYr  = expirationYear(policy.issue_date, policy.term_length)
    const yrLeft = yearsRemaining(policy.issue_date, policy.term_length)

    if (expYr && yrLeft != null) {
      if (yrLeft <= 0) {
        flags.push({
          severity:    'critical',
          label:       'Term Expired',
          description: `Policy expired in ${expYr} — verify current status and coverage gap.`,
        })
      } else if (yrLeft <= 2) {
        flags.push({
          severity:    'critical',
          label:       `Term Expires ${expYr} — Urgent`,
          description: `Only ${yrLeft} year${yrLeft !== 1 ? 's' : ''} remaining. Conversion or replacement conversation is time-sensitive.`,
        })
      } else if (yrLeft <= 5) {
        flags.push({
          severity:    'warning',
          label:       `Term Expires ${expYr}`,
          description: `${yrLeft} years remaining. Good window to discuss conversion privilege or replacement options.`,
        })
      }
    }
  }

  // ── PERMANENT-SPECIFIC FLAGS ────────────────────────────────────────────────
  if (type === 'permanent_ul' || type === 'permanent_wl') {

    // 1035 exchange opportunity
    if (policy.cash_value_amount && policy.cost_basis) {
      const gain    = policy.cash_value_amount - policy.cost_basis
      const gainPct = gain / policy.cost_basis
      if (gainPct > 0.15) {
        flags.push({
          severity:    'opportunity',
          label:       '1035 Exchange Opportunity',
          description: `${fmtAmtFull(gain)} in untaxed gain (CSV ${fmtAmtFull(policy.cash_value_amount)} vs. basis ${fmtAmtFull(policy.cost_basis)}). Discuss tax-free transfer to a better-suited policy.`,
        })
      }
    }

    // UL-specific: policy health / lapse risk
    if (type === 'permanent_ul' && policy.cash_value_amount && policy.annual_premium) {
      const yearsLeft = policy.cash_value_amount / policy.annual_premium
      if (yearsLeft < 5) {
        flags.push({
          severity:    'critical',
          label:       'Policy Health — Lapse Risk',
          description: `At current premium, cash value may only sustain the policy ~${Math.floor(yearsLeft)} more year${Math.floor(yearsLeft) !== 1 ? 's' : ''}. This UL may be underfunded — verify with carrier.`,
        })
      } else if (yearsLeft < 10) {
        flags.push({
          severity:    'warning',
          label:       'Policy Health — Monitor',
          description: `Cash value relative to premium suggests ~${Math.floor(yearsLeft)} years of sustainability. Worth a closer look with carrier.`,
        })
      }
    }
  }

  // ── CHILD RIDER ─────────────────────────────────────────────────────────────
  if (hasChildRider(policy.riders)) {
    flags.push({
      severity:    'warning',
      label:       'Child Rider Attached',
      description: 'Verify that insured children still qualify under the rider. May need removal, conversion to own policy, or simply confirmation.',
    })
  }

  // ── BENEFICIARY ─────────────────────────────────────────────────────────────
  if (!policy.primary_beneficiary) {
    flags.push({
      severity:    'warning',
      label:       'Beneficiary Not on File',
      description: 'Confirm primary and contingent beneficiary on the call and record it.',
    })
  }

  return flags
}
