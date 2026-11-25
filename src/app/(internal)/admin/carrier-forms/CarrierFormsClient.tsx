'use client'

import { useState } from 'react'
import { Plus, Pencil, Trash2, FileText, X, Check, ChevronDown, ChevronUp } from 'lucide-react'
import type { CarrierFormRow, CarrierOption } from './page'

const REQUEST_TYPES = [
  'Billing Issue', 'Change Payment Info', 'Beneficiary Change',
  'Statement of Insurance', 'Address Update', 'Lapse / Reinstatement',
  'Claims Assistance', 'General Coverage Question', 'Policy Review', 'Policy Surrender', 'Other',
]

const FORMS_BUCKET_PREFIX = 'carrier-forms/'

type FormState = {
  carrier_id:   string
  form_number:  string
  form_name:    string
  description:  string
  sr_types:     string[]
  states:       string
  is_fillable:  boolean
  fill_handler: string
  is_current:   boolean
  notes:        string
  file:         File | null
}

const EMPTY: FormState = {
  carrier_id: '', form_number: '', form_name: '', description: '',
  sr_types: [], states: '', is_fillable: false, fill_handler: '',
  is_current: true, notes: '', file: null,
}

function labelFor(form: CarrierFormRow): string {
  return form.carriers?.short_name ?? form.carriers?.name ?? '—'
}

