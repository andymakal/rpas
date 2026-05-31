import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest }        from 'next/server'

/**
 * GET /api/cron/annual-reviews
 *
 * Runs daily (configured in vercel.json).
 * Finds every placed case where placed_at is between 350 and 370 days ago
 * (a 3-week window around the anniversary so no one slips through).
 * Creates an in-app notification so Andy can open the case and send the
 * pre-composed annual review email.
 *
 * Security: Vercel passes the CRON_SECRET as a Bearer token.
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()

  const now    = new Date()
  const lo     = new Date(now); lo.setDate(lo.getDate() - 370)
  const hi     = new Date(now); hi.setDate(hi.getDate() - 350)
  const loStr  = lo.toISOString()
  const hiStr  = hi.toISOString()

  const { data: cases, error } = await supabase
    .from('cases')
    .select(`
      id,
      placed_at,
      customers!customer_id ( first_name, last_name )
    `)
    .eq('internal_status', 'placed')
    .eq('is_test', false)
    .gte('placed_at', loStr)
    .lte('placed_at', hiStr)

  if (error) {
    console.error('annual-reviews cron error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  const rows = (cases ?? []) as unknown as {
    id: string
    placed_at: string
    customers: { first_name: string; last_name: string } | null
  }[]

  if (rows.length === 0) {
    return Response.json({ ok: true, sent: 0 })
  }

  const notifications = rows.map(c => {
    const name = c.customers
      ? `${c.customers.first_name} ${c.customers.last_name}`
      : 'Unknown'
    return {
      type:  'annual_review',
      title: `🎂 Annual review due: ${name}`,
      body:  'It\'s been about a year since placement — send the annual check-in email',
      link:  `/cases/${c.id}`,
    }
  })

  const { error: notifErr } = await supabase
    .from('notifications')
    .insert(notifications)

  if (notifErr) {
    console.error('annual-reviews notification insert error:', notifErr)
    return Response.json({ error: notifErr.message }, { status: 500 })
  }

  return Response.json({ ok: true, sent: rows.length })
}
