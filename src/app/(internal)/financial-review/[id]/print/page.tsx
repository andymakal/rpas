import { createAdminClient } from '@/lib/supabase/admin'
import { notFound } from 'next/navigation'
import type { ParsedContract } from '../page'

export const dynamic = 'force-dynamic'

// ── Formatters ────────────────────────────────────────────────────────────────

function fmt(v: number | null | undefined): string {
  if (v == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v)
}

function fmtPct(v: number | null | undefined): string {
  if (v == null) return '—'
  return `${v}%`
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = iso.includes('T') ? new Date(iso) : new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function fmtShortDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = iso.includes('T') ? new Date(iso) : new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function today(): string {
  return new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

// ── Row component ─────────────────────────────────────────────────────────────

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
      <td style={{ padding: '8px 12px', color: '#6b7280', fontSize: '12px', width: '45%' }}>{label}</td>
      <td style={{ padding: '8px 12px', color: bold ? '#111827' : '#1f2937', fontWeight: bold ? 600 : 400, fontSize: '13px' }}>
        {value}
      </td>
    </tr>
  )
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      backgroundColor: '#1F3864',
      color: 'white',
      padding: '8px 16px',
      fontSize: '11px',
      fontWeight: 700,
      letterSpacing: '0.1em',
      textTransform: 'uppercase',
      marginTop: '24px',
      marginBottom: '0',
    }}>
      {children}
    </div>
  )
}

// ── Main print page ───────────────────────────────────────────────────────────

