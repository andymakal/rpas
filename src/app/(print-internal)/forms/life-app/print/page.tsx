// Blank Life Insurance Application Data form — no customer data.
// All fields render as underlines for handwritten completion by the LSP or client.

export const dynamic = 'force-dynamic'

function Blank({ w = '160px' }: { w?: string }) {
  return <span style={{ borderBottom: '1px solid #aaa', minWidth: w, display: 'inline-block' }}>&nbsp;</span>
}

function LabelBlank({ label, w }: { label: string; w?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 9, color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      <Blank w={w} />
    </div>
  )
}

function YNBlank() {
  return <span style={{ whiteSpace: 'nowrap' }}>☐ Yes &nbsp; ☐ No</span>
}

function CondRow({ label }: { label: string }) {
  return (
    <tr style={{ borderBottom: '1px solid #e5e5e5' }}>
      <td style={{ padding: '4px 6px', fontSize: 11, width: '38%' }}>{label}</td>
      <td style={{ padding: '4px 6px', fontSize: 11, whiteSpace: 'nowrap' }}><YNBlank /></td>
      <td style={{ padding: '4px 6px', fontSize: 11, width: '50%' }}>
        <span style={{ borderBottom: '1px solid #aaa', display: 'block', minWidth: 200 }}>&nbsp;</span>
      </td>
    </tr>
  )
}

function blankRows(count: number, cols: string[]) {
  return Array.from({ length: count }, (_, i) => (
    <tr key={i} style={{ borderBottom: '1px solid #e5e5e5' }}>
      {cols.map(c => (
        <td key={c} style={{ padding: '6px 4px' }}>
          <span style={{ borderBottom: '1px solid #aaa', display: 'block', minWidth: 60 }}>&nbsp;</span>
        </td>
      ))}
    </tr>
  ))
}

const CONDITIONS = [
  'Heart disease / heart attack', 'Stroke / TIA', 'High blood pressure',
  'High cholesterol', 'Diabetes (Type 1 or 2)', 'Cancer (any type)',
  'Lung / respiratory disease', 'Kidney disease', 'Liver disease',
  'Neurological disorder', 'Mental health condition', 'Substance use / addiction',
  'HIV / AIDS', 'Autoimmune disorder', 'Arthritis / joint disease',
  'Back / spine condition', 'Sleep apnea', 'Thyroid disorder',
  'Gastrointestinal disorder', 'Vision / hearing impairment', 'Other',
]

