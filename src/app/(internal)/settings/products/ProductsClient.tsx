'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2, AlertCircle, ChevronDown, ChevronUp, Plus, X } from 'lucide-react'
import type { ProductRow, CarrierOption, ProductTypeOption } from './page'

type Props = {
  products:     ProductRow[]
  carriers:     CarrierOption[]
  productTypes: ProductTypeOption[]
}

type EditState = {
  carrier_id:      string
  product_type_id: string
  gdc_multiplier:  string
  is_active:       boolean
  notes:           string
}

type RowStatus = 'idle' | 'saving' | 'saved' | 'error'

function toEditState(p: ProductRow): EditState {
  return {
    carrier_id:      p.carrier_id ?? '',
    product_type_id: p.product_type_id ?? '',
    gdc_multiplier:  String(p.gdc_multiplier),
    is_active:       p.is_active,
    notes:           p.notes ?? '',
  }
}

function isDirty(original: ProductRow, edit: EditState) {
  return (
    (edit.carrier_id || null)       !== (original.carrier_id ?? null) ||
    (edit.product_type_id || null)  !== (original.product_type_id ?? null) ||
    parseFloat(edit.gdc_multiplier) !== original.gdc_multiplier          ||
    edit.is_active                  !== original.is_active               ||
    (edit.notes || null)            !== (original.notes ?? null)
  )
}

type NewProductForm = {
  name:            string
  carrier_id:      string
  product_type_id: string
  gdc_multiplier:  string
  notes:           string
}

const BLANK_NEW: NewProductForm = {
  name: '', carrier_id: '', product_type_id: '', gdc_multiplier: '', notes: '',
}

