'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { UserPlus, Trash2, CheckCircle, Clock, Mail, Pencil, Check, X } from 'lucide-react'
import type { TeamMember } from './page'

function fmt(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function TeamClient({ members }: { members: TeamMember[] }) {
  const router = useRouter()

  const [showInvite, setShowInvite] = useState(false)
  const [inviteName,  setInviteName]  = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting]       = useState(false)
  const [inviteMsg, setInviteMsg]     = useState<{ ok: boolean; text: string } | null>(null)

  const [removingId, setRemovingId]   = useState<string | null>(null)
  const [confirmId,  setConfirmId]    = useState<string | null>(null)

  const [editingId,   setEditingId]   = useState<string | null>(null)
  const [editName,    setEditName]    = useState('')
  const [editSaving,  setEditSaving]  = useState(false)
  const [editMsg,     setEditMsg]     = useState<{ ok: boolean; text: string } | null>(null)

  async function handleInvite() {
    setInviting(true); setInviteMsg(null)
    try {
      const res = await fetch('/api/admin/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, full_name: inviteName }),
      })
      const j = await res.json()
      if (!res.ok) {
        setInviteMsg({ ok: false, text: j.error ?? 'Invite failed' })
      } else {
        setInviteMsg({ ok: true, text: `Invite sent to ${inviteEmail}` })
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

  function startEdit(m: TeamMember) {
    setEditingId(m.id)
    setEditName(m.full_name ?? '')
    setEditMsg(null)
    setConfirmId(null)
  }

  async function handleSaveName(userId: string) {
    setEditSaving(true); setEditMsg(null)
    try {
      const res = await fetch('/api/admin/team', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, full_name: editName }),
      })
      const j = await res.json()
      if (!res.ok) {
        setEditMsg({ ok: false, text: j.error ?? 'Save failed' })
      } else {
        setEditingId(null)
        router.refresh()
      }
    } catch {
      setEditMsg({ ok: false, text: 'Network error' })
    } finally {
      setEditSaving(false)
    }
  }

  async function handleRemove(userId: string) {
    setRemovingId(userId)
    try {
      const res = await fetch('/api/admin/team', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      })
      if (res.ok) {
        setConfirmId(null)
        router.refresh()
      }
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <div className="p-8">
      <div className="max-w-3xl mx-auto">
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
            <UserPlus className="w-4 h-4" /> Invite Team Member
          </button>
        </div>

        {/* Invite form */}
        {showInvite && (
          <div className="mb-6 bg-slate-900 border border-slate-700 rounded-xl p-5 space-y-4">
            <p className="text-sm font-medium text-slate-200">Invite a new team member</p>
            <p className="text-xs text-slate-500">
              They'll receive an email with a sign-in link. After clicking it they can set their own password.
            </p>
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
                <Mail className="w-4 h-4" /> {inviting ? 'Sending…' : 'Send Invite'}
              </button>
              <button
                onClick={() => { setShowInvite(false); setInviteMsg(null) }}
                className="text-sm text-slate-400 hover:text-slate-200"
              >
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
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Email</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Last sign in</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {members.map((m, i) => (
                <tr
                  key={m.id}
                  className={i < members.length - 1 ? 'border-b border-slate-800/50' : ''}
                >
                  <td className="px-4 py-3">
                    {editingId === m.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={editName}
                          onChange={e => setEditName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleSaveName(m.id); if (e.key === 'Escape') setEditingId(null) }}
                          autoFocus
                          className="bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded px-2 py-1 w-40 focus:outline-none focus:border-blue-500"
                        />
                        <button
                          onClick={() => handleSaveName(m.id)}
                          disabled={editSaving || !editName.trim()}
                          className="text-emerald-400 hover:text-emerald-300 disabled:opacity-40"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button onClick={() => setEditingId(null)} className="text-slate-500 hover:text-slate-300">
                          <X className="w-4 h-4" />
                        </button>
                        {editMsg && <span className="text-xs text-red-400">{editMsg.text}</span>}
                      </div>
                    ) : (
                      <button
                        onClick={() => startEdit(m)}
                        className="group flex items-center gap-1.5 font-medium text-white hover:text-slate-300 transition-colors"
                      >
                        {m.full_name ?? <span className="text-slate-500 italic font-normal">No name — click to set</span>}
                        <Pencil className="w-3 h-3 text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-400">{m.email}</td>
                  <td className="px-4 py-3">
                    {m.confirmed ? (
                      <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium bg-emerald-900/50 text-emerald-300 border border-emerald-800">
                        <CheckCircle className="w-3 h-3" /> Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium bg-amber-900/50 text-amber-300 border border-amber-800">
                        <Clock className="w-3 h-3" /> Invite pending
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">{fmt(m.last_sign_in)}</td>
                  <td className="px-4 py-3 text-right">
                    {confirmId === m.id ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="text-xs text-slate-400">Remove?</span>
                        <button
                          onClick={() => handleRemove(m.id)}
                          disabled={removingId === m.id}
                          className="text-xs font-medium text-red-400 hover:text-red-300 disabled:opacity-50"
                        >
                          {removingId === m.id ? 'Removing…' : 'Yes'}
                        </button>
                        <button
                          onClick={() => setConfirmId(null)}
                          className="text-xs text-slate-500 hover:text-slate-300"
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => setConfirmId(m.id)}
                        className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