export default async function FinancialReviewPrintPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: review, error } = await supabase
    .from('financial_reviews')
    .select(`
      id, review_number, status, contracts, recommendation_notes, created_at,
      customer_id,
      customers ( id, first_name, last_name, city, state, phone, email, date_of_birth )
    `)
    .eq('id', id)
    .single()

  if (error || !review) notFound()

  const rd = review as unknown as {
    id: string
    review_number: string | null
    contracts: ParsedContract[]
    recommendation_notes: string | null
    customers: {
      first_name: string
      last_name: string
      city: string | null
      state: string | null
      phone: string | null
      email: string | null
      date_of_birth: string | null
    } | null
  }

  const c = rd.customers
  const contracts: ParsedContract[] = Array.isArray(rd.contracts) ? rd.contracts : []
  const clientName = c ? `${c.first_name} ${c.last_name}` : 'Client'

  // Determine if any contracts have income benefits
  const hasIncomeBenefits = contracts.some(c => c.income_benefit != null)
  const totalAccountValue = contracts.reduce((sum, c) => sum + (c.account_value ?? 0), 0)
  const totalSurrenderValue = contracts.reduce((sum, c) => sum + (c.surrender_value ?? 0), 0)
  const totalCostBasis = contracts.reduce((sum, c) => sum + (c.total_premiums_paid ?? c.cost_basis ?? 0), 0)
  const totalSurrenderCharges = contracts.reduce((sum, c) => sum + (c.current_surrender_charge_amt ?? 0), 0)

  const navyBlue = '#1F3864'

  return (
    <html>
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`Financial Review — ${clientName}`}</title>
        <style>{`
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: Georgia, 'Times New Roman', serif; color: #111827; background: white; }
          @media print {
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .page-break { page-break-before: always; }
            .no-break { page-break-inside: avoid; }
          }
          table { width: 100%; border-collapse: collapse; }
          .container { max-width: 780px; margin: 0 auto; padding: 40px 32px; }
        `}</style>
      </head>
      <body>
        <div className="container" style={{ maxWidth: '780px', margin: '0 auto', padding: '40px 32px' }}>

          {/* ── Cover / Header ─────────────────────────────────────────── */}
          <div style={{ borderBottom: `3px solid ${navyBlue}`, paddingBottom: '24px', marginBottom: '32px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                  <div style={{
                    width: '32px', height: '32px', backgroundColor: navyBlue, borderRadius: '6px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'white', fontWeight: 700, fontSize: '12px',
                  }}>RP</div>
                  <div>
                    <div style={{ fontWeight: 700, color: navyBlue, fontSize: '15px' }}>Right Path</div>
                    <div style={{ color: '#6b7280', fontSize: '11px' }}>Agency System</div>
                  </div>
                </div>
                <h1 style={{ fontSize: '22px', fontWeight: 700, color: navyBlue, marginTop: '12px' }}>
                  Annuity Review
                </h1>
                <p style={{ color: '#4b5563', fontSize: '13px', marginTop: '2px' }}>
                  Prepared for {clientName}
                </p>
              </div>
              <div style={{ textAlign: 'right', color: '#6b7280', fontSize: '12px' }}>
                <p>{rd.review_number}</p>
                <p style={{ marginTop: '2px' }}>{today()}</p>
                {c?.city && c?.state && <p style={{ marginTop: '2px' }}>{c.city}, {c.state}</p>}
              </div>
            </div>
          </div>

          {/* ── Section 1: Contract Snapshot ───────────────────────────── */}
          <div style={{ marginBottom: '32px' }}>
            <SectionHeading>Section 1 — Contract Snapshot</SectionHeading>
            {contracts.map((contract, idx) => (
              <div key={idx} className="no-break" style={{ marginBottom: '20px' }}>
                <div style={{
                  backgroundColor: '#f3f4f6',
                  padding: '10px 16px',
                  borderLeft: `4px solid ${navyBlue}`,
                  marginBottom: '0',
                }}>
                  <p style={{ fontWeight: 700, color: navyBlue, fontSize: '14px' }}>
                    {contract.carrier}{contract.product_name ? ` · ${contract.product_name}` : ''}
                  </p>
                  <p style={{ color: '#6b7280', fontSize: '11px', marginTop: '2px' }}>
                    {[contract.annuity_type, contract.account_type, contract.contract_number].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <table>
                  <tbody>
                    <Row label="Owner"          value={contract.owner} />
                    {contract.joint_owner && <Row label="Joint Owner" value={contract.joint_owner} />}
                    <Row label="Issue Date"     value={fmtDate(contract.issue_date)} />
                    <Row label="Valuation Date" value={fmtShortDate(contract.valuation_date)} />
                    <Row label="Account Value"       value={fmt(contract.account_value)} bold />
                    <Row label="Surrender Value"    value={fmt(contract.surrender_value)} />
                    <Row label="Total Premiums Paid" value={fmt(contract.total_premiums_paid ?? contract.cost_basis)} />
                    {contract.initial_premium != null && contract.total_premiums_paid != null && contract.initial_premium !== contract.total_premiums_paid && (
                      <Row label="Initial Premium" value={fmt(contract.initial_premium)} />
                    )}
                    {contract.free_withdrawal_pct != null && (
                      <Row label="Free Withdrawal Allowance" value={fmtPct(contract.free_withdrawal_pct)} />
                    )}
                  </tbody>
                </table>
              </div>
            ))}
          </div>

          {/* ── Section 2: Side-by-Side Comparison ────────────────────── */}
          {contracts.length > 1 && (
            <div className="page-break" style={{ marginBottom: '32px' }}>
              <SectionHeading>Section 2 — Side-by-Side Comparison</SectionHeading>
              <div style={{ overflowX: 'auto', marginTop: '0' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f9fafb' }}>
                      <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: '11px', color: '#6b7280', fontWeight: 600, borderBottom: '2px solid #e5e7eb' }}>
                        Field
                      </th>
                      {contracts.map((c, i) => (
                        <th key={i} style={{ padding: '10px 12px', textAlign: 'right', fontSize: '11px', color: navyBlue, fontWeight: 700, borderBottom: '2px solid #e5e7eb' }}>
                          {c.carrier}
                          <br />
                          <span style={{ fontWeight: 400, color: '#6b7280' }}>{c.annuity_type}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { label: 'Account Value', fn: (c: ParsedContract) => fmt(c.account_value), bold: true },
                      { label: 'Surrender Value', fn: (c: ParsedContract) => fmt(c.surrender_value) },
                      { label: 'Total Premiums Paid', fn: (c: ParsedContract) => fmt(c.total_premiums_paid ?? c.cost_basis) },
                      { label: 'Surrender Charge', fn: (c: ParsedContract) => c.current_surrender_charge_amt != null ? fmt(c.current_surrender_charge_amt) : fmtPct(c.current_surrender_charge_pct) },
                      { label: 'Surrender Period', fn: (c: ParsedContract) => c.surrender_period ?? '—' },
                      { label: 'Free Withdrawal %', fn: (c: ParsedContract) => fmtPct(c.free_withdrawal_pct) },
                    ].map(({ label, fn, bold }) => (
                      <tr key={label} style={{ borderBottom: '1px solid #e5e7eb' }}>
                        <td style={{ padding: '8px 12px', color: '#6b7280', fontSize: '12px' }}>{label}</td>
                        {contracts.map((c, i) => (
                          <td key={i} style={{ padding: '8px 12px', textAlign: 'right', fontSize: '13px', fontWeight: bold ? 600 : 400, color: bold ? navyBlue : '#1f2937' }}>
                            {fn(c)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ backgroundColor: '#f3f4f6', borderTop: '2px solid #d1d5db' }}>
                      <td style={{ padding: '10px 12px', fontSize: '12px', fontWeight: 700, color: navyBlue }}>Combined Total</td>
                      {contracts.map((_, i) => {
                        if (i === 0) {
                          return (
                            <td key={i} style={{ padding: '10px 12px', textAlign: 'right', fontSize: '13px', fontWeight: 700, color: navyBlue }} colSpan={contracts.length}>
                              {fmt(totalAccountValue)} account value · {fmt(totalSurrenderValue)} surrender
                            </td>
                          )
                        }
                        return null
                      })}
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* ── Section 3: Surrender Cost Analysis ────────────────────── */}
          <div className="no-break" style={{ marginBottom: '32px' }}>
            <SectionHeading>Section 3 — Surrender Cost Analysis</SectionHeading>
            {contracts.every(c => c.current_surrender_charge_pct == null && c.current_surrender_charge_amt == null && !c.surrender_period) ? (
              <p style={{ padding: '16px 12px', color: '#6b7280', fontSize: '13px' }}>
                No surrender charge data was found in the uploaded documents.
              </p>
            ) : (
              <>
                <table>
                  <thead>
                    <tr style={{ backgroundColor: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
                      <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: '11px', color: '#6b7280', fontWeight: 600 }}>Contract</th>
                      <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: '11px', color: '#6b7280', fontWeight: 600 }}>Account Value</th>
                      <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: '11px', color: '#6b7280', fontWeight: 600 }}>Charge %</th>
                      <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: '11px', color: '#6b7280', fontWeight: 600 }}>Charge $</th>
                      <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: '11px', color: '#6b7280', fontWeight: 600 }}>Net Surrender</th>
                      <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: '11px', color: '#6b7280', fontWeight: 600 }}>Period Ends</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contracts.map((contract, i) => {
                      const netSurrender = contract.surrender_value ?? (
                        contract.account_value != null && contract.current_surrender_charge_amt != null
                          ? contract.account_value - contract.current_surrender_charge_amt
                          : null
                      )
                      return (
                        <tr key={i} style={{ borderBottom: '1px solid #e5e7eb' }}>
                          <td style={{ padding: '8px 12px', fontSize: '12px', color: '#1f2937' }}>
                            {contract.carrier}
                            {contract.contract_number ? <span style={{ color: '#9ca3af', marginLeft: '6px', fontSize: '11px' }}>{contract.contract_number}</span> : null}
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: '13px' }}>{fmt(contract.account_value)}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: '13px', color: '#dc2626' }}>
                            {fmtPct(contract.current_surrender_charge_pct)}
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: '13px', color: '#dc2626' }}>
                            {fmt(contract.current_surrender_charge_amt)}
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: '13px', fontWeight: 600 }}>{fmt(netSurrender)}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: '12px', color: '#6b7280' }}>{contract.surrender_period ?? '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                  {contracts.length > 1 && (
                    <tfoot>
                      <tr style={{ backgroundColor: '#f3f4f6', borderTop: '2px solid #d1d5db' }}>
                        <td style={{ padding: '10px 12px', fontSize: '12px', fontWeight: 700, color: navyBlue }}>Combined</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, fontSize: '13px' }}>{fmt(totalAccountValue)}</td>
                        <td></td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, fontSize: '13px', color: '#dc2626' }}>{fmt(totalSurrenderCharges)}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, fontSize: '13px' }}>{fmt(totalSurrenderValue)}</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  )}
                </table>

                {/* Surrender schedules */}
                {contracts.some(c => c.surrender_schedule?.length > 0) && (
                  <div style={{ marginTop: '16px' }}>
                    <p style={{ fontSize: '11px', color: '#6b7280', fontWeight: 600, marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Surrender Schedules
                    </p>
                    <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
                      {contracts.filter(c => c.surrender_schedule?.length > 0).map((contract, i) => (
                        <div key={i} style={{ minWidth: '160px' }}>
                          <p style={{ fontSize: '11px', fontWeight: 600, color: navyBlue, marginBottom: '6px' }}>{contract.carrier}</p>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                            {contract.surrender_schedule.map(s => (
                              <span key={s.year} style={{
                                fontSize: '10px', backgroundColor: '#f3f4f6', border: '1px solid #e5e7eb',
                                borderRadius: '4px', padding: '2px 6px', color: '#4b5563',
                              }}>
                                Yr {s.year}: {s.charge_pct}%
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {totalCostBasis > 0 && (
                  <div style={{ marginTop: '16px', padding: '12px 16px', backgroundColor: '#fefce8', border: '1px solid #fde68a', borderRadius: '6px' }}>
                    <p style={{ fontSize: '12px', color: '#92400e' }}>
                      <strong>Cost Basis Note:</strong> Combined cost basis is {fmt(totalCostBasis)}.
                      {totalAccountValue > totalCostBasis
                        ? ` Surrendering would trigger a taxable gain of approximately ${fmt(totalAccountValue - totalCostBasis - totalSurrenderCharges)} before surrender charges.`
                        : ` Surrendering may generate a loss that could be used to offset other income.`}
                    </p>
                  </div>
                )}
              </>
            )}
          </div>

          {/* ── Section 4: Income Benefit Summary ─────────────────────── */}
          {hasIncomeBenefits && (
            <div className="no-break" style={{ marginBottom: '32px' }}>
              <SectionHeading>Section 4 — Income Benefit Summary</SectionHeading>
              {contracts.filter(c => c.income_benefit).map((contract, i) => (
                <div key={i} className="no-break" style={{ marginBottom: '16px' }}>
                  <div style={{
                    backgroundColor: '#f3f4f6', padding: '10px 16px',
                    borderLeft: `4px solid ${navyBlue}`,
                  }}>
                    <p style={{ fontWeight: 700, color: navyBlue, fontSize: '13px' }}>{contract.carrier}</p>
                    {contract.income_benefit?.rider_name && (
                      <p style={{ color: '#6b7280', fontSize: '11px', marginTop: '2px' }}>
                        {contract.income_benefit.rider_name}
                      </p>
                    )}
                  </div>
                  <table>
                    <tbody>
                      {contract.income_benefit?.benefit_base != null && (
                        <Row label="Income Base (Benefit Base)" value={fmt(contract.income_benefit.benefit_base)} bold />
                      )}
                      {contract.income_benefit?.guaranteed_rollup_rate != null && (
                        <Row label="Guaranteed Rollup Rate" value={fmtPct(contract.income_benefit.guaranteed_rollup_rate)} />
                      )}
                      {contract.income_benefit?.withdrawal_pct != null && (
                        <Row label="Withdrawal Percentage" value={fmtPct(contract.income_benefit.withdrawal_pct)} />
                      )}
                      {contract.income_benefit?.annual_income != null && (
                        <Row label="Guaranteed Annual Income" value={fmt(contract.income_benefit.annual_income)} bold />
                      )}
                      {contract.income_benefit?.income_start_date && (
                        <Row label="Income Start Date" value={fmtDate(contract.income_benefit.income_start_date)} />
                      )}
                      {contract.income_benefit?.income_status && (
                        <Row label="Income Status" value={contract.income_benefit.income_status} />
                      )}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}

          {/* ── Recommendation Notes ───────────────────────────────────── */}
          {rd.recommendation_notes && (
            <div className="no-break" style={{ marginBottom: '32px' }}>
              <SectionHeading>Recommendations & Action Items</SectionHeading>
              <div style={{ padding: '16px', whiteSpace: 'pre-wrap', fontSize: '13px', lineHeight: '1.6', color: '#1f2937', borderLeft: '4px solid #e5e7eb' }}>
                {rd.recommendation_notes}
              </div>
            </div>
          )}

          {/* ── Footer ────────────────────────────────────────────────── */}
          <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '16px', marginTop: '32px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <p style={{ fontSize: '10px', color: '#9ca3af', maxWidth: '500px', lineHeight: '1.5' }}>
              This document is prepared for informational purposes only and does not constitute investment advice.
              Contract values are as of the statement date shown. Surrender charges and income projections are
              subject to contract terms and conditions. Consult your contract documents for complete details.
            </p>
            <div style={{ textAlign: 'right', color: '#9ca3af', fontSize: '10px' }}>
              <p style={{ fontWeight: 600, color: '#6b7280' }}>Right Path Agency</p>
              <p>{today()}</p>
            </div>
          </div>

        </div>
      </body>
    </html>
  )
}
