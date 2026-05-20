'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function PortalLoginPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const router = useRouter()
  const [slug, setSlug] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    params.then(p => setSlug(p.slug))
  }, [params])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!pin.trim()) return
    setLoading(true)
    setError('')

    const res = await fetch(`/api/portal/${slug}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    })

    if (res.ok) {
      router.push(`/portal/${slug}`)
      router.refresh()
    } else {
      const json = await res.json().catch(() => ({}))
      setError(json.error ?? 'Incorrect PIN. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-slate-900 px-6 py-5">
        <div className="max-w-sm mx-auto">
          <p className="text-xs font-semibold text-slate-400 tracking-widest uppercase mb-1">
            Right Path Agency System
          </p>
          <p className="text-white font-bold text-lg">Agency Portal</p>
        </div>
      </header>

      <div className="flex-1 flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8">
            <h1 className="text-xl font-bold text-slate-900 mb-1">Sign In</h1>
            <p className="text-sm text-slate-500 mb-6">
              Enter your agent number to access your portal.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Agent Number
                </label>
                <input
                  type="password"
                  value={pin}
                  onChange={e => { setPin(e.target.value); setError('') }}
                  placeholder="e.g. C4775"
                  autoFocus
                  className="w-full rounded-lg border border-slate-300 px-4 py-3 text-base
                    text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2
                    focus:ring-slate-800 focus:border-transparent transition-colors"
                />
              </div>

              {error && (
                <p className="text-sm text-red-600">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading || !pin.trim()}
                className="w-full py-3 rounded-xl bg-slate-800 text-white font-semibold
                  hover:bg-slate-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Checking…' : 'Access Portal'}
              </button>
            </form>
          </div>

          <p className="text-center text-xs text-slate-400 mt-4">
            Need help? Contact your Makal Financial representative.
          </p>
        </div>
      </div>
    </div>
  )
}
