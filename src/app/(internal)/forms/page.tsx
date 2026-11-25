import { FileText, Printer, Download } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { DOCUMENTS_BUCKET } from '@/lib/projects/review-1035'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Forms' }

const STATIC_FORMS = [
  {
    id:          'life-app',
    title:       'Life Insurance Application Data',
    description: 'Blank fact-finder form to give to an LSP or client. Covers personal info, health history, existing coverage, beneficiaries, and financial goals.',
    href:        '/forms/life-app/print',
    badge:       'Intake',
  },
]

type CarrierGroup = {
  carrier: string
  forms: {
    id:           string
    form_number:  string | null
    form_name:    string
    description:  string | null
    is_fillable:  boolean
    fill_handler: string | null
    downloadUrl:  string | null
  }[]
}

export default async function FormsPage() {
  const supabase = createAdminClient()

  const { data: formsRaw } = await supabase
    .from('carrier_forms')
    .select('id, form_number, form_name, description, is_fillable, fill_handler, file_url, carriers ( name, short_name )')
    .eq('is_current', true)
    .order('form_name')

  // Generate signed URLs and group by carrier
  const carrierMap = new Map<string, CarrierGroup>()

  await Promise.all((formsRaw ?? []).map(async f => {
    const carrierName = (f.carriers as unknown as { name: string; short_name: string } | null)?.name ?? 'Other'

    let downloadUrl: string | null = null
    if (f.file_url) {
      const { data: signed } = await supabase.storage
        .from(DOCUMENTS_BUCKET)
        .createSignedUrl(f.file_url, 1800)
      downloadUrl = signed?.signedUrl ?? null
    }

    if (!carrierMap.has(carrierName)) {
      carrierMap.set(carrierName, { carrier: carrierName, forms: [] })
    }
    carrierMap.get(carrierName)!.forms.push({
      id:           f.id,
      form_number:  f.form_number,
      form_name:    f.form_name,
      description:  f.description,
      is_fillable:  f.is_fillable,
      fill_handler: f.fill_handler,
      downloadUrl,
    })
  }))

  const carrierGroups = Array.from(carrierMap.values()).sort((a, b) =>
    a.carrier.localeCompare(b.carrier)
  )

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-white">Forms Library</h1>
        <p className="mt-1 text-sm text-slate-400">
          Intake forms, carrier service forms, and other documents. Manage the carrier library at{' '}
          <a href="/admin/carrier-forms" className="text-blue-400 hover:text-blue-300 transition-colors">
            Admin → Carrier Forms
          </a>
          .
        </p>
      </div>

      {/* ── Intake forms ──────────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-3">Intake</h2>
        <div className="space-y-3">
          {STATIC_FORMS.map(form => (
            <div
              key={form.id}
              className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900 px-5 py-4"
            >
              <div className="flex items-start gap-4">
                <div className="mt-0.5 rounded-lg bg-slate-800 p-2">
                  <FileText className="w-4 h-4 text-slate-400" />
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

      {/* ── Carrier forms ─────────────────────────────────────────────────── */}
      {carrierGroups.length > 0 ? (
        <section>
          <h2 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-3">Carrier Service Forms</h2>
          <div className="space-y-6">
            {carrierGroups.map(group => (
              <div key={group.carrier}>
                <h3 className="text-sm font-semibold text-slate-300 mb-2">{group.carrier}</h3>
                <div className="space-y-2">
                  {group.forms.map(form => (
                    <div
                      key={form.id}
                      className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900 px-5 py-4"
                    >
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
                      <div className="ml-6 shrink-0 flex items-center gap-2">
                        {form.downloadUrl && (
                          <a
                            href={form.downloadUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
                          >
                            <Download className="w-3.5 h-3.5" />
                            PDF
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-700 p-6 text-center">
          <FileText className="mx-auto w-6 h-6 text-slate-600 mb-2" />
          <p className="text-sm text-slate-500">
            No carrier forms added yet.{' '}
            <a href="/admin/carrier-forms" className="text-blue-400 hover:text-blue-300 transition-colors">
              Add the first one →
            </a>
          </p>
        </div>
      )}
    </div>
  )
}
