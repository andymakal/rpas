'use client'

import { useState } from 'react'
import { Copy, Check } from 'lucide-react'

interface ScriptCardProps {
  label: string
  text:  string
}

export function ScriptCard({ label, text }: ScriptCardProps) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="rounded-lg bg-slate-800/60 border border-slate-700/50 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">{label}</p>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 text-xs rounded px-2 py-0.5 transition-colors bg-slate-700 hover:bg-slate-600 text-slate-300 shrink-0"
        >
          {copied
            ? <><Check className="w-3 h-3 text-emerald-400" />Copied</>
            : <><Copy className="w-3 h-3" />Copy</>
          }
        </button>
      </div>
      <p className="text-xs text-slate-200 leading-relaxed">{text}</p>
    </div>
  )
}
