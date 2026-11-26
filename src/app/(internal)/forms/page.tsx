import { Printer } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { DOCUMENTS_BUCKET } from '@/lib/projects/review-1035'
import { FormsLibraryClient } from './FormsLibraryClient'
import type { CarrierGroup, FormEntry } from './FormsLibraryClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Forms Library' }

const STATIC_FORMS = [
  {
    id:          'life-app',
    title:       'Life Insurance Application Data',
    description: 'Blank fact-finder form to give to an LSP or client. Covers personal info, health history, existing coverage, beneficiaries, and financial goals.',
    href:        '/forms/life-app/print',
    badge:       'Intake',
  },
]

export default async function FormsPage() {
  const supabase = createAdminClient()

  const { data: formsRaw } = await supabase
    .from('carrier_forms')
    .select('id, form_number, form_name, description, form_category, is_fillable, fill_handler, file_url, carriers ( name, short_name )')
    .eq('is_current', true)
    .order('form_name')

  const carrierMap = new Map<string, CarrierGroup>()
  const miscEntries: FormEntry[] = []

  await Promise.all((formsRaw ?? []).map(async f => {
    let downloadUrl: string | null = null
    if (f.file_url) {
      const { data: signed } = await supabase.storage
        .from(DOCUMENTS_BUCKET)
        .createSignedUrl(f.file_url, 1800)
      downloadUrl = signed?.signedUrl ?? null
    }

    const entry: FormEntry = {
      id:           f.id,
      form_number:  f.form_number,
      form_name:    f.form_name,
      description:  f.description,
      is_fillable:  f.is_fillable,
      fill_handler: f.fill_handler,
      downloadUrl,
    }

    const category = (f.form_category as string | null) ?? 'carrier'
    if (category === 'misc') {
      miscEntries.push(entry)
    } else {
      const carrierName = (f.carriers as unknown as { name: string } | null)?.name ?? 'Other'
      if (!carrierMap.has(carrierName)) {
        carrierMap.set(carrierName, { carrier: carrierName, forms: [] })
      }
      carrierMap.get(carrierName)!.forms.push(entry)
    }
  }))

  const carrierGroups = Array.from(carrierMap.values()).sort((a, b) =>
    a.carrier.localeCompare(b.carrier)
  )
  miscEntries.sort((a, b) => a.form_name.localeCompare(b.form_name))

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-white">Forms Library</h1>
        <p className="mt-1 text-sm text-slate-400">
          Intake forms, carrier service forms, and other documents. Manage the library at{' '}
          <a href="/admin/carrier-forms" className="text-blue-400 hover:text-blue-300 transition-colors">
            Admin → Carrier Forms
          </a>
          .
        </p>
      </div>

      {/* ── Intake forms ───────────────────────────────────────────────────── */}
      <section className="mb-10">
        <h2 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-3">Intake</h2>
        <div className="space-y-3">
          {STATIC_FORMS.map(form => (
            <div
              key={form.id}
              className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900 px-5 py-4"
            >
              <div className="flex items-start gap-4">
                <div className="mt-0.5 rounded-lg bg-slate-800 p-2">
                  <Printer className="w-4 h-4 text-slate-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-white">{form.title}</p>
                    <span className="text-xs px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-400">{form.badge}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">{form.description}</p>
                </div>
              </div>
              <a
                href={form.href}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-6 shrink-0 flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
              >
                <Printer className="w-3.5 h-3.5" />
                Print / Open
              </a>
            </div>
          ))}
        </div>
      </section>

      {/* ── Carrier + misc forms (collapsible) ─────────────────────────────── */}
      <FormsLibraryClient carrierGroups={carrierGroups} miscEntries={miscEntries} />
    </div>
  )
}
