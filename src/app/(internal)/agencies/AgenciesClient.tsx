'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2, AlertCircle, Search, Plus, X, ChevronDown, ChevronUp } from 'lucide-react'
import type { AgencyRow, SmlTeamOption } from './page'

type Props = {
  agencies: AgencyRow[]
  teams:    SmlTeamOption[]
}

type EditState = {
  display_name:   string
  sml_team_id:    string
  is_active:      boolean
  agent_number:   string
  contact_phone:  string
  contact_email:  string
  contact_street: string
  contact_city:   string
  contact_state:  string
  contact_zip:    string
}

type RowStatus = 'idle' | 'saving' | 'saved' | 'error'

function toEdit(a: AgencyRow): EditState {
  return {
    display_name:   a.display_name ?? '',
    sml_team_id:    a.sml_team_id ?? '',
    is_active:      a.is_active,
    agent_number:   a.agent_number ?? '',
    contact_phone:  a.contact_phone ?? '',
    contact_email:  a.contact_email ?? '',
    contact_street: a.contact_street ?? '',
    contact_city:   a.contact_city ?? '',
    contact_state:  a.contact_state ?? '',
    contact_zip:    a.contact_zip ?? '',
  }
}

function toSlug(s: string): string {
  return s.toLowerCase().replace(/['']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

type NewAgencyForm = {
  name:         string
  display_name: string
  slug:         string
  sml_team_id:  string
}

const BLANK: NewAgencyForm = { name: '', display_name: '', slug: '', sml_team_id: '' }

function isDirty(a: AgencyRow, e: EditState) {
  return (
    (e.display_name   || null) !== (a.display_name   ?? null) ||
    (e.sml_team_id    || null) !== (a.sml_team_id    ?? null) ||
    e.is_active                !== a.is_active                ||
    (e.agent_number   || null) !== (a.agent_number   ?? null) ||
    (e.contact_phone  || null) !== (a.contact_phone  ?? null) ||
    (e.contact_email  || null) !== (a.contact_email  ?? null) ||
    (e.contact_street || null) !== (a.contact_street ?? null) ||
    (e.contact_city   || null) !== (a.contact_city   ?? null) ||
    (e.contact_state  || null) !== (a.contact_state  ?? null) ||
    (e.contact_zip    || null) !== (a.contact_zip    ?? null)
  )
}

const INPUT = 'w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded px-2 py-1.5 focus:outline-none focus:border-slate-500 placeholder-slate-600'

export function AgenciesClient({ agencies, teams }: Props) {
  const router = useRouter()
  const [edits, setEdits]       = useState<Record<string, EditState>>(() =>
    Object.fromEntries(agencies.map(a => [a.id, toEdit(a)]))
  )
  const [statuses, setStatuses] = useState<Record<string, RowStatus>>({})
  const [errors, setErrors]     = useState<Record<string, string>>({})
  const [search, setSearch]     = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const [showAdd, setShowAdd]   = useState(false)
  const [newForm, setNewForm]   = useState<NewAgencyForm>(BLANK)
  const [addLoading, setAddLoading] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  function update(id: string, field: keyof EditState, value: string | boolean) {
    setEdits(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }))
    setStatuses(prev => ({ ...prev, [id]: 'idle' }))
  }

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function save(agency: AgencyRow) {
    const edit = edits[agency.id]
    setStatuses(prev => ({ ...prev, [agency.id]: 'saving' }))
    setErrors(prev => ({ ...prev, [agency.id]: '' }))

    const res = await fetch(`/api/admin/agencies/${agency.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        display_name:   edit.display_name   || null,
        sml_team_id:    edit.sml_team_id    || null,
        is_active:      edit.is_active,
        agent_number:   edit.agent_number   || null,
        contact_phone:  edit.contact_phone  || null,
        contact_email:  edit.contact_email  || null,
        contact_street: edit.contact_street || null,
        contact_city:   edit.contact_city   || null,
        contact_state:  edit.contact_state  || null,
        contact_zip:    edit.contact_zip    || null,
      }),
    })

    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      setErrors(prev => ({ ...prev, [agency.id]: json.error ?? 'Save failed' }))
      setStatuses(prev => ({ ...prev, [agency.id]: 'error' }))
      return
    }

    setStatuses(prev => ({ ...prev, [agency.id]: 'saved' }))
    setTimeout(() => {
      setStatuses(prev => ({ ...prev, [agency.id]: 'idle' }))
      router.refresh()
    }, 1500)
  }

  async function addAgency() {
    if (!newForm.display_name.trim()) { setAddError('Display name is required'); return }
    if (!newForm.slug.trim())         { setAddError('Slug is required'); return }

    setAddLoading(true)
    setAddError(null)

    const res = await fetch('/api/admin/agencies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name:         newForm.name.trim() || newForm.display_name.trim(),
        display_name: newForm.display_name.trim(),
        slug:         newForm.slug.trim(),
        sml_team_id:  newForm.sml_team_id || null,
      }),
    })

    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      setAddError(json.error ?? 'Failed to add agency')
      setAddLoading(false)
      return
    }

    setNewForm(BLANK)
    setShowAdd(false)
    setAddLoading(false)
    router.refresh()
  }

  const q = search.trim().toLowerCase()
  const filtered = agencies.filter(a =>
    !q ||
    a.name.toLowerCase().includes(q) ||
    (a.display_name ?? '').toLowerCase().includes(q) ||
    a.slug.toLowerCase().includes(q)
  )

  return (
    <div className="space-y-4">

      {/* Add agency */}
      {!showAdd ? (
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 text-sm font-medium text-white px-4 py-2 rounded-lg"
          style={{ backgroundColor: '#1F3864' }}
        >
          <Plus className="w-4 h-4" />
          Add Agency
        </button>
      ) : (
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-white font-semibold text-sm">New Agency</p>
            <button onClick={() => { setShowAdd(false); setNewForm(BLANK); setAddError(null) }}>
              <X className="w-4 h-4 text-slate-500 hover:text-slate-300" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Agent / display name *</label>
              <input
                type="text"
                value={newForm.display_name}
                onChange={e => {
                  const val = e.target.value
                  setNewForm(f => ({ ...f, display_name: val, slug: toSlug(val) }))
                }}
                placeholder="e.g. Bob Smith"
                className={INPUT}
              />
            </div>

            <div>
              <label className="text-xs text-slate-400 mb-1 block">Allstate business name</label>
              <input
                type="text"
                value={newForm.name}
                onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. BOB SMITH AGENCY INC (leave blank to use display name)"
                className={INPUT}
              />
            </div>

            <div>
              <label className="text-xs text-slate-400 mb-1 block">Slug * (auto-filled — edit if needed)</label>
              <input
                type="text"
                value={newForm.slug}
                onChange={e => setNewForm(f => ({ ...f, slug: e.target.value }))}
                placeholder="e.g. smith-bob-ks"
                className={`${INPUT} font-mono`}
              />
              <p className="text-xs text-slate-600 mt-1">Used in the dashboard URL — must be unique.</p>
            </div>

            <div>
              <label className="text-xs text-slate-400 mb-1 block">SML team</label>
              <select
                value={newForm.sml_team_id}
                onChange={e => setNewForm(f => ({ ...f, sml_team_id: e.target.value }))}
                className={INPUT}
              >
                <option value="">— unassigned</option>
                {teams.map(t => (
                  <option key={t.id} value={t.id}>{t.display_name}</option>
                ))}
              </select>
            </div>
          </div>

          {addError && (
            <div className="flex items-center gap-2 text-red-400 text-xs">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {addError}
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={addAgency}
              disabled={addLoading}
              className="flex items-center gap-2 text-sm font-medium text-white px-4 py-2 rounded-lg disabled:opacity-50"
              style={{ backgroundColor: '#1F3864' }}
            >
              {addLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Save Agency
            </button>
            <button
              onClick={() => { setShowAdd(false); setNewForm(BLANK); setAddError(null) }}
              className="text-sm text-slate-400 hover:text-slate-200"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search agencies…"
          className="w-full bg-slate-900 border border-slate-700 text-slate-200 text-sm rounded-lg pl-9 pr-3 py-2 focus:outline-none focus:border-slate-500 placeholder-slate-600"
        />
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-800">
              <th className="py-2.5 px-4 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Display name</th>
              <th className="py-2.5 px-4 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Allstate name</th>
              <th className="py-2.5 px-4 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">SML team</th>
              <th className="py-2.5 px-4 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Slug</th>
              <th className="py-2.5 px-4 text-center text-xs font-medium text-slate-500 uppercase tracking-wide">Active</th>
              <th className="py-2.5 px-4 w-32" />
            </tr>
          </thead>
          <tbody>
            {filtered.map(agency => {
              const edit      = edits[agency.id]
              const status    = statuses[agency.id] ?? 'idle'
              const error     = errors[agency.id]
              const dirty     = edit ? isDirty(agency, edit) : false
              const isOpen    = expanded.has(agency.id)
              const hasContact = agency.contact_phone || agency.contact_email || agency.contact_street

              return (
                <>
                  <tr key={agency.id} className="border-b border-slate-800 last:border-0 hover:bg-slate-800/30">
                    {/* Display name */}
                    <td className="py-2.5 px-4">
                      <input
                        type="text"
                        value={edit?.display_name ?? ''}
                        onChange={e => update(agency.id, 'display_name', e.target.value)}
                        placeholder="Agent name…"
                        className={INPUT}
                      />
                    </td>

                    {/* Allstate business name — read only */}
                    <td className="py-2.5 px-4 text-xs text-slate-500 max-w-[200px] truncate">
                      {agency.name}
                    </td>

                    {/* SML team */}
                    <td className="py-2.5 px-4">
                      <select
                        value={edit?.sml_team_id ?? ''}
                        onChange={e => update(agency.id, 'sml_team_id', e.target.value)}
                        className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded px-2 py-1.5 focus:outline-none focus:border-slate-500"
                      >
                        <option value="">— unassigned</option>
                        {teams.map(t => (
                          <option key={t.id} value={t.id}>{t.display_name}</option>
                        ))}
                      </select>
                    </td>

                    {/* Slug — read only */}
                    <td className="py-2.5 px-4 text-xs text-slate-600 font-mono">{agency.slug}</td>

                    {/* Active toggle */}
                    <td className="py-2.5 px-4 text-center">
                      <button
                        onClick={() => update(agency.id, 'is_active', !edit?.is_active)}
                        className={`text-xs px-2 py-0.5 rounded font-medium ${
                          edit?.is_active
                            ? 'bg-green-900/50 text-green-400 border border-green-800'
                            : 'bg-slate-700 text-slate-500 border border-slate-600'
                        }`}
                      >
                        {edit?.is_active ? 'Active' : 'Off'}
                      </button>
                    </td>

                    {/* Actions */}
                    <td className="py-2.5 px-4">
                      <div className="flex items-center justify-end gap-2">
                        {error && (
                          <div className="flex items-center gap-1 text-red-400 text-xs">
                            <AlertCircle className="w-3 h-3" />
                            {error}
                          </div>
                        )}
                        {dirty && status !== 'saving' && status !== 'saved' && (
                          <button
                            onClick={() => save(agency)}
                            className="text-xs px-3 py-1 rounded font-medium text-white"
                            style={{ backgroundColor: '#1F3864' }}
                          >
                            Save
                          </button>
                        )}
                        {status === 'saving' && <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />}
                        {status === 'saved'  && <Check className="w-4 h-4 text-green-400" />}
                        <button
                          onClick={() => toggleExpand(agency.id)}
                          title="Edit contact info"
                          className={`p-1 rounded transition-colors ${
                            isOpen
                              ? 'text-slate-300 bg-slate-700'
                              : hasContact
                                ? 'text-slate-400 hover:text-slate-200'
                                : 'text-slate-600 hover:text-slate-400'
                          }`}
                        >
                          {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                      </div>
                    </td>
                  </tr>

                  {/* Contact info panel */}
                  {isOpen && (
                    <tr key={`${agency.id}-contact`} className="border-b border-slate-800 bg-slate-800/20">
                      <td colSpan={6} className="px-4 py-4">
                        <div className="grid grid-cols-7 gap-3">
                          <div>
                            <label className="text-xs text-slate-500 mb-1 block">Agent #</label>
                            <input
                              type="text"
                              value={edit?.agent_number ?? ''}
                              onChange={e => update(agency.id, 'agent_number', e.target.value)}
                              placeholder="A0X0000"
                              className={INPUT}
                            />
                          </div>
                          <div>
                            <label className="text-xs text-slate-500 mb-1 block">Phone</label>
                            <input
                              type="text"
                              value={edit?.contact_phone ?? ''}
                              onChange={e => update(agency.id, 'contact_phone', e.target.value)}
                              placeholder="555-555-5555"
                              className={INPUT}
                            />
                          </div>
                          <div className="col-span-2">
                            <label className="text-xs text-slate-500 mb-1 block">Email</label>
                            <input
                              type="text"
                              value={edit?.contact_email ?? ''}
                              onChange={e => update(agency.id, 'contact_email', e.target.value)}
                              placeholder="agent@allstate.com"
                              className={INPUT}
                            />
                          </div>
                          <div>
                            <label className="text-xs text-slate-500 mb-1 block">Street</label>
                            <input
                              type="text"
                              value={edit?.contact_street ?? ''}
                              onChange={e => update(agency.id, 'contact_street', e.target.value)}
                              placeholder="123 Main St"
                              className={INPUT}
                            />
                          </div>
                          <div>
                            <label className="text-xs text-slate-500 mb-1 block">City</label>
                            <input
                              type="text"
                              value={edit?.contact_city ?? ''}
                              onChange={e => update(agency.id, 'contact_city', e.target.value)}
                              placeholder="Pittsburgh"
                              className={INPUT}
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-xs text-slate-500 mb-1 block">State</label>
                              <input
                                type="text"
                                value={edit?.contact_state ?? ''}
                                onChange={e => update(agency.id, 'contact_state', e.target.value)}
                                placeholder="PA"
                                className={INPUT}
                                maxLength={2}
                              />
                            </div>
                            <div>
                              <label className="text-xs text-slate-500 mb-1 block">ZIP</label>
                              <input
                                type="text"
                                value={edit?.contact_zip ?? ''}
                                onChange={e => update(agency.id, 'contact_zip', e.target.value)}
                                placeholder="15222"
                                className={INPUT}
                              />
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="py-10 text-center text-sm text-slate-600">
                  No agencies match your search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-600">{filtered.length} of {agencies.length} agencies</p>
    </div>
  )
}
