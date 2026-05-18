'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { KeyRound, Check } from 'lucide-react'

export default function ChangePasswordPage() {
  const supabase = createClient()
  const [password,  setPassword]  = useState('')
  const [confirm,   setConfirm]   = useState('')
  const [saving,    setSaving]    = useState(false)
  const [msg,       setMsg]       = useState<{ ok: boolean; text: string } | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    if (password.length < 8) {
      setMsg({ ok: false, text: 'Password must be at least 8 characters' }); return
    }
    if (password !== confirm) {
      setMsg({ ok: false, text: 'Passwords do not match' }); return
    }
    setSaving(true)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setMsg({ ok: false, text: error.message })
    } else {
      setMsg({ ok: true, text: 'Password updated successfully' })
      setPassword(''); setConfirm('')
    }
    setSaving(false)
  }

  return (
    <div className="p-8">
      <div className="max-w-md mx-auto">
        <div className="mb-6">
          <h1 className="text-white text-2xl font-semibold">Change Password</h1>
          <p className="text-slate-400 text-sm mt-0.5">Set a new password for your account</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">New password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                required
                className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 placeholder-slate-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Confirm password</label>
              <input
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="Repeat new password"
                required
                className="w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 placeholder-slate-600"
              />
            </div>

            {msg && (
              <div className={`rounded-lg px-4 py-3 text-sm flex items-center gap-2 ${
                msg.ok
                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                  : 'bg-red-950 text-red-300 border border-red-800'
              }`}>
                {msg.ok && <Check className="w-4 h-4 flex-shrink-0" />}
                {msg.text}
              </div>
            )}

            <button
              type="submit"
              disabled={saving}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50 transition-opacity hover:opacity-90"
              style={{ backgroundColor: '#1F3864' }}
            >
              <KeyRound className="w-4 h-4" />
              {saving ? 'Updating…' : 'Update Password'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
