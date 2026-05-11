import { createAdminClient } from '@/lib/supabase/admin'
import { notFound } from 'next/navigation'
import { ReferralIntakeForm } from '@/components/intake/ReferralIntakeForm'

export default async function SlugIntakePage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const supabase = createAdminClient()

  const { data: agency } = await supabase
    .from('agencies')
    .select('id, agency_name, principal_first_name, principal_last_name')
    .eq('slug', slug)
    .eq('is_active', true)
    .single()

  if (!agency) notFound()

  return (
    <main className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-slate-900 px-6 py-4 flex-shrink-0">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-400 tracking-widest uppercase">
              Right Path Agency System
            </p>
            <p className="text-white font-bold text-lg leading-tight">
              Makal Financial Services, LLC
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-400">Questions?</p>
            <a href="tel:+18148087526"
              className="text-sm text-slate-300 font-medium hover:text-white transition-colors">
              (814) 808-7526
            </a>
          </div>
        </div>
      </header>
      <div className="flex-1 flex flex-col items-center justify-start px-4 py-8">
        <div className="w-full max-w-lg">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-slate-900">Submit a Referral</h1>
            <p className="text-slate-500 mt-1 text-sm">
              Takes about 90 seconds. We'll take it from here.
            </p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
            <ReferralIntakeForm
              prefilledAgencyId={agency.id}
              prefilledAgencyName={`${agency.principal_first_name} ${agency.principal_last_name}`}
              agencySlug={slug}
            />
          </div>
          <p className="text-center text-xs text-slate-400 mt-6 px-4">
            All referrals are handled in accordance with Allstate Financial Services
            compliance guidelines. Client information is kept confidential.
          </p>
        </div>
      </div>
    </main>
  )
}