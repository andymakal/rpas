import { createAdminClient } from '@/lib/supabase/admin'
import { notFound } from 'next/navigation'
import { generateFlags, getReviewType } from '@/lib/reviews/prep'
import type { PolicyForPrep } from '@/lib/reviews/prep'

export const dynamic = 'force-dynamic'

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  const expiry = (issueYear(issueIso) ?? 0) + parseInt(match[0], 10)
  return expiry - new Date().getFullYear()
}

function yearsActive(issueIso: string | null): number | null {
  if (!issueIso) return null
  const iy = issueYear(issueIso)
  if (!iy) return null
  return new Date().getFullYear() - iy
}

function expiryYear(issueIso: string | null, termStr: string | null): number | null {
  const iy = issueYear(issueIso)
  if (!iy || !termStr) return null
  const match = termStr.match(/\d+/)
  if (!match) return null
  return iy + parseInt(match[0], 10)
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function ReviewPrintPage(
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

  if (!review) notFound()

  const policy = review.service_policies as unknown as (PolicyForPrep & {
    agents: { first_name: string; last_name: string } | null
  }) | null

  if (!policy) notFound()

  const reviewDate  = review.call_completed_at
    ? fmtDate(review.call_completed_at)
    : new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  const type        = getReviewType(policy.product_type)
  const isPerma     = type !== 'term'
  const deathBenefit = policy.death_benefit_amount ?? policy.face_amount
  const yrLeft      = yearsRemaining(policy.issue_date, policy.term_length)
  const yrActive    = yearsActive(policy.issue_date)
  const expYear     = expiryYear(policy.issue_date, policy.term_length)
  const iyear       = issueYear(policy.issue_date)
  const lspName     = policy.agents
    ? `${policy.agents.first_name} ${policy.agents.last_name}`
    : null

  // Generate flags to drive status message and recommendations
  const flags = generateFlags(policy)
  const hasCritical = flags.some(f => f.severity === 'critical')
  const hasWarning  = flags.some(f => f.severity === 'warning')

  const statusMsg = hasCritical
    ? 'Action needed — please review the items below with your advisor'
    : hasWarning
      ? 'A few items below deserve your attention'
      : '✓ Your policy is in excellent standing and fully protecting your family ✓'

  const statusColor = hasCritical ? '#c0392b' : hasWarning ? '#d68910' : '#1a7a4a'
  const statusBg    = hasCritical ? '#fdf2f2' : hasWarning ? '#fefdf2' : '#f2fdf5'
  const statusBorder = hasCritical ? '#e74c3c' : hasWarning ? '#f39c12' : '#27ae60'

  // Personalized recommendations from flags + standards
  const recommendations: string[] = []
  if (yrLeft != null && yrLeft <= 5 && !isPerma) {
    recommendations.push(`Your term policy expires in ${expYear} — contact us to review your conversion and renewal options before time runs out.`)
  }
  if (!policy.primary_beneficiary || policy.primary_beneficiary === 'Not specified') {
    recommendations.push('Update your beneficiary designations to ensure your coverage reaches your intended recipients.')
  } else {
    recommendations.push('Confirm your beneficiary designations are current, especially after any life changes.')
  }
  if (isPerma && policy.cash_value_amount && policy.cash_value_amount > 0) {
    recommendations.push('Your policy has accumulated cash value — ask us about loan options or how this value works within your financial plan.')
  }
  flags.filter(f => f.severity === 'critical' || f.severity === 'warning').forEach(f => {
    if (!recommendations.some(r => r.toLowerCase().includes('beneficiary') && f.label.toLowerCase().includes('beneficiary'))) {
      recommendations.push(f.description)
    }
  })
  if (recommendations.length < 3) {
    recommendations.push('Review your coverage needs annually as your life circumstances change.')
  }
  recommendations.push('Contact us any time with questions about your policy or financial planning needs.')

  const yearsRemainingDisplay = isPerma
    ? 'Permanent'
    : yrLeft != null
      ? `${yrLeft} yrs`
      : '—'

  const coverageSince = iyear
    ? `${iyear}`
    : '—'

  const yearsActiveDisplay = yrActive != null ? `${yrActive} Year${yrActive !== 1 ? 's' : ''} Active` : '—'

  const termDisplay = isPerma
    ? `Permanent (No Expiration)`
    : policy.term_length
      ? `${policy.term_length} (Expires ${expYear ?? '—'})`
      : '—'

  const premiumDisplay = policy.premium_mode
    ? `${policy.premium_mode} (${fmt(policy.annual_premium)}/year)`
    : policy.annual_premium
      ? `${fmt(policy.annual_premium)}/year`
      : '—'

  const beneficiaryDisplay = review.primary_beneficiary_confirmed
    || policy.primary_beneficiary
    || 'Not specified'

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Annual Policy Review — {policy.client_name}</title>
        <style>{`
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: 'Segoe UI', Arial, sans-serif;
            font-size: 13px;
            color: #222;
            background: #fff;
            padding: 32px 40px;
            max-width: 860px;
            margin: 0 auto;
          }
          @media print {
            body { padding: 16px 24px; }
            .no-print { display: none !important; }
            @page { margin: 0.5in; }
          }

          /* Header */
          .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1B4FC4; padding-bottom: 10px; margin-bottom: 20px; }
          .header-left h1 { color: #1B4FC4; font-size: 15px; font-weight: 700; }
          .header-left p  { color: #555; font-size: 12px; margin-top: 2px; }
          .header-right   { text-align: right; font-size: 11px; color: #555; line-height: 1.6; }

          /* Title */
          .title h2 { color: #1B4FC4; font-size: 26px; font-weight: 800; margin-bottom: 4px; }
          .title p  { font-size: 16px; color: #333; margin-bottom: 18px; }

          /* Stat cards */
          .stats { display: grid; grid-template-columns: repeat(4,1fr); gap: 10px; margin-bottom: 16px; }
          .stat-card { border: 1px solid #d1d9f0; border-radius: 6px; padding: 12px 14px; }
          .stat-card .stat-label { font-size: 9px; font-weight: 700; color: #777; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
          .stat-card .stat-value { font-size: 22px; font-weight: 800; color: #1B4FC4; margin-bottom: 2px; }
          .stat-card .stat-sub   { font-size: 10px; color: #888; }

          /* Status banner */
          .status-banner {
            border: 1.5px solid ${statusBorder};
            border-radius: 6px;
            background: ${statusBg};
            color: ${statusColor};
            padding: 10px 16px;
            font-size: 13px;
            font-weight: 600;
            text-align: center;
            margin-bottom: 18px;
          }

          /* Section */
          .section { margin-bottom: 18px; }
          .section-title {
            font-size: 12px; font-weight: 700; color: #1B4FC4;
            text-transform: uppercase; letter-spacing: 0.5px;
            border-left: 3px solid #1B4FC4;
            padding-left: 8px; margin-bottom: 10px;
          }

          /* Info table */
          .info-table { width: 100%; border-collapse: collapse; }
          .info-table td { padding: 6px 8px; font-size: 12px; border: 1px solid #e8ecf8; }
          .info-table .label { color: #666; width: 30%; }
          .info-table .value { font-weight: 600; color: #222; }

          /* Two-column info layout */
          .info-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
          .info-box { border: 1px solid #e0e6f5; border-radius: 5px; overflow: hidden; }
          .info-box table { width: 100%; border-collapse: collapse; }
          .info-box td { padding: 5px 10px; font-size: 12px; border-bottom: 1px solid #eef1fb; }
          .info-box td:first-child { color: #777; width: 48%; }
          .info-box td:last-child  { font-weight: 600; text-align: right; }

          /* Cash value */
          .cv-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
          .cv-box { border: 1px solid #e0e6f5; border-radius: 5px; padding: 10px 14px; }
          .cv-row { display: flex; justify-content: space-between; font-size: 12px; padding: 4px 0; border-bottom: 1px solid #f0f3fb; }
          .cv-row:last-child { border-bottom: none; }
          .cv-label { color: #666; }
          .cv-value { font-weight: 700; }

          /* Alert row */
          .alert-row { border: 1px solid #f0c040; background: #fffbec; border-radius: 4px; padding: 6px 12px; font-size: 11px; color: #7a6000; display: flex; justify-content: space-between; margin-top: 8px; }

          /* Conversion */
          .conversion-box { border: 1px solid #dbe6fb; border-radius: 5px; padding: 12px 14px; background: #f6f8ff; }
          .conversion-box h4 { color: #1B4FC4; font-size: 13px; font-weight: 700; margin-bottom: 4px; }
          .conversion-box p  { font-size: 12px; color: #555; }

          /* Recommendations */
          .rec-list { list-style: none; padding: 0; }
          .rec-list li { display: flex; gap: 10px; padding: 6px 0; border-bottom: 1px solid #f0f3fb; font-size: 12px; color: #333; }
          .rec-list li:last-child { border-bottom: none; }
          .rec-num { background: #1B4FC4; color: #fff; border-radius: 50%; width: 18px; height: 18px; font-size: 10px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 1px; }

          /* Footer */
          .footer { margin-top: 24px; padding-top: 10px; border-top: 1px solid #ddd; font-size: 10px; color: #888; display: flex; justify-content: space-between; }

          /* Print button */
          .print-btn {
            position: fixed; bottom: 24px; right: 24px;
            background: #1B4FC4; color: #fff;
            border: none; border-radius: 8px;
            padding: 10px 20px; font-size: 14px; font-weight: 600;
            cursor: pointer; box-shadow: 0 4px 12px rgba(27,79,196,0.4);
            transition: opacity 0.2s;
          }
          .print-btn:hover { opacity: 0.9; }
        `}</style>
      </head>
      <body>

        {/* Print button (hidden on print) */}
        <button className="print-btn no-print" onClick="window.print()">
          🖨 Print / Save as PDF
        </button>

        {/* Header */}
        <div className="header">
          <div className="header-left">
            <h1>Andy Makal, Investment Advisory Representative</h1>
            {lspName && <p>In partnership with {lspName}</p>}
          </div>
          <div className="header-right">
            Annual Policy Review<br />
            Review Date: {reviewDate}<br />
            Policy Year: {iyear ?? 'N/A'}
          </div>
        </div>

        {/* Title */}
        <div className="title">
          <h2>Annual Policy Review</h2>
          <p>{policy.client_name}</p>
        </div>

        {/* 4 Stat Cards */}
        <div className="stats">
          <div className="stat-card">
            <div className="stat-label">Death Benefit</div>
            <div className="stat-value">{deathBenefit ? fmt(deathBenefit) : '—'}</div>
            <div className="stat-sub">Guaranteed Level</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Annual Premium</div>
            <div className="stat-value">{policy.annual_premium ? fmt(policy.annual_premium) : '—'}</div>
            <div className="stat-sub">{policy.premium_mode ?? 'N/A'}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Years Remaining</div>
            <div className="stat-value">{yearsRemainingDisplay}</div>
            <div className="stat-sub">of {isPerma ? 'Permanent' : (policy.term_length ?? 'Term')}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Coverage Since</div>
            <div className="stat-value">{coverageSince}</div>
            <div className="stat-sub">{yearsActiveDisplay}</div>
          </div>
        </div>

        {/* Status Banner */}
        <div className="status-banner">{statusMsg}</div>

        {/* Policy Information */}
        <div className="section">
          <div className="section-title">Policy Information</div>
          <div className="info-cols">
            <div className="info-box">
              <table>
                <tbody>
                  <tr><td>Policy Number</td><td>{policy.policy_number ?? '—'}</td></tr>
                  <tr><td>Insured</td><td>{policy.insured_first_name && policy.insured_last_name ? `${policy.insured_first_name} ${policy.insured_last_name}` : policy.client_name}</td></tr>
                  <tr><td>Carrier</td><td>{policy.carrier ?? '—'}</td></tr>
                  <tr><td>Issue Date</td><td>{policy.issue_date ? fmtDate(policy.issue_date) : '—'}</td></tr>
                  <tr><td>Term / Type</td><td>{termDisplay}</td></tr>
                </tbody>
              </table>
            </div>
            <div className="info-box">
              <table>
                <tbody>
                  <tr><td>Premium Mode</td><td>{premiumDisplay}</td></tr>
                  <tr><td>Rate Class</td><td>{policy.rate_class ?? '—'}</td></tr>
                  <tr><td>Primary Beneficiary</td><td>{beneficiaryDisplay}</td></tr>
                  <tr><td>Contingent Beneficiary</td><td>—</td></tr>
                  <tr><td>Riders</td><td>{policy.riders ?? 'None'}</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Cash Value — permanent policies only */}
        {isPerma && (
          <div className="section">
            <div className="section-title">💰 Policy Performance &amp; Cash Value</div>
            <div className="cv-grid">
              <div className="cv-box">
                <div style={{ fontSize: 11, fontWeight: 700, color: '#555', marginBottom: 6 }}>📊 Current Policy Values</div>
                <div className="cv-row"><span className="cv-label">Cash Value</span><span className="cv-value">{fmt(policy.cash_value_amount)}</span></div>
                <div className="cv-row"><span className="cv-label">Cash Surrender Value</span><span className="cv-value">{fmt(policy.cash_value_amount)}</span></div>
              </div>
              <div className="cv-box">
                <div style={{ fontSize: 11, fontWeight: 700, color: '#555', marginBottom: 6 }}>&nbsp;</div>
                <div className="cv-row"><span className="cv-label">Outstanding Loans</span><span className="cv-value">—</span></div>
                <div className="cv-row"><span className="cv-label">Cost Basis (1035)</span><span className="cv-value">{fmt(policy.cost_basis)}</span></div>
              </div>
            </div>
            {!policy.primary_beneficiary && (
              <div className="alert-row">
                <span>⚠ Beneficiary designation not on file</span>
                <span style={{ fontWeight: 700 }}>Action required</span>
              </div>
            )}
          </div>
        )}

        {/* Conversion Privilege — term policies */}
        {!isPerma && (
          <div className="section">
            <div className="section-title">🔄 Conversion Privilege</div>
            <div className="conversion-box">
              <h4>💡 You Have Valuable Conversion Options Available</h4>
              <p>Your term policy includes a conversion privilege that allows you to convert to permanent coverage without a new medical exam. Contact your advisor to discuss your options before this privilege expires{expYear ? ` in ${expYear}` : ''}.</p>
              {yrLeft != null && yrLeft <= 5 && (
                <p style={{ marginTop: 8, color: '#c0392b', fontWeight: 600 }}>
                  ⏰ Time-sensitive: Only {yrLeft} year{yrLeft !== 1 ? 's' : ''} remaining to exercise this option.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Personalized Recommendations */}
        <div className="section">
          <div className="section-title">Personalized Recommendations</div>
          <ul className="rec-list">
            {recommendations.slice(0, 5).map((rec, i) => (
              <li key={i}>
                <div className="rec-num">{i + 1}</div>
                <span>{rec}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Footer */}
        <div className="footer">
          <span>This review is provided for informational purposes. Policy terms are governed by your contract.</span>
          <span>Questions? Contact Andy Makal{lspName ? ` or ${lspName}` : ''}</span>
        </div>

        {/* Auto-print script */}
        <script dangerouslySetInnerHTML={{ __html: `
          window.addEventListener('load', function() {
            // Small delay so styles render before print dialog
            setTimeout(function() { window.print(); }, 400);
          });
        `}} />

      </body>
    </html>
  )
}
