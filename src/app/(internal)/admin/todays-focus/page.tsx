import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { TodaysFocusClient, type FocusFormOption, type ActiveFocusRow } from './TodaysFocusClient'

export const metadata: Metadata = { title: "Today's Focus" }
export const dynamic = 'force-dynamic'

/**
 * Today's Focus (management direction). Lets appropriate management elevate a
 * project or a single activity for a bounded period. The elevation feeds the
 * GoRules Daily Direction decision and influences MY WORK ordering; it never
 * disables other work and never overrides a customer commitment. Every focus is
 * temporary (it must carry an expiry).
 */
export default async function TodaysFocusPage() {
  const sessionClient = await createClient()
  const { data: { user } } = await sessionClient.auth.getUser()
  if (!user) redirect('/login')

  const supabase = createAdminClient()
  const [{ data: projects }, { data: workFunctions }, { data: active }] = await Promise.all([
    supabase
      .from('projects')
      .select('id, name')
      .eq('status', 'active')
      .order('created_at', { ascending: false }),
    supabase
      .from('work_functions')
      .select('id, label, canonical_key')
      .eq('is_active', true)
      .order('sort_order'),
    supabase
      .from('todays_focus')
      .select('id, scope, note, expires_at, projects ( name ), work_functions ( label )')
      .gt('expires_at', new Date().toISOString())
      .order('expires_at', { ascending: true }),
  ])

  const projectOptions: FocusFormOption[] = (projects ?? []).map((p) => ({ id: p.id as string, label: p.name as string }))
  const activityOptions: FocusFormOption[] = (workFunctions ?? []).map((w) => ({ id: w.id as string, label: w.label as string }))

  const activeFocus: ActiveFocusRow[] = (active ?? []).map((f) => {
    const row = f as typeof f & { projects: { name: string } | null; work_functions: { label: string } | null }
    return {
      id: row.id as string,
      scope: row.scope as 'project' | 'activity',
      label: row.scope === 'project' ? (row.projects?.name ?? 'a project') : (row.work_functions?.label ?? 'an activity'),
      note: (row.note as string | null) ?? null,
      expiresAt: row.expires_at as string,
    }
  })

  return (
    <TodaysFocusClient
      projectOptions={projectOptions}
      activityOptions={activityOptions}
      activeFocus={activeFocus}
    />
  )
}
