import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

// ── Helpers ───────────────────────────────────────────────────────────────────

function s(ff: Record<string, unknown>, k: string): string {
  return typeof ff[k] === 'string' ? (ff[k] as string) : ''
}
function b(ff: Record<string, unknown>, k: string): boolean {
  return typeof ff[k] === 'boolean' ? (ff[k] as boolean) : false
}
function arr<T>(ff: Record<string, unknown>, k: string, map: (o: Record<string, unknown>) => T): T[] {
  if (!Array.isArray(ff[k])) return []
  return (ff[k] as unknown[]).map(x => map((x ?? {}) as Record<string, unknown>))
}

function V({ v, w = '160px' }: { v: string; w?: string }) {
  return v
    ? <span style={{ borderBottom: '1px solid #222', paddingBottom: 1, minWidth: w, display: 'inline-block' }}>{v}</span>
    : <span style={{ borderBottom: '1px solid #aaa', minWidth: w, display: 'inline-block' }}>&nbsp;</span>
}

function YN({ val }: { val: boolean | null }) {
  const Y = val === true  ? '☑' : '☐'
  const N = val === false ? '☑' : '☐'
  return <span style={{ whiteSpace: 'nowrap' }}>{Y} Yes &nbsp; {N} No</span>
}

function LabelVal({ label, v, w }: { label: string; v: string; w?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 9, color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      <V v={v} w={w} />
    </div>
  )
}

function CondRow({ label, yes, detail }: { label: string; yes: boolean; detail: string }) {
  return (
    <tr style={{ borderBottom: '1px solid #e5e5e5' }}>
      <td style={{ padding: '4px 6px', fontSize: 11, width: '38%' }}>{label}</td>
      <td style={{ padding: '4px 6px', fontSize: 11, whiteSpace: 'nowrap' }}>
        <YN val={yes || null} />
      </td>
      <td style={{ padding: '4px 6px', fontSize: 11, width: '50%' }}>
        {yes
          ? <span style={{ borderBottom: '1px solid #222', display: 'block', minWidth: 200, paddingBottom: 1 }}>{detail || ' '}</span>
          : <span style={{ borderBottom: '1px solid #ddd', display: 'block', minWidth: 200 }}>&nbsp;</span>}
      </td>
    </tr>
  )
}

