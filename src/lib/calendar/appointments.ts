/**
 * Server-side calendar appointment creation and the kind-aware double-booking
 * guard (CALENDAR_DESIGN.md §4a, §9 Layer A).
 *
 * Layer A creates exactly one shape: an exact-time `appointment` owned by a
 * producer, referencing a source workflow (the stewardship callback). Before it
 * writes, it rejects an overlap with that producer's existing time, using the
 * kind-aware rule:
 *
 *   - overlap with an `appointment` or a `busy` block  -> CONFLICT (reject)
 *   - overlap with a matching-purpose `hold`           -> NOT a conflict
 *     (the hold is being used as intended; Layer C concern, not triggered here)
 *
 * Only the pure OVERLAP math (`intervalsOverlap`, `isDoubleBooked`) lives here as
 * testable functions; the DB read/insert are thin wrappers a route calls with a
 * service-role client.
 */

import type { createAdminClient } from '@/lib/supabase/admin'

/** Half-open interval overlap: [aStart,aEnd) intersects [bStart,bEnd). Touching
 * endpoints (a ends exactly when b starts) do NOT overlap. */
export function intervalsOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime()
}

/** A minimal existing-block shape for the guard. */
export interface GuardBlock {
  kind: 'appointment' | 'busy' | 'hold'
  purpose: string | null
  starts_at: string
  ends_at: string
}

/**
 * Whether a proposed [start,end) double-books the producer against their
 * existing live blocks, kind-aware:
 *   - an 'appointment' or 'busy' block that overlaps is a conflict;
 *   - a 'hold' is never a conflict for Layer A (it is fillable, not blocking;
 *     a matching-purpose appointment belongs inside it, and a non-matching one
 *     is a Layer C concern this guard does not adjudicate).
 */
export function isDoubleBooked(
  start: Date,
  end: Date,
  existing: GuardBlock[],
): boolean {
  for (const b of existing) {
    if (b.kind === 'hold') continue
    const bStart = new Date(b.starts_at)
    const bEnd = new Date(b.ends_at)
    if (intervalsOverlap(start, end, bStart, bEnd)) return true
  }
  return false
}

export interface CreateAppointmentInput {
  producerId: string
  startsAt: Date
  endsAt: Date
  /** The IANA zone the appointment was STATED in (the customer's zone). */
  statedTimeZone: string
  customerId: string | null
  sourceType: string | null
  sourceId: string | null
  title: string | null
  notes: string | null
  location: string | null
  createdBy: string | null
}

export type CreateAppointmentResult =
  | { ok: true; id: string }
  | { ok: false; status: number; error: string }

/**
 * Create an exact-time appointment for a producer, guarding against a
 * double-booking first. Reads the producer's live same-day blocks, applies the
 * kind-aware guard, and inserts on success. The guard read window is the
 * calendar day around the appointment (a cheap, index-backed range), which is
 * sufficient for a point-in-time overlap check.
 */
export async function createGuardedAppointment(
  supabase: ReturnType<typeof createAdminClient>,
  input: CreateAppointmentInput,
): Promise<CreateAppointmentResult> {
  if (!(input.endsAt.getTime() > input.startsAt.getTime())) {
    return { ok: false, status: 400, error: 'Appointment end must be after its start.' }
  }

  // Read the producer's live blocks in a window spanning the appointment, to
  // check overlap. A 1-day pad on each side covers any block that starts the day
  // before and runs long; the overlap test itself is exact.
  const windowStart = new Date(input.startsAt.getTime() - 24 * 60 * 60 * 1000)
  const windowEnd = new Date(input.endsAt.getTime() + 24 * 60 * 60 * 1000)

  const { data: existing, error: readErr } = await supabase
    .from('calendar_blocks')
    .select('kind, purpose, starts_at, ends_at')
    .eq('producer_id', input.producerId)
    .eq('is_current', true)
    .lt('starts_at', windowEnd.toISOString())
    .gt('ends_at', windowStart.toISOString())
  if (readErr) return { ok: false, status: 500, error: readErr.message }

  if (isDoubleBooked(input.startsAt, input.endsAt, (existing ?? []) as GuardBlock[])) {
    return {
      ok: false,
      status: 409,
      error: 'That producer already has an appointment at that time. Pick another time or producer.',
    }
  }

  const { data: inserted, error: insErr } = await supabase
    .from('calendar_blocks')
    .insert({
      producer_id: input.producerId,
      kind: 'appointment',
      has_time: true,
      starts_at: input.startsAt.toISOString(),
      ends_at: input.endsAt.toISOString(),
      stated_time_zone: input.statedTimeZone,
      customer_id: input.customerId,
      source_type: input.sourceType,
      source_id: input.sourceId,
      title: input.title,
      notes: input.notes,
      location: input.location,
      status: 'confirmed',
      // Layer A: the acting producer owns the appointment, so it is their own
      // My Work appointment. (The group-offer + claim/reassign path is Layer B.)
      claimed_by_producer_id: input.producerId,
      claimed_at: new Date().toISOString(),
      created_by: input.createdBy,
    })
    .select('id')
    .single()
  if (insErr) return { ok: false, status: 500, error: insErr.message }

  return { ok: true, id: inserted.id }
}