export function ProductsClient({ products, carriers, productTypes }: Props) {
  const router = useRouter()
  const [edits, setEdits]       = useState<Record<string, EditState>>(() =>
    Object.fromEntries(products.map(p => [p.id, toEditState(p)]))
  )
  const [statuses, setStatuses] = useState<Record<string, RowStatus>>({})
  const [errors, setErrors]     = useState<Record<string, string>>({})
  const [showInactive, setShowInactive] = useState(false)

  const [showAddForm, setShowAddForm]   = useState(false)
  const [newForm, setNewForm]           = useState<NewProductForm>(BLANK_NEW)
  const [addLoading, setAddLoading]     = useState(false)
  const [addError, setAddError]         = useState<string | null>(null)

  function update(id: string, field: keyof EditState, value: string | boolean) {
    setEdits(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }))
    setStatuses(prev => ({ ...prev, [id]: 'idle' }))
  }

  async function save(product: ProductRow) {
    const edit = edits[product.id]
    if (!edit) return

    setStatuses(prev => ({ ...prev, [product.id]: 'saving' }))
    setErrors(prev => ({ ...prev, [product.id]: '' }))

    const gdcVal = parseFloat(edit.gdc_multiplier)
    if (isNaN(gdcVal)) {
      setErrors(prev => ({ ...prev, [product.id]: 'GDC multiplier must be a number' }))
      setStatuses(prev => ({ ...prev, [product.id]: 'error' }))
      return
    }

    const res = await fetch(`/api/admin/products/${product.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        carrier_id:      edit.carrier_id      || null,
        product_type_id: edit.product_type_id || null,
        gdc_multiplier:  gdcVal,
        is_active:       edit.is_active,
        notes:           edit.notes || null,
      }),
    })

    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      setErrors(prev => ({ ...prev, [product.id]: json.error ?? 'Save failed' }))
      setStatuses(prev => ({ ...prev, [product.id]: 'error' }))
      return
    }

    setStatuses(prev => ({ ...prev, [product.id]: 'saved' }))
    setTimeout(() => setStatuses(prev => ({ ...prev, [product.id]: 'idle' })), 2000)
  }

  async function addProduct() {
    const gdcVal = parseFloat(newForm.gdc_multiplier)
    if (!newForm.name.trim()) { setAddError('Product name is required'); return }
    if (isNaN(gdcVal))        { setAddError('GDC multiplier must be a number'); return }

    setAddLoading(true)
    setAddError(null)

    const res = await fetch('/api/admin/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name:            newForm.name.trim(),
        carrier_id:      newForm.carrier_id || null,
        product_type_id: newForm.product_type_id || null,
        gdc_multiplier:  gdcVal,
        notes:           newForm.notes || null,
      }),
    })

    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      setAddError(json.error ?? 'Failed to add product')
      setAddLoading(false)
      return
    }

    setNewForm(BLANK_NEW)
    setShowAddForm(false)
    setAddLoading(false)
    router.refresh()
  }

  const active   = products.filter(p => p.is_active)
  const inactive = products.filter(p => !p.is_active)

  const carrierGroups = Array.from(
    active.reduce((map, p) => {
      const key = p.carrier_name ?? '— No carrier assigned'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(p)
      return map
    }, new Map<string, ProductRow[]>())
  ).sort(([a], [b]) => a.localeCompare(b))

  function renderRow(product: ProductRow) {
    const edit   = edits[product.id]
    const status = statuses[product.id] ?? 'idle'
    const error  = errors[product.id]
    const dirty  = edit ? isDirty(product, edit) : false

    return (
      <tr key={product.id} className="border-b border-slate-800 hover:bg-slate-800/30">
        {/* Product name */}
        <td className="py-2.5 px-4 text-sm text-slate-200 font-medium">{product.name}</td>

        {/* Carrier */}
        <td className="py-2.5 px-4">
          <select
            value={edit?.carrier_id ?? ''}
            onChange={e => update(product.id, 'carrier_id', e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded px-2 py-1.5 focus:outline-none focus:border-slate-500"
          >
            <option value="">— No carrier</option>
            {carriers.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </td>

        {/* Product type */}
        <td className="py-2.5 px-4">
          <select
            value={edit?.product_type_id ?? ''}
            onChange={e => update(product.id, 'product_type_id', e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded px-2 py-1.5 focus:outline-none focus:border-slate-500"
          >
            <option value="">— No type</option>
            {productTypes.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </td>

        {/* GDC multiplier */}
        <td className="py-2.5 px-4 w-28">
          <input
            type="text"
            value={edit?.gdc_multiplier ?? ''}
            onChange={e => update(product.id, 'gdc_multiplier', e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded px-2 py-1.5 font-mono focus:outline-none focus:border-slate-500"
          />
        </td>

        {/* Active toggle */}
        <td className="py-2.5 px-4 text-center">
          <button
            onClick={() => update(product.id, 'is_active', !edit?.is_active)}
            className={`text-xs px-2 py-0.5 rounded font-medium ${
              edit?.is_active
                ? 'bg-green-900/50 text-green-400 border border-green-800'
                : 'bg-slate-700 text-slate-500 border border-slate-600'
            }`}
          >
            {edit?.is_active ? 'Active' : 'Off'}
          </button>
        </td>

        {/* Notes */}
        <td className="py-2.5 px-4">
          <input
            type="text"
            value={edit?.notes ?? ''}
            onChange={e => update(product.id, 'notes', e.target.value)}
            placeholder="Internal notes..."
            className="w-full bg-slate-800 border border-slate-700 text-slate-400 text-xs rounded px-2 py-1.5 placeholder-slate-600 focus:outline-none focus:border-slate-500"
          />
        </td>

        {/* Save */}
        <td className="py-2.5 px-4 text-right w-24">
          {error && (
            <div className="flex items-center justify-end gap-1 text-red-400 text-xs mb-1">
              <AlertCircle className="w-3 h-3" />
              {error}
            </div>
          )}
          {dirty && status !== 'saving' && status !== 'saved' && (
            <button
              onClick={() => save(product)}
              className="text-xs px-3 py-1 rounded font-medium text-white"
              style={{ backgroundColor: '#1F3864' }}
            >
              Save
            </button>
          )}
          {status === 'saving' && <Loader2 className="w-4 h-4 text-slate-400 animate-spin ml-auto" />}
          {status === 'saved' && <Check className="w-4 h-4 text-green-400 ml-auto" />}
        </td>
      </tr>
    )
  }

  return (
    <div className="space-y-8">

      {/* Add product button + form */}
      <div>
        {!showAddForm ? (
          <button
            onClick={() => setShowAddForm(true)}
            className="flex items-center gap-2 text-sm font-medium text-white px-4 py-2 rounded-lg"
            style={{ backgroundColor: '#1F3864' }}
          >
            <Plus className="w-4 h-4" />
            Add Product
          </button>
        ) : (
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-white font-semibold text-sm">New Product</p>
              <button onClick={() => { setShowAddForm(false); setNewForm(BLANK_NEW); setAddError(null) }}>
                <X className="w-4 h-4 text-slate-500 hover:text-slate-300" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs text-slate-400 mb-1 block">Product name *</label>
                <input
                  type="text"
                  value={newForm.name}
                  onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. TermAccel Level Term"
                  className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded px-3 py-2 focus:outline-none focus:border-slate-500"
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 mb-1 block">Carrier</label>
                <select
                  value={newForm.carrier_id}
                  onChange={e => setNewForm(f => ({ ...f, carrier_id: e.target.value }))}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded px-3 py-2 focus:outline-none focus:border-slate-500"
                >
                  <option value="">— No carrier</option>
                  {carriers.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-slate-400 mb-1 block">Product type</label>
                <select
                  value={newForm.product_type_id}
                  onChange={e => setNewForm(f => ({ ...f, product_type_id: e.target.value }))}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded px-3 py-2 focus:outline-none focus:border-slate-500"
                >
                  <option value="">— No type</option>
                  {productTypes.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-slate-400 mb-1 block">GDC multiplier *</label>
                <input
                  type="text"
                  value={newForm.gdc_multiplier}
                  onChange={e => setNewForm(f => ({ ...f, gdc_multiplier: e.target.value }))}
                  placeholder="e.g. 1.17 or 0.055"
                  className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded px-3 py-2 font-mono focus:outline-none focus:border-slate-500"
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 mb-1 block">Notes</label>
                <input
                  type="text"
                  value={newForm.notes}
                  onChange={e => setNewForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Internal notes..."
                  className="w-full bg-slate-800 border border-slate-700 text-slate-400 text-sm rounded px-3 py-2 placeholder-slate-600 focus:outline-none focus:border-slate-500"
                />
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
                onClick={addProduct}
                disabled={addLoading}
                className="flex items-center gap-2 text-sm font-medium text-white px-4 py-2 rounded-lg disabled:opacity-50"
                style={{ backgroundColor: '#1F3864' }}
              >
                {addLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Save Product
              </button>
              <button
                onClick={() => { setShowAddForm(false); setNewForm(BLANK_NEW); setAddError(null) }}
                className="text-sm text-slate-400 hover:text-slate-200"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {carrierGroups.map(([carrierName, rows]) => (
        <div key={carrierName}>
          <h2 className="text-slate-400 text-xs font-semibold uppercase tracking-widest mb-2 px-1">
            {carrierName}
          </h2>
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="py-2 px-4 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Product</th>
                  <th className="py-2 px-4 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Carrier</th>
                  <th className="py-2 px-4 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Type</th>
                  <th className="py-2 px-4 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">GDC ×</th>
                  <th className="py-2 px-4 text-center text-xs font-medium text-slate-500 uppercase tracking-wide">Status</th>
                  <th className="py-2 px-4 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Notes</th>
                  <th className="py-2 px-4" />
                </tr>
              </thead>
              <tbody>
                {rows.map(renderRow)}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {inactive.length > 0 && (
        <div>
          <button
            onClick={() => setShowInactive(v => !v)}
            className="flex items-center gap-2 text-slate-500 text-xs font-semibold uppercase tracking-widest hover:text-slate-400 transition-colors mb-2 px-1"
          >
            {showInactive ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            Inactive products ({inactive.length})
          </button>
          {showInactive && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-800">
                    <th className="py-2 px-4 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Product</th>
                    <th className="py-2 px-4 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Carrier</th>
                    <th className="py-2 px-4 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Type</th>
                    <th className="py-2 px-4 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">GDC ×</th>
                    <th className="py-2 px-4 text-center text-xs font-medium text-slate-500 uppercase tracking-wide">Status</th>
                    <th className="py-2 px-4 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Notes</th>
                    <th className="py-2 px-4" />
                  </tr>
                </thead>
                <tbody>
                  {inactive.map(renderRow)}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
