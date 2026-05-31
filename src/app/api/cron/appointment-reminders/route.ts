import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest }        from 'next/server'

/**
 * GET /api/cron/appointment-reminders
 *
 * Runs daily (configured in vercel.json).
 * Finds every case with appointment_date = tomorrow and internal_status =
 * 'appointment_set', then creates an in-app notification so the team
 * member sees the reminder and can send the pre-composed email.
 *
 * Security: Vercel passes the CRON_SECRET as a Bearer token.
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()

  // Tomorrow's date in YYYY-MM-DD (UTC)
  const tomorrow = new Date()
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  const tomorrowStr = tomorrow.toISOString().slice(0, 10)

  const { data: cases, error } = await supabase
    .from('cases')
    .select(`
      id,
      appointment_date,
      appointment_time,
      customers!customer_id ( first_name, last_name )
    `)
    .eq('internal_status', 'appointment_set')
    .eq('is_test', false)
    .like('appointment_date', `${tomorrowStr}%`)

  if (error) {
    console.error('appointment-reminders cron error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  const rows = (cases ?? []) as unknown as {
    id: string
    appointment_date: string
    appointment_time: string | null
    customers: { first_name: string; last_name: string } | null
  }[]

  if (rows.length === 0) {
    return Response.json({ ok: true, sent: 0 })
  }

  const notifications = rows.map(c => {
    const name = c.customers
      ? `${c.customers.first_name} ${c.customers.last_name}`
      : 'Unknown'
    const time = c.appointment_time ?? ''
    return {
      type:  'appointment_reminder',
      title: `📅 Appointment tomorrow: ${name}`,
      body:  time ? `Send a reminder email — appointment at ${time}` : 'Send a reminder email',
      link:  `/referrals/${c.id}`,
    }
  })

  const { error: notifErr } = await supabase
    .from('notifications')
    .insert(notifications)

  if (notifErr) {
    console.error('appointment-reminders notification insert error:', notifErr)
    return Response.json({ error: notifErr.message }, { status: 500 })
  }

  return Response.json({ ok: true, sent: rows.length })
}
