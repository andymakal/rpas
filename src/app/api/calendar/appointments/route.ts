import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInternalAdmin } from '@/lib/stewardship/auth'
import { resolveProducerForUser } from '@/lib/capabilities/resolve'
import { createTimeContext, customerWallClockToInstant } from '@/lib/time'
import { deriveCustomerZone } from '@/lib/calendar/customer-zone'
import { createGuardedAppointment } from '@/lib/calendar/appointments'
import { buildAppointmentIcs, icsFilename } from '@/lib/calendar/ics'

/**
 * POST /api/calendar/appointments
 *
 * Create an exact-time calendar appointment (Layer A) from a promised callback
 * with a specific time. The acting producer (the person recording the call)
 * owns it, so it becomes their own My Work appointment; the group-offer /
 * claim / reassign path is Layer B.
 *
 * Body:
 *   {
 *     customer_id:  string,           // the customer the appointment is with
 *     date:         'YYYY-MM-DD',     // customer-local date
 *     clock:        'HH:MM',          // customer-local exact time
 *     duration_minutes?: number,      // default 30
 *     source_type?: string,           // e.g. 'stewardship_outreach'
 *     source_id?:   string,           // the outreach row id
 *     title?:       string,
 *     notes?:       string,
 *     location?:    string,           // e.g. a phone number
 *   }
 *
 * The appointment time is interpreted on the CUSTOMER'S clock (derived from the
 * customer's state; falls back to the time module default when unknown), stored
 * as an absolute instant plus the stated IANA zone, and the response carries an
 * .ics the operator sends from Outlook (Right Path never sends email).
 */

const DEFAULT_DURATION_MIN = 30

export async function POST(request: NextRequest) {
  const auth = await requireInternalAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  const sessionClient = await createClient()
  const { data: { user } } = await sessionClient.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const producer = await resolveProducerForUser(user.id)
  if (!producer) {
    return Response.json(
      { error: 'Your account has no team member profile, so it cannot own an appointment.' },
      { status: 403 },
    )
  }

  let body: {
    customer_id?: string
    date?: string
    clock?: string
    duration_minutes?: number
    source_type?: string
    source_id?: string
    title?: string
    notes?: string
    location?: string
  }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const customerId = body.customer_id
  const date = (body.date ?? '').trim()
  const clock = (body.clock ?? '').trim()
  if (!customerId) return Response.json({ error: 'customer_id is required' }, { status: 400 })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return Response.json({ error: 'A valid date is required' }, { status: 400 })
  if (!/^\d{2}:\d{2}$/.test(clock)) return Response.json({ error: 'A valid exact time is required' }, { status: 400 })

  const supabase = createAdminClient()

  // Read the customer for the stated zone (from state) and the invite display.
  const { data: customer, error: custErr } = await supabase
    .from('customers')
    .select('id, first_name, last_name, email, state')
    .eq('id', customerId)
    .maybeSingle()
  if (custErr) return Response.json({ error: custErr.message }, { status: 500 })
  if (!customer) return Response.json({ error: 'Customer not found' }, { status: 404 })

  // The appointment is stated on the CUSTOMER'S clock. Derive it from their
  // state; fall back to the time module's documented default when unknown. The
  // derived zone (known or fallback) is what we STORE, so the stated local time
  // is always re-derivable.
  const derived = deriveCustomerZone((customer as { state: string | null }).state)
  const ctx = createTimeContext({ customerTimeZone: derived?.timeZone ?? null })
  const statedTimeZone = ctx.customerTimeZone

  const startsAt = customerWallClockToInstant(ctx, date, clock)
  if (!startsAt) return Response.json({ error: 'Could not resolve the appointment time' }, { status: 400 })
  const duration = Number.isFinite(body.duration_minutes) && (body.duration_minutes as number) > 0
    ? Math.floor(body.duration_minutes as number)
    : DEFAULT_DURATION_MIN
  const endsAt = new Date(startsAt.getTime() + duration * 60 * 1000)

  const custName = [customer.first_name, customer.last_name].filter(Boolean).join(' ').trim() || 'the customer'
  const title = body.title?.trim() || `Call with ${custName}`

  // Create with the kind-aware double-booking guard.
  const result = await createGuardedAppointment(supabase, {
    producerId: producer.id,
    startsAt,
    endsAt,
    statedTimeZone,
    customerId,
    sourceType: body.source_type?.trim() || null,
    sourceId: body.source_id?.trim() || null,
    title,
    notes: body.notes?.trim() || null,
    location: body.location?.trim() || null,
    createdBy: user.id,
  })
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status })

  // Build the .ics the operator sends from Outlook. Right Path never sends it;
  // this is the attachment for the mailto/Outlook contract.
  const ics = buildAppointmentIcs({
    start: startsAt,
    end: endsAt,
    statedTimeZone,
    summary: title,
    description: body.notes?.trim() || undefined,
    location: body.location?.trim() || undefined,
    attendees: customer.email ? [{ name: custName, email: customer.email }] : undefined,
    uid: result.id,
  })

  return Response.json({
    data: {
      appointment_id: result.id,
      stated_time_zone: statedTimeZone,
      zone_ambiguous: derived?.ambiguous ?? false,
      zone_known: ctx.customerTimeZoneKnown,
      ics,
      ics_filename: icsFilename(title),
    },
  })
}
