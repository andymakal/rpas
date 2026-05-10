'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import Link from 'next/link'
import { ArrowLeft, Loader2 } from 'lucide-react'

type Agency = { id: string; agency_name: string }
type LSP = { id: string; agency_id: string; first_name: string; last_name: string }

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

export default function NewReferralPage() {
  const router = useRouter()
  const supabase = createClient()

  const [agencies, setAgencies] = useState<Agency[]>([])
  const [lsps, setLsps] = useState<LSP[]>([])
  const [loadingAgencies, setLoadingAgencies] = useState(true)
  const [loadingLsps, setLoadingLsps] = useState(false)

  const [agencyId, setAgencyId] = useState('')
  const [lspId, setLspId] = useState('')
  const [referralType, setReferralType] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [notes, setNotes] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadAgencies() {
      const { data } = await supabase
        .from('agencies')
        .select('id, agency_name')
        .eq('is_active', true)
        .order('agency_name')
      if (data) setAgencies(data)
      setLoadingAgencies(false)
    }
    loadAgencies()
  }, [])

  useEffect(() => {
    if (!agencyId) { setLsps([]); setLspId(''); return }
    setLoadingLsps(true)
    setLspId('')
    async function loadLsps() {
      const { data } = await supabase
        .from('lsps')
        .select('id, agency_id, first_name, last_name')
        .eq('agency_id', agencyId)
        .eq('is_active', true)
        .order('last_name')
      if (data) setLsps(data)
      setLoadingLsps(false)
    }
    loadLsps()
  }, [agencyId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    const { error } = await supabase.from('referrals').insert({
      agency_id:         agencyId,
      lsp_id:            lspId || null,
      referral_type:     referralType,
      client_first_name: firstName.trim(),
      client_last_name:  lastName.trim(),
      client_phone:      phone.trim(),
      client_email:      email.trim() || null,
      referral_notes:    notes.trim() || null,
      status:            'working',
    })

    if (error) { setError(error.message); setSubmitting(false); return }
    router.push('/referrals?success=1')
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
          <p className="text-slate-400 text-sm mt-1">Record a new referral from an agency partner</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <h2 className="text-white text-sm font-medium">Referral Source</h2>

            <div className="space-y-1.5">
              <Label className="text-slate-300 text-sm">Agency *</Label>
              {loadingAgencies ? (
                <p className="text-slate-500 text-sm py-2">Loading agencies...</p>
              ) : (
                <select required value={agencyId} onChange={e => setAgencyId(e.target.value)} className={selectCls}>
                  <option value="">Select agency...</option>
                  {agencies.map(a => (
                    <option key={a.id} value={a.id}>{a.agency_name}</option>
                  ))}
                </select>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-slate-300 text-sm">
                Staff Member <span className="text-slate-500 font-normal">— optional</span>
              </Label>
              <select
                value={lspId}
                onChange={e => setLspId(e.target.value)}
                disabled={!agencyId || loadingLsps}
                className={selectCls}
              >
                <option value="">
                  {!agencyId ? 'Select an agency first'
                    : loadingLsps ? 'Loading...'
                    : lsps.length === 0 ? 'No staff on file for this agency'
                    : 'Select staff member...'}
                </option>
                {lsps.map(l => (
                  <option key={l.id} value={l.id}>{l.first_name} {l.last_name}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-slate-300 text-sm">Referral Type *</Label>
              <select required value={referralType} onChange={e => setReferralType(e.target.value)} className={selectCls}>
                <option value="">Select type...</option>
                {REFERRAL_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
          </div>

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
                <Label className="text-slate-300 text-sm">Phone *</Label>
                <Input required type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="(570) 555-0100" className={inputCls} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">
                  Email <span className="text-slate-500 font-normal">— optional</span>
                </Label>
                <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="jane@email.com" className={inputCls} />
              </div>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
            <h2 className="text-white text-sm font-medium">
              Notes <span className="text-slate-500 font-normal">— optional</span>
            </h2>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Context, mortgage amount, urgency, anything useful for the first call..."
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
              {submitting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Logging...</> : 'Log Referral →'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}