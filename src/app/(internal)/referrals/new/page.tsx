'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { logCase, type LeadSource } from '@/app/actions/log-case'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import Link from 'next/link'
import { ArrowLeft, Loader2, Flame } from 'lucide-react'
import { US_STATES } from '@/lib/constants/referral-options'

type Agency = { id: string; name: string; display_name: string | null }
type Agent  = { id: string; agency_id: string; first_name: string; last_name: string }

const supabase = createClient()

const LEAD_SOURCES: { value: LeadSource; label: string; description: string }[] = [
  { value: 'agency_referral', label: 'Agency Referral',   description: 'Submitted by an LSP at a partner P&C agency' },
  { value: 'allstate_web',    label: 'Allstate.com Lead', description: 'Assigned from Allstate.com inquiry' },
  { value: 'self_generated',  label: 'Self Generated',    description: 'Makal-sourced, no partner agency' },
]

const REFERRAL_TYPES: { value: string; label: string }[] = [
  { value: 'mortgage_protection', label: 'Mortgage Protection' },
  { value: 'life_review',         label: 'Life Review' },
  { value: 'financial_planning',  label: 'Financial Planning' },
  { value: 'annuity_review',      label: 'Annuity Review' },
  { value: 'uit_rollover',        label: 'UIT Rollover' },
  { value: '1035_exchange',       label: '1035 Exchange' },
  { value: 'wanderer_review',     label: 'Wanderer Review' },
  { value: 'term_expiry',         label: 'Term Expiry' },
  { value: 'tobacco_rerate',      label: 'Tobacco Rerate' },
  { value: 'business_owner',      label: 'Business Owner' },
  { value: 'umbrella_flagged',    label: 'Umbrella Flagged' },
  { value: 'general',             label: 'General' },
]

