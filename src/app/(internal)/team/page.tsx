import type { Metadata } from 'next'
import { TeamClient } from './TeamClient'
import { createAdminClient } from '@/lib/supabase/admin'

export const metadata: Metadata = { title: 'Team' }
export const dynamic = 'force-dynamic'

export type Producer = {
  id: string                    // producer.id if record exists; auth user id otherwise (temp)
  has_producer_record: boolean  // true if a row in producers table exists
  auth_user_id: string | null
  first_name: string
  last_name: string
  email: string | null
  phone: string | null
  title: string | null
  allstate_id: string | null
  npn: string | null
  sub_producer_code: string | null
  birthday: string | null
  is_active: boolean
  // From auth
  auth_email: string
  confirmed: boolean
  last_sign_in: string | null
  created_at: string
}

export default async function TeamPage() {
  const supabase = createAdminClient()

  const [
    { data: { users } },
    { data: producers },
  ] = await Promise.all([
    supabase.auth.admin.listUsers({ perPage: 200 }),
    supabase.from('producers').select('*').order('last_name'),
  ])

  const producerByAuthId = new Map(
    (producers ?? []).map(p => [p.auth_user_id, p])
  )

  // Build merged list: auth users that have a producer record (or any auth user)
  const members: Producer[] = (users ?? []).map(u => {
    const p = producerByAuthId.get(u.id)
    return {
      id:                  p?.id ?? u.id,
      has_producer_record: !!p,
      auth_user_id:        u.id,
      first_name:       p?.first_name ?? (u.user_metadata?.full_name as string ?? '').split(' ')[0] ?? '',
      last_name:        p?.last_name  ?? (u.user_metadata?.full_name as string ?? '').split(' ').slice(1).join(' ') ?? '',
      email:            p?.email ?? null,
      phone:            p?.phone ?? null,
      title:            p?.title ?? null,
      allstate_id:      p?.allstate_id ?? null,
      npn:              p?.npn ?? null,
      sub_producer_code: p?.sub_producer_code ?? null,
      birthday:         p?.birthday ?? null,
      is_active:        p?.is_active ?? true,
      auth_email:       u.email ?? '',
      confirmed:        !!u.email_confirmed_at,
      last_sign_in:     u.last_sign_in_at ?? null,
      created_at:       u.created_at,
    }
  })

  members.sort((a, b) => {
    if (a.confirmed !== b.confirmed) return a.confirmed ? -1 : 1
    const aLabel = `${a.first_name} ${a.last_name}`.trim() || a.auth_email
    const bLabel = `${b.first_name} ${b.last_name}`.trim() || b.auth_email
    return aLabel.localeCompare(bLabel)
  })

  return <TeamClient members={members} />
}
