'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Phone, Building2, User, Calendar, Clock, MessageSquare } from 'lucide-react'
import type { ReferralDetail, Tier1Stage } from './page'

const APPT_STATUSES = new Set(['appointment_set', 'appointment_kept', 'appointment_missed'])

function daysAgo(iso: string | null): number | null {
  if (!iso) return null
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

function fmt(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtRelative(iso: string | null): string {
  if (!iso) return 'Never'
  const d = daysAgo(iso)
  if (d === 0) return 'Today'
  if (d === 1) return 'Yesterday'
  return `${d} days ago`
}

function StatusBadge({ st }: { st: ReferralDetail['stage_translations'] }) {
  if (!st) return null
  let cls = 'bg-blue-900/50 text-blue-300 border border-blue-800'
  if (st.is_won) cls = 'bg-emerald-900/60 text-emerald-300 border border-emerald-700'
  if (st.is_lost) cls = 'bg-slate-800/70 text-slate-400 border border-slate-700'
  return (
    <span className={`inline-flex items-center rounded px-2.5 py-1 text-xs font-medium ${cls}`}>
      {st.agency_label}
    </span>
  )
}

type Props = {
  referral: ReferralDetail
  stages: Tier1Stage[]
}

export function ReferralEditClient({ referral, stages }: Props) {
  const router = useRouter()

  const [status, setStatus] = useState(referral.internal_status)
  const [appointmentDate, setAppointmentDate] = useState(
    referral.appointment_date ? referral.appointment_date.split('T')[0] : ''
  )
  const [notes, setNotes] = useState(referral.notes ?? '')
  const [touches, setTouches] = useState(referral.touches ?? 0)
  const [lastContact, setLastContact] = useState(referral.last_contact_at)

  const [saving, setSaving] = useState(false)
  const [logging, setLogging] = useState(false)
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const showApptDate = APPT_STATUSES.has(status)

  const clientName = referral.customers
    ? `${referral.customers.first_name} ${referral.customers.last_name}`
    : 'Unknown'

  const agencyName = referral.agencies?.display_name ?? referral.agencies?.name ?? '—'

  const agentName = referral.agents
    ? `${referral.agents.first_name} ${referral.agents.last_name}`
    : null

  async function handleSave() {
    setSaving(true)
    setSaveMsg(null)

    const body: Record<string, unknown> = { internal_status: status, notes: notes || null }
    if (showApptDate) body.appointment_date = appointmentDate || null

    try {
      const res = await fetch(`/api/cases/${referral.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = await res.json()
        setSaveMsg({ ok: false, text: j.error ?? 'Save failed' })
      } else {
        setSaveMsg({ ok: true, text: 'Saved' })
        router.refresh()
        setTimeout(() => setSaveMsg(null), 2000)
      }
    } catch {
      setSaveMsg({ ok: false, text: 'Network error' })
    } finally {
      setSaving(false)
    }
  }

  async function handleLogTouch() {
    setLogging(true)
    try {
      const res = await fetch(`/api/cases/${referral.id}/touch`, { method: 'POST' })
      if (res.ok) {
        const { data } = await res.json()
        setTouches(data.touches)
        setLastContact(data.last_contact_at)
      }
    } finally {
      setLogging(false)
    }
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/referrals"
          className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 mb-4 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Referrals
        </Link>

        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-white text-2xl font-semibold">{clientName}</h1>
            <div className="mt-1.5">
              <StatusBadge st={referral.stage_translations} />
            </div>
          </div>

          <button
            onClick={handleLogTouch}
            disabled={logging}
            className="flex-shrink-0 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white bg-slate-700 hover:bg-slate-600 transition-colors disabled:opacity-50"
          >
            <Phone className="w-4 h-4" />
            {logging ? 'Logging…' : 'Log a Touch'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left — read-only info */}
        <div className="space-y-5">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide">Contact Info</h2>

            {referral.customers?.phone && (
              <div className="flex items-center gap-2.5">
                <Phone className="w-4 h-4 text-slate-500 flex-shrink-0" />
                <span className="text-slate-200 text-sm">{referral.customers.phone}</span>
              </div>
            )}

            <div className="flex items-center gap-2.5">
              <Building2 className="w-4 h-4 text-slate-500 flex-shrink-0" />
              <span className="text-slate-200 text-sm">{agencyName}</span>
            </div>

            {agentName && (
              <div className="flex items-center gap-2.5">
                <User className="w-4 h-4 text-slate-500 flex-shrink-0" />
                <span className="text-slate-200 text-sm">{agentName}</span>
              </div>
            )}

            <div className="flex items-center gap-2.5">
              <Calendar className="w-4 h-4 text-slate-500 flex-shrink-0" />
              <span className="text-slate-200 text-sm">{fmt(referral.created_at)}</span>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide">Activity</h2>

            <div className="flex items-center gap-2.5">
              <Phone className="w-4 h-4 text-slate-500 flex-shrink-0" />
              <div>
                <p className="text-slate-200 text-sm">{touches} touch{touches !== 1 ? 'es' : ''}</p>
                <p className="text-xs text-slate-500">Last: {fmtRelative(lastContact)}</p>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              <Clock className="w-4 h-4 text-slate-500 flex-shrink-0" />
              <div>
                <p className="text-xs text-slate-500">In system since</p>
                <p className="text-slate-200 text-sm">{fmt(referral.created_at)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Right — editable fields */}
        <div className="md:col-span-2 space-y-5">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-5">
            <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide">Update Referral</h2>

            {/* Status */}
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Status</label>
              <select
                value={status}
                onChange={e => setStatus(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-slate-500"
              >
                {stages.map(s => (
                  <option key={s.id} value={s.internal_status}>{s.agency_label}</option>
                ))}
              </select>
            </div>

            {/* Appointment date — only when relevant */}
            {showApptDate && (
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Appointment Date</label>
                <input
                  type="date"
                  value={appointmentDate}
                  onChange={e => setAppointmentDate(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-slate-500"
                />
              </div>
            )}

            {/* Notes */}
            <div>
              <label className="block text-xs text-slate-400 mb-1.5 flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5" /> Notes
              </label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={6}
                placeholder="Add notes about this referral…"
                className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-slate-500 placeholder-slate-600 resize-none"
              />
            </div>

            <div className="flex items-center justify-between pt-1">
              {saveMsg ? (
                <p className={`text-sm ${saveMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                  {saveMsg.text}
                </p>
              ) : (
                <span />
              )}
              <button
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: '#1F3864' }}
              >
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
