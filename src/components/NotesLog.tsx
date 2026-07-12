'use client'

import { useState } from 'react'
import { Send, Copy, Check, MessageSquare } from 'lucide-react'

export type NoteEntry = {
  id: string
  section: 'triage' | 'producer' | 'underwriting'
  author_name: string
  body: string
  created_at: string
}

const SECTION_STYLES = {
  triage: {
    border: 'border-l-blue-500',
    badge:  'bg-blue-500/10 text-blue-400 border-blue-500/30',
    pill:   'bg-blue-500/20 border-blue-500 text-blue-300',
  },
  producer: {
    border: 'border-l-emerald-500',
    badge:  'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    pill:   'bg-emerald-500/20 border-emerald-500 text-emerald-300',
  },
  underwriting: {
    border: 'border-l-amber-500',
    badge:  'bg-amber-500/10 text-amber-400 border-amber-500/30',
    pill:   'bg-amber-500/20 border-amber-500 text-amber-300',
  },
} as const

export function NotesLog({
  initialNotes,
  apiPath,
  defaultSection = 'producer',
}: {
  initialNotes: NoteEntry[]
  apiPath: string
  defaultSection?: 'triage' | 'producer' | 'underwriting'
}) {
  const [notes,   setNotes]   = useState<NoteEntry[]>(initialNotes)
  const [section, setSection] = useState<'triage' | 'producer' | 'underwriting'>(defaultSection)
  const [body,    setBody]    = useState('')
  const [posting, setPosting] = useState(false)
  const [err,     setErr]     = useState<string | null>(null)
  const [copied,  setCopied]  = useState(false)

  async function handlePost() {
    if (!body.trim()) { setErr('Note cannot be empty'); return }
    setPosting(true); setErr(null)
    try {
      const res = await fetch(apiPath, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ section, body: body.trim() }),
      })
      const json = await res.json()
      if (!res.ok) { setErr(json.error ?? 'Failed to post note'); return }
      setNotes(prev => [json.data as NoteEntry, ...prev])
      setBody('')
    } catch { setErr('Network error') }
    finally { setPosting(false) }
  }

  function handleCopy() {
    const sorted = [...notes].sort((a, b) => a.created_at.localeCompare(b.created_at))
    const text = sorted.map(n => {
      const dt = new Date(n.created_at)
      const ts = dt.toLocaleString('en-US', {
        month: '2-digit', day: '2-digit', year: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true,
      })
      return `[${ts}] ${n.section.toUpperCase()} — ${n.author_name}\n${n.body}`
    }).join('\n\n')
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-200">Notes</h2>
          {notes.length > 0 && (
            <span className="text-xs text-slate-500">({notes.length})</span>
          )}
        </div>
        {notes.length > 0 && (
          <button
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors"
          >
            {copied
              ? <><Check className="w-3 h-3 text-emerald-400" /><span className="text-emerald-400">Copied!</span></>
              : <><Copy className="w-3 h-3" />Copy for eAgent</>
            }
          </button>
        )}
      </div>

      {/* Compose */}
      <div className="px-5 py-4 space-y-3 border-b border-slate-800">
        <div className="flex gap-2 flex-wrap">
          {(['triage', 'producer', 'underwriting'] as const).map(s => (
            <button
              key={s}
              type="button"
              onClick={() => setSection(s)}
              className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors capitalize ${
                section === s
                  ? SECTION_STYLES[s].pill
                  : 'border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-600'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handlePost() }}
          rows={3}
          placeholder="Add a note… (Cmd+Enter to post)"
          className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-slate-500 placeholder-slate-600 resize-none"
        />
        {err && <p className="text-xs text-red-400">{err}</p>}
        <button
          onClick={handlePost}
          disabled={posting || !body.trim()}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg disabled:opacity-40 transition-colors"
        >
          {posting ? '…' : <><Send className="w-3.5 h-3.5" /> Post note</>}
        </button>
      </div>

      {/* Feed */}
      {notes.length === 0 ? (
        <div className="px-5 py-6 text-center text-slate-600 text-sm">No notes yet</div>
      ) : (
        <div className="divide-y divide-slate-800/60">
          {notes.map(n => {
            const dt = new Date(n.created_at)
            const dateStr = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            const timeStr = dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
            const ss = SECTION_STYLES[n.section]
            return (
              <div key={n.id} className={`px-5 py-4 border-l-4 ${ss.border}`}>
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded border capitalize ${ss.badge}`}>
                    {n.section}
                  </span>
                  <span className="text-xs font-medium text-slate-300">{n.author_name}</span>
                  <span suppressHydrationWarning className="text-xs text-slate-600">{dateStr} · {timeStr}</span>
                </div>
                <p className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed">{n.body}</p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
