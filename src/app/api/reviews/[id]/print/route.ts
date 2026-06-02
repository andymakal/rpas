import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'
import { generateFlags, getReviewType } from '@/lib/reviews/prep'
import type { PolicyForPrep } from '@/lib/reviews/prep'

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(v: number | null | undefined): string {
  if (v == null) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  }).format(v)
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = iso.includes('T') ? new Date(iso) : new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function issueYear(iso: string | null): number | null {
  if (!iso) return null
  const d = iso.includes('T') ? new Date(iso) : new Date(iso + 'T12:00:00')
  return d.getFullYear()
}

function yearsRemaining(issueIso: string | null, termStr: string | null): number | null {
  if (!issueIso || !termStr) return null
  const match = termStr.match(/\d+/)
  if (!match) return null
  return (issueYear(issueIso) ?? 0) + parseInt(match[0], 10) - new Date().getFullYear()
}

function yearsActive(issueIso: string | null): number | null {
  const iy = issueYear(issueIso)
  return iy ? new Date().getFullYear() - iy : null
}

function expiryYear(issueIso: string | null, termStr: string | null): number | null {
  const iy = issueYear(issueIso)
  if (!iy || !termStr) return null
  const match = termStr.match(/\d+/)
  return match ? iy + parseInt(match[0], 10) : null
}

