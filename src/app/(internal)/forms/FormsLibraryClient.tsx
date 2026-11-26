'use client'

import { useState } from 'react'
import { FileText, Download, ChevronDown, ChevronUp } from 'lucide-react'

export type FormEntry = {
  id:            string
  form_number:   string | null
  form_name:     string
  description:   string | null
  is_fillable:   boolean
  fill_handler:  string | null
  downloadUrl:   string | null
}

export type CarrierGroup = {
  carrier: string
  forms:   FormEntry[]
}

function FormRow({ form }: { form: FormEntry }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900 px-5 py-4">
      <div className="flex items-start gap-4 min-w-0">
        <div className="mt-0.5 rounded-lg bg-slate-800 p-2 shrink-0">
          <FileText className="w-4 h-4 text-slate-400" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-white">{form.form_name}</p>
            {form.form_number && (
              <span className="text-xs font-mono px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-500">
                {form.form_number}
              </span>
            )}
            {form.is_fillable && (
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-teal-400/10 text-teal-400 border border-teal-400/20">
                Auto-fill
              </span>
            )}
          </div>
          {form.description && (
            <p className="mt-0.5 text-xs text-slate-500">{form.description}</p>
          )}
        </div>
      </div>
      {form.downloadUrl && (
        <a
          href={form.downloadUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-6 shrink-0 flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          PDF
        </a>
      )}
    </div>
  )
}

function CollapsibleSection({
  title,
  count,
  defaultOpen = true,
  children,
}: {
  title:        string
  count:        number
  defaultOpen?: boolean
  children:     React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-800/60 transition-colors text-left"
      >
        <div className="flex items-center gap-2.5">
          <span className="font-medium text-slate-200 text-sm">{title}</span>
          <span className="text-xs text-slate-500 bg-slate-800 rounded-full px-2 py-0.5">
            {count} form{count !== 1 ? 's' : ''}
          </span>
        </div>
        {open
          ? <ChevronUp className="w-4 h-4 text-slate-500 shrink-0" />
          : <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />}
      </button>
      {open && (
        <div className="border-t border-slate-800 px-4 py-3 space-y-2">
          {children}
        </div>
      )}
    </div>
  )
}

export function FormsLibraryClient({
  carrierGroups,
  miscEntries,
}: {
  carrierGroups: CarrierGroup[]
  miscEntries:   FormEntry[]
}) {
  const hasCarrier = carrierGroups.length > 0
  const hasMisc    = miscEntries.length > 0

  if (!hasCarrier && !hasMisc) {
    return (
      <div className="rounded-xl border border-dashed border-slate-700 p-6 text-center">
        <FileText className="mx-auto w-6 h-6 text-slate-600 mb-2" />
        <p className="text-sm text-slate-500">
          No carrier forms added yet.{' '}
          <a href="/admin/carrier-forms" className="text-blue-400 hover:text-blue-300 transition-colors">
            Add the first one →
          </a>
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-10">
      {hasCarrier && (
        <section>
          <h2 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-3">
            Carrier Service Forms
          </h2>
          <div className="space-y-2">
            {carrierGroups.map(group => (
              <CollapsibleSection
                key={group.carrier}
                title={group.carrier}
                count={group.forms.length}
              >
                {group.forms.map(form => (
                  <FormRow key={form.id} form={form} />
                ))}
              </CollapsibleSection>
            ))}
          </div>
        </section>
      )}

      {hasMisc && (
        <section>
          <h2 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-3">
            Miscellaneous Forms
          </h2>
          <CollapsibleSection title="Miscellaneous" count={miscEntries.length}>
            {miscEntries.map(form => (
              <FormRow key={form.id} form={form} />
            ))}
          </CollapsibleSection>
        </section>
      )}
    </div>
  )
}
