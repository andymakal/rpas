'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2, AlertCircle, Search, Plus, X } from 'lucide-react'
import type { AgencyRow, SmlTeamOption } from './page'

type Props = {
  agencies: AgencyRow[]
  teams:    SmlTeamOption[]
}

type EditState = {
  display_name: string
  sml_team_id:  string
  is_active:    boolean
}

type RowStatus = 'idle' | 'saving' | 'saved' | 'error'

function toEdit(a: AgencyRow): EditState {
  return {
    display_name: a.display_name ?? '',
    sml_team_id:  a.sml_team_id ?? '',
    is_active:    a.is_active,
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
    (e.display_name || null) !== (a.display_name ?? null) ||
    (e.sml_team_id  || null) !== (a.sml_team_id  ?? null) ||
    e.is_active              !== a.is_active
  )
}

export function AgenciesClient({ agencies, teams }: Props) {
  const router = useRouter()
  const [edits, setEdits]       = useState<Record<string, EditState>>(() =>
    Object.fromEntries(agencies.map(a => [a.id, toEdit(a)]))
  )
  const [statuses, setStatuses] = useState<Record<string, RowStatus>>({})
  const [errors, setErrors]     = useState<Record<string, string>>({})
  const [search, setSearch]     = useState('')

  const [showAdd, setShowAdd]   = useState(false)
  const [newForm, setNewForm]   = useState<NewAgencyForm>(BLANK)
  const [addLoading, setAddLoading] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  function update(id: string, field: keyof EditState, value: string | boolean) {
    setEdits(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }))
    setStatuses(prev => ({ ...prev, [id]: 'idle' }))
  }

  async function save(agency: AgencyRow) {
    const edit = edits[agency.id]
    setStatuses(prev => ({ ...prev, [agency.id]: 'saving' }))
    setErrors(prev => ({ ...prev, [agency.id]: '' }))

    const res = await fetch(`/api/admin/agencies/${agency.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        display_name: edit.display_name || null,
        sml_team_id:  edit.sml_team_id  || null,
        is_active:    edit.is_active,
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
                  setNewForm(f => ({
                    ...f,
                    display_name: val,
                    slug: toSlug(val),
                  }))
                }}
                placeholder="e.g. Bob Smith"
                className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded px-3 py-2 focus:outline-none focus:border-slate-500"
              />
            </div>

            <div>
              <label className="text-xs text-slate-400 mb-1 block">Allstate business name</label>
              <input
                type="text"
                value={newForm.name}
                onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. BOB SMITH AGENCY INC (leave blank to use display name)"
                className="w-full bg-slate-800 border border-slate-700 text-slate-400 text-sm rounded px-3 py-2 placeholder-slate-600 focus:outline-none focus:border-slate-500"
              />
            </div>

            <div>
              <label className="text-xs text-slate-400 mb-1 block">Slug * (auto-filled — edit if needed)</label>
              <input
                type="text"
                value={newForm.slug}
                onChange={e => setNewForm(f => ({ ...f, slug: e.target.value }))}
                placeholder="e.g. smith-bob-ks"
                className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded px-3 py-2 font-mono focus:outline-none focus:border-slate-500"
              />
              <p className="text-xs text-slate-600 mt-1">Used in the dashboard URL — must be unique.</p>
            </div>

            <div>
              <label className="text-xs text-slate-400 mb-1 block">SML team</label>
              <select
                value={newForm.sml_team_id}
                onChange={e => setNewForm(f => ({ ...f, sml_team_id: e.target.value }))}
                className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded px-3 py-2 focus:outline-none focus:border-slate-500"
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
              <th className="py-2.5 px-4 w-24" />
            </tr>
          </thead>
          <tbody>
            {filtered.map(agency => {
              const edit   = edits[agency.id]
              const status = statuses[agency.id] ?? 'idle'
              const error  = errors[agency.id]
              const dirty  = edit ? isDirty(agency, edit) : false

              return (
                <tr key={agency.id} className="border-b border-slate-800 last:border-0 hover:bg-slate-800/30">
                  {/* Display name — the editable friendly name */}
                  <td className="py-2.5 px-4">
                    <input
                      type="text"
                      value={edit?.display_name ?? ''}
                      onChange={e => update(agency.id, 'display_name', e.target.value)}
                      placeholder="Agent name…"
                      className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded px-2 py-1.5 focus:outline-none focus:border-slate-500 placeholder-slate-600"
                    />
                  </td>

                  {/* Allstate business name — read only */}
                  <td className="py-2.5 px-4 text-xs text-slate-500 max-w-[220px] truncate">
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

                  {/* Save */}
                  <td className="py-2.5 px-4 text-right">
                    {error && (
                      <div className="flex items-center justify-end gap-1 text-red-400 text-xs mb-1">
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
                    {status === 'saving' && <Loader2 className="w-4 h-4 text-slate-400 animate-spin ml-auto" />}
                    {status === 'saved'  && <Check className="w-4 h-4 text-green-400 ml-auto" />}
                  </td>
                </tr>
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
