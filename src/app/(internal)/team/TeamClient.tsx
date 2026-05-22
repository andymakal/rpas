'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  UserPlus, Trash2, CheckCircle, Clock,
  ChevronDown, ChevronUp, Pencil, Check, X, KeyRound,
} from 'lucide-react'
import type { Producer } from './page'

function fmt(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtBirthday(iso: string | null) {
  if (!iso) return '—'
  // birthday is a DATE string (YYYY-MM-DD) — parse without timezone shift
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

type FieldDef = { key: string; label: string; placeholder?: string; type?: string }

const PROFILE_FIELDS: FieldDef[] = [
  { key: 'title',             label: 'Title',              placeholder: 'Life Insurance Specialist' },
  { key: 'phone',             label: 'Phone',              placeholder: '(555) 555-5555',  type: 'tel' },
  { key: 'allstate_id',       label: 'Allstate ID',        placeholder: 'A12345678' },
  { key: 'npn',               label: 'NPN',                placeholder: '12345678' },
  { key: 'sub_producer_code', label: 'Sub-Producer Code',  placeholder: 'SP-001' },
  { key: 'birthday',          label: 'Birthday',           type: 'date' },
]

type EditState = Partial<Record<string, string>>

export function TeamClient({ members }: { members: Producer[] }) {
  const router = useRouter()

  // Invite form
  const [showInvite,   setShowInvite]   = useState(false)
  const [inviteName,   setInviteName]   = useState('')
  const [inviteEmail,  setInviteEmail]  = useState('')
  const [inviting,     setInviting]     = useState(false)
  const [inviteMsg,    setInviteMsg]    = useState<{ ok: boolean; text: string } | null>(null)
  const [tempPass,     setTempPass]     = useState<string | null>(null)
  const [tempPassLabel, setTempPassLabel] = useState('Account created — share this temporary password')

  // Password reset — keyed by member id so the inline result shows in the right row
  const [resettingId,    setResettingId]    = useState<string | null>(null)
  const [resetResultId,  setResetResultId]  = useState<string | null>(null)
  const [resetNewPass,   setResetNewPass]   = useState<string | null>(null)
  const [resetError,     setResetError]     = useState<string | null>(null)

  // Row state
  const [expandedId,   setExpandedId]  = useState<string | null>(null)
  const [editingId,    setEditingId]   = useState<string | null>(null)
  const [editState,    setEditState]   = useState<EditState>({})
  const [saving,       setSaving]      = useState(false)
  const [saveMsg,      setSaveMsg]     = useState<{ ok: boolean; text: string } | null>(null)
  const [confirmId,    setConfirmId]   = useState<string | null>(null)
  const [removingId,   setRemovingId]  = useState<string | null>(null)

  async function handleInvite() {
    setInviting(true); setInviteMsg(null); setTempPass(null)
    try {
      const res = await fetch('/api/admin/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, full_name: inviteName }),
      })
      const j = await res.json()
      if (!res.ok) {
        setInviteMsg({ ok: false, text: j.error ?? 'Failed to create account' })
      } else {
        setTempPassLabel('Account created — share this temporary password')
        setTempPass(j.tempPass)
        setInviteMsg({ ok: true, text: `Account created for ${inviteName}` })
        setInviteName(''); setInviteEmail('')
        setShowInvite(false)
        router.refresh()
      }
    } catch {
      setInviteMsg({ ok: false, text: 'Network error' })
    } finally {
      setInviting(false)
    }
  }

  function startEdit(m: Producer) {
    setEditingId(m.id)
    setSaveMsg(null)
    const initial: EditState = {
      first_name:        m.first_name,
      last_name:         m.last_name,
      title:             m.title ?? '',
      phone:             m.phone ?? '',
      allstate_id:       m.allstate_id ?? '',
      npn:               m.npn ?? '',
      sub_producer_code: m.sub_producer_code ?? '',
      birthday:          m.birthday ?? '',
    }
    setEditState(initial)
    setExpandedId(m.id)
  }

  async function handleSave(m: Producer) {
    setSaving(true); setSaveMsg(null)
    try {
      // Update auth name if changed
      const newFullName = `${editState.first_name ?? ''} ${editState.last_name ?? ''}`.trim()
      const oldFullName = `${m.first_name} ${m.last_name}`.trim()

      if (newFullName !== oldFullName) {
        await fetch('/api/admin/team', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: m.auth_user_id, full_name: newFullName }),
        })
      }

      // Update producer profile
      const producerUpdate: Record<string, unknown> = {
        first_name:        editState.first_name,
        last_name:         editState.last_name,
        title:             editState.title   || null,
        phone:             editState.phone   || null,
        allstate_id:       editState.allstate_id   || null,
        npn:               editState.npn     || null,
        sub_producer_code: editState.sub_producer_code || null,
        birthday:          editState.birthday || null,
      }

      if (!m.has_producer_record) {
        // No producer record yet (pre-migration user) — create one
        const res = await fetch('/api/admin/producers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...producerUpdate, auth_user_id: m.auth_user_id, email: m.auth_email }),
        })
        const j = await res.json()
        if (!res.ok) { setSaveMsg({ ok: false, text: j.error ?? 'Save failed' }); return }
      } else {
        const res = await fetch(`/api/admin/producers/${m.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(producerUpdate),
        })
        const j = await res.json()
        if (!res.ok) { setSaveMsg({ ok: false, text: j.error ?? 'Save failed' }); return }
      }

      setSaveMsg({ ok: true, text: 'Saved' })
      setEditingId(null)
      router.refresh()
    } catch {
      setSaveMsg({ ok: false, text: 'Network error' })
    } finally {
      setSaving(false)
    }
  }

  async function handleRemove(m: Producer) {
    setRemovingId(m.id)
    try {
      const res = await fetch('/api/admin/team', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: m.auth_user_id }),
      })
      if (res.ok) { setConfirmId(null); router.refresh() }
    } finally {
      setRemovingId(null)
    }
  }

  async function handleResetPassword(m: Producer) {
    setResettingId(m.id)
    setResetResultId(null)
    setResetNewPass(null)
    setResetError(null)
    try {
      const res = await fetch('/api/admin/team', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: m.auth_user_id }),
      })
      const j = await res.json()
      if (res.ok) {
        setResetResultId(m.id)
        setResetNewPass(j.tempPass)
      } else {
        setResetResultId(m.id)
        setResetError(j.error ?? 'Reset failed')
      }
    } catch {
      setResetResultId(m.id)
      setResetError('Network error')
    } finally {
      setResettingId(null)
    }
  }

  function field(key: string) {
    return editState[key] ?? ''
  }

  function setField(key: string, val: string) {
    setEditState(s => ({ ...s, [key]: val }))
  }

  return (
    <div className="p-8">
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-white text-2xl font-semibold">Team</h1>
            <p className="text-slate-400 text-sm mt-0.5">{members.length} member{members.length !== 1 ? 's' : ''}</p>
          </div>
          <button
            onClick={() => { setShowInvite(o => !o); setInviteMsg(null) }}
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#1F3864' }}
          >
            <UserPlus className="w-4 h-4" /> Add Team Member
          </button>
        </div>

        {/* Temp password banner */}
        {tempPass && (
          <div className="mb-6 bg-emerald-950 border border-emerald-800 rounded-xl p-5 space-y-2">
            <p className="text-sm font-medium text-emerald-300">{tempPassLabel}</p>
            <p className="text-xs text-slate-400">They can change it under <strong>Change Password</strong> in the sidebar.</p>
            <div className="flex items-center gap-3 mt-2">
              <code className="bg-slate-900 border border-slate-700 text-white text-sm font-mono rounded-lg px-4 py-2 tracking-wider">
                {tempPass}
              </code>
              <button onClick={() => navigator.clipboard.writeText(tempPass)} className="text-xs text-slate-400 hover:text-slate-200">
                Copy
              </button>
            </div>
            <button onClick={() => setTempPass(null)} className="text-xs text-slate-500 hover:text-slate-400 pt-1">Dismiss</button>
          </div>
        )}

        {/* Invite form */}
        {showInvite && (
          <div className="mb-6 bg-slate-900 border border-slate-700 rounded-xl p-5 space-y-4">
            <p className="text-sm font-medium text-slate-200">Add a team member</p>
            <p className="text-xs text-slate-500">Creates an account immediately. A temporary password will be displayed so you can share it with them.</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Full name</label>
                <input
                  type="text"
                  value={inviteName}
                  onChange={e => setInviteName(e.target.value)}
                  placeholder="First Last"
                  className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-500 placeholder-slate-600"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Email address</label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  placeholder="name@allstate.com"
                  className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-500 placeholder-slate-600"
                />
              </div>
            </div>
            {inviteMsg && (
              <p className={`text-sm ${inviteMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{inviteMsg.text}</p>
            )}
            <div className="flex items-center gap-3">
              <button
                onClick={handleInvite}
                disabled={inviting || !inviteName.trim() || !inviteEmail.trim()}
                className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-40 transition-opacity hover:opacity-90"
                style={{ backgroundColor: '#1F3864' }}
              >
                <UserPlus className="w-4 h-4" /> {inviting ? 'Creating…' : 'Create Account'}
              </button>
              <button onClick={() => { setShowInvite(false); setInviteMsg(null) }} className="text-sm text-slate-400 hover:text-slate-200">
                Cancel
              </button>
            </div>
          </div>
        )}

        {inviteMsg && !showInvite && (
          <div className={`mb-4 rounded-lg px-4 py-3 text-sm ${inviteMsg.ok ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-red-950 text-red-300 border border-red-800'}`}>
            {inviteMsg.text}
          </div>
        )}

        {/* Team table */}
        <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
          {members.map((m, i) => {
            const isExpanded = expandedId === m.id
            const isEditing  = editingId  === m.id
            const isLast     = i === members.length - 1
            const displayName = `${m.first_name} ${m.last_name}`.trim() || m.auth_email

            return (
              <div key={m.id} className={!isLast ? 'border-b border-slate-800' : ''}>

                {/* Summary row */}
                <div
                  className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-slate-800/30 transition-colors"
                  onClick={() => {
                    if (editingId === m.id) return
                    setExpandedId(isExpanded ? null : m.id)
                  }}
                >
                  {/* Avatar */}
                  <div className="w-9 h-9 rounded-full bg-slate-700 flex items-center justify-center text-sm font-medium text-white shrink-0 select-none">
                    {(m.first_name?.[0] ?? m.auth_email[0] ?? '?').toUpperCase()}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{displayName}</p>
                    <p className="text-xs text-slate-500 truncate">{m.title ?? m.auth_email}</p>
                  </div>

                  {/* Status badge */}
                  {m.confirmed ? (
                    <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium bg-emerald-900/50 text-emerald-300 border border-emerald-800 shrink-0">
                      <CheckCircle className="w-3 h-3" /> Active
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium bg-amber-900/50 text-amber-300 border border-amber-800 shrink-0">
                      <Clock className="w-3 h-3" /> Pending
                    </span>
                  )}

                  <span className="text-xs text-slate-500 shrink-0 hidden sm:block w-32 text-right">
                    {m.last_sign_in ? `Last in ${fmt(m.last_sign_in)}` : 'Never signed in'}
                  </span>

                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-slate-500 shrink-0" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
                  )}
                </div>

                {/* Expanded detail panel */}
                {isExpanded && (
                  <div className="border-t border-slate-800 bg-slate-950/50 px-5 py-5">

                    {isEditing ? (
                      /* ── EDIT MODE ── */
                      <div className="space-y-5">
                        {/* Name row */}
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs text-slate-400 mb-1.5">First name</label>
                            <input
                              type="text"
                              value={field('first_name')}
                              onChange={e => setField('first_name', e.target.value)}
                              className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-slate-400 mb-1.5">Last name</label>
                            <input
                              type="text"
                              value={field('last_name')}
                              onChange={e => setField('last_name', e.target.value)}
                              className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
                            />
                          </div>
                        </div>

                        {/* Profile fields grid */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                          {PROFILE_FIELDS.map(f => (
                            <div key={f.key}>
                              <label className="block text-xs text-slate-400 mb-1.5">{f.label}</label>
                              <input
                                type={f.type ?? 'text'}
                                value={field(f.key)}
                                onChange={e => setField(f.key, e.target.value)}
                                placeholder={f.placeholder}
                                className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 placeholder-slate-600"
                              />
                            </div>
                          ))}
                        </div>

                        {saveMsg && (
                          <p className={`text-sm ${saveMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{saveMsg.text}</p>
                        )}

                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => handleSave(m)}
                            disabled={saving}
                            className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-40 transition-opacity hover:opacity-90"
                            style={{ backgroundColor: '#1F3864' }}
                          >
                            <Check className="w-4 h-4" /> {saving ? 'Saving…' : 'Save'}
                          </button>
                          <button
                            onClick={() => { setEditingId(null); setSaveMsg(null) }}
                            className="text-sm text-slate-400 hover:text-slate-200"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>

                    ) : (
                      /* ── READ MODE ── */
                      <div className="space-y-4">
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-8 gap-y-3 text-sm">
                          <InfoRow label="Email"            value={m.auth_email} />
                          <InfoRow label="Title"            value={m.title} />
                          <InfoRow label="Phone"            value={m.phone} />
                          <InfoRow label="Allstate ID"      value={m.allstate_id} />
                          <InfoRow label="NPN"              value={m.npn} />
                          <InfoRow label="Sub-Producer Code" value={m.sub_producer_code} />
                          <InfoRow label="Birthday"         value={fmtBirthday(m.birthday)} />
                          <InfoRow label="Last Sign-In"     value={fmt(m.last_sign_in)} />
                          <InfoRow label="Member Since"     value={fmt(m.created_at)} />
                        </div>

                        <div className="flex items-center gap-4 pt-1">
                          <button
                            onClick={e => { e.stopPropagation(); startEdit(m) }}
                            className="inline-flex items-center gap-1.5 text-sm text-slate-300 hover:text-white transition-colors"
                          >
                            <Pencil className="w-3.5 h-3.5" /> Edit Profile
                          </button>

                          <button
                            onClick={e => { e.stopPropagation(); handleResetPassword(m) }}
                            disabled={resettingId === m.id}
                            className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-amber-400 transition-colors disabled:opacity-50"
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                            {resettingId === m.id ? 'Resetting…' : 'Reset Password'}
                          </button>

                          {confirmId === m.id ? (
                            <span className="inline-flex items-center gap-2">
                              <span className="text-xs text-slate-400">Remove this member?</span>
                              <button
                                onClick={() => handleRemove(m)}
                                disabled={removingId === m.id}
                                className="text-xs font-medium text-red-400 hover:text-red-300 disabled:opacity-50"
                              >
                                {removingId === m.id ? 'Removing…' : 'Yes, remove'}
                              </button>
                              <button onClick={() => setConfirmId(null)} className="text-xs text-slate-500 hover:text-slate-300">
                                Cancel
                              </button>
                            </span>
                          ) : (
                            <button
                              onClick={e => { e.stopPropagation(); setConfirmId(m.id) }}
                              className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-red-400 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" /> Remove
                            </button>
                          )}
                        </div>

                        {/* Inline password-reset result */}
                        {resetResultId === m.id && (
                          resetError ? (
                            <div className="mt-3 rounded-lg border border-red-800 bg-red-950/50 px-4 py-3 flex items-center justify-between gap-3">
                              <p className="text-sm text-red-400">{resetError}</p>
                              <button onClick={() => setResetResultId(null)} className="text-xs text-slate-500 hover:text-slate-300">Dismiss</button>
                            </div>
                          ) : (
                            <div className="mt-3 rounded-lg border border-emerald-800 bg-emerald-950/60 px-4 py-3 space-y-2">
                              <p className="text-xs font-medium text-emerald-300">Password reset — share this new temporary password with {m.first_name || m.auth_email}</p>
                              <div className="flex items-center gap-3">
                                <code className="bg-slate-900 border border-slate-700 text-white text-sm font-mono rounded-lg px-4 py-2 tracking-wider">
                                  {resetNewPass}
                                </code>
                                <button
                                  onClick={() => resetNewPass && navigator.clipboard.writeText(resetNewPass)}
                                  className="text-xs text-slate-400 hover:text-slate-200"
                                >
                                  Copy
                                </button>
                                <button onClick={() => setResetResultId(null)} className="text-xs text-slate-500 hover:text-slate-300 ml-auto">
                                  Dismiss
                                </button>
                              </div>
                            </div>
                          )
                        )}

                      </div>
                    )}
                  </div>
                )}

              </div>
            )
          })}
        </div>

      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-xs text-slate-500 mb-0.5">{label}</p>
      <p className="text-slate-200 text-sm">{value && value !== '—' ? value : <span className="text-slate-600 italic">—</span>}</p>
    </div>
  )
}