export function CarrierFormsClient({
  initialForms,
  carriers,
}: {
  initialForms: CarrierFormRow[]
  carriers:     CarrierOption[]
}) {
  const [forms, setForms] = useState<CarrierFormRow[]>(initialForms)
  const [modalOpen, setModalOpen]   = useState(false)
  const [editId, setEditId]         = useState<string | null>(null)
  const [state, setState]           = useState<FormState>(EMPTY)
  const [saving, setSaving]         = useState(false)
  const [err, setErr]               = useState<string | null>(null)
  const [deleteId, setDeleteId]     = useState<string | null>(null)
  const [deleting, setDeleting]     = useState(false)
  const [expandedCarrier, setExpandedCarrier] = useState<string | null>(null)

  // Group forms by carrier
  const grouped: Record<string, CarrierFormRow[]> = {}
  for (const f of forms) {
    const key = f.carrier_id ?? 'none'
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(f)
  }
  const carrierOrder = Object.keys(grouped).sort((a, b) => {
    const aName = grouped[a][0]?.carriers?.name ?? 'z'
    const bName = grouped[b][0]?.carriers?.name ?? 'z'
    return aName.localeCompare(bName)
  })

  function openAdd() {
    setEditId(null)
    setState(EMPTY)
    setErr(null)
    setModalOpen(true)
  }

  function openEdit(form: CarrierFormRow) {
    setEditId(form.id)
    setState({
      carrier_id:   form.carrier_id ?? '',
      form_number:  form.form_number ?? '',
      form_name:    form.form_name,
      description:  form.description ?? '',
      sr_types:     form.sr_types ?? [],
      states:       (form.states ?? []).join(', '),
      is_fillable:  form.is_fillable,
      fill_handler: form.fill_handler ?? '',
      is_current:   form.is_current,
      notes:        form.notes ?? '',
      file:         null,
    })
    setErr(null)
    setModalOpen(true)
  }

  function toggleType(t: string) {
    setState(s => ({
      ...s,
      sr_types: s.sr_types.includes(t)
        ? s.sr_types.filter(x => x !== t)
        : [...s.sr_types, t],
    }))
  }

  async function handleSave() {
    if (!state.form_name.trim()) { setErr('Form name is required.'); return }
    if (!state.carrier_id)       { setErr('Carrier is required.');   return }

    setSaving(true); setErr(null)
    try {
      const fd = new FormData()
      fd.append('carrier_id',   state.carrier_id)
      fd.append('form_number',  state.form_number.trim())
      fd.append('form_name',    state.form_name.trim())
      fd.append('description',  state.description.trim())
      fd.append('sr_types',     state.sr_types.join(','))
      fd.append('states',       state.states.trim())
      fd.append('is_fillable',  String(state.is_fillable))
      fd.append('fill_handler', state.fill_handler.trim())
      fd.append('is_current',   String(state.is_current))
      fd.append('notes',        state.notes.trim())
      if (state.file) fd.append('file', state.file)

      const url    = editId ? `/api/admin/carrier-forms/${editId}` : '/api/admin/carrier-forms'
      const method = editId ? 'PATCH' : 'POST'
      const res    = await fetch(url, { method, body: fd })
      const json   = await res.json()
      if (!res.ok) { setErr(json.error ?? 'Save failed'); return }

      if (editId) {
        setForms(fs => fs.map(f => f.id === editId ? { ...f, ...json.data } : f))
      } else {
        // Attach carrier info for display
        const carrier = carriers.find(c => c.id === json.data.carrier_id) ?? null
        setForms(fs => [{ ...json.data, carriers: carrier }, ...fs])
      }
      setModalOpen(false)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteId) return
    setDeleting(true)
    const res = await fetch(`/api/admin/carrier-forms/${deleteId}`, { method: 'DELETE' })
    if (res.ok) {
      setForms(fs => fs.filter(f => f.id !== deleteId))
    }
    setDeleteId(null)
    setDeleting(false)
  }

  const inputCls  = 'w-full bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 placeholder-slate-600'
  const labelCls  = 'block text-xs text-slate-400 mb-1'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Carrier Forms</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Forms surfaced on Service Requests by carrier and request type.
          </p>
        </div>
        <button
          onClick={openAdd}
          className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
          style={{ backgroundColor: '#1F3864' }}
        >
          <Plus className="w-4 h-4" /> Add Form
        </button>
      </div>

      {/* Forms list grouped by carrier */}
      {carrierOrder.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-12 text-center">
          <FileText className="w-8 h-8 text-slate-700 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">No forms yet. Add the first one.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {carrierOrder.map(carrierId => {
            const group = grouped[carrierId]
            const carrierName = group[0]?.carriers?.name ?? 'Unknown Carrier'
            const isExpanded = expandedCarrier === carrierId
            return (
              <div key={carrierId} className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
                <button
                  onClick={() => setExpandedCarrier(isExpanded ? null : carrierId)}
                  className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-800/60 transition-colors text-left"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="font-medium text-slate-200 text-sm">{carrierName}</span>
                    <span className="text-xs text-slate-500 bg-slate-800 rounded-full px-2 py-0.5">
                      {group.length} form{group.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  {isExpanded
                    ? <ChevronUp className="w-4 h-4 text-slate-500" />
                    : <ChevronDown className="w-4 h-4 text-slate-500" />}
                </button>

                {isExpanded && (
                  <div className="border-t border-slate-800">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-800/60">
                          <th className="px-5 py-2.5 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Form</th>
                          <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">SR Types</th>
                          <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">States</th>
                          <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Status</th>
                          <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">File</th>
                          <th className="px-4 py-2.5" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {group.map(form => (
                          <tr key={form.id} className="hover:bg-slate-800/40 transition-colors">
                            <td className="px-5 py-3">
                              <p className="text-slate-200 font-medium">{form.form_name}</p>
                              {form.form_number && (
                                <p className="text-xs text-slate-500 font-mono mt-0.5">{form.form_number}</p>
                              )}
                              {form.description && (
                                <p className="text-xs text-slate-500 mt-0.5">{form.description}</p>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              {!form.sr_types || form.sr_types.length === 0
                                ? <span className="text-xs text-slate-500 italic">All types</span>
                                : (
                                  <div className="flex flex-wrap gap-1">
                                    {form.sr_types.map(t => (
                                      <span key={t} className="text-xs bg-blue-900/40 text-blue-300 rounded px-1.5 py-0.5">{t}</span>
                                    ))}
                                  </div>
                                )}
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-400">
                              {!form.states || form.states.length === 0
                                ? <span className="italic text-slate-500">All states</span>
                                : form.states.join(', ')}
                            </td>
                            <td className="px-4 py-3">
                              {form.is_current
                                ? <span className="text-xs text-emerald-400">Current</span>
                                : <span className="text-xs text-slate-500">Superseded</span>}
                            </td>
                            <td className="px-4 py-3">
                              {form.file_url
                                ? <span className="text-xs text-sky-400">PDF attached</span>
                                : <span className="text-xs text-amber-400">No file</span>}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2 justify-end">
                                <button
                                  onClick={() => openEdit(form)}
                                  className="p-1.5 rounded text-slate-500 hover:text-slate-200 hover:bg-slate-700 transition-colors"
                                  title="Edit"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => setDeleteId(form.id)}
                                  className="p-1.5 rounded text-slate-500 hover:text-red-400 hover:bg-red-900/20 transition-colors"
                                  title="Delete"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Add / Edit modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-800">
              <h2 className="font-semibold text-slate-100">{editId ? 'Edit Form' : 'Add Form'}</h2>
              <button onClick={() => setModalOpen(false)} className="text-slate-500 hover:text-slate-200">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Carrier *</label>
                  <select
                    value={state.carrier_id}
                    onChange={e => setState(s => ({ ...s, carrier_id: e.target.value }))}
                    className={inputCls}
                  >
                    <option value="">— select —</option>
                    {carriers.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Form Number</label>
                  <input
                    type="text"
                    value={state.form_number}
                    onChange={e => setState(s => ({ ...s, form_number: e.target.value }))}
                    placeholder="e.g. ALL2018-4"
                    className={inputCls}
                  />
                </div>
              </div>

              <div>
                <label className={labelCls}>Form Name *</label>
                <input
                  type="text"
                  value={state.form_name}
                  onChange={e => setState(s => ({ ...s, form_name: e.target.value }))}
                  placeholder="e.g. Beneficiary Change Request"
                  className={inputCls}
                />
              </div>

              <div>
                <label className={labelCls}>Description</label>
                <input
                  type="text"
                  value={state.description}
                  onChange={e => setState(s => ({ ...s, description: e.target.value }))}
                  placeholder="Short description of when to use this form"
                  className={inputCls}
                />
              </div>

              <div>
                <label className={labelCls}>Applies to SR Types (leave unchecked = all types)</label>
                <div className="grid grid-cols-2 gap-1.5 mt-1">
                  {REQUEST_TYPES.map(t => (
                    <label key={t} className="flex items-center gap-2 cursor-pointer select-none py-1">
                      <input
                        type="checkbox"
                        checked={state.sr_types.includes(t)}
                        onChange={() => toggleType(t)}
                        className="w-3.5 h-3.5 rounded border-slate-600 accent-blue-500"
                      />
                      <span className="text-xs text-slate-300">{t}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className={labelCls}>States (comma-separated, leave blank = all states)</label>
                <input
                  type="text"
                  value={state.states}
                  onChange={e => setState(s => ({ ...s, states: e.target.value }))}
                  placeholder="e.g. PA, NY, NJ"
                  className={inputCls}
                />
              </div>

              <div>
                <label className={labelCls}>PDF File {editId ? '(upload new to replace)' : ''}</label>
                <input
                  type="file"
                  accept=".pdf,application/pdf"
                  onChange={e => setState(s => ({ ...s, file: e.target.files?.[0] ?? null }))}
                  className="w-full text-sm text-slate-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-slate-700 file:text-slate-200 hover:file:bg-slate-600 cursor-pointer"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={state.is_current}
                    onChange={e => setState(s => ({ ...s, is_current: e.target.checked }))}
                    className="w-4 h-4 rounded border-slate-600 accent-blue-500"
                  />
                  <span className="text-sm text-slate-300">Current version</span>
                </label>
                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={state.is_fillable}
                    onChange={e => setState(s => ({ ...s, is_fillable: e.target.checked }))}
                    className="w-4 h-4 rounded border-slate-600 accent-blue-500"
                  />
                  <span className="text-sm text-slate-300">System can pre-fill</span>
                </label>
              </div>

              {state.is_fillable && (
                <div>
                  <label className={labelCls}>Fill Handler</label>
                  <input
                    type="text"
                    value={state.fill_handler}
                    onChange={e => setState(s => ({ ...s, fill_handler: e.target.value }))}
                    placeholder="e.g. everlake-sa-change"
                    className={inputCls}
                  />
                </div>
              )}

              <div>
                <label className={labelCls}>Notes</label>
                <textarea
                  value={state.notes}
                  onChange={e => setState(s => ({ ...s, notes: e.target.value }))}
                  rows={2}
                  placeholder="Any notes about this form (version, special instructions, etc.)"
                  className={`${inputCls} resize-none`}
                />
              </div>

              {err && <p className="text-xs text-red-400">{err}</p>}
            </div>

            <div className="flex items-center justify-end gap-3 px-6 pb-5 pt-2 border-t border-slate-800">
              <button
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50 hover:opacity-90 transition-opacity"
                style={{ backgroundColor: '#1F3864' }}
              >
                <Check className="w-4 h-4" />
                {saving ? 'Saving…' : editId ? 'Save Changes' : 'Add Form'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm p-6 shadow-2xl">
            <h2 className="font-semibold text-slate-100 mb-2">Delete form?</h2>
            <p className="text-sm text-slate-400 mb-5">
              This will also remove any attached PDF from storage. This cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteId(null)}
                className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 text-sm font-medium text-white bg-red-700 hover:bg-red-600 rounded-lg disabled:opacity-50 transition-colors"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
