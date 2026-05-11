'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { submitReferral, type SubmitReferralResult } from '@/app/actions/submit-referral'
import { step1Schema, step2Schema, step3Schema, type ReferralFormData } from '@/lib/schemas/referral'
import {
  REFERRAL_TYPES, MARITAL_STATUS_OPTIONS, CONTACT_METHOD_OPTIONS,
  CONTACT_TIME_OPTIONS, US_STATES,
} from '@/lib/constants/referral-options'

type Agency = { id: string; name: string }
type FieldErrors = Partial<Record<keyof ReferralFormData, string>>

type QualifyingFlags = {
  life_insurance_outside_work: boolean
  job_change_last_5_years: boolean
  review_401k: boolean
  retirement_prep: boolean
}

interface ReferralIntakeFormProps {
  prefilledAgencyId?: string
  prefilledAgencyName?: string
  agencySlug?: string
}

const EMPTY_FORM: ReferralFormData = {
  agency_id: '', lsp_name: '', client_first_name: '', client_last_name: '',
  client_phone: '', client_email: '', client_dob: '', client_marital_status: '',
  client_address: '', client_city: '', client_state: '', client_zip: '',
  referral_type: '', is_existing_client: false,
  preferred_contact: undefined, best_contact_time: undefined, notes: '',
  life_insurance_outside_work: false,
  job_change_last_5_years: false,
  review_401k: false,
  retirement_prep: false,
}

const STEP_SCHEMAS = [step1Schema, step2Schema, step3Schema]

const QUALIFYING_TRIGGERS = [
  {
    key: 'life_insurance_outside_work' as const,
    label: 'Did the client mention life insurance outside of work?',
    subtext: 'Employer coverage ends when employment does.',
  },
  {
    key: 'job_change_last_5_years' as const,
    label: 'Did the client change jobs in the last 5 years?',
    subtext: 'Job changes often leave 401(k)s and benefit gaps behind.',
  },
  {
    key: 'review_401k' as const,
    label: 'Did the client mention wanting a 401(k) review?',
    subtext: 'Many people are in the wrong funds for their timeline.',
  },
  {
    key: 'retirement_prep' as const,
    label: 'Is the client actively preparing for retirement?',
    subtext: 'Social Security timing, RMDs, and Medicare have critical decision windows.',
  },
]

function getTalkPath(flags: QualifyingFlags) {
  if (flags.retirement_prep) return {
    icon: '🗓️',
    headline: 'Retirement Planning Conversation',
    body: 'Social Security timing, Medicare enrollment, and RMD planning all have critical decision windows. Your advisor will walk through the Right Path retirement sequence.',
  }
  if (flags.review_401k || flags.job_change_last_5_years) return {
    icon: '💼',
    headline: '401(k) & Benefits Review',
    body: 'Old retirement accounts and benefit gaps from job changes are some of the most overlooked financial risks. Your advisor will help get a clear picture.',
  }
  if (flags.life_insurance_outside_work) return {
    icon: '🛡️',
    headline: 'Personal Life Insurance Review',
    body: "Group coverage through work is a starting point — not a plan. Your advisor will help identify what's actually needed.",
  }
  return null
}

function StepBar({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-2 mb-6">
      {Array.from({ length: total }, (_, i) => (
        <div key={i} className="flex items-center gap-2 flex-1">
          <div className={`h-2 flex-1 rounded-full transition-all duration-300 ${
            i < current ? 'bg-slate-800' : i === current ? 'bg-slate-500' : 'bg-slate-200'
          }`} />
        </div>
      ))}
    </div>
  )
}

function Field({ label, error, required, hint, children }: {
  label: string; error?: string; required?: boolean; hint?: string; children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-slate-700">
        {label}{required && <span className="text-red-500 ml-1">*</span>}
      </label>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
      {children}
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  )
}

function Input({
  value, onChange, error, type, placeholder, autoComplete, inputMode, maxLength, disabled,
}: {
  value: string; onChange: (v: string) => void; error?: string; type?: string;
  placeholder?: string; autoComplete?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  maxLength?: number; disabled?: boolean
}) {
  return (
    <input
      value={value} onChange={(e) => onChange(e.target.value)}
      type={type} placeholder={placeholder} autoComplete={autoComplete}
      inputMode={inputMode} maxLength={maxLength} disabled={disabled}
      className={`w-full rounded-lg border px-4 py-3 text-base text-slate-900 placeholder-slate-400
        focus:outline-none focus:ring-2 focus:ring-slate-800 focus:border-transparent transition-colors
        ${error ? 'border-red-400 bg-red-50' : 'border-slate-300 bg-white hover:border-slate-400'}`}
    />
  )
}

