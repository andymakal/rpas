import type { Metadata } from 'next'
import { TeamClient } from './TeamClient'
import { createAdminClient } from '@/lib/supabase/admin'

export const metadata: Metadata = { title: 'Team' }
export const dynamic = 'force-dynamic'

export type TeamMember = {
  id: string
  email: string
  full_name: string | null
  confirmed: boolean
  last_sign_in: string | null
  created_at: string
}

export default async function TeamPage() {
  const supabase = createAdminClient()
  const { data: { users } } = await supabase.auth.admin.listUsers({ perPage: 200 })

  const members: TeamMember[] = (users ?? []).map(u => ({
    id:           u.id,
    email:        u.email ?? '',
    full_name:    (u.user_metadata?.full_name as string | null) ?? null,
    confirmed:    !!u.email_confirmed_at,
    last_sign_in: u.last_sign_in_at ?? null,
    created_at:   u.created_at,
  }))

  // Sort: confirmed first, then alphabetically by name/email
  members.sort((a, b) => {
    if (a.confirmed !== b.confirmed) return a.confirmed ? -1 : 1
    const aLabel = a.full_name ?? a.email
    const bLabel = b.full_name ?? b.email
    return aLabel.localeCompare(bLabel)
  })

  return <TeamClient members={members} />
}