export default function BlankFactFinderPrintPage() {
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

  return (
    <>
      <title>Life Insurance Application Data</title>
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
        .section { margin-bottom: 16px; }
        .section-title { background: #1a1a2e; color: #fff; font-weight: 700; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; padding: 5px 8px; margin-bottom: 8px; }
        .row { display: flex; gap: 16px; margin-bottom: 10px; flex-wrap: wrap; }
        .field { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 80px; }
        .field-label { font-size: 9px; color: #666; text-transform: uppercase; letter-spacing: 0.05em; }
        .field-line { border-bottom: 1px solid #aaa; min-height: 16px; padding-bottom: 1px; font-size: 11px; min-width: 60px; }
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
        .pb { page-break-after: always; }
        @media print {
          .print-btn { display: none; }
          .page { padding: 0; }
        }
      ` }} />

      <div className="page">
        <button className="print-btn">Print / Save as PDF</button>

        {/* ── PAGE 1 ─────────────────────────────────────────────────────── */}
        <div className="pb">
          <div className="header">
            <div>
              <div className="agency-name">Makal Financial Services</div>
              <div className="form-title">Life Insurance Application Data</div>
              <div style={{ fontSize: 9, color: '#999', marginTop: 3 }}>Prepared {today}</div>
            </div>
          </div>

          {/* Personal Information */}
          <div className="section">
            <div className="section-title">Personal Information</div>
            <div className="row">
              <LabelBlank label="First Name" w="140px" />
              <LabelBlank label="Middle Name" w="100px" />
              <LabelBlank label="Last Name" w="140px" />
            </div>
            <div className="row">
              <LabelBlank label="Date of Birth (MM/DD/YYYY)" w="140px" />
              <LabelBlank label="Place of Birth" w="140px" />
              <LabelBlank label="Gender" w="100px" />
            </div>
            <div className="row">
              <LabelBlank label="Marital Status" w="120px" />
              <LabelBlank label="Citizenship" w="160px" />
              <LabelBlank label="SSN" w="120px" />
            </div>
          </div>

          {/* Contact */}
          <div className="section">
            <div className="section-title">Contact Information</div>
            <div className="row">
              <LabelBlank label="Street Address" w="220px" />
              <LabelBlank label="City" w="130px" />
              <LabelBlank label="State" w="60px" />
              <LabelBlank label="ZIP" w="70px" />
            </div>
            <div className="row">
              <LabelBlank label="Phone" w="140px" />
              <LabelBlank label="Email" w="200px" />
              <LabelBlank label="Preferred Language" w="120px" />
            </div>
          </div>

          {/* Employment */}
          <div className="section">
            <div className="section-title">Employment &amp; Income</div>
            <div className="row">
              <LabelBlank label="Employment Status" w="140px" />
              <LabelBlank label="Employer / Business" w="180px" />
              <LabelBlank label="Occupation / Title" w="160px" />
            </div>
            <div className="row">
              <LabelBlank label="Annual Income" w="120px" />
              <LabelBlank label="Net Worth (approx.)" w="140px" />
              <LabelBlank label="Years at Employer" w="100px" />
            </div>
          </div>

          {/* Physical */}
          <div className="section">
            <div className="section-title">Physical Build</div>
            <div className="row">
              <LabelBlank label="Height (ft)" w="70px" />
              <LabelBlank label="Height (in)" w="70px" />
              <LabelBlank label="Weight (lbs)" w="80px" />
              <LabelBlank label="Weight Change in last 2 yrs?" w="180px" />
            </div>
          </div>

          {/* Physician */}
          <div className="section">
            <div className="section-title">Attending Physician</div>
            <div className="row">
              <LabelBlank label="Physician Name" w="180px" />
              <LabelBlank label="Practice / Clinic" w="180px" />
            </div>
            <div className="row">
              <LabelBlank label="Phone" w="140px" />
              <LabelBlank label="Address" w="260px" />
              <LabelBlank label="Last Visit" w="100px" />
            </div>
            <div className="row">
              <LabelBlank label="Current Medications" w="100%" />
            </div>
          </div>

          {/* Tobacco */}
          <div className="section">
            <div className="section-title">Tobacco &amp; Lifestyle</div>
            {[
              'Currently use tobacco / nicotine products?',
              'Used tobacco in the last 12 months?',
              'Used tobacco in the last 5 years?',
              'Currently use marijuana / cannabis?',
              'Used marijuana in the last 12 months?',
              'Engage in hazardous activities (aviation, diving, racing, etc.)?',
              'Aviation — licensed pilot?',
              'Alcohol use exceeds 14 drinks per week?',
              'DUI / DWI in the last 5 years?',
              'Pending or declined life insurance application in last 3 years?',
            ].map(q => (
              <div key={q} className="yn-row">
                <span className="yn-label">{q}</span>
                <span className="yn-ctrl"><YNBlank /></span>
                <span className="yn-detail">
                  <span style={{ fontSize: 9, color: '#999' }}>Details: </span>
                  <span style={{ borderBottom: '1px solid #ddd', display: 'inline-block', minWidth: 160 }}>&nbsp;</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── PAGE 2 ─────────────────────────────────────────────────────── */}
        <div className="pb">
          <div style={{ borderBottom: '1px solid #eee', marginBottom: 14, paddingBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontWeight: 700, fontSize: 12, color: '#1a1a2e' }}>Medical History</span>
            <span style={{ fontSize: 9, color: '#999' }}>For each YES, provide details (date of diagnosis, treatment, current status).</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Condition</th><th>Yes / No</th><th>Details (date, treatment, status)</th>
              </tr>
            </thead>
            <tbody>
              {CONDITIONS.map(c => <CondRow key={c} label={c} />)}
            </tbody>
          </table>

          {/* Family History */}
          <div style={{ marginTop: 16 }}>
            <div className="section-title">Family History (Parents / Siblings)</div>
            <table>
              <thead>
                <tr>
                  <th>Relation</th><th>Age / Age at Death</th><th>Cause of Death / Condition</th><th>Yes / No</th>
                </tr>
              </thead>
              <tbody>
                {['Father', 'Mother', 'Sibling', 'Sibling'].map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #e5e5e5' }}>
                    <td style={{ padding: '5px 4px', fontSize: 11 }}>{r}</td>
                    <td style={{ padding: '5px 4px' }}><span style={{ borderBottom: '1px solid #aaa', display: 'block', minWidth: 60 }}>&nbsp;</span></td>
                    <td style={{ padding: '5px 4px' }}><span style={{ borderBottom: '1px solid #aaa', display: 'block', minWidth: 160 }}>&nbsp;</span></td>
                    <td style={{ padding: '5px 4px' }}><YNBlank /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ fontSize: 9, color: '#999', marginTop: 4 }}>Flag if parent/sibling had heart disease, stroke, or cancer before age 60.</p>
          </div>
        </div>

        {/* ── PAGE 3 ─────────────────────────────────────────────────────── */}
        <div className="pb">
          {/* Existing Life Coverage */}
          <div className="section">
            <div className="section-title">Existing Life Insurance Coverage</div>
            <table>
              <thead>
                <tr><th>Company</th><th>Policy #</th><th>Face Amount</th><th>Issue Date</th><th>Type</th><th>Replacing?</th></tr>
              </thead>
              <tbody>
                {blankRows(3, ['Company', 'Policy #', 'Face Amount', 'Issue Date', 'Type', 'Replacing?'])}
              </tbody>
            </table>
          </div>

          {/* LTC */}
          <div className="section">
            <div className="section-title">Long-Term Care Policies</div>
            <table>
              <thead>
                <tr><th>Policy / Company</th><th>Insured</th><th>Daily Benefit</th><th>Annual Premium</th></tr>
              </thead>
              <tbody>
                {blankRows(2, ['Policy / Company', 'Insured', 'Daily Benefit', 'Annual Premium'])}
              </tbody>
            </table>
          </div>

          {/* Disability */}
          <div className="section">
            <div className="section-title">Disability Income Policies</div>
            <table>
              <thead>
                <tr><th>Policy / Company</th><th>Type</th><th>Insured</th><th>Monthly Benefit</th><th>Annual Premium</th></tr>
              </thead>
              <tbody>
                {blankRows(2, ['Policy / Company', 'Type', 'Insured', 'Monthly Benefit', 'Annual Premium'])}
              </tbody>
            </table>
          </div>

          {/* Primary Beneficiaries */}
          <div className="section">
            <div className="section-title">Primary Beneficiaries</div>
            <table>
              <thead>
                <tr><th>Name</th><th>DOB</th><th>Relationship</th><th>% Share</th><th>Phone</th><th>Email</th></tr>
              </thead>
              <tbody>
                {blankRows(3, ['Name', 'DOB', 'Relationship', '% Share', 'Phone', 'Email'])}
              </tbody>
            </table>
          </div>

          {/* Contingent Beneficiaries */}
          <div className="section">
            <div className="section-title">Contingent Beneficiaries</div>
            <table>
              <thead>
                <tr><th>Name</th><th>DOB</th><th>Relationship</th><th>% Share</th><th>Phone</th><th>Email</th></tr>
              </thead>
              <tbody>
                {blankRows(2, ['Name', 'DOB', 'Relationship', '% Share', 'Phone', 'Email'])}
              </tbody>
            </table>
          </div>

          {/* Dependents */}
          <div className="section">
            <div className="section-title">Dependents</div>
            <table>
              <thead>
                <tr><th>Name</th><th>DOB</th><th>Relationship</th><th>Marital Status</th></tr>
              </thead>
              <tbody>
                {blankRows(3, ['Name', 'DOB', 'Relationship', 'Marital Status'])}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── PAGE 4 ─────────────────────────────────────────────────────── */}
        <div>
          {/* Financial Goals */}
          <div className="section">
            <div className="section-title">Financial Goals &amp; Coverage Needs</div>
            <div className="row">
              <LabelBlank label="Primary reason for coverage" w="100%" />
            </div>
            <div className="row">
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 9, color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Coverage priorities (check all that apply)</div>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11 }}>
                  {['Income replacement', 'Mortgage / debt payoff', 'College funding', 'Estate planning', 'Business continuity', 'Final expenses', 'Wealth transfer'].map(o => (
                    <span key={o}>☐ {o}</span>
                  ))}
                </div>
              </div>
            </div>
            <div className="row">
              <LabelBlank label="Coverage amount desired" w="140px" />
              <LabelBlank label="Term or Permanent?" w="140px" />
              <LabelBlank label="Budget (annual premium)" w="140px" />
            </div>
          </div>

          {/* Estate & Legal */}
          <div className="section">
            <div className="section-title">Estate &amp; Legal</div>
            {[
              'Will in place?',
              'Trust in place?',
              'Power of Attorney (financial)?',
              'Power of Attorney (healthcare)?',
            ].map(q => (
              <div key={q} className="yn-row">
                <span className="yn-label">{q}</span>
                <span className="yn-ctrl"><YNBlank /></span>
                <span className="yn-detail">
                  <span style={{ fontSize: 9, color: '#999' }}>Details: </span>
                  <span style={{ borderBottom: '1px solid #ddd', display: 'inline-block', minWidth: 180 }}>&nbsp;</span>
                </span>
              </div>
            ))}
          </div>

          {/* Notes */}
          <div className="section">
            <div className="section-title">Additional Notes</div>
            <div style={{ border: '1px solid #ddd', minHeight: 60, padding: 6, borderRadius: 3 }}>&nbsp;</div>
          </div>

          {/* Signature */}
          <div className="signature-block">
            <div className="sig-field">
              <div className="sig-line" />
              <div className="sig-lbl">Client Signature</div>
            </div>
            <div className="sig-field">
              <div className="sig-line" />
              <div className="sig-lbl">Date</div>
            </div>
            <div className="sig-field">
              <div className="sig-line" />
              <div className="sig-lbl">Producer / LSP</div>
            </div>
          </div>
        </div>
      </div>

      <script dangerouslySetInnerHTML={{ __html: `
        document.querySelector('.print-btn').addEventListener('click', function() { window.print(); });
      ` }} />
    </>
  )
}