function e(s: string | null | undefined): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ── Route Handler — returns raw HTML (no Next.js layout wrapping) ─────────────

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: review } = await supabase
    .from('policy_reviews')
    .select(`
      id, review_number, review_type, assigned_to, status, outcome,
      call_completed_at, prep_notes, primary_beneficiary_confirmed,
      service_policies (
        id, client_name, policy_number, carrier, product_type,
        issue_date, term_length, face_amount, death_benefit_amount,
        cash_value_amount, cost_basis, annual_premium, premium_mode,
        rate_class, riders, insured_first_name, insured_last_name,
        primary_beneficiary,
        agents ( first_name, last_name )
      )
    `)
    .eq('id', id)
    .single()

  if (!review) {
    return new Response('Review not found', { status: 404 })
  }

  const policy = review.service_policies as unknown as (PolicyForPrep & {
    agents: { first_name: string; last_name: string } | null
  }) | null

  if (!policy) {
    return new Response('Policy not found', { status: 404 })
  }

  const reviewDate   = review.call_completed_at
    ? fmtDate(review.call_completed_at)
    : new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  const type         = getReviewType(policy.product_type)
  const isPerma      = type !== 'term'
  const deathBenefit = policy.death_benefit_amount ?? policy.face_amount
  const yrLeft       = yearsRemaining(policy.issue_date, policy.term_length)
  const yrActive     = yearsActive(policy.issue_date)
  const expYear      = expiryYear(policy.issue_date, policy.term_length)
  const iyear        = issueYear(policy.issue_date)
  const lspName      = policy.agents
    ? `${policy.agents.first_name} ${policy.agents.last_name}`
    : null

  const flags       = generateFlags(policy)
  const hasCritical = flags.some(f => f.severity === 'critical')
  const hasWarning  = flags.some(f => f.severity === 'warning')

  const statusMsg    = hasCritical
    ? 'Action needed — please review the items below with your advisor'
    : hasWarning
      ? 'A few items below deserve your attention'
      : '&#10003; Your policy is in excellent standing and fully protecting your family &#10003;'
  const statusBg     = hasCritical ? '#fdf2f2' : hasWarning ? '#fefdf2' : '#f2fdf5'
  const statusColor  = hasCritical ? '#c0392b' : hasWarning ? '#7a6000' : '#1a7a4a'
  const statusBorder = hasCritical ? '#e74c3c' : hasWarning ? '#f39c12' : '#27ae60'

  const termDisplay  = isPerma
    ? 'Permanent (No Expiration)'
    : policy.term_length ? `${e(policy.term_length)} (Expires ${expYear ?? '—'})` : '—'

  const premiumDisplay = policy.premium_mode
    ? `${e(policy.premium_mode)} (${fmt(policy.annual_premium)}/year)`
    : policy.annual_premium ? `${fmt(policy.annual_premium)}/year` : '—'

  const beneficiary = review.primary_beneficiary_confirmed
    || policy.primary_beneficiary
    || 'Not specified'

  const insuredName = policy.insured_first_name && policy.insured_last_name
    ? `${e(policy.insured_first_name)} ${e(policy.insured_last_name)}`
    : e(policy.client_name)

  // Recommendations
  const recs: string[] = []
  if (yrLeft != null && yrLeft <= 5 && !isPerma) {
    recs.push(`Your term policy expires in ${expYear} — contact us to review your conversion and renewal options before time runs out.`)
  }
  if (!policy.primary_beneficiary) {
    recs.push('Update your beneficiary designations to ensure your coverage reaches your intended recipients.')
  } else {
    recs.push('Confirm your beneficiary designations are current, especially after any major life changes.')
  }
  if (isPerma && policy.cash_value_amount && policy.cash_value_amount > 0) {
    recs.push('Your policy has accumulated cash value — ask us about options within your financial plan.')
  }
  flags.filter(f => f.severity === 'critical' || f.severity === 'warning').slice(0, 2).forEach(f => {
    recs.push(e(f.description))
  })
  if (recs.length < 3) recs.push('Review your coverage needs annually as your life circumstances change.')
  recs.push('Contact us any time with questions about your policy or financial planning needs.')

  const recItems = recs.slice(0, 5).map((r, i) =>
    `<li><div class="rec-num">${i + 1}</div><span>${r}</span></li>`
  ).join('')

  const cashValueSection = isPerma ? `
    <div class="section">
      <div class="section-title">&#128176; Policy Performance &amp; Cash Value</div>
      <div class="cv-grid">
        <div class="cv-box">
          <div class="cv-subtitle">&#128202; Current Policy Values</div>
          <div class="cv-row"><span class="cv-label">Cash Value</span><span class="cv-value">${fmt(policy.cash_value_amount)}</span></div>
          <div class="cv-row"><span class="cv-label">Cash Surrender Value</span><span class="cv-value">${fmt(policy.cash_value_amount)}</span></div>
        </div>
        <div class="cv-box">
          <div class="cv-subtitle">&nbsp;</div>
          <div class="cv-row"><span class="cv-label">Outstanding Loans</span><span class="cv-value">—</span></div>
          <div class="cv-row"><span class="cv-label">Cost Basis (1035)</span><span class="cv-value">${fmt(policy.cost_basis)}</span></div>
        </div>
      </div>
      ${!policy.primary_beneficiary ? '<div class="alert-row"><span>&#9888; Beneficiary designation not on file</span><span class="alert-action">Action required</span></div>' : ''}
    </div>` : ''

  const conversionSection = !isPerma ? `
    <div class="section">
      <div class="section-title">&#128260; Conversion Privilege</div>
      <div class="conversion-box">
        <h4>&#128161; You Have Valuable Conversion Options Available</h4>
        <p>Your term policy includes a conversion privilege that allows you to convert to permanent coverage without a new medical exam. Contact your advisor to discuss your options${expYear ? ` before ${expYear}` : ''}.</p>
        ${yrLeft != null && yrLeft <= 5 ? `<p class="urgent">&#9200; Time-sensitive: Only ${yrLeft} year${yrLeft !== 1 ? 's' : ''} remaining to exercise this option.</p>` : ''}
      </div>
    </div>` : ''

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Annual Policy Review — ${e(policy.client_name)}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#222;background:#fff;padding:32px 40px;max-width:860px;margin:0 auto}
    @media print{body{padding:16px 24px}.no-print{display:none!important}@page{margin:.5in}}
    .header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1B4FC4;padding-bottom:10px;margin-bottom:20px}
    .header h1{color:#1B4FC4;font-size:15px;font-weight:700}
    .header p{color:#555;font-size:12px;margin-top:2px}
    .header-right{text-align:right;font-size:11px;color:#555;line-height:1.7}
    .title h2{color:#1B4FC4;font-size:26px;font-weight:800;margin-bottom:4px}
    .title p{font-size:16px;color:#333;margin-bottom:18px}
    .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px}
    .stat-card{border:1px solid #d1d9f0;border-radius:6px;padding:12px 14px}
    .stat-label{font-size:9px;font-weight:700;color:#777;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px}
    .stat-value{font-size:22px;font-weight:800;color:#1B4FC4;margin-bottom:2px}
    .stat-sub{font-size:10px;color:#888}
    .status-banner{border:1.5px solid ${statusBorder};border-radius:6px;background:${statusBg};color:${statusColor};padding:10px 16px;font-size:13px;font-weight:600;text-align:center;margin-bottom:18px}
    .section{margin-bottom:18px}
    .section-title{font-size:12px;font-weight:700;color:#1B4FC4;text-transform:uppercase;letter-spacing:.5px;border-left:3px solid #1B4FC4;padding-left:8px;margin-bottom:10px}
    .info-cols{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    .info-box{border:1px solid #e0e6f5;border-radius:5px;overflow:hidden}
    .info-box table{width:100%;border-collapse:collapse}
    .info-box td{padding:5px 10px;font-size:12px;border-bottom:1px solid #eef1fb}
    .info-box td:first-child{color:#777;width:48%}
    .info-box td:last-child{font-weight:600;text-align:right}
    .cv-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .cv-box{border:1px solid #e0e6f5;border-radius:5px;padding:10px 14px}
    .cv-subtitle{font-size:11px;font-weight:700;color:#555;margin-bottom:6px}
    .cv-row{display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-bottom:1px solid #f0f3fb}
    .cv-row:last-child{border-bottom:none}
    .cv-label{color:#666}.cv-value{font-weight:700}
    .alert-row{border:1px solid #f0c040;background:#fffbec;border-radius:4px;padding:6px 12px;font-size:11px;color:#7a6000;display:flex;justify-content:space-between;margin-top:8px}
    .alert-action{font-weight:700}
    .conversion-box{border:1px solid #dbe6fb;border-radius:5px;padding:12px 14px;background:#f6f8ff}
    .conversion-box h4{color:#1B4FC4;font-size:13px;font-weight:700;margin-bottom:4px}
    .conversion-box p{font-size:12px;color:#555;margin-top:6px}
    .urgent{color:#c0392b!important;font-weight:600!important}
    .rec-list{list-style:none;padding:0}
    .rec-list li{display:flex;gap:10px;padding:6px 0;border-bottom:1px solid #f0f3fb;font-size:12px;color:#333}
    .rec-list li:last-child{border-bottom:none}
    .rec-num{background:#1B4FC4;color:#fff;border-radius:50%;width:18px;height:18px;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px}
    .footer{margin-top:24px;padding-top:10px;border-top:1px solid #ddd;font-size:10px;color:#888;display:flex;justify-content:space-between}
    .print-btn{display:block;margin:0 auto 24px;background:#1B4FC4;color:#fff;border:none;border-radius:8px;padding:10px 28px;font-size:14px;font-weight:600;cursor:pointer}
  </style>
</head>
<body>
  <button class="print-btn no-print" onclick="window.print()">&#128424; Print / Save as PDF</button>

  <div class="header">
    <div>
      <h1>Andy Makal, Investment Advisory Representative</h1>
      ${lspName ? `<p>In partnership with ${e(lspName)}</p>` : ''}
    </div>
    <div class="header-right">
      Annual Policy Review<br>
      Review Date: ${reviewDate}<br>
      Policy Year: ${iyear ?? 'N/A'}
    </div>
  </div>

  <div class="title">
    <h2>Annual Policy Review</h2>
    <p>${e(policy.client_name)}</p>
  </div>

  <div class="stats">
    <div class="stat-card">
      <div class="stat-label">Death Benefit</div>
      <div class="stat-value">${fmt(deathBenefit)}</div>
      <div class="stat-sub">Guaranteed Level</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Annual Premium</div>
      <div class="stat-value">${fmt(policy.annual_premium)}</div>
      <div class="stat-sub">${e(policy.premium_mode) || 'N/A'}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Years Remaining</div>
      <div class="stat-value">${isPerma ? 'Permanent' : yrLeft != null ? `${yrLeft} yrs` : '—'}</div>
      <div class="stat-sub">of ${isPerma ? 'Permanent' : e(policy.term_length) || 'Term'}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Coverage Since</div>
      <div class="stat-value">${iyear ?? '—'}</div>
      <div class="stat-sub">${yrActive != null ? `${yrActive} Year${yrActive !== 1 ? 's' : ''} Active` : '—'}</div>
    </div>
  </div>

  <div class="status-banner">${statusMsg}</div>

  <div class="section">
    <div class="section-title">Policy Information</div>
    <div class="info-cols">
      <div class="info-box"><table>
        <tr><td>Policy Number</td><td>${e(policy.policy_number)}</td></tr>
        <tr><td>Insured</td><td>${insuredName}</td></tr>
        <tr><td>Carrier</td><td>${e(policy.carrier)}</td></tr>
        <tr><td>Issue Date</td><td>${fmtDate(policy.issue_date)}</td></tr>
        <tr><td>Term / Type</td><td>${termDisplay}</td></tr>
      </table></div>
      <div class="info-box"><table>
        <tr><td>Premium Mode</td><td>${premiumDisplay}</td></tr>
        <tr><td>Rate Class</td><td>${e(policy.rate_class)}</td></tr>
        <tr><td>Primary Beneficiary</td><td>${e(beneficiary)}</td></tr>
        <tr><td>Contingent Beneficiary</td><td>—</td></tr>
        <tr><td>Riders</td><td>${e(policy.riders) || 'None'}</td></tr>
      </table></div>
    </div>
  </div>

  ${cashValueSection}
  ${conversionSection}

  <div class="section">
    <div class="section-title">Personalized Recommendations</div>
    <ul class="rec-list">${recItems}</ul>
  </div>

  <div class="footer">
    <span>This review is provided for informational purposes. Policy terms are governed by your contract.</span>
    <span>Questions? Contact Andy Makal${lspName ? ` or ${e(lspName)}` : ''}</span>
  </div>

  <script>window.addEventListener('load',function(){setTimeout(function(){window.print()},400)})</script>
</body>
</html>`

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}
