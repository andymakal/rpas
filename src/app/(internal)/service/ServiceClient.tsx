'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Search, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react'
import type { ServiceRow } from './page'
import { fmtDate as formatDate } from '@/lib/fmt'

// ── Constants ─────────────────────────────────────────────────────────────────

const WORKFLOW_LABELS: Record<string, string> = {
  open:                  'Open',
  sa_form_sent:          'SA Form Sent',
  form_sent_to_client:   'Form → Client',
  form_sent_to_carrier:  'Form → Carrier',
  resolved:              'Resolved',
  cannot_service:        'Cannot Service',
}

const WORKFLOW_COLORS: Record<string, string> = {
  open:                  'text-blue-400 bg-blue-400/10 border border-blue-400/20',
  sa_form_sent:          'text-yellow-400 bg-yellow-400/10 border border-yellow-400/20',
  form_sent_to_client:   'text-orange-400 bg-orange-400/10 border border-orange-400/20',
  form_sent_to_carrier:  'text-purple-400 bg-purple-400/10 border border-purple-400/20',
  resolved:              'text-emerald-400 bg-emerald-400/10 border border-emerald-400/20',
  cannot_service:        'text-slate-500 bg-slate-500/10 border border-slate-500/20',
}

const SA_LABELS: Record<string, string> = {
  unknown:      'Unknown',
  confirmed:    'Confirmed',
  not_on_file:  'Not on File',
}

const SA_COLORS: Record<string, string> = {
  unknown:      'text-slate-400 bg-slate-400/10 border border-slate-400/20',
  confirmed:    'text-emerald-400 bg-emerald-400/10 border border-emerald-400/20',
  not_on_file:  'text-red-400 bg-red-400/10 border border-red-400/20',
}

const OPEN_STATUSES = ['open', 'sa_form_sent', 'form_sent_to_client', 'form_sent_to_carrier']
const CLOSED_STATUSES = ['resolved', 'cannot_service']

type TabKey = 'open' | 'closed' | 'all'
type SortKey = 'sr' | 'client' | 'carrier' | 'type' | 'workflow' | 'received'

// ── Component ─────────────────────────────────────────────────────────────────

