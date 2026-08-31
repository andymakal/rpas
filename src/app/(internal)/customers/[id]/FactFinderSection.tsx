'use client'

import { useState } from 'react'
import {
  ClipboardList, ChevronDown, ChevronUp,
  Check, AlertTriangle, Plus, Trash2, ShieldCheck,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

type OtherPolicy = {
  company: string; policy_number: string; face_amount: string
  issue_date: string; type: string; sold: boolean
}

type Bene = {
  name: string; dob: string; relationship: string
  percentage: string; ssn: string; phone: string; email: string
}

type FF = {
  // Identity
  middle_name: string; suffix: string; ssn: string
  place_of_birth: string; citizenship: string; citizenship_detail: string
  drivers_license: string; dl_state: string
  // Employment
  employer: string; occupation: string; employment_type: string; business_address: string
  annual_income: string; other_income: string; other_income_amount: string
  total_assets: string; total_liabilities: string
  // Build
  height_ft: string; height_in: string; weight_lbs: string
  weight_change: boolean; weight_change_detail: string
  // Physician
  physician_name: string; physician_address: string; physician_phone: string
  last_visit_date: string; last_visit_reason: string; last_visit_abnormal: boolean
  // Lifestyle
  tobacco_last_used: string; tobacco_packs_day: string
  alcohol: boolean; alcohol_detail: string
  marijuana: boolean; marijuana_detail: string
  substances: boolean; substances_detail: string
  aviation: boolean; aviation_detail: string
  hazardous: boolean; hazardous_detail: string
  intl_travel: boolean; intl_travel_detail: string
  military: boolean; military_detail: string
  dui: boolean; dui_detail: string
  felony: boolean; felony_detail: string
  bankruptcy: boolean; bankruptcy_detail: string
  // Medical
  pending_appt: boolean; pending_appt_detail: string; medications: string
  cond_cholesterol: boolean; cond_cholesterol_d: string
  cond_bp: boolean; cond_bp_d: string
  cond_diabetes: boolean; cond_diabetes_d: string
  cond_heart: boolean; cond_heart_d: string
  cond_stroke: boolean; cond_stroke_d: string
  cond_cancer: boolean; cond_cancer_d: string
  cond_respiratory: boolean; cond_respiratory_d: string
  cond_neuro: boolean; cond_neuro_d: string
  cond_mental: boolean; cond_mental_d: string
  cond_cognitive: boolean; cond_cognitive_d: string
  cond_musculo: boolean; cond_musculo_d: string
  cond_blood: boolean; cond_blood_d: string
  cond_digestive: boolean; cond_digestive_d: string
  cond_kidney: boolean; cond_kidney_d: string
  cond_endocrine: boolean; cond_endocrine_d: string
  cond_eye_ear_skin: boolean; cond_eye_ear_skin_d: string
  cond_hiv: boolean; cond_hiv_d: string
  cond_diagnostics: boolean; cond_diagnostics_d: string
  cond_hospitalization: boolean; cond_hospitalization_d: string
  cond_er: boolean; cond_er_d: string
  cond_nursing_home: boolean; cond_other: string
  // Family history
  fam_father_age: string; fam_father_age_death: string; fam_father_cause: string
  fam_father_heart: boolean; fam_father_heart_age: string
  fam_father_cancer: boolean; fam_father_cancer_type: string
  fam_mother_age: string; fam_mother_age_death: string; fam_mother_cause: string
  fam_mother_heart: boolean; fam_mother_heart_age: string
  fam_mother_cancer: boolean; fam_mother_cancer_type: string
  fam_siblings: string
  fam_hereditary: boolean; fam_hereditary_detail: string
  fam_mental: boolean; fam_mental_detail: string
  // Insurance
  prior_declines: boolean; prior_declines_detail: string
  // Misc
  bene_notes: string; ff_notes: string
}

// ─── Init helpers ─────────────────────────────────────────────────────────────

function initFF(raw: Record<string, unknown> | null): FF {
  const r = raw ?? {}
  const s = (k: string) => (typeof r[k] === 'string' ? (r[k] as string) : '')
  const b = (k: string) => (typeof r[k] === 'boolean' ? (r[k] as boolean) : false)
  return {
    middle_name: s('middle_name'), suffix: s('suffix'), ssn: s('ssn'),
    place_of_birth: s('place_of_birth'),
    citizenship: s('citizenship') || 'us_citizen', citizenship_detail: s('citizenship_detail'),
    drivers_license: s('drivers_license'), dl_state: s('dl_state'),
    employer: s('employer'), occupation: s('occupation'),
    employment_type: s('employment_type'), business_address: s('business_address'),
    annual_income: s('annual_income'), other_income: s('other_income'),
    other_income_amount: s('other_income_amount'),
    total_assets: s('total_assets'), total_liabilities: s('total_liabilities'),
    height_ft: s('height_ft'), height_in: s('height_in'), weight_lbs: s('weight_lbs'),
    weight_change: b('weight_change'), weight_change_detail: s('weight_change_detail'),
    physician_name: s('physician_name'), physician_address: s('physician_address'),
    physician_phone: s('physician_phone'), last_visit_date: s('last_visit_date'),
    last_visit_reason: s('last_visit_reason'), last_visit_abnormal: b('last_visit_abnormal'),
    tobacco_last_used: s('tobacco_last_used'), tobacco_packs_day: s('tobacco_packs_day'),
    alcohol: b('alcohol'), alcohol_detail: s('alcohol_detail'),
    marijuana: b('marijuana'), marijuana_detail: s('marijuana_detail'),
    substances: b('substances'), substances_detail: s('substances_detail'),
    aviation: b('aviation'), aviation_detail: s('aviation_detail'),
    hazardous: b('hazardous'), hazardous_detail: s('hazardous_detail'),
    intl_travel: b('intl_travel'), intl_travel_detail: s('intl_travel_detail'),
    military: b('military'), military_detail: s('military_detail'),
    dui: b('dui'), dui_detail: s('dui_detail'),
    felony: b('felony'), felony_detail: s('felony_detail'),
    bankruptcy: b('bankruptcy'), bankruptcy_detail: s('bankruptcy_detail'),
    pending_appt: b('pending_appt'), pending_appt_detail: s('pending_appt_detail'),
    medications: s('medications'),
    cond_cholesterol: b('cond_cholesterol'), cond_cholesterol_d: s('cond_cholesterol_d'),
    cond_bp: b('cond_bp'), cond_bp_d: s('cond_bp_d'),
    cond_diabetes: b('cond_diabetes'), cond_diabetes_d: s('cond_diabetes_d'),
    cond_heart: b('cond_heart'), cond_heart_d: s('cond_heart_d'),
    cond_stroke: b('cond_stroke'), cond_stroke_d: s('cond_stroke_d'),
    cond_cancer: b('cond_cancer'), cond_cancer_d: s('cond_cancer_d'),
    cond_respiratory: b('cond_respiratory'), cond_respiratory_d: s('cond_respiratory_d'),
    cond_neuro: b('cond_neuro'), cond_neuro_d: s('cond_neuro_d'),
    cond_mental: b('cond_mental'), cond_mental_d: s('cond_mental_d'),
    cond_cognitive: b('cond_cognitive'), cond_cognitive_d: s('cond_cognitive_d'),
    cond_musculo: b('cond_musculo'), cond_musculo_d: s('cond_musculo_d'),
    cond_blood: b('cond_blood'), cond_blood_d: s('cond_blood_d'),
    cond_digestive: b('cond_digestive'), cond_digestive_d: s('cond_digestive_d'),
    cond_kidney: b('cond_kidney'), cond_kidney_d: s('cond_kidney_d'),
    cond_endocrine: b('cond_endocrine'), cond_endocrine_d: s('cond_endocrine_d'),
    cond_eye_ear_skin: b('cond_eye_ear_skin'), cond_eye_ear_skin_d: s('cond_eye_ear_skin_d'),
    cond_hiv: b('cond_hiv'), cond_hiv_d: s('cond_hiv_d'),
    cond_diagnostics: b('cond_diagnostics'), cond_diagnostics_d: s('cond_diagnostics_d'),
    cond_hospitalization: b('cond_hospitalization'), cond_hospitalization_d: s('cond_hospitalization_d'),
    cond_er: b('cond_er'), cond_er_d: s('cond_er_d'),
    cond_nursing_home: b('cond_nursing_home'), cond_other: s('cond_other'),
    fam_father_age: s('fam_father_age'), fam_father_age_death: s('fam_father_age_death'),
    fam_father_cause: s('fam_father_cause'),
    fam_father_heart: b('fam_father_heart'), fam_father_heart_age: s('fam_father_heart_age'),
    fam_father_cancer: b('fam_father_cancer'), fam_father_cancer_type: s('fam_father_cancer_type'),
    fam_mother_age: s('fam_mother_age'), fam_mother_age_death: s('fam_mother_age_death'),
    fam_mother_cause: s('fam_mother_cause'),
    fam_mother_heart: b('fam_mother_heart'), fam_mother_heart_age: s('fam_mother_heart_age'),
    fam_mother_cancer: b('fam_mother_cancer'), fam_mother_cancer_type: s('fam_mother_cancer_type'),
    fam_siblings: s('fam_siblings'),
    fam_hereditary: b('fam_hereditary'), fam_hereditary_detail: s('fam_hereditary_detail'),
    fam_mental: b('fam_mental'), fam_mental_detail: s('fam_mental_detail'),
    prior_declines: b('prior_declines'), prior_declines_detail: s('prior_declines_detail'),
    bene_notes: s('bene_notes'), ff_notes: s('ff_notes'),
  }
}

function initArr<T>(raw: Record<string, unknown> | null, key: string, map: (o: Record<string, unknown>) => T): T[] {
  const r = raw ?? {}
  if (!Array.isArray(r[key])) return []
  return (r[key] as unknown[]).map(x => map((x ?? {}) as Record<string, unknown>))
}

const EMPTY_POLICY: OtherPolicy = { company: '', policy_number: '', face_amount: '', issue_date: '', type: 'personal', sold: false }
const EMPTY_BENE: Bene = { name: '', dob: '', relationship: '', percentage: '', ssn: '', phone: '', email: '' }

function mapPolicy(o: Record<string, unknown>): OtherPolicy {
  return {
    company:       typeof o.company       === 'string' ? o.company       : '',
    policy_number: typeof o.policy_number === 'string' ? o.policy_number : '',
    face_amount:   typeof o.face_amount   === 'string' ? o.face_amount   : '',
    issue_date:    typeof o.issue_date    === 'string' ? o.issue_date    : '',
    type:          typeof o.type          === 'string' ? o.type          : 'personal',
    sold:          typeof o.sold          === 'boolean' ? o.sold         : false,
  }
}

function mapBene(o: Record<string, unknown>): Bene {
  return {
    name:         typeof o.name         === 'string' ? o.name         : '',
    dob:          typeof o.dob          === 'string' ? o.dob          : '',
    relationship: typeof o.relationship === 'string' ? o.relationship : '',
    percentage:   typeof o.percentage   === 'string' ? o.percentage   : '',
    ssn:          typeof o.ssn          === 'string' ? o.ssn          : '',
    phone:        typeof o.phone        === 'string' ? o.phone        : '',
    email:        typeof o.email        === 'string' ? o.email        : '',
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const inp = 'w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 placeholder-slate-600'
const inpSm = 'w-full bg-slate-800 border border-slate-600 text-slate-100 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-500 placeholder-slate-600'

function SubSection({ id, title, open, onToggle, flagged, children }: {
  id: string; title: string; open: boolean; onToggle: () => void
  flagged?: boolean; children: React.ReactNode
}) {
  return (
    <div className="border-b border-slate-800 last:border-0">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-slate-800/30 transition-colors"
        data-id={id}
      >
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide flex items-center gap-2">
          {title}
          {flagged && <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />}
        </span>
        {open ? <ChevronUp className="w-3.5 h-3.5 text-slate-500" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-500" />}
      </button>
      {open && <div className="px-5 pb-5 space-y-3">{children}</div>}
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs text-slate-500 mb-1">{children}</label>
}

function Row2({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>
}

function Row3({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-3 gap-3">{children}</div>
}

function YN({ yes, onChange }: { yes: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex shrink-0">
      <button
        onClick={() => onChange(true)}
        className={`px-2.5 py-1 text-xs font-medium rounded-l border transition-colors ${yes ? 'bg-amber-900/60 text-amber-300 border-amber-700' : 'bg-transparent text-slate-500 border-slate-700 hover:text-slate-300 hover:border-slate-500'}`}
      >YES</button>
      <button
        onClick={() => onChange(false)}
        className={`px-2.5 py-1 text-xs font-medium rounded-r border-t border-r border-b transition-colors ${!yes ? 'bg-slate-700 text-slate-300 border-slate-600' : 'bg-transparent text-slate-500 border-slate-700 hover:text-slate-300 hover:border-slate-500'}`}
      >NO</button>
    </div>
  )
}

function CondRow({ label, yes, detail, onYes, onDetail }: {
  label: string; yes: boolean; detail: string
  onYes: (v: boolean) => void; onDetail: (v: string) => void
}) {
  return (
    <div className="border-b border-slate-800/50 last:border-0">
      <div className="flex items-center justify-between py-2.5">
        <span className="text-sm text-slate-300">{label}</span>
        <YN yes={yes} onChange={onYes} />
      </div>
      {yes && (
        <textarea
          value={detail}
          onChange={e => onDetail(e.target.value)}
          rows={2}
          placeholder="Date diagnosed, treatment, current status…"
          className="w-full bg-slate-800 border border-amber-800/40 text-slate-100 text-xs rounded-lg px-3 py-2 mb-3 focus:outline-none focus:border-amber-600/60 placeholder-slate-600 resize-none"
        />
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function FactFinderSection({
  customerId,
  initialData,
  initialVerifiedAt,
}: {
  customerId:       string
  initialData:      Record<string, unknown> | null
  initialVerifiedAt: string | null
}) {
  const [open,       setOpen]       = useState(false)
  const [ff,         setFf]         = useState<FF>(() => initFF(initialData))
  const [policies,   setPolicies]   = useState<OtherPolicy[]>(() => initArr(initialData, 'other_policies', mapPolicy))
  const [primBenes,  setPrimBenes]  = useState<Bene[]>(() => initArr(initialData, 'primary_benes', mapBene))
  const [contBenes,  setContBenes]  = useState<Bene[]>(() => initArr(initialData, 'contingent_benes', mapBene))
  const [verifiedAt, setVerifiedAt] = useState<string | null>(initialVerifiedAt)
  const [saving,     setSaving]     = useState(false)
  const [saveMsg,    setSaveMsg]    = useState<{ ok: boolean; text: string } | null>(null)

  // which sub-sections are open
  const [openSections, setOpenSections] = useState<Set<string>>(new Set())
  function toggleSec(id: string) {
    setOpenSections(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function set<K extends keyof FF>(key: K, value: FF[K]) {
    setFf(prev => ({ ...prev, [key]: value }))
  }

  function setPolicy(i: number, key: keyof OtherPolicy, value: string | boolean) {
    setPolicies(prev => prev.map((p, j) => j === i ? { ...p, [key]: value } : p))
  }
  function setBene(arr: Bene[], setArr: (fn: (prev: Bene[]) => Bene[]) => void, i: number, key: keyof Bene, value: string) {
    setArr(prev => prev.map((b, j) => j === i ? { ...b, [key]: value } : b))
  }

  async function handleSave(verify = false) {
    setSaving(true); setSaveMsg(null)
    try {
      const payload: Record<string, unknown> = {
        fact_finder: { ...ff, other_policies: policies, primary_benes: primBenes, contingent_benes: contBenes },
      }
      if (verify) payload.fact_finder_verified_at = new Date().toISOString()

      const res  = await fetch(`/api/customers/${customerId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) {
        setSaveMsg({ ok: false, text: json.error ?? 'Save failed' })
      } else {
        setSaveMsg({ ok: true, text: verify ? 'Saved and marked verified' : 'Saved' })
        if (verify) setVerifiedAt(new Date().toISOString())
        setTimeout(() => setSaveMsg(null), 3000)
      }
    } catch {
      setSaveMsg({ ok: false, text: 'Network error' })
    } finally {
      setSaving(false)
    }
  }

  // How many YES conditions to show in the status badge
  const condCount = [
    ff.cond_cholesterol, ff.cond_bp, ff.cond_diabetes, ff.cond_heart, ff.cond_stroke,
    ff.cond_cancer, ff.cond_respiratory, ff.cond_neuro, ff.cond_mental, ff.cond_cognitive,
    ff.cond_musculo, ff.cond_blood, ff.cond_digestive, ff.cond_kidney, ff.cond_endocrine,
    ff.cond_eye_ear_skin, ff.cond_hiv,
  ].filter(Boolean).length

  const anyData = !!(
    ff.middle_name || ff.ssn || ff.employer || ff.height_ft || ff.physician_name ||
    ff.medications || condCount > 0 || policies.length > 0 || primBenes.length > 0
  )

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide hover:text-slate-200 transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <ClipboardList className="w-3.5 h-3.5" />
          Fact Finder
          {anyData && (
            <span className={`ml-1 text-xs normal-case font-normal px-1.5 py-0.5 rounded-full ${
              verifiedAt ? 'bg-green-900/40 text-green-400' : 'bg-slate-800 text-slate-500'
            }`}>
              {verifiedAt
                ? `Verified ${new Date(verifiedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                : 'In progress'}
            </span>
          )}
          {condCount > 0 && (
            <span className="ml-1 text-xs normal-case font-normal bg-amber-900/40 text-amber-400 px-1.5 py-0.5 rounded-full">
              {condCount} condition{condCount !== 1 ? 's' : ''}
            </span>
          )}
        </span>
        {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>

      {open && (
        <div className="border-t border-slate-800">

          {/* ── Identity & Legal ──────────────────────────────────────────── */}
          <SubSection id="identity" title="Identity & Legal"
            open={openSections.has('identity')} onToggle={() => toggleSec('identity')}>
            <Row3>
              <div><Label>Middle name</Label><input value={ff.middle_name} onChange={e => set('middle_name', e.target.value)} className={inp} /></div>
              <div><Label>Suffix</Label>
                <select value={ff.suffix} onChange={e => set('suffix', e.target.value)} className={inp}>
                  <option value="">—</option>
                  <option>Jr.</option><option>Sr.</option><option>II</option><option>III</option><option>IV</option>
                </select>
              </div>
              <div><Label>SSN <span className="text-slate-600">(stored securely)</span></Label>
                <input value={ff.ssn} onChange={e => set('ssn', e.target.value)} placeholder="XXX-XX-XXXX" className={inp} />
              </div>
            </Row3>
            <Row3>
              <div><Label>Place of birth (state or country)</Label><input value={ff.place_of_birth} onChange={e => set('place_of_birth', e.target.value)} className={inp} /></div>
              <div><Label>Citizenship</Label>
                <select value={ff.citizenship} onChange={e => set('citizenship', e.target.value)} className={inp}>
                  <option value="us_citizen">US Citizen</option>
                  <option value="green_card">Green Card / LPR</option>
                  <option value="visa">Work / Other Visa</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div><Label>Citizenship detail (if non-citizen)</Label><input value={ff.citizenship_detail} onChange={e => set('citizenship_detail', e.target.value)} placeholder="Visa type, country…" className={inp} /></div>
            </Row3>
            <Row2>
              <div><Label>Driver&apos;s license #</Label><input value={ff.drivers_license} onChange={e => set('drivers_license', e.target.value)} className={inp} /></div>
              <div><Label>State</Label><input value={ff.dl_state} onChange={e => set('dl_state', e.target.value)} maxLength={2} placeholder="NJ" className={inp} /></div>
            </Row2>
          </SubSection>

          {/* ── Employment & Finances ─────────────────────────────────────── */}
          <SubSection id="employment" title="Employment & Finances"
            open={openSections.has('employment')} onToggle={() => toggleSec('employment')}>
            <Row3>
              <div><Label>Employer</Label><input value={ff.employer} onChange={e => set('employer', e.target.value)} className={inp} /></div>
              <div><Label>Occupation / title</Label><input value={ff.occupation} onChange={e => set('occupation', e.target.value)} className={inp} /></div>
              <div><Label>Employment type</Label>
                <select value={ff.employment_type} onChange={e => set('employment_type', e.target.value)} className={inp}>
                  <option value="">—</option>
                  <option value="full_time">Full-time</option>
                  <option value="part_time">Part-time</option>
                  <option value="self_employed">Self-employed</option>
                  <option value="seasonal">Seasonal</option>
                  <option value="retired">Retired</option>
                  <option value="unemployed">Unemployed</option>
                </select>
              </div>
            </Row3>
            <div><Label>Business address</Label><input value={ff.business_address} onChange={e => set('business_address', e.target.value)} placeholder="Street, City, State" className={inp} /></div>
            <Row3>
              <div><Label>Annual earned income ($)</Label><input value={ff.annual_income} onChange={e => set('annual_income', e.target.value)} type="number" min="0" step="1000" className={inp} /></div>
              <div><Label>Other income source</Label><input value={ff.other_income} onChange={e => set('other_income', e.target.value)} placeholder="Rental, pension…" className={inp} /></div>
              <div><Label>Other income amount ($)</Label><input value={ff.other_income_amount} onChange={e => set('other_income_amount', e.target.value)} type="number" min="0" step="1000" className={inp} /></div>
            </Row3>
            <Row2>
              <div><Label>Total assets ($)</Label><input value={ff.total_assets} onChange={e => set('total_assets', e.target.value)} type="number" min="0" step="10000" className={inp} /></div>
              <div><Label>Total liabilities ($)</Label><input value={ff.total_liabilities} onChange={e => set('total_liabilities', e.target.value)} type="number" min="0" step="10000" className={inp} /></div>
            </Row2>
          </SubSection>

          {/* ── Build & Physician ─────────────────────────────────────────── */}
          <SubSection id="build" title="Build & Physician"
            open={openSections.has('build')} onToggle={() => toggleSec('build')}>
            <div className="grid grid-cols-4 gap-3">
              <div><Label>Height (ft)</Label><input value={ff.height_ft} onChange={e => set('height_ft', e.target.value)} type="number" min="3" max="8" placeholder="5" className={inp} /></div>
              <div><Label>Height (in)</Label><input value={ff.height_in} onChange={e => set('height_in', e.target.value)} type="number" min="0" max="11" placeholder="10" className={inp} /></div>
              <div><Label>Weight (lbs)</Label><input value={ff.weight_lbs} onChange={e => set('weight_lbs', e.target.value)} type="number" min="50" max="600" className={inp} /></div>
              <div className="flex flex-col justify-end">
                <Label>Weight change &gt;10 lbs?</Label>
                <YN yes={ff.weight_change} onChange={v => set('weight_change', v)} />
              </div>
            </div>
            {ff.weight_change && (
              <div><Label>Weight change detail</Label>
                <input value={ff.weight_change_detail} onChange={e => set('weight_change_detail', e.target.value)}
                  placeholder="Loss or gain, amount, reason" className={inp} />
              </div>
            )}
            <div className="pt-2 border-t border-slate-800">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Primary Physician</p>
              <Row2>
                <div><Label>Name</Label><input value={ff.physician_name} onChange={e => set('physician_name', e.target.value)} className={inp} /></div>
                <div><Label>Phone</Label><input value={ff.physician_phone} onChange={e => set('physician_phone', e.target.value)} type="tel" className={inp} /></div>
              </Row2>
              <div><Label>Address</Label><input value={ff.physician_address} onChange={e => set('physician_address', e.target.value)} className={inp} /></div>
              <Row3>
                <div><Label>Date of last visit</Label><input value={ff.last_visit_date} onChange={e => set('last_visit_date', e.target.value)} type="date" className={inp} /></div>
                <div><Label>Reason</Label><input value={ff.last_visit_reason} onChange={e => set('last_visit_reason', e.target.value)} placeholder="Annual, follow-up…" className={inp} /></div>
                <div className="flex flex-col justify-end">
                  <Label>Results abnormal?</Label>
                  <YN yes={ff.last_visit_abnormal} onChange={v => set('last_visit_abnormal', v)} />
                </div>
              </Row3>
            </div>
          </SubSection>

          {/* ── Lifestyle ─────────────────────────────────────────────────── */}
          <SubSection id="lifestyle" title="Lifestyle"
            flagged={ff.dui || ff.felony || ff.bankruptcy || ff.aviation || ff.hazardous}
            open={openSections.has('lifestyle')} onToggle={() => toggleSec('lifestyle')}>
            <Row3>
              <div><Label>Tobacco — last used</Label><input value={ff.tobacco_last_used} onChange={e => set('tobacco_last_used', e.target.value)} type="date" className={inp} /></div>
              <div><Label>Packs/day (if current)</Label><input value={ff.tobacco_packs_day} onChange={e => set('tobacco_packs_day', e.target.value)} type="number" min="0" step="0.5" className={inp} /></div>
            </Row3>
            {[
              { flag: 'alcohol',    detail: 'alcohol_detail',    label: 'Alcohol use',                        ph: 'Drinks/week, type' },
              { flag: 'marijuana',  detail: 'marijuana_detail',  label: 'Marijuana / cannabis use',           ph: 'Frequency, form' },
              { flag: 'substances', detail: 'substances_detail', label: 'Other controlled substance use / history', ph: 'Type, date last used, treatment' },
              { flag: 'aviation',   detail: 'aviation_detail',   label: 'Aviation activity (pilot, student)', ph: 'License type, hours/year, aircraft' },
              { flag: 'hazardous',  detail: 'hazardous_detail',  label: 'Hazardous avocations (scuba, climbing, racing, skydiving…)', ph: 'Activity, frequency' },
              { flag: 'intl_travel',detail: 'intl_travel_detail',label: 'International travel or residence plans', ph: 'Countries, dates' },
              { flag: 'military',   detail: 'military_detail',   label: 'Military service',                   ph: 'Branch, status, pay grade' },
              { flag: 'dui',        detail: 'dui_detail',        label: 'DUI / license suspension / 3+ violations in 3 years', ph: 'Dates, details' },
              { flag: 'felony',     detail: 'felony_detail',     label: 'Felony conviction',                  ph: 'Offense, date, disposition' },
              { flag: 'bankruptcy', detail: 'bankruptcy_detail', label: 'Bankruptcy in past 5 years',         ph: 'Chapter, discharge date' },
            ].map(({ flag, detail, label, ph }) => (
              <div key={flag}>
                <div className="flex items-center justify-between py-1.5">
                  <span className="text-sm text-slate-300">{label}</span>
                  <YN yes={ff[flag as keyof FF] as boolean} onChange={v => set(flag as keyof FF, v as FF[keyof FF])} />
                </div>
                {(ff[flag as keyof FF] as boolean) && (
                  <input value={ff[detail as keyof FF] as string} onChange={e => set(detail as keyof FF, e.target.value as FF[keyof FF])}
                    placeholder={ph} className={`${inp} mt-1 mb-2 border-amber-800/40`} />
                )}
              </div>
            ))}
          </SubSection>

          {/* ── Medical History ───────────────────────────────────────────── */}
          <SubSection id="medical" title="Medical History"
            flagged={condCount > 0}
            open={openSections.has('medical')} onToggle={() => toggleSec('medical')}>
            <div className="flex items-center justify-between py-1.5">
              <span className="text-sm text-slate-300">Pending medical appointment</span>
              <YN yes={ff.pending_appt} onChange={v => set('pending_appt', v)} />
            </div>
            {ff.pending_appt && (
              <input value={ff.pending_appt_detail} onChange={e => set('pending_appt_detail', e.target.value)}
                placeholder="Doctor, specialty, reason" className={`${inp} border-amber-800/40`} />
            )}
            <div><Label>Current prescriptions / treatments</Label>
              <textarea value={ff.medications} onChange={e => set('medications', e.target.value)}
                rows={2} placeholder="Medication name, dose, condition being treated…"
                className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 placeholder-slate-600 resize-none" />
            </div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide pt-2">Conditions — has the applicant ever been diagnosed with or treated for:</p>
            <CondRow label="High cholesterol" yes={ff.cond_cholesterol} detail={ff.cond_cholesterol_d} onYes={v => set('cond_cholesterol', v)} onDetail={v => set('cond_cholesterol_d', v)} />
            <CondRow label="High blood pressure / hypertension" yes={ff.cond_bp} detail={ff.cond_bp_d} onYes={v => set('cond_bp', v)} onDetail={v => set('cond_bp_d', v)} />
            <CondRow label="Diabetes / blood sugar disorder" yes={ff.cond_diabetes} detail={ff.cond_diabetes_d} onYes={v => set('cond_diabetes', v)} onDetail={v => set('cond_diabetes_d', v)} />
            <CondRow label="Heart disease (CAD, heart attack, chest pain, irregular heartbeat, murmur)" yes={ff.cond_heart} detail={ff.cond_heart_d} onYes={v => set('cond_heart', v)} onDetail={v => set('cond_heart_d', v)} />
            <CondRow label="Stroke / TIA / blood clot / aneurysm / peripheral vascular disease" yes={ff.cond_stroke} detail={ff.cond_stroke_d} onYes={v => set('cond_stroke', v)} onDetail={v => set('cond_stroke_d', v)} />
            <CondRow label="Cancer / tumors / growths / masses / leukemia / lymphoma" yes={ff.cond_cancer} detail={ff.cond_cancer_d} onYes={v => set('cond_cancer', v)} onDetail={v => set('cond_cancer_d', v)} />
            <CondRow label="Respiratory (asthma, emphysema, COPD, sleep apnea, oxygen use)" yes={ff.cond_respiratory} detail={ff.cond_respiratory_d} onYes={v => set('cond_respiratory', v)} onDetail={v => set('cond_respiratory_d', v)} />
            <CondRow label="Neurological (seizures, Parkinson's, MS, ALS, cerebral palsy)" yes={ff.cond_neuro} detail={ff.cond_neuro_d} onYes={v => set('cond_neuro', v)} onDetail={v => set('cond_neuro_d', v)} />
            <CondRow label="Mental health (anxiety, depression, bipolar, schizophrenia, PTSD, eating disorder, suicide attempt)" yes={ff.cond_mental} detail={ff.cond_mental_d} onYes={v => set('cond_mental', v)} onDetail={v => set('cond_mental_d', v)} />
            <CondRow label="Cognitive (dementia, Alzheimer's, ADHD, memory loss)" yes={ff.cond_cognitive} detail={ff.cond_cognitive_d} onYes={v => set('cond_cognitive', v)} onDetail={v => set('cond_cognitive_d', v)} />
            <CondRow label="Musculoskeletal (arthritis, fibromyalgia, muscular dystrophy, chronic back/neck pain)" yes={ff.cond_musculo} detail={ff.cond_musculo_d} onYes={v => set('cond_musculo', v)} onDetail={v => set('cond_musculo_d', v)} />
            <CondRow label="Blood / immune (anemia, hemophilia, lupus, sickle cell)" yes={ff.cond_blood} detail={ff.cond_blood_d} onYes={v => set('cond_blood', v)} onDetail={v => set('cond_blood_d', v)} />
            <CondRow label="Digestive (colitis, Crohn's, hepatitis, liver disorder, colon polyps, pancreatitis)" yes={ff.cond_digestive} detail={ff.cond_digestive_d} onYes={v => set('cond_digestive', v)} onDetail={v => set('cond_digestive_d', v)} />
            <CondRow label="Kidney / bladder / prostate / reproductive disorders" yes={ff.cond_kidney} detail={ff.cond_kidney_d} onYes={v => set('cond_kidney', v)} onDetail={v => set('cond_kidney_d', v)} />
            <CondRow label="Thyroid / endocrine / pituitary / adrenal disorders" yes={ff.cond_endocrine} detail={ff.cond_endocrine_d} onYes={v => set('cond_endocrine', v)} onDetail={v => set('cond_endocrine_d', v)} />
            <CondRow label="Eye / ear / skin disorders" yes={ff.cond_eye_ear_skin} detail={ff.cond_eye_ear_skin_d} onYes={v => set('cond_eye_ear_skin', v)} onDetail={v => set('cond_eye_ear_skin_d', v)} />
            <CondRow label="HIV / AIDS" yes={ff.cond_hiv} detail={ff.cond_hiv_d} onYes={v => set('cond_hiv', v)} onDetail={v => set('cond_hiv_d', v)} />
            <CondRow label="Diagnostic tests in past 2 years (EKG, CT, MRI, colonoscopy, biopsy…)" yes={ff.cond_diagnostics} detail={ff.cond_diagnostics_d} onYes={v => set('cond_diagnostics', v)} onDetail={v => set('cond_diagnostics_d', v)} />
            <CondRow label="Hospitalization / surgery in past 5 years" yes={ff.cond_hospitalization} detail={ff.cond_hospitalization_d} onYes={v => set('cond_hospitalization', v)} onDetail={v => set('cond_hospitalization_d', v)} />
            <CondRow label="ER / urgent care visits in past 5 years" yes={ff.cond_er} detail={ff.cond_er_d} onYes={v => set('cond_er', v)} onDetail={v => set('cond_er_d', v)} />
            <div className="flex items-center justify-between py-2.5">
              <span className="text-sm text-slate-300">Nursing home / hospice / assisted living (ever)</span>
              <YN yes={ff.cond_nursing_home} onChange={v => set('cond_nursing_home', v)} />
            </div>
            <div><Label>Other conditions not listed above</Label>
              <textarea value={ff.cond_other} onChange={e => set('cond_other', e.target.value)}
                rows={2} placeholder="Any other diagnoses, treatments, or ongoing medical care…"
                className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 placeholder-slate-600 resize-none" />
            </div>
          </SubSection>

          {/* ── Family History ────────────────────────────────────────────── */}
          <SubSection id="family" title="Family History"
            open={openSections.has('family')} onToggle={() => toggleSec('family')}>
            {(['father', 'mother'] as const).map(parent => (
              <div key={parent} className={parent === 'mother' ? 'pt-3 border-t border-slate-800' : ''}>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 capitalize">{parent}</p>
                <Row3>
                  <div><Label>Age if living</Label>
                    <input value={ff[`fam_${parent}_age` as keyof FF] as string}
                      onChange={e => set(`fam_${parent}_age` as keyof FF, e.target.value as FF[keyof FF])}
                      type="number" min="0" max="130" className={inp} />
                  </div>
                  <div><Label>Age at death</Label>
                    <input value={ff[`fam_${parent}_age_death` as keyof FF] as string}
                      onChange={e => set(`fam_${parent}_age_death` as keyof FF, e.target.value as FF[keyof FF])}
                      type="number" min="0" max="130" className={inp} />
                  </div>
                  <div><Label>Cause of death</Label>
                    <input value={ff[`fam_${parent}_cause` as keyof FF] as string}
                      onChange={e => set(`fam_${parent}_cause` as keyof FF, e.target.value as FF[keyof FF])}
                      placeholder="Heart disease, cancer…" className={inp} />
                  </div>
                </Row3>
                <div className="grid grid-cols-4 gap-3 mt-2">
                  <div className="flex flex-col gap-1">
                    <Label>Heart disease?</Label>
                    <YN yes={ff[`fam_${parent}_heart` as keyof FF] as boolean}
                      onChange={v => set(`fam_${parent}_heart` as keyof FF, v as FF[keyof FF])} />
                  </div>
                  {(ff[`fam_${parent}_heart` as keyof FF] as boolean) && (
                    <div><Label>Age at onset</Label>
                      <input value={ff[`fam_${parent}_heart_age` as keyof FF] as string}
                        onChange={e => set(`fam_${parent}_heart_age` as keyof FF, e.target.value as FF[keyof FF])}
                        type="number" min="0" max="130" className={inp} />
                    </div>
                  )}
                  <div className="flex flex-col gap-1">
                    <Label>Cancer?</Label>
                    <YN yes={ff[`fam_${parent}_cancer` as keyof FF] as boolean}
                      onChange={v => set(`fam_${parent}_cancer` as keyof FF, v as FF[keyof FF])} />
                  </div>
                  {(ff[`fam_${parent}_cancer` as keyof FF] as boolean) && (
                    <div><Label>Cancer type</Label>
                      <input value={ff[`fam_${parent}_cancer_type` as keyof FF] as string}
                        onChange={e => set(`fam_${parent}_cancer_type` as keyof FF, e.target.value as FF[keyof FF])}
                        placeholder="Colon, breast…" className={inp} />
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div className="pt-3 border-t border-slate-800">
              <Label>Siblings — any significant conditions or early deaths</Label>
              <textarea value={ff.fam_siblings} onChange={e => set('fam_siblings', e.target.value)}
                rows={2} placeholder="e.g. Brother died age 52 — heart attack; Sister — breast cancer dx age 45"
                className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 placeholder-slate-600 resize-none" />
            </div>
            <div>
              <div className="flex items-center justify-between py-1.5">
                <span className="text-sm text-slate-300">Hereditary conditions (ALS, polycystic kidney, Huntington&apos;s, aneurysm, cardiomyopathy)</span>
                <YN yes={ff.fam_hereditary} onChange={v => set('fam_hereditary', v)} />
              </div>
              {ff.fam_hereditary && (
                <input value={ff.fam_hereditary_detail} onChange={e => set('fam_hereditary_detail', e.target.value)}
                  placeholder="Condition, affected family member" className={`${inp} border-amber-800/40`} />
              )}
            </div>
            <div>
              <div className="flex items-center justify-between py-1.5">
                <span className="text-sm text-slate-300">Family history of mental illness, suicide, or substance abuse</span>
                <YN yes={ff.fam_mental} onChange={v => set('fam_mental', v)} />
              </div>
              {ff.fam_mental && (
                <input value={ff.fam_mental_detail} onChange={e => set('fam_mental_detail', e.target.value)}
                  placeholder="Relationship, condition" className={`${inp} border-amber-800/40`} />
              )}
            </div>
          </SubSection>

          {/* ── Other Insurance ───────────────────────────────────────────── */}
          <SubSection id="insurance" title="Other Insurance & Declines"
            open={openSections.has('insurance')} onToggle={() => toggleSec('insurance')}>
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Existing policies at other carriers</p>
                <button onClick={() => setPolicies(p => [...p, { ...EMPTY_POLICY }])}
                  className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 border border-slate-700 hover:border-slate-500 rounded-md px-2 py-1 transition-colors">
                  <Plus className="w-3 h-3" /> Add policy
                </button>
              </div>
              {policies.length === 0 && (
                <p className="text-xs text-slate-600 italic">No other policies on file</p>
              )}
              {policies.map((p, i) => (
                <div key={i} className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-3 mb-2 space-y-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-slate-400 font-medium">Policy {i + 1}</span>
                    <button onClick={() => setPolicies(prev => prev.filter((_, j) => j !== i))}
                      className="text-slate-600 hover:text-red-400 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div><label className="block text-xs text-slate-500 mb-1">Company</label><input value={p.company} onChange={e => setPolicy(i, 'company', e.target.value)} className={inpSm} /></div>
                    <div><label className="block text-xs text-slate-500 mb-1">Policy #</label><input value={p.policy_number} onChange={e => setPolicy(i, 'policy_number', e.target.value)} className={inpSm} /></div>
                    <div><label className="block text-xs text-slate-500 mb-1">Face amount ($)</label><input value={p.face_amount} onChange={e => setPolicy(i, 'face_amount', e.target.value)} type="number" min="0" step="10000" className={inpSm} /></div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div><label className="block text-xs text-slate-500 mb-1">Issue date</label><input value={p.issue_date} onChange={e => setPolicy(i, 'issue_date', e.target.value)} type="date" className={inpSm} /></div>
                    <div><label className="block text-xs text-slate-500 mb-1">Type</label>
                      <select value={p.type} onChange={e => setPolicy(i, 'type', e.target.value)} className={inpSm}>
                        <option value="personal">Personal</option>
                        <option value="business">Business</option>
                        <option value="group">Group</option>
                      </select>
                    </div>
                    <div className="flex items-end pb-0.5">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={p.sold} onChange={e => setPolicy(i, 'sold', e.target.checked)}
                          className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30" />
                        <span className="text-xs text-slate-400">Policy sold / surrendered</span>
                      </label>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="pt-2 border-t border-slate-800">
              <div className="flex items-center justify-between py-1.5">
                <span className="text-sm text-slate-300">Ever declined, rated, or postponed by a carrier?</span>
                <YN yes={ff.prior_declines} onChange={v => set('prior_declines', v)} />
              </div>
              {ff.prior_declines && (
                <textarea value={ff.prior_declines_detail} onChange={e => set('prior_declines_detail', e.target.value)}
                  rows={2} placeholder="Carrier, year, reason if known…"
                  className="w-full bg-slate-800 border border-amber-800/40 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-amber-600/60 placeholder-slate-600 resize-none" />
              )}
            </div>
          </SubSection>

          {/* ── Beneficiaries ─────────────────────────────────────────────── */}
          <SubSection id="beneficiaries" title="Default Beneficiaries"
            open={openSections.has('beneficiaries')} onToggle={() => toggleSec('beneficiaries')}>
            <p className="text-xs text-slate-500 -mt-1">Default beneficiaries — can be overridden per case/application.</p>
            {(['Primary', 'Contingent'] as const).map(tier => {
              const arr   = tier === 'Primary' ? primBenes : contBenes
              const setArr = tier === 'Primary' ? setPrimBenes : setContBenes
              return (
                <div key={tier}>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{tier} beneficiaries</p>
                    <button onClick={() => setArr(p => [...p, { ...EMPTY_BENE }])}
                      className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 border border-slate-700 hover:border-slate-500 rounded-md px-2 py-1 transition-colors">
                      <Plus className="w-3 h-3" /> Add
                    </button>
                  </div>
                  {arr.length === 0 && <p className="text-xs text-slate-600 italic mb-2">None on file</p>}
                  {arr.map((bene, i) => (
                    <div key={i} className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-3 mb-2 space-y-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-slate-400 font-medium">{tier} #{i + 1}</span>
                        <button onClick={() => setArr(prev => prev.filter((_, j) => j !== i))}
                          className="text-slate-600 hover:text-red-400 transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div><label className="block text-xs text-slate-500 mb-1">Full name</label><input value={bene.name} onChange={e => setBene(arr, setArr, i, 'name', e.target.value)} className={inpSm} /></div>
                        <div><label className="block text-xs text-slate-500 mb-1">Relationship</label><input value={bene.relationship} onChange={e => setBene(arr, setArr, i, 'relationship', e.target.value)} placeholder="Spouse, child…" className={inpSm} /></div>
                        <div><label className="block text-xs text-slate-500 mb-1">% share</label><input value={bene.percentage} onChange={e => setBene(arr, setArr, i, 'percentage', e.target.value)} type="number" min="1" max="100" className={inpSm} /></div>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div><label className="block text-xs text-slate-500 mb-1">Date of birth</label><input value={bene.dob} onChange={e => setBene(arr, setArr, i, 'dob', e.target.value)} type="date" className={inpSm} /></div>
                        <div><label className="block text-xs text-slate-500 mb-1">SSN</label><input value={bene.ssn} onChange={e => setBene(arr, setArr, i, 'ssn', e.target.value)} placeholder="XXX-XX-XXXX" className={inpSm} /></div>
                        <div><label className="block text-xs text-slate-500 mb-1">Phone</label><input value={bene.phone} onChange={e => setBene(arr, setArr, i, 'phone', e.target.value)} type="tel" className={inpSm} /></div>
                      </div>
                      <div><label className="block text-xs text-slate-500 mb-1">Email</label><input value={bene.email} onChange={e => setBene(arr, setArr, i, 'email', e.target.value)} type="email" className={inpSm} /></div>
                    </div>
                  ))}
                </div>
              )
            })}
            <div><Label>Beneficiary notes / special instructions</Label>
              <textarea value={ff.bene_notes} onChange={e => set('bene_notes', e.target.value)}
                rows={2} placeholder="Trust as beneficiary, minor provisions, split instructions…"
                className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 placeholder-slate-600 resize-none" />
            </div>
          </SubSection>

          {/* ── Notes ─────────────────────────────────────────────────────── */}
          <SubSection id="notes" title="Fact Finder Notes"
            open={openSections.has('notes')} onToggle={() => toggleSec('notes')}>
            <textarea value={ff.ff_notes} onChange={e => set('ff_notes', e.target.value)}
              rows={3} placeholder="Additional context, clarifications, or follow-up items…"
              className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 placeholder-slate-600 resize-none" />
          </SubSection>

          {/* ── Footer ────────────────────────────────────────────────────── */}
          <div className="px-5 py-4 flex items-center gap-3 border-t border-slate-800 bg-slate-900/60">
            <button
              onClick={() => handleSave(false)}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg disabled:opacity-50 transition-colors"
            >
              {saving ? '…' : <><Check className="w-3.5 h-3.5" /> Save</>}
            </button>
            <button
              onClick={() => handleSave(true)}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-emerald-300 bg-emerald-900/30 hover:bg-emerald-900/50 border border-emerald-800 rounded-lg disabled:opacity-50 transition-colors"
            >
              <ShieldCheck className="w-3.5 h-3.5" /> Mark Verified
            </button>
            {saveMsg && (
              <span className={`text-xs flex items-center gap-1 ${saveMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                {saveMsg.ok ? <Check className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                {saveMsg.text}
              </span>
            )}
          </div>

        </div>
      )}
    </div>
  )
}