function Select({ value, onChange, options, placeholder, error }: {
  value: string; onChange: (v: string) => void;
  options: readonly { value: string; label: string }[];
  placeholder?: string; error?: string
}) {
  return (
    <select
      value={value} onChange={(e) => onChange(e.target.value)}
      className={`w-full rounded-lg border px-4 py-3 text-base focus:outline-none focus:ring-2
        focus:ring-slate-800 focus:border-transparent transition-colors appearance-none bg-white
        ${error ? 'border-red-400 bg-red-50' : 'border-slate-300 hover:border-slate-400'}
        ${!value ? 'text-slate-400' : 'text-slate-900'}`}
    >
      {placeholder && <option value="" disabled>{placeholder}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

function Toggle({ checked, onChange, label, description }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; description?: string
}) {
  return (
    <button type="button" onClick={() => onChange(!checked)}
      className={`w-full flex items-center justify-between p-4 rounded-lg border-2 transition-all
        ${checked ? 'border-slate-800 bg-slate-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}
    >
      <div className="text-left">
        <p className={`text-sm font-medium ${checked ? 'text-slate-900' : 'text-slate-700'}`}>{label}</p>
        {description && <p className="text-xs text-slate-500 mt-0.5">{description}</p>}
      </div>
      <div className={`w-12 h-6 rounded-full transition-all flex-shrink-0 ml-4 ${checked ? 'bg-slate-800' : 'bg-slate-300'}`}>
        <div className={`w-5 h-5 bg-white rounded-full shadow mt-0.5 transition-all ${checked ? 'translate-x-6' : 'translate-x-0.5'}`} />
      </div>
    </button>
  )
}

function OptionGrid({ options, value, onChange }: {
  options: readonly { value: string; label: string }[];
  value: string | undefined; onChange: (v: string) => void
}) {
  return (
    <div className="grid grid-cols-1 gap-2">
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value === value ? '' : o.value)}
          className={`px-4 py-3 rounded-lg border-2 text-sm font-medium text-left transition-all
            ${value === o.value
              ? 'border-slate-800 bg-slate-800 text-white'
              : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function CheckboxTrigger({ checked, onChange, label, subtext }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; subtext: string
}) {
  return (
    <label className="flex items-start gap-3 p-3 rounded-lg border border-slate-200 hover:border-slate-400 cursor-pointer transition-colors">
      <input
        type="checkbox" checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-slate-800"
      />
      <div>
        <p className="text-sm font-medium text-slate-800">{label}</p>
        <p className="text-xs text-slate-500 mt-0.5">{subtext}</p>
      </div>
    </label>
  )
}

function ConfirmationScreen({ result, qualifyingFlags, onAnother }: {
  result: Extract<SubmitReferralResult, { success: true }>
  qualifyingFlags: QualifyingFlags
  onAnother: () => void
}) {
  const talkPath = getTalkPath(qualifyingFlags)

  return (
    <div className="text-center py-8 space-y-6">
      <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto">
        <svg className="w-10 h-10 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-slate-900">Referral Submitted</h2>
        <p className="text-slate-600">
          We've received your referral for{' '}
          <span className="font-semibold text-slate-900">{result.client_name}</span>.
        </p>
      </div>

      {talkPath && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-5 text-left space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-2xl">{talkPath.icon}</span>
            <p className="text-sm font-semibold text-blue-900">{talkPath.headline}</p>
          </div>
          <p className="text-sm text-blue-800">{talkPath.body}</p>
        </div>
      )}

      <div className="bg-slate-50 rounded-xl p-5 text-left space-y-3">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">What happens next</p>
        <div className="space-y-2 text-sm text-slate-700">
          <div className="flex gap-3">
            <span className="text-slate-400 flex-shrink-0">01</span>
            <span>Our team has been notified — response clock is running</span>
          </div>
          <div className="flex gap-3">
            <span className="text-slate-400 flex-shrink-0">02</span>
            <span>We'll reach out to {result.client_name} within 5 minutes during business hours</span>
          </div>
          <div className="flex gap-3">
            <span className="text-slate-400 flex-shrink-0">03</span>
            <span>You'll hear from us when the case places — that's your SPIFF trigger</span>
          </div>
        </div>
      </div>
      <p className="text-xs text-slate-400">
        Reference: <span className="font-mono">{result.referral_id.slice(0, 8).toUpperCase()}</span>
      </p>
      <button onClick={onAnother}
        className="w-full py-3 px-6 rounded-xl border-2 border-slate-800 text-slate-800
          font-semibold hover:bg-slate-800 hover:text-white transition-all">
        Submit Another Referral
      </button>
    </div>
  )
}

export function ReferralIntakeForm({
  prefilledAgencyId,
  prefilledAgencyName,
  agencySlug,
}: ReferralIntakeFormProps = {}) {
  const [step, setStep] = useState(0)
  const [form, setForm] = useState<ReferralFormData>({
    ...EMPTY_FORM,
    agency_id: prefilledAgencyId ?? '',
  })
  const [errors, setErrors] = useState<FieldErrors>({})
  const [agencies, setAgencies] = useState<Agency[]>([])
  const [agenciesLoading, setAgenciesLoading] = useState(!prefilledAgencyId)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<SubmitReferralResult | null>(null)

  // Pre-fill LSP name from localStorage
  useEffect(() => {
    if (!agencySlug) return
    const savedName = localStorage.getItem(`rpas_lsp_${agencySlug}`)
    if (savedName) setForm((prev) => ({ ...prev, lsp_name: savedName }))
  }, [agencySlug])

  // Load agencies only if not prefilled
  useEffect(() => {
    if (prefilledAgencyId) return
    async function loadAgencies() {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('agencies').select('id, agency_name').eq('is_active', true).order('agency_name')
      if (!error && data) setAgencies(data.map(a => ({ id: a.id, name: a.agency_name })))
      setAgenciesLoading(false)
    }
    loadAgencies()
  }, [prefilledAgencyId])

  function set<K extends keyof ReferralFormData>(key: K, value: ReferralFormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setErrors((prev) => ({ ...prev, [key]: undefined }))
  }

  function validateStep(s: number): boolean {
    const parsed = STEP_SCHEMAS[s].safeParse(form)
    if (parsed.success) { setErrors({}); return true }
    const newErrors: FieldErrors = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof ReferralFormData
      if (!newErrors[key]) newErrors[key] = issue.message
    }
    setErrors(newErrors)
    return false
  }

  function next() { if (validateStep(step)) setStep((s) => s + 1) }
  function back() { setErrors({}); setStep((s) => s - 1) }

  async function handleSubmit() {
    if (!validateStep(2)) return
    setSubmitting(true)
    const res = await submitReferral(form)
    if (res.success && agencySlug && form.lsp_name) {
      localStorage.setItem(`rpas_lsp_${agencySlug}`, form.lsp_name)
    }
    setResult(res)
    setSubmitting(false)
  }

  function reset() { 
    setForm({ ...EMPTY_FORM, agency_id: prefilledAgencyId ?? '' })
    setErrors({})
    setStep(0)
    setResult(null)
  }

  if (result?.success) return (
    <ConfirmationScreen
      result={result}
      qualifyingFlags={{
        life_insurance_outside_work: form.life_insurance_outside_work,
        job_change_last_5_years:     form.job_change_last_5_years,
        review_401k:                 form.review_401k,
        retirement_prep:             form.retirement_prep,
      }}
      onAnother={reset}
    />
  )

  const stepContent = [
    <div key="step1" className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Who's referring?</h2>
        <p className="text-sm text-slate-500 mt-1">Your agency and name, so we credit the right team</p>
      </div>

      <Field label="Agency" required error={errors.agency_id}>
        {prefilledAgencyId ? (
          <div className="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-base text-slate-700">
            {prefilledAgencyName}
          </div>
        ) : agenciesLoading ? (
          <div className="w-full rounded-lg border border-slate-300 px-4 py-3 text-slate-400">
            Loading agencies...
          </div>
        ) : (
          <Select value={form.agency_id} onChange={(v) => set('agency_id', v)}
            options={agencies.map((a) => ({ value: a.id, label: a.name }))}
            placeholder="Select your agency" error={errors.agency_id} />
        )}
      </Field>

      <Field label="Your Name" required hint="First Last — exactly as you want it recorded" error={errors.lsp_name}>
        <Input value={form.lsp_name} onChange={(v) => set('lsp_name', v)}
          placeholder="e.g. Kris Aley" autoComplete="name" error={errors.lsp_name} />
      </Field>
    </div>,

    <div key="step2" className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Client information</h2>
        <p className="text-sm text-slate-500 mt-1">Tell us about the person you're referring</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="First Name" required error={errors.client_first_name}>
          <Input value={form.client_first_name} onChange={(v) => set('client_first_name', v)}
            placeholder="Jane" error={errors.client_first_name} />
        </Field>
        <Field label="Last Name" required error={errors.client_last_name}>
          <Input value={form.client_last_name} onChange={(v) => set('client_last_name', v)}
            placeholder="Smith" error={errors.client_last_name} />
        </Field>
      </div>
      <Field label="Phone Number" required error={errors.client_phone}>
        <Input value={form.client_phone} onChange={(v) => set('client_phone', v)}
          type="tel" placeholder="(570) 555-0100" inputMode="tel" error={errors.client_phone} />
      </Field>
      <Field label="Email Address" hint="Optional — but helps us reach them faster" error={errors.client_email}>
        <Input value={form.client_email ?? ''} onChange={(v) => set('client_email', v)}
          type="email" placeholder="jane.smith@email.com" inputMode="email" error={errors.client_email} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date of Birth" error={errors.client_dob}>
          <Input value={form.client_dob ?? ''} onChange={(v) => set('client_dob', v)}
            type="date" error={errors.client_dob} />
        </Field>
        <Field label="Marital Status" error={errors.client_marital_status}>
          <Select value={form.client_marital_status ?? ''} onChange={(v) => set('client_marital_status', v)}
            options={MARITAL_STATUS_OPTIONS} placeholder="Select" error={errors.client_marital_status} />
        </Field>
      </div>
      <Field label="Street Address" required error={errors.client_address}>
        <Input value={form.client_address} onChange={(v) => set('client_address', v)}
          placeholder="123 Main St" autoComplete="street-address" error={errors.client_address} />
      </Field>
      <div className="grid grid-cols-6 gap-3">
        <div className="col-span-3">
          <Field label="City" required error={errors.client_city}>
            <Input value={form.client_city} onChange={(v) => set('client_city', v)}
              placeholder="Bloomsburg" error={errors.client_city} />
          </Field>
        </div>
        <div className="col-span-2">
          <Field label="State" required error={errors.client_state}>
            <Select value={form.client_state} onChange={(v) => set('client_state', v)}
              options={US_STATES} placeholder="PA" error={errors.client_state} />
          </Field>
        </div>
        <div className="col-span-1">
          <Field label="ZIP" required error={errors.client_zip}>
            <Input value={form.client_zip} onChange={(v) => set('client_zip', v)}
              placeholder="17815" inputMode="numeric" maxLength={10} error={errors.client_zip} />
          </Field>
        </div>
      </div>
    </div>,

    <div key="step3" className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Referral details</h2>
        <p className="text-sm text-slate-500 mt-1">Help us get to the right person fast</p>
      </div>
      <Field label="Referral Type" required error={errors.referral_type}>
        <Select value={form.referral_type} onChange={(v) => set('referral_type', v)}
          options={REFERRAL_TYPES} placeholder="What brought them to you?" error={errors.referral_type} />
      </Field>
      <Toggle checked={form.is_existing_client} onChange={(v) => set('is_existing_client', v)}
        label="Existing Client" description="This person already has a policy or account with us" />
      <Field label="Best Way to Reach Them">
        <OptionGrid options={CONTACT_METHOD_OPTIONS} value={form.preferred_contact}
          onChange={(v) => set('preferred_contact', v as ReferralFormData['preferred_contact'])} />
      </Field>
      <Field label="Best Time to Reach Them">
        <OptionGrid options={CONTACT_TIME_OPTIONS} value={form.best_contact_time}
          onChange={(v) => set('best_contact_time', v as ReferralFormData['best_contact_time'])} />
      </Field>
      <Field label="Notes" hint="Context that helps us make a great first impression" error={errors.notes}>
        <textarea value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)}
          placeholder="Just bought a $400K home, has 2 kids, mentioned they've been meaning to look at life insurance..."
          rows={4} maxLength={500}
          className="w-full rounded-lg border border-slate-300 px-4 py-3 text-base text-slate-900
            placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-800
            focus:border-transparent hover:border-slate-400 transition-colors resize-none" />
        <p className="text-xs text-slate-400 text-right mt-1">{(form.notes ?? '').length}/500</p>
      </Field>

      <div className="space-y-2">
        <p className="text-sm font-medium text-slate-700">Quick Check-In</p>
        <p className="text-xs text-slate-500">Check any that apply — helps us start the right conversation</p>
        <div className="space-y-2 pt-1">
          {QUALIFYING_TRIGGERS.map(({ key, label, subtext }) => (
            <CheckboxTrigger key={key} checked={form[key]}
              onChange={(v) => set(key, v)} label={label} subtext={subtext} />
          ))}
        </div>
      </div>

      {result && !result.success && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {result.error}
        </div>
      )}
    </div>,
  ]

  return (
    <div className="space-y-6">
      <StepBar current={step} total={3} />
      {stepContent[step]}
      <div className="flex gap-3 pt-2">
        {step > 0 && (
          <button type="button" onClick={back}
            className="flex-1 py-4 rounded-xl border-2 border-slate-300 text-slate-700
              font-semibold hover:border-slate-400 transition-all text-base">
            Back
          </button>
        )}
        <button type="button" onClick={step < 2 ? next : handleSubmit} disabled={submitting}
          className="flex-1 py-4 rounded-xl bg-slate-800 text-white font-semibold
            hover:bg-slate-700 active:bg-slate-900 transition-all text-base
            disabled:opacity-60 disabled:cursor-not-allowed">
          {submitting ? 'Submitting...' : step < 2 ? 'Continue →' : 'Submit Referral'}
        </button>
      </div>
      <p className="text-center text-xs text-slate-400">
        Step {step + 1} of 3 · Right Path Agency System
      </p>
    </div>
  )
  
}