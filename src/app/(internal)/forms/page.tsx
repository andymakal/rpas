import { FileText, Printer } from 'lucide-react'

export const metadata = { title: 'Forms' }

const FORMS = [
  {
    id:          'life-app',
    title:       'Life Insurance Application Data',
    description: 'Blank fact-finder form to give to an LSP or client. Covers personal info, health history, existing coverage, beneficiaries, and financial goals.',
    href:        '/forms/life-app/print',
    badge:       'Intake',
  },
]

export default function FormsPage() {
  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-white">Forms</h1>
        <p className="mt-1 text-sm text-slate-400">
          Printable forms for clients, LSPs, and internal use. Carrier service forms coming soon.
        </p>
      </div>

      <div className="space-y-3">
        {FORMS.map(form => (
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

      <div className="mt-10 rounded-xl border border-dashed border-slate-700 p-6 text-center">
        <FileText className="mx-auto w-6 h-6 text-slate-600 mb-2" />
        <p className="text-sm text-slate-500">Carrier service forms will appear here as they are added.</p>
      </div>
    </div>
  )
}