function formatPhone(v: string): string {
  const digits = v.replace(/\D/g, '').slice(0, 10)
  if (digits.length < 4) return digits
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

const PREFERRED_CONTACT_OPTIONS = [
  { value: 'phone',  label: 'Phone call' },
  { value: 'text',   label: 'Text message' },
  { value: 'email',  label: 'Email' },
  { value: 'any',    label: 'Any' },
]

const BEST_TIME_OPTIONS = [
  { value: 'mornings',    label: 'Mornings' },
  { value: 'afternoons',  label: 'Afternoons' },
  { value: 'evenings',    label: 'Evenings' },
  { value: 'anytime',     label: 'Anytime' },
]

export default function NewReferralPage() {
  const router = useRouter()

  // Source
  const [leadSource,   setLeadSource]   = useState<LeadSource>('agency_referral')
  const [agencies,     setAgencies]     = useState<Agency[]>([])
  const [agents,       setAgents]       = useState<Agent[]>([])
  const [loadingAgencies, setLoadingAgencies] = useState(true)
  const [loadingAgents,   setLoadingAgents]   = useState(false)
  const [agencyId, setAgencyId] = useState('')
  const [agentId,  setAgentId]  = useState('')

  // Contact
  const [firstName,     setFirstName]     = useState('')
  const [lastName,      setLastName]      = useState('')
  const [phone,         setPhone]         = useState('')
  const [email,         setEmail]         = useState('')
  const [dob,           setDob]           = useState('')
  const [street,        setStreet]        = useState('')
  const [city,          setCity]          = useState('')
  const [state,         setState]         = useState('')
  const [zip,           setZip]           = useState('')

  // Referral details
  const [referralType,     setReferralType]     = useState('')
  const [isHotLead,        setIsHotLead]        = useState(false)
  const [preferredContact, setPreferredContact] = useState('')
  const [bestContactTime,  setBestContactTime]  = useState('')

  // Qualifying flags
  const [lifeInsuranceOutsideWork, setLifeInsuranceOutsideWork] = useState(false)
  const [jobChange,                setJobChange]                = useState(false)
  const [review401k,               setReview401k]               = useState(false)
  const [retirementPrep,           setRetirementPrep]           = useState(false)

  // Other flags
  const [spanishSpeaking, setSpanishSpeaking] = useState(false)

  // Notes
  const [notes, setNotes] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [error,      setError]      = useState<string | null>(null)

  const needsAgency = leadSource === 'agency_referral'

  useEffect(() => {
    async function loadAgencies() {
      const { data } = await supabase
        .from('agencies')
        .select('id, name, display_name')
        .eq('is_active', true)
        .order('name')
      if (data) setAgencies(data)
      setLoadingAgencies(false)
    }
    loadAgencies()
  }, [])

  useEffect(() => {
    if (!agencyId) { setAgents([]); setAgentId(''); return }
    setLoadingAgents(true)
    setAgentId('')
    async function loadAgents() {
      const { data } = await supabase
        .from('agents')
        .select('id, agency_id, first_name, last_name')
        .eq('agency_id', agencyId)
        .eq('is_active', true)
        .order('last_name')
      if (data) setAgents(data)
      setLoadingAgents(false)
    }
    loadAgents()
  }, [agencyId])

  function handleLeadSourceChange(source: LeadSource) {
    setLeadSource(source)
    if (source !== 'agency_referral') {
      setAgencyId('')
      setAgentId('')
      setAgents([])
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    const result = await logCase({
      agency_id:     needsAgency ? agencyId : undefined,
      agent_id:      agentId || undefined,
      lead_source:   leadSource,
      first_name:    firstName.trim(),
      last_name:     lastName.trim(),
      phone:         phone.trim(),
      email:         email.trim() || undefined,
      dob:           dob || undefined,
      street:        street.trim() || undefined,
      city:          city.trim() || undefined,
      state:         state || undefined,
      zip:           zip.trim() || undefined,
      spanish_speaking: spanishSpeaking,
      referral_type: referralType,
      is_hot_lead:   isHotLead,
      preferred_contact:         preferredContact || undefined,
      best_contact_time:         bestContactTime  || undefined,
      life_insurance_outside_work: lifeInsuranceOutsideWork,
      job_change_last_5_years:     jobChange,
      review_401k:                 review401k,
      retirement_prep:             retirementPrep,
      notes:         notes.trim() || undefined,
    })

    if (!result.success) { setError(result.error); setSubmitting(false); return }
    router.push(`/referrals/${result.case_id}`)
  }

  const inputCls  = 'bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 h-9'
  const selectCls = 'w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-slate-500 disabled:opacity-40 disabled:cursor-not-allowed'

  return (
    <div className="p-8">
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <Link href="/referrals" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 mb-4">
            <ArrowLeft className="w-4 h-4" /> Back to Referrals
          </Link>
          <h1 className="text-white text-2xl font-semibold">Log a Referral</h1>
          <p className="text-slate-400 text-sm mt-1">Record a new referral or self-generated lead</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">

          {/* Lead Source */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
            <h2 className="text-white text-sm font-medium">Lead Source</h2>
            <div className="grid grid-cols-3 gap-2">
              {LEAD_SOURCES.map(s => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => handleLeadSourceChange(s.value)}
                  className={`flex flex-col gap-1 p-3 rounded-lg border-2 text-left transition-all ${
                    leadSource === s.value
                      ? 'border-blue-500 bg-blue-950/40'
                      : 'border-slate-700 hover:border-slate-600'
                  }`}
                >
                  <span className={`text-xs font-semibold ${leadSource === s.value ? 'text-blue-300' : 'text-slate-300'}`}>
                    {s.label}
                  </span>
                  <span className="text-xs text-slate-500 leading-snug">{s.description}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Referral Source — agency referrals only */}
          {needsAgency && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
              <h2 className="text-white text-sm font-medium">Referral Source</h2>

              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">Agency *</Label>
                {loadingAgencies ? (
                  <p className="text-slate-500 text-sm py-2">Loading agencies...</p>
                ) : (
                  <select required={needsAgency} value={agencyId} onChange={e => setAgencyId(e.target.value)} className={selectCls}>
                    <option value="">Select agency...</option>
                    {agencies.map(a => (
                      <option key={a.id} value={a.id}>{a.display_name ?? a.name}</option>
                    ))}
                  </select>
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">LSP Name *</Label>
                <select
                  required={needsAgency}
                  value={agentId}
                  onChange={e => setAgentId(e.target.value)}
                  disabled={!agencyId || loadingAgents}
                  className={selectCls}
                >
                  <option value="">
                    {!agencyId ? 'Select an agency first'
                      : loadingAgents ? 'Loading...'
                      : agents.length === 0 ? 'No LSPs on file for this agency'
                      : 'Select LSP...'}
                  </option>
                  {agents.map(a => (
                    <option key={a.id} value={a.id}>{a.first_name} {a.last_name}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Referral Type */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
            <h2 className="text-white text-sm font-medium">Referral Type</h2>
            <select required value={referralType} onChange={e => setReferralType(e.target.value)} className={selectCls}>
              <option value="">Select type...</option>
              {REFERRAL_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          {/* Contact Information */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <h2 className="text-white text-sm font-medium">Contact Information</h2>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">First Name *</Label>
                <Input required value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="Jane" className={inputCls} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">Last Name *</Label>
                <Input required value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Smith" className={inputCls} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">Date of Birth *</Label>
                <Input required type="date" value={dob} onChange={e => setDob(e.target.value)} className={inputCls} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">Phone *</Label>
                <Input required type="tel" value={phone} onChange={e => setPhone(formatPhone(e.target.value))} placeholder="(570) 555-0100" className={inputCls} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-slate-300 text-sm">
                Email <span className="text-slate-500 font-normal">— optional</span>
              </Label>
              <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="jane@email.com" className={inputCls} />
            </div>

            <div className="space-y-1.5">
              <Label className="text-slate-300 text-sm">Street Address *</Label>
              <Input required value={street} onChange={e => setStreet(e.target.value)} placeholder="123 Main St" className={inputCls} />
            </div>

            <div className="grid grid-cols-6 gap-3">
              <div className="col-span-3 space-y-1.5">
                <Label className="text-slate-300 text-sm">City *</Label>
                <Input required value={city} onChange={e => setCity(e.target.value)} placeholder="Scranton" className={inputCls} />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label className="text-slate-300 text-sm">State *</Label>
                <select required value={state} onChange={e => setState(e.target.value)} className={selectCls}>
                  <option value="">—</option>
                  {US_STATES.map(s => (
                    <option key={s.value} value={s.value}>{s.value}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-1 space-y-1.5">
                <Label className="text-slate-300 text-sm">ZIP *</Label>
                <Input required value={zip} onChange={e => setZip(e.target.value)} placeholder="18503" className={inputCls} />
              </div>
            </div>
          </div>

          {/* Contact Preference */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <h2 className="text-white text-sm font-medium">Contact Preference</h2>

            <div className="space-y-2">
              <Label className="text-slate-300 text-sm">Preferred contact method</Label>
              <div className="flex gap-2 flex-wrap">
                {PREFERRED_CONTACT_OPTIONS.map(o => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setPreferredContact(preferredContact === o.value ? '' : o.value)}
                    className={`rounded-lg px-3 py-2 text-sm font-medium border transition-all ${
                      preferredContact === o.value
                        ? 'border-blue-500 bg-blue-950/40 text-blue-300'
                        : 'border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-200'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-slate-300 text-sm">Best time to reach them</Label>
              <div className="flex gap-2 flex-wrap">
                {BEST_TIME_OPTIONS.map(o => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setBestContactTime(bestContactTime === o.value ? '' : o.value)}
                    className={`rounded-lg px-3 py-2 text-sm font-medium border transition-all ${
                      bestContactTime === o.value
                        ? 'border-blue-500 bg-blue-950/40 text-blue-300'
                        : 'border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-200'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Qualifying Flags */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
            <h2 className="text-white text-sm font-medium">Qualifying Flags</h2>
            <p className="text-xs text-slate-500">Check anything that applies — helps prioritize and route the conversation</p>
            <div className="space-y-2.5">
              {([
                { key: 'lifeInsuranceOutsideWork', label: 'Life insurance outside of work', checked: lifeInsuranceOutsideWork, set: setLifeInsuranceOutsideWork },
                { key: 'jobChange',                label: 'Job change in the last 5 years',  checked: jobChange,                set: setJobChange },
                { key: 'review401k',               label: '401(k) or retirement account review', checked: review401k,           set: setReview401k },
                { key: 'retirementPrep',           label: 'Retirement planning / prep',      checked: retirementPrep,           set: setRetirementPrep },
              ] as const).map(f => (
                <label key={f.key} className="flex items-center gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={f.checked}
                    onChange={e => f.set(e.target.checked)}
                    className="h-4 w-4 rounded accent-blue-500 cursor-pointer"
                  />
                  <span className="text-sm text-slate-300 group-hover:text-white transition-colors">{f.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Other Flags */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
            <h2 className="text-white text-sm font-medium">Additional Flags</h2>
            <div className="space-y-2.5">

              {/* Hot lead */}
              <label className={`flex items-start gap-3 rounded-lg border-2 p-3 cursor-pointer transition-all ${
                isHotLead ? 'border-orange-700 bg-orange-950/30' : 'border-slate-700 hover:border-slate-600'
              }`}>
                <input
                  type="checkbox"
                  checked={isHotLead}
                  onChange={e => setIsHotLead(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded accent-orange-500 cursor-pointer"
                />
                <div>
                  <div className="flex items-center gap-1.5">
                    <Flame className={`w-3.5 h-3.5 ${isHotLead ? 'text-orange-400' : 'text-slate-500'}`} />
                    <p className={`text-sm font-medium ${isHotLead ? 'text-orange-300' : 'text-slate-200'}`}>Hot Lead</p>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">Client expressed strong interest — high urgency, prioritize first contact</p>
                </div>
              </label>

              {/* Spanish speaking */}
              <label className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={spanishSpeaking}
                  onChange={e => setSpanishSpeaking(e.target.checked)}
                  className="h-4 w-4 rounded accent-blue-500 cursor-pointer"
                />
                <div>
                  <p className="text-sm font-medium text-slate-200 group-hover:text-white transition-colors">
                    Spanish Speaking
                  </p>
                  <p className="text-xs text-slate-500">Client&apos;s primary language is Spanish</p>
                </div>
              </label>

            </div>
          </div>

          {/* Notes */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
            <h2 className="text-white text-sm font-medium">
              Notes <span className="text-slate-500 font-normal">— optional</span>
            </h2>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Context, urgency, anything useful for the first call..."
              rows={3}
              className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500 resize-none"
            />
          </div>

          {error && (
            <div className="bg-red-950 border border-red-800 text-red-300 text-sm p-3 rounded-md">{error}</div>
          )}

          <div className="flex items-center justify-between pt-1">
            <Link href="/referrals" className="text-sm text-slate-400 hover:text-slate-200 transition-colors">
              Cancel
            </Link>
            <Button type="submit" disabled={submitting} className="text-white px-6 font-medium" style={{ backgroundColor: '#1F3864' }}>
              {submitting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : 'Log Referral'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