function SectionHead({ title }: { title: string }) {
  return (
    <tr>
      <td colSpan={3} style={{ background: '#1a1a2e', color: '#fff', fontWeight: 700, fontSize: 11, padding: '5px 8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {title}
      </td>
    </tr>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function FactFinderPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: customer } = await supabase
    .from('customers')
    .select('first_name, last_name, date_of_birth, phone, email, street, city, state, zip, gender, marital_status, fact_finder')
    .eq('id', id)
    .eq('is_test', false)
    .single()

  if (!customer) notFound()

  const ff: Record<string, unknown> = (customer.fact_finder as Record<string, unknown>) ?? {}
  const fullName = `${customer.first_name} ${customer.last_name}`

  const primBenes = arr(ff, 'primary_benes', o => ({
    name:         typeof o.name         === 'string' ? o.name         : '',
    dob:          typeof o.dob          === 'string' ? o.dob          : '',
    relationship: typeof o.relationship === 'string' ? o.relationship : '',
    percentage:   typeof o.percentage   === 'string' ? o.percentage   : '',
    phone:        typeof o.phone        === 'string' ? o.phone        : '',
    email:        typeof o.email        === 'string' ? o.email        : '',
  }))
  const contBenes = arr(ff, 'contingent_benes', o => ({
    name:         typeof o.name         === 'string' ? o.name         : '',
    dob:          typeof o.dob          === 'string' ? o.dob          : '',
    relationship: typeof o.relationship === 'string' ? o.relationship : '',
    percentage:   typeof o.percentage   === 'string' ? o.percentage   : '',
    phone:        typeof o.phone        === 'string' ? o.phone        : '',
    email:        typeof o.email        === 'string' ? o.email        : '',
  }))
  const dependents = arr(ff, 'dependents', o => ({
    name:          typeof o.name          === 'string' ? o.name          : '',
    dob:           typeof o.dob           === 'string' ? o.dob           : '',
    relationship:  typeof o.relationship  === 'string' ? o.relationship  : '',
    marital_status: typeof o.marital_status === 'string' ? o.marital_status : '',
  }))
  const policies = arr(ff, 'other_policies', o => ({
    company:       typeof o.company       === 'string' ? o.company       : '',
    policy_number: typeof o.policy_number === 'string' ? o.policy_number : '',
    face_amount:   typeof o.face_amount   === 'string' ? o.face_amount   : '',
    issue_date:    typeof o.issue_date    === 'string' ? o.issue_date    : '',
    type:          typeof o.type          === 'string' ? o.type          : '',
    sold:          typeof o.sold          === 'boolean' ? o.sold         : false,
  }))
  const ltcPolicies = arr(ff, 'ltc_policies', o => ({
    policy_name:    typeof o.policy_name    === 'string' ? o.policy_name    : '',
    insured:        typeof o.insured        === 'string' ? o.insured        : '',
    benefit_amount: typeof o.benefit_amount === 'string' ? o.benefit_amount : '',
    annual_premium: typeof o.annual_premium === 'string' ? o.annual_premium : '',
  }))
  const disPolicies = arr(ff, 'disability_policies', o => ({
    policy_name:    typeof o.policy_name    === 'string' ? o.policy_name    : '',
    policy_type:    typeof o.policy_type    === 'string' ? o.policy_type    : '',
    insured:        typeof o.insured        === 'string' ? o.insured        : '',
    benefit_amount: typeof o.benefit_amount === 'string' ? o.benefit_amount : '',
    annual_premium: typeof o.annual_premium === 'string' ? o.annual_premium : '',
  }))
  const investments = arr(ff, 'investment_accounts', o => ({
    institution:         typeof o.institution         === 'string' ? o.institution         : '',
    account_type:        typeof o.account_type        === 'string' ? o.account_type        : '',
    approximate_value:   typeof o.approximate_value   === 'string' ? o.approximate_value   : '',
    ownership:           typeof o.ownership           === 'string' ? o.ownership           : 'individual',
    related_person_name: typeof o.related_person_name === 'string' ? o.related_person_name : '',
  }))

  const acctTypeLabel: Record<string, string> = {
    brokerage: 'Brokerage', mutual_fund: 'Mutual Fund',
    ira_traditional: 'IRA (Traditional)', ira_roth: 'IRA (Roth)',
    '401k': '401(k)', '403b': '403(b)', annuity: 'Annuity',
    utma_ugma: 'UTMA / UGMA', '529': '529 Plan', other: 'Other',
  }
  const ownershipLabel: Record<string, string> = {
    individual: 'Individual', joint_spouse: 'Joint – Spouse',
    joint_other: 'Joint – Other', custodian: 'UTMA / Custodial',
  }

  const maritalMap: Record<string, string> = {
    single: 'Single', married: 'Married', divorced: 'Divorced',
    widowed: 'Widowed', separated: 'Separated',
  }
  const citizenMap: Record<string, string> = {
    us_citizen: 'U.S. Citizen', permanent_resident: 'Permanent Resident',
    visa: 'Visa / Non-Resident',
  }
  const empMap: Record<string, string> = {
    employed: 'Employed', self_employed: 'Self-Employed',
    retired: 'Retired', unemployed: 'Unemployed', other: 'Other',
  }

  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

  function blankBeneRows(count: number) {
    return Array.from({ length: count }, (_, i) => (
      <tr key={i} style={{ borderBottom: '1px solid #e5e5e5' }}>
        {['Name', 'DOB', 'Relationship', '% Share', 'Phone', 'Email'].map(h => (
          <td key={h} style={{ padding: '6px 4px' }}>
            <span style={{ borderBottom: '1px solid #aaa', display: 'block', minWidth: 60 }}>&nbsp;</span>
          </td>
        ))}
      </tr>
    ))
  }

  return (
    <>
      <title>Fact Finder — {fullName}</title>
      <style dangerouslySetInnerHTML={{ __html: `
        * { box-sizing: border-box; margin: 0; padding: 0 }
        body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #111; background: #fff; }
        .page { max-width: 780px; margin: 0 auto; padding: 24px 28px; }
        .print-btn {
          display: inline-block; margin-bottom: 16px; padding: 8px 20px;
          background: #1a1a2e; color: #fff; border: none; border-radius: 6px;
          font-size: 13px; cursor: pointer; font-family: inherit;
        }
        .print-btn:hover { background: #2d2d50; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1a1a2e; padding-bottom: 10px; margin-bottom: 16px; }
        .agency-name { font-size: 15px; font-weight: 700; color: #1a1a2e; }
        .form-title { font-size: 13px; color: #555; margin-top: 3px; }
        .client-name { font-size: 18px; font-weight: 700; text-align: right; }
        .section { margin-bottom: 16px; }
        .section-title { background: #1a1a2e; color: #fff; font-weight: 700; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; padding: 5px 8px; margin-bottom: 8px; }
        .row { display: flex; gap: 16px; margin-bottom: 10px; flex-wrap: wrap; }
        .field { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 80px; }
        .field-label { font-size: 9px; color: #666; text-transform: uppercase; letter-spacing: 0.05em; }
        .field-line { border-bottom: 1px solid #aaa; min-height: 16px; padding-bottom: 1px; font-size: 11px; min-width: 60px; }
        .field-line.filled { border-color: #222; color: #111; }
        table { width: 100%; border-collapse: collapse; font-size: 10px; }
        table th { background: #e8e8f0; text-align: left; padding: 4px 6px; font-size: 9px; text-transform: uppercase; letter-spacing: 0.04em; font-weight: 700; }
        table td { padding: 4px 6px; vertical-align: top; }
        table tr { border-bottom: 1px solid #e5e5e5; }
        .yn-row { display: flex; align-items: baseline; gap: 8px; padding: 5px 0; border-bottom: 1px solid #f0f0f0; }
        .yn-label { flex: 1; font-size: 11px; }
        .yn-ctrl { white-space: nowrap; font-size: 11px; margin-right: 8px; }
        .yn-detail { flex: 2; }
        .signature-block { margin-top: 24px; border-top: 1px solid #ccc; padding-top: 16px; display: flex; gap: 40px; }
        .sig-field { flex: 1; }
        .sig-line { border-bottom: 1px solid #222; margin-top: 24px; }
        .sig-lbl { font-size: 9px; color: #666; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 3px; }
        @media print {
          .print-btn { display: none; }
          body { font-size: 10px; }
          .page { padding: 0; max-width: 100%; }
          .section { page-break-inside: avoid; }
          .pb { page-break-before: always; }
        }
      ` }} />

      <div className="page">
        <button className="print-btn">Print / Save as PDF</button>

        <div className="header">
          <div>
            <div className="agency-name">Makal Financial Services</div>
            <div className="form-title">Life Insurance — Fact Finder</div>
            <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>Date: {today}</div>
          </div>
          <div className="client-name">{fullName}</div>
        </div>

        {/* ── Section 1: Personal Information ─────────────────────────────── */}
        <div className="section">
          <div className="section-title">Personal Information</div>
          <div className="row">
            <div className="field" style={{ flex: 2 }}>
              <span className="field-label">First Name</span>
              <span className={`field-line${customer.first_name ? ' filled' : ''}`}>{customer.first_name}</span>
            </div>
            <div className="field">
              <span className="field-label">Middle Name</span>
              <span className={`field-line${s(ff,'middle_name') ? ' filled' : ''}`}>{s(ff,'middle_name')}</span>
            </div>
            <div className="field" style={{ flex: 2 }}>
              <span className="field-label">Last Name</span>
              <span className={`field-line${customer.last_name ? ' filled' : ''}`}>{customer.last_name}</span>
            </div>
            <div className="field" style={{ flex: 0.5 }}>
              <span className="field-label">Suffix</span>
              <span className={`field-line${s(ff,'suffix') ? ' filled' : ''}`}>{s(ff,'suffix')}</span>
            </div>
          </div>
          <div className="row">
            <div className="field">
              <span className="field-label">Date of Birth (MM/DD/YYYY)</span>
              <span className="field-line">&nbsp;</span>
            </div>
            <div className="field">
              <span className="field-label">Social Security Number</span>
              <span className="field-line">&nbsp;</span>
            </div>
            <div className="field">
              <span className="field-label">Place of Birth</span>
              <span className={`field-line${s(ff,'place_of_birth') ? ' filled' : ''}`}>{s(ff,'place_of_birth')}</span>
            </div>
          </div>
          <div className="row">
            <div className="field" style={{ flex: 1.5 }}>
              <span className="field-label">Citizenship</span>
              <span className={`field-line${s(ff,'citizenship') ? ' filled' : ''}`}>
                {({'us_citizen':'U.S. Citizen','permanent_resident':'Permanent Resident','visa':'Visa / Non-Resident'} as Record<string,string>)[s(ff,'citizenship')] || s(ff,'citizenship')}
              </span>
            </div>
            <div className="field" style={{ flex: 2 }}>
              <span className="field-label">Citizenship Detail (if non-citizen)</span>
              <span className={`field-line${s(ff,'citizenship_detail') ? ' filled' : ''}`}>{s(ff,'citizenship_detail')}</span>
            </div>
            <div className="field" style={{ flex: 1.5 }}>
              <span className="field-label">Driver&apos;s License #</span>
              <span className={`field-line${s(ff,'drivers_license') ? ' filled' : ''}`}>{s(ff,'drivers_license')}</span>
            </div>
            <div className="field" style={{ flex: 0.5 }}>
              <span className="field-label">DL State</span>
              <span className={`field-line${s(ff,'dl_state') ? ' filled' : ''}`}>{s(ff,'dl_state')}</span>
            </div>
          </div>
          <div className="row">
            <div className="field">
              <span className="field-label">Gender</span>
              <span className={`field-line${customer.gender ? ' filled' : ''}`}>
                {customer.gender ? (customer.gender.charAt(0).toUpperCase() + customer.gender.slice(1)) : ''}
              </span>
            </div>
            <div className="field">
              <span className="field-label">Marital Status</span>
              <span className={`field-line${customer.marital_status ? ' filled' : ''}`}>
                {({'single':'Single','married':'Married','divorced':'Divorced','widowed':'Widowed','separated':'Separated'} as Record<string,string>)[customer.marital_status ?? ''] || customer.marital_status}
              </span>
            </div>
          </div>
        </div>

        {/* ── Section 2: Contact Information ──────────────────────────────── */}
        <div className="section">
          <div className="section-title">Contact Information</div>
          <div className="row">
            <div className="field" style={{ flex: 3 }}>
              <span className="field-label">Street Address</span>
              <span className={`field-line${customer.street ? ' filled' : ''}`}>{customer.street}</span>
            </div>
            <div className="field" style={{ flex: 2 }}>
              <span className="field-label">City</span>
              <span className={`field-line${customer.city ? ' filled' : ''}`}>{customer.city}</span>
            </div>
            <div className="field" style={{ flex: 0.6 }}>
              <span className="field-label">State</span>
              <span className={`field-line${customer.state ? ' filled' : ''}`}>{customer.state}</span>
            </div>
            <div className="field">
              <span className="field-label">ZIP</span>
              <span className={`field-line${customer.zip ? ' filled' : ''}`}>{customer.zip}</span>
            </div>
          </div>
          <div className="row">
            <div className="field">
              <span className="field-label">Phone</span>
              <span className={`field-line${customer.phone ? ' filled' : ''}`}>{customer.phone}</span>
            </div>
            <div className="field" style={{ flex: 2 }}>
              <span className="field-label">Email</span>
              <span className={`field-line${customer.email ? ' filled' : ''}`}>{customer.email}</span>
            </div>
          </div>
        </div>

        {/* ── Section 3: Employment & Income ──────────────────────────────── */}
        <div className="section">
          <div className="section-title">Employment &amp; Income</div>
          <div className="row">
            <div className="field" style={{ flex: 2 }}>
              <span className="field-label">Employer</span>
              <span className={`field-line${s(ff,'employer') ? ' filled' : ''}`}>{s(ff,'employer')}</span>
            </div>
            <div className="field" style={{ flex: 2 }}>
              <span className="field-label">Occupation</span>
              <span className={`field-line${s(ff,'occupation') ? ' filled' : ''}`}>{s(ff,'occupation')}</span>
            </div>
            <div className="field">
              <span className="field-label">Employment Type</span>
              <span className={`field-line${s(ff,'employment_type') ? ' filled' : ''}`}>
                {({'employed':'Employed','self_employed':'Self-Employed','retired':'Retired','unemployed':'Unemployed','other':'Other'} as Record<string,string>)[s(ff,'employment_type')] || s(ff,'employment_type')}
              </span>
            </div>
          </div>
          <div className="row">
            <div className="field" style={{ flex: 3 }}>
              <span className="field-label">Business Address</span>
              <span className={`field-line${s(ff,'business_address') ? ' filled' : ''}`}>{s(ff,'business_address')}</span>
            </div>
            <div className="field">
              <span className="field-label">Annual Income</span>
              <span className={`field-line${s(ff,'annual_income') ? ' filled' : ''}`}>{s(ff,'annual_income')}</span>
            </div>
          </div>
          <div className="row">
            <div className="field" style={{ flex: 2 }}>
              <span className="field-label">Other Income Source</span>
              <span className={`field-line${s(ff,'other_income') ? ' filled' : ''}`}>{s(ff,'other_income')}</span>
            </div>
            <div className="field">
              <span className="field-label">Other Income Amount</span>
              <span className={`field-line${s(ff,'other_income_amount') ? ' filled' : ''}`}>{s(ff,'other_income_amount')}</span>
            </div>
            <div className="field">
              <span className="field-label">Total Assets</span>
              <span className={`field-line${s(ff,'total_assets') ? ' filled' : ''}`}>{s(ff,'total_assets')}</span>
            </div>
            <div className="field">
              <span className="field-label">Total Liabilities</span>
              <span className={`field-line${s(ff,'total_liabilities') ? ' filled' : ''}`}>{s(ff,'total_liabilities')}</span>
            </div>
          </div>
        </div>

        {/* ── Section 4: Physical Build ────────────────────────────────────── */}
        <div className="section">
          <div className="section-title">Physical Build</div>
          <div className="row">
            <div className="field">
              <span className="field-label">Height (ft)</span>
              <span className={`field-line${s(ff,'height_ft') ? ' filled' : ''}`}>{s(ff,'height_ft')}</span>
            </div>
            <div className="field">
              <span className="field-label">Height (in)</span>
              <span className={`field-line${s(ff,'height_in') ? ' filled' : ''}`}>{s(ff,'height_in')}</span>
            </div>
            <div className="field">
              <span className="field-label">Weight (lbs)</span>
              <span className={`field-line${s(ff,'weight_lbs') ? ' filled' : ''}`}>{s(ff,'weight_lbs')}</span>
            </div>
            <div className="field" style={{ flex: 2 }}>
              <span className="field-label">Significant weight change in past year?</span>
              <span className="field-line">
                <YN val={ff.weight_change != null ? b(ff,'weight_change') : null} />
              </span>
            </div>
          </div>
          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <span className="field-label">If yes, describe</span>
              <span className={`field-line${s(ff,'weight_change_detail') ? ' filled' : ''}`}>{s(ff,'weight_change_detail') || <>&nbsp;</>}</span>
            </div>
          </div>
        </div>

        {/* ── Section 5: Attending Physician ──────────────────────────────── */}
        <div className="section">
          <div className="section-title">Attending Physician</div>
          <div className="row">
            <div className="field" style={{ flex: 2 }}>
              <span className="field-label">Physician Name</span>
              <span className={`field-line${s(ff,'physician_name') ? ' filled' : ''}`}>{s(ff,'physician_name')}</span>
            </div>
            <div className="field">
              <span className="field-label">Phone</span>
              <span className={`field-line${s(ff,'physician_phone') ? ' filled' : ''}`}>{s(ff,'physician_phone')}</span>
            </div>
          </div>
          <div className="row">
            <div className="field" style={{ flex: 3 }}>
              <span className="field-label">Address</span>
              <span className={`field-line${s(ff,'physician_address') ? ' filled' : ''}`}>{s(ff,'physician_address')}</span>
            </div>
            <div className="field">
              <span className="field-label">Date of Last Visit</span>
              <span className={`field-line${s(ff,'last_visit_date') ? ' filled' : ''}`}>{s(ff,'last_visit_date')}</span>
            </div>
          </div>
          <div className="row">
            <div className="field" style={{ flex: 2 }}>
              <span className="field-label">Reason for Last Visit</span>
              <span className={`field-line${s(ff,'last_visit_reason') ? ' filled' : ''}`}>{s(ff,'last_visit_reason')}</span>
            </div>
            <div className="field">
              <span className="field-label">Any abnormal results?</span>
              <span className="field-line">
                <YN val={ff.last_visit_abnormal != null ? b(ff,'last_visit_abnormal') : null} />
              </span>
            </div>
          </div>
        </div>

        {/* ── Page 2 ─────────────────────────────────────────────────────── */}
        <div className="pb">

        {/* ── Section 6: Tobacco & Lifestyle ──────────────────────────────── */}
        <div className="section">
          <div className="section-title">Tobacco &amp; Lifestyle</div>
          <div style={{ marginBottom: 8 }}>
            <div className="row" style={{ alignItems: 'center' }}>
              <div className="field">
                <span className="field-label">Current or past tobacco use?</span>
                <span className="field-line"><YN val={s(ff,'tobacco_last_used') || s(ff,'tobacco_packs_day') ? true : null} /></span>
              </div>
              <div className="field">
                <span className="field-label">Last used</span>
                <span className={`field-line${s(ff,'tobacco_last_used') ? ' filled' : ''}`}>{s(ff,'tobacco_last_used')}</span>
              </div>
              <div className="field">
                <span className="field-label">Packs/day</span>
                <span className={`field-line${s(ff,'tobacco_packs_day') ? ' filled' : ''}`}>{s(ff,'tobacco_packs_day')}</span>
              </div>
            </div>
          </div>
          {(
            [
              ['alcohol',    'Alcohol use beyond 2 drinks/day',          'alcohol_detail'],
              ['marijuana',  'Marijuana use',                             'marijuana_detail'],
              ['substances', 'Other substance use',                       'substances_detail'],
              ['aviation',   'Aviation (private pilot or crew)',          'aviation_detail'],
              ['hazardous',  'Hazardous sports or activities',            'hazardous_detail'],
              ['intl_travel','International travel outside US/Canada',    'intl_travel_detail'],
              ['military',   'Active or pending military service',        'military_detail'],
              ['dui',        'DUI / DWI in past 10 years',               'dui_detail'],
              ['felony',     'Any felony conviction',                     'felony_detail'],
              ['bankruptcy', 'Bankruptcy in past 10 years',              'bankruptcy_detail'],
            ] as [string, string, string][]
          ).map(([key, label, detKey]) => (
            <div key={key} className="yn-row">
              <span className="yn-label">{label}</span>
              <span className="yn-ctrl"><YN val={ff[key] != null ? b(ff,key) : null} /></span>
              <span className="yn-detail">
                <span className={`field-line${s(ff,detKey) ? ' filled' : ''}`} style={{ display: 'block', minWidth: 160 }}>
                  {s(ff,detKey) || ' '}
                </span>
              </span>
            </div>
          ))}
        </div>

        {/* ── Section 7: Medical History ───────────────────────────────────── */}
        <div className="section">
          <div className="section-title">Medical History</div>
          <div className="row" style={{ marginBottom: 8 }}>
            <div className="field" style={{ flex: 2 }}>
              <span className="field-label">Pending medical appointment?</span>
              <span className="field-line"><YN val={ff.pending_appt != null ? b(ff,'pending_appt') : null} /></span>
            </div>
            {b(ff,'pending_appt') && (
              <div className="field" style={{ flex: 3 }}>
                <span className="field-label">Details</span>
                <span className={`field-line${s(ff,'pending_appt_detail') ? ' filled' : ''}`}>{s(ff,'pending_appt_detail')}</span>
              </div>
            )}
          </div>
          <div className="row" style={{ marginBottom: 12 }}>
            <div className="field" style={{ flex: 1 }}>
              <span className="field-label">Current medications (list all)</span>
              <span className={`field-line${s(ff,'medications') ? ' filled' : ''}`} style={{ minHeight: 28 }}>{s(ff,'medications')}</span>
            </div>
          </div>
          <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 4, color: '#333' }}>
            Have you ever been diagnosed with or treated for any of the following?
          </div>
          <table>
            <thead>
              <tr>
                <th style={{ width: '38%' }}>Condition</th>
                <th style={{ width: '12%' }}>Yes / No</th>
                <th>Details (date, treatment, current status)</th>
              </tr>
            </thead>
            <tbody>
              {([
                ['cond_cholesterol','High Cholesterol',                       'cond_cholesterol_d'],
                ['cond_bp',         'High Blood Pressure',                    'cond_bp_d'],
                ['cond_diabetes',   'Diabetes / Pre-Diabetes',                'cond_diabetes_d'],
                ['cond_heart',      'Heart Disease / Heart Attack',           'cond_heart_d'],
                ['cond_stroke',     'Stroke / TIA',                          'cond_stroke_d'],
                ['cond_cancer',     'Cancer',                                 'cond_cancer_d'],
                ['cond_respiratory','Respiratory (COPD, Asthma, Sleep Apnea)','cond_respiratory_d'],
                ['cond_neuro',      'Neurological (MS, Parkinson\'s, Seizure)','cond_neuro_d'],
                ['cond_mental',     'Mental Health / Depression / Anxiety',   'cond_mental_d'],
                ['cond_cognitive',  'Cognitive / Memory Issues',              'cond_cognitive_d'],
                ['cond_musculo',    'Musculoskeletal / Back / Joint',         'cond_musculo_d'],
                ['cond_blood',      'Blood Disorder / Anemia',               'cond_blood_d'],
                ['cond_digestive',  'Digestive / Liver / GI',                'cond_digestive_d'],
                ['cond_kidney',     'Kidney / Urinary',                      'cond_kidney_d'],
                ['cond_endocrine',  'Endocrine / Thyroid',                   'cond_endocrine_d'],
                ['cond_eye_ear_skin','Eye / Ear / Skin Disorder',            'cond_eye_ear_skin_d'],
                ['cond_hiv',        'HIV / AIDS',                            'cond_hiv_d'],
                ['cond_diagnostics','Recent Lab Work / Imaging / Tests',     'cond_diagnostics_d'],
                ['cond_hospitalization','Hospitalization (past 5 years)',    'cond_hospitalization_d'],
                ['cond_er',         'Emergency Room Visit (past 5 years)',   'cond_er_d'],
              ] as [string, string, string][]).map(([key, label, detKey]) => (
                <CondRow key={key} label={label} yes={b(ff,key)} detail={s(ff,detKey)} />
              ))}
              <tr style={{ borderBottom: '1px solid #e5e5e5' }}>
                <td style={{ padding: '4px 6px', fontSize: 11 }}>Nursing Home / Assisted Living</td>
                <td style={{ padding: '4px 6px', fontSize: 11 }}>
                  <YN val={ff.cond_nursing_home != null ? b(ff,'cond_nursing_home') : null} />
                </td>
                <td style={{ padding: '4px 6px' }}><span style={{ borderBottom: '1px solid #ddd', display: 'block' }}>&nbsp;</span></td>
              </tr>
              <tr>
                <td style={{ padding: '4px 6px', fontSize: 11 }}>Other conditions not listed</td>
                <td></td>
                <td style={{ padding: '4px 6px', fontSize: 11 }}>
                  <span className={`field-line${s(ff,'cond_other') ? ' filled' : ''}`} style={{ display: 'block' }}>{s(ff,'cond_other') || ' '}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        </div>{/* end page 2 */}

        {/* ── Page 3 ─────────────────────────────────────────────────────── */}
        <div className="pb">

        {/* ── Section 8: Family History ────────────────────────────────────── */}
        <div className="section">
          <div className="section-title">Family History</div>
          <table>
            <thead>
              <tr>
                <th>Parent</th><th>Current Age or Age at Death</th><th>Cause of Death</th>
                <th>Heart disease before 60?</th><th>Age</th><th>Cancer?</th><th>Type</th>
              </tr>
            </thead>
            <tbody>
              {(['father','mother'] as const).map(p => (
                <tr key={p} style={{ borderBottom: '1px solid #e5e5e5' }}>
                  <td style={{ padding: '5px 6px', fontWeight: 700 }}>{p.charAt(0).toUpperCase()+p.slice(1)}</td>
                  <td style={{ padding: '5px 6px' }}>
                    <span className={`field-line${(s(ff,`fam_${p}_age`)||s(ff,`fam_${p}_age_death`)) ? ' filled' : ''}`}>
                      {s(ff,`fam_${p}_age`) || s(ff,`fam_${p}_age_death`) || ' '}
                    </span>
                  </td>
                  <td style={{ padding: '5px 6px' }}>
                    <span className={`field-line${s(ff,`fam_${p}_cause`) ? ' filled' : ''}`}>{s(ff,`fam_${p}_cause`) || ' '}</span>
                  </td>
                  <td style={{ padding: '5px 6px' }}><YN val={ff[`fam_${p}_heart`] != null ? b(ff,`fam_${p}_heart`) : null} /></td>
                  <td style={{ padding: '5px 6px' }}>
                    <span className={`field-line${s(ff,`fam_${p}_heart_age`) ? ' filled' : ''}`}>{s(ff,`fam_${p}_heart_age`) || ' '}</span>
                  </td>
                  <td style={{ padding: '5px 6px' }}><YN val={ff[`fam_${p}_cancer`] != null ? b(ff,`fam_${p}_cancer`) : null} /></td>
                  <td style={{ padding: '5px 6px' }}>
                    <span className={`field-line${s(ff,`fam_${p}_cancer_type`) ? ' filled' : ''}`}>{s(ff,`fam_${p}_cancer_type`) || ' '}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row" style={{ marginTop: 8 }}>
            <div className="field" style={{ flex: 1 }}>
              <span className="field-label">Siblings (health notes)</span>
              <span className={`field-line${s(ff,'fam_siblings') ? ' filled' : ''}`}>{s(ff,'fam_siblings') || ' '}</span>
            </div>
          </div>
          <div className="yn-row">
            <span className="yn-label">Any hereditary conditions?</span>
            <span className="yn-ctrl"><YN val={ff.fam_hereditary != null ? b(ff,'fam_hereditary') : null} /></span>
            <span className="yn-detail">
              <span className={`field-line${s(ff,'fam_hereditary_detail') ? ' filled' : ''}`} style={{ display: 'block' }}>{s(ff,'fam_hereditary_detail') || ' '}</span>
            </span>
          </div>
          <div className="yn-row">
            <span className="yn-label">Mental health history in immediate family?</span>
            <span className="yn-ctrl"><YN val={ff.fam_mental != null ? b(ff,'fam_mental') : null} /></span>
            <span className="yn-detail">
              <span className={`field-line${s(ff,'fam_mental_detail') ? ' filled' : ''}`} style={{ display: 'block' }}>{s(ff,'fam_mental_detail') || ' '}</span>
            </span>
          </div>
        </div>

        {/* ── Section 9: Existing Coverage ────────────────────────────────── */}
        <div className="section">
          <div className="section-title">Existing Insurance Coverage</div>
          <div className="yn-row" style={{ marginBottom: 8 }}>
            <span className="yn-label">Any prior life insurance declines, modifications, or rated policies?</span>
            <span className="yn-ctrl"><YN val={ff.prior_declines != null ? b(ff,'prior_declines') : null} /></span>
            <span className="yn-detail">
              <span className={`field-line${s(ff,'prior_declines_detail') ? ' filled' : ''}`} style={{ display: 'block' }}>{s(ff,'prior_declines_detail') || ' '}</span>
            </span>
          </div>
          <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 4, color: '#333' }}>Life Insurance Policies</div>
          <table>
            <thead>
              <tr><th>Company</th><th>Policy #</th><th>Face Amount</th><th>Issue Date</th><th>Type</th><th>Sold?</th></tr>
            </thead>
            <tbody>
              {policies.length > 0 ? policies.map((p, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #e5e5e5' }}>
                  <td style={{ padding: '5px 4px' }}><span className={`field-line${p.company ? ' filled' : ''}`}>{p.company || ' '}</span></td>
                  <td style={{ padding: '5px 4px' }}><span className={`field-line${p.policy_number ? ' filled' : ''}`}>{p.policy_number || ' '}</span></td>
                  <td style={{ padding: '5px 4px' }}><span className={`field-line${p.face_amount ? ' filled' : ''}`}>{p.face_amount || ' '}</span></td>
                  <td style={{ padding: '5px 4px' }}><span className={`field-line${p.issue_date ? ' filled' : ''}`}>{p.issue_date || ' '}</span></td>
                  <td style={{ padding: '5px 4px' }}><span className={`field-line${p.type ? ' filled' : ''}`}>{p.type || ' '}</span></td>
                  <td style={{ padding: '5px 4px' }}><YN val={p.sold} /></td>
                </tr>
              )) : (
                <>{[1,2,3].map(i => (
                  <tr key={i} style={{ borderBottom: '1px solid #e5e5e5' }}>
                    {[1,2,3,4,5,6].map(j => <td key={j} style={{ padding: '7px 4px' }}><span style={{ borderBottom: '1px solid #aaa', display: 'block' }}>&nbsp;</span></td>)}
                  </tr>
                ))}</>
              )}
            </tbody>
          </table>
          {ltcPolicies.length > 0 && (
            <>
              <div style={{ fontSize: 10, fontWeight: 700, marginTop: 8, marginBottom: 4, color: '#333' }}>Long-Term Care Policies</div>
              <table>
                <thead><tr><th>Policy Name</th><th>Insured</th><th>Benefit Amount</th><th>Annual Premium</th></tr></thead>
                <tbody>
                  {ltcPolicies.map((p, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #e5e5e5' }}>
                      <td style={{ padding: '5px 4px' }}>{p.policy_name || ' '}</td>
                      <td style={{ padding: '5px 4px' }}>{p.insured || ' '}</td>
                      <td style={{ padding: '5px 4px' }}>{p.benefit_amount || ' '}</td>
                      <td style={{ padding: '5px 4px' }}>{p.annual_premium || ' '}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {disPolicies.length > 0 && (
            <>
              <div style={{ fontSize: 10, fontWeight: 700, marginTop: 8, marginBottom: 4, color: '#333' }}>Disability Policies</div>
              <table>
                <thead><tr><th>Policy Name</th><th>Type</th><th>Insured</th><th>Benefit Amount</th><th>Annual Premium</th></tr></thead>
                <tbody>
                  {disPolicies.map((p, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #e5e5e5' }}>
                      <td style={{ padding: '5px 4px' }}>{p.policy_name || ' '}</td>
                      <td style={{ padding: '5px 4px' }}>{p.policy_type || ' '}</td>
                      <td style={{ padding: '5px 4px' }}>{p.insured || ' '}</td>
                      <td style={{ padding: '5px 4px' }}>{p.benefit_amount || ' '}</td>
                      <td style={{ padding: '5px 4px' }}>{p.annual_premium || ' '}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {investments.length > 0 && (
            <>
              <div style={{ fontSize: 10, fontWeight: 700, marginTop: 8, marginBottom: 4, color: '#333' }}>Investment &amp; Brokerage Accounts</div>
              <table>
                <thead>
                  <tr>
                    <th>Institution</th>
                    <th>Account Type</th>
                    <th>Approx. Value</th>
                    <th>Ownership</th>
                    <th>Joint / Custodian</th>
                  </tr>
                </thead>
                <tbody>
                  {investments.map((inv, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #e5e5e5' }}>
                      <td style={{ padding: '5px 4px' }}>{inv.institution || ' '}</td>
                      <td style={{ padding: '5px 4px' }}>{(acctTypeLabel[inv.account_type] ?? inv.account_type) || ' '}</td>
                      <td style={{ padding: '5px 4px' }}>{inv.approximate_value || ' '}</td>
                      <td style={{ padding: '5px 4px' }}>{(ownershipLabel[inv.ownership] ?? inv.ownership) || ' '}</td>
                      <td style={{ padding: '5px 4px' }}>{inv.related_person_name || ' '}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>

        </div>{/* end page 3 */}

        {/* ── Page 4 ─────────────────────────────────────────────────────── */}
        <div className="pb">

        {/* ── Section 10: Beneficiaries ────────────────────────────────────── */}
        <div className="section">
          <div className="section-title">Primary Beneficiaries</div>
          <table>
            <thead><tr><th>Full Name</th><th>DOB</th><th>Relationship</th><th>% Share</th><th>Phone</th><th>Email</th></tr></thead>
            <tbody>
              {primBenes.length > 0
                ? primBenes.map((bn, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #e5e5e5' }}>
                    <td style={{ padding: '5px 4px' }}><span className={`field-line${bn.name ? ' filled' : ''}`}>{bn.name || ' '}</span></td>
                    <td style={{ padding: '5px 4px' }}><span className={`field-line${bn.dob ? ' filled' : ''}`}>{bn.dob || ' '}</span></td>
                    <td style={{ padding: '5px 4px' }}><span className={`field-line${bn.relationship ? ' filled' : ''}`}>{bn.relationship || ' '}</span></td>
                    <td style={{ padding: '5px 4px' }}><span className={`field-line${bn.percentage ? ' filled' : ''}`}>{bn.percentage || ' '}</span></td>
                    <td style={{ padding: '5px 4px' }}><span className={`field-line${bn.phone ? ' filled' : ''}`}>{bn.phone || ' '}</span></td>
                    <td style={{ padding: '5px 4px' }}><span className={`field-line${bn.email ? ' filled' : ''}`}>{bn.email || ' '}</span></td>
                  </tr>
                ))
                : blankBeneRows(3)
              }
            </tbody>
          </table>
        </div>

        <div className="section" style={{ marginTop: 12 }}>
          <div className="section-title">Contingent Beneficiaries</div>
          <table>
            <thead><tr><th>Full Name</th><th>DOB</th><th>Relationship</th><th>% Share</th><th>Phone</th><th>Email</th></tr></thead>
            <tbody>
              {contBenes.length > 0
                ? contBenes.map((bn, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #e5e5e5' }}>
                    <td style={{ padding: '5px 4px' }}><span className={`field-line${bn.name ? ' filled' : ''}`}>{bn.name || ' '}</span></td>
                    <td style={{ padding: '5px 4px' }}><span className={`field-line${bn.dob ? ' filled' : ''}`}>{bn.dob || ' '}</span></td>
                    <td style={{ padding: '5px 4px' }}><span className={`field-line${bn.relationship ? ' filled' : ''}`}>{bn.relationship || ' '}</span></td>
                    <td style={{ padding: '5px 4px' }}><span className={`field-line${bn.percentage ? ' filled' : ''}`}>{bn.percentage || ' '}</span></td>
                    <td style={{ padding: '5px 4px' }}><span className={`field-line${bn.phone ? ' filled' : ''}`}>{bn.phone || ' '}</span></td>
                    <td style={{ padding: '5px 4px' }}><span className={`field-line${bn.email ? ' filled' : ''}`}>{bn.email || ' '}</span></td>
                  </tr>
                ))
                : blankBeneRows(2)
              }
            </tbody>
          </table>
        </div>

        {/* ── Section 11: Dependents ───────────────────────────────────────── */}
        <div className="section" style={{ marginTop: 12 }}>
          <div className="section-title">Dependents</div>
          <table>
            <thead><tr><th>Full Name</th><th>Date of Birth</th><th>Relationship</th><th>Marital Status</th></tr></thead>
            <tbody>
              {dependents.length > 0
                ? dependents.map((d, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #e5e5e5' }}>
                    <td style={{ padding: '5px 4px' }}><span className={`field-line${d.name ? ' filled' : ''}`}>{d.name || ' '}</span></td>
                    <td style={{ padding: '5px 4px' }}><span className={`field-line${d.dob ? ' filled' : ''}`}>{d.dob || ' '}</span></td>
                    <td style={{ padding: '5px 4px' }}><span className={`field-line${d.relationship ? ' filled' : ''}`}>{d.relationship || ' '}</span></td>
                    <td style={{ padding: '5px 4px' }}><span className={`field-line${d.marital_status ? ' filled' : ''}`}>{d.marital_status || ' '}</span></td>
                  </tr>
                ))
                : [1,2,3].map(i => (
                  <tr key={i} style={{ borderBottom: '1px solid #e5e5e5' }}>
                    {[1,2,3,4].map(j => <td key={j} style={{ padding: '7px 4px' }}><span style={{ borderBottom: '1px solid #aaa', display: 'block' }}>&nbsp;</span></td>)}
                  </tr>
                ))
              }
            </tbody>
          </table>
        </div>

        {/* ── Section 12: Financial Goals ──────────────────────────────────── */}
        <div className="section" style={{ marginTop: 12 }}>
          <div className="section-title">Financial Goals &amp; Profile</div>
          <div style={{ marginBottom: 6, fontSize: 10, color: '#444' }}>Check all that apply:</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px 16px', marginBottom: 10 }}>
            {([
              ['goals_retirement',   'Retirement Planning'],
              ['goals_education',    'Education Funding'],
              ['goals_wealth',       'Wealth Accumulation'],
              ['goals_estate',       'Estate Planning'],
              ['goals_emergencies',  'Emergency Fund'],
              ['goals_major_purchase','Major Purchase'],
              ['goals_business',     'Business Planning'],
            ] as [string, string][]).map(([key, label]) => (
              <span key={key} style={{ fontSize: 11 }}>
                {b(ff,key) ? '☑' : '☐'} {label}
              </span>
            ))}
          </div>
          <div className="row">
            <div className="field" style={{ flex: 2 }}>
              <span className="field-label">Other goals</span>
              <span className={`field-line${s(ff,'goals_other') ? ' filled' : ''}`}>{s(ff,'goals_other')}</span>
            </div>
            <div className="field">
              <span className="field-label">Risk Tolerance</span>
              <span className={`field-line${s(ff,'risk_tolerance') ? ' filled' : ''}`}>{s(ff,'risk_tolerance')}</span>
            </div>
            <div className="field">
              <span className="field-label">Emergency Fund (months)</span>
              <span className={`field-line${s(ff,'emergency_fund') ? ' filled' : ''}`}>{s(ff,'emergency_fund')}</span>
            </div>
          </div>
        </div>

        {/* ── Section 13: Estate & Legal ───────────────────────────────────── */}
        <div className="section">
          <div className="section-title">Estate &amp; Legal</div>
          <div className="row" style={{ alignItems: 'center' }}>
            <div className="field">
              <span className="field-label">Do you have a will?</span>
              <span className="field-line" style={{ fontSize: 11 }}>
                {(() => {
                  const w = s(ff,'has_will')
                  return (
                    <>
                      <span style={{ marginRight: 10 }}>{w === 'yes' ? '☑' : '☐'} Yes</span>
                      <span style={{ marginRight: 10 }}>{w === 'no' ? '☑' : '☐'} No</span>
                      <span>{w === 'in_progress' ? '☑' : '☐'} In Progress</span>
                    </>
                  )
                })()}
              </span>
            </div>
            <div className="field" style={{ flex: 3 }}>
              <span className="field-label">Details</span>
              <span className={`field-line${s(ff,'will_detail') ? ' filled' : ''}`}>{s(ff,'will_detail')}</span>
            </div>
          </div>
        </div>

        {/* ── Section 14: Additional Notes ────────────────────────────────── */}
        <div className="section">
          <div className="section-title">Additional Notes</div>
          {s(ff,'bene_notes') && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 9, color: '#666', textTransform: 'uppercase', marginBottom: 3 }}>Beneficiary Notes</div>
              <div style={{ fontSize: 11, borderLeft: '2px solid #ccc', paddingLeft: 8 }}>{s(ff,'bene_notes')}</div>
            </div>
          )}
          {s(ff,'ff_notes') && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 9, color: '#666', textTransform: 'uppercase', marginBottom: 3 }}>General Notes</div>
              <div style={{ fontSize: 11, borderLeft: '2px solid #ccc', paddingLeft: 8 }}>{s(ff,'ff_notes')}</div>
            </div>
          )}
          <div style={{ borderBottom: '1px solid #aaa', minHeight: 40 }}>&nbsp;</div>
          <div style={{ borderBottom: '1px solid #aaa', minHeight: 20, marginTop: 8 }}>&nbsp;</div>
        </div>

        {/* ── Signature ────────────────────────────────────────────────────── */}
        <div className="signature-block">
          <div className="sig-field">
            <div className="sig-line" />
            <div className="sig-lbl">Client Signature</div>
          </div>
          <div className="sig-field" style={{ flex: 0.5 }}>
            <div className="sig-line" />
            <div className="sig-lbl">Date</div>
          </div>
        </div>

        </div>{/* end page 4 */}
      </div>

      <script dangerouslySetInnerHTML={{ __html: `
        document.querySelector('.print-btn').addEventListener('click', function() { window.print(); });
      ` }} />
    </>
  )
}