export function ServiceClient({ rows }: { rows: ServiceRow[] }) {
  const router = useRouter()
  const [tab, setTab]           = useState<TabKey>('open')
  const [search, setSearch]     = useState('')
  const [sortKey, setSortKey]   = useState<SortKey>('received')
  const [sortDir, setSortDir]   = useState<'asc' | 'desc'>('desc')

  function handleSort(k: SortKey) {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(k); setSortDir('asc') }
  }

  const SortTh = ({ k, label, right }: { k: SortKey; label: string; right?: boolean }) => {
    const active = sortKey === k
    return (
      <th className={`px-4 py-3 ${right ? 'text-right' : 'text-left'}`}>
        <button onClick={() => handleSort(k)}
          className={`inline-flex items-center gap-1 text-xs font-medium transition-colors ${active ? 'text-white' : 'text-slate-400 hover:text-slate-200'}`}>
          {label}
          {active
            ? sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
            : <ChevronDown className="w-3 h-3 opacity-30" />}
        </button>
      </th>
    )
  }

  const filtered = useMemo(() => {
    let r = rows

    if (tab === 'open')   r = r.filter(x => OPEN_STATUSES.includes(x.workflow_status))
    if (tab === 'closed') r = r.filter(x => CLOSED_STATUSES.includes(x.workflow_status))

    if (search.trim()) {
      const q = search.toLowerCase()
      r = r.filter(x => {
        const client  = (x.service_policies?.client_name ?? '').toLowerCase()
        const policy  = (x.service_policies?.policy_number ?? '').toLowerCase()
        const carrier = (x.service_policies?.carrier ?? '').toLowerCase()
        const type    = x.request_type.toLowerCase()
        const sr      = (x.sr_number ?? '').toLowerCase()
        return client.includes(q) || policy.includes(q) || carrier.includes(q) || type.includes(q) || sr.includes(q)
      })
    }

    r = [...r].sort((a, b) => {
      let diff = 0
      if (sortKey === 'sr') {
        diff = (a.sr_number ?? '').localeCompare(b.sr_number ?? '')
      } else if (sortKey === 'client') {
        diff = (a.service_policies?.client_name ?? '').localeCompare(b.service_policies?.client_name ?? '')
      } else if (sortKey === 'carrier') {
        diff = (a.service_policies?.carrier ?? '').localeCompare(b.service_policies?.carrier ?? '')
      } else if (sortKey === 'type') {
        diff = a.request_type.localeCompare(b.request_type)
      } else if (sortKey === 'workflow') {
        diff = a.workflow_status.localeCompare(b.workflow_status)
      } else {
        // received
        const aD = new Date(a.date_received + 'T12:00:00').getTime()
        const bD = new Date(b.date_received + 'T12:00:00').getTime()
        diff = aD - bD
      }
      return sortDir === 'asc' ? diff : -diff
    })

    return r
  }, [rows, tab, search, sortKey, sortDir])

  const openCount   = rows.filter(x => OPEN_STATUSES.includes(x.workflow_status)).length
  const closedCount = rows.filter(x => CLOSED_STATUSES.includes(x.workflow_status)).length

  return (
    <div className="space-y-4">
      {/* Tabs + Search */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="flex items-center rounded-lg bg-slate-900 border border-slate-800 p-0.5 gap-0.5">
          {([
            { key: 'open',   label: `Open (${openCount})`         },
            { key: 'closed', label: `Closed (${closedCount})`     },
            { key: 'all',    label: `All (${rows.length})`        },
          ] as { key: TabKey; label: string }[]).map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${tab === t.key ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'}`}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="relative flex-1 min-w-0 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
          <input
            type="text"
            placeholder="Search client, policy, carrier, type…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border border-slate-800 bg-slate-900 text-white placeholder-slate-500 focus:outline-none focus:border-slate-600"
          />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
        {filtered.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-base font-medium text-slate-400">No service requests found.</p>
            <p className="text-sm text-slate-600 mt-1">Try a different filter or create a new request.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                <SortTh k="sr"       label="SR #"       />
                <SortTh k="client"   label="Client"     />
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Policy #</th>
                <SortTh k="carrier"  label="Carrier"    />
                <SortTh k="type"     label="Type"       />
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">SA Status</th>
                <SortTh k="workflow" label="Workflow"   />
                <SortTh k="received" label="Received"   />
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => {
                const isLast = i === filtered.length - 1
                const policy = row.service_policies
                const saStatus = policy?.sa_status ?? 'unknown'
                return (
                  <tr
                    key={row.id}
                    onClick={() => router.push(`/service/${row.id}`)}
                    className={`group cursor-pointer transition-colors hover:bg-slate-800/30 ${!isLast ? 'border-b border-slate-800/50' : ''}`}
                  >
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-slate-400">{row.sr_number ?? '—'}</span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-white group-hover:text-blue-300 transition-colors">
                        {policy?.client_name ?? '—'}
                      </p>
                      {(policy?.agents) && (
                        <p className="text-xs text-slate-500 mt-0.5">
                          {policy.agents.first_name} {policy.agents.last_name}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-400">
                      {policy?.policy_number ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-300 text-xs">
                      {policy?.carrier ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-300 text-xs max-w-[160px] truncate">
                      {row.request_type}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${SA_COLORS[saStatus] ?? SA_COLORS.unknown}`}>
                        {SA_LABELS[saStatus] ?? saStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${WORKFLOW_COLORS[row.workflow_status] ?? WORKFLOW_COLORS.open}`}>
                        {WORKFLOW_LABELS[row.workflow_status] ?? row.workflow_status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                      {formatDate(row.date_received)}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      <ChevronRight className="w-4 h-4 group-hover:text-slate-400 transition-colors" />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs text-slate-600">{filtered.length} of {rows.length} service requests</p>
    </div>
  )
}
