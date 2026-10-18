import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireInternalAdmin } from '@/lib/stewardship/auth'
import { resolveProducerForUser } from '@/lib/capabilities/resolve'
import {
  reserveSubject,
  reserveNextSubject,
  heartbeatReservation,
  releaseSubject,
  type ReservationActivityKey,
  type ReservationSubjectType,
} from '@/lib/reservations/work-reservations'

/**
 * POST /api/reservations — the shared temporary work-reservation endpoint.
 *
 * One route serves every shared activity (Send Introductory Emails, Contact
 * Research, and any future one) so the coordination behaves identically
 * everywhere. A reservation is a soft, self-expiring lease — not ownership,
 * assignment, or a workflow status — so this route NEVER touches a business
 * record; it only records/renews/clears who is temporarily working a subject.
 *
 * Actions (in the `action` field):
 *   - 'next'      Reserve the first AVAILABLE subject from the caller's ordered
 *                 candidate list (the still-to-do work the activity's own list
 *                 API already scoped to this employee — project, filters, and
 *                 eligibility are enforced THERE, upstream). This is the open
 *                 and the Save & Next primitive: it hands the employee the next
 *                 free subject, atomically skipping any a teammate is already
 *                 working. Returns the reserved subject id, or null when every
 *                 candidate is currently taken.
 *   - 'reserve'  Reserve ONE specific subject (e.g. a deliberate reopen). Returns
 *                 whether the caller now holds it.
 *   - 'heartbeat' Extend the caller's live lease on a subject while they work.
 *   - 'release'  Drop the caller's reservation (completing, skipping, leaving).
 *
 * Concurrency and recovery live entirely in the SQL primitive this calls: the
 * subject is unique per (activity, type, id), every state change takes a row
 * lock, and leases expire, so two employees acting at the same instant can never
 * both win the same subject and an abandoned session frees automatically. The
 * route's only job is to authenticate the caller, resolve their producer, and
 * forward the request.
 *
 * Why the route trusts the client's candidate list: a reservation changes no
 * business record, and the authoritative save routes (PATCH /api/stewardship/[id]
 * and the contact-review save) each re-enforce their own membership/eligibility
 * on the actual mutation. The candidate list is already the server-scoped
 * population the activity handed the client, so this layer is pure coordination
 * on top of it — the smallest reliable shared solution.
 */

const ACTIVITY_KEYS: ReservationActivityKey[] = ['introductory_emails', 'contact_research']
const SUBJECT_TYPES: ReservationSubjectType[] = ['stewardship_outreach', 'customer']

function isActivityKey(v: unknown): v is ReservationActivityKey {
  return typeof v === 'string' && (ACTIVITY_KEYS as string[]).includes(v)
}
function isSubjectType(v: unknown): v is ReservationSubjectType {
  return typeof v === 'string' && (SUBJECT_TYPES as string[]).includes(v)
}

/** Resolve the caller to an authorized internal admin AND their producer. A
 * reservation must be attributable to a producer, so a session with no producer
 * profile cannot reserve shared work. */
async function resolveCaller() {
  const auth = await requireInternalAdmin()
  if (!auth.ok) return { ok: false as const, status: auth.status, error: auth.error }

  const sessionClient = await createClient()
  const { data: { user } } = await sessionClient.auth.getUser()
  if (!user) return { ok: false as const, status: 401, error: 'Unauthorized' }

  const producer = await resolveProducerForUser(user.id)
  if (!producer) {
    return {
      ok: false as const,
      status: 403,
      error: 'Your account has no team member profile, so it cannot reserve shared work.',
    }
  }
  return { ok: true as const, producerId: producer.id }
}

type Body = {
  action?: 'next' | 'reserve' | 'heartbeat' | 'release'
  activity?: string
  subject_type?: string
  /** For 'next': the ordered candidate subject ids (the caller's still-to-do
   * work, as the activity already scoped it). */
  candidate_ids?: unknown
  /** For 'reserve' | 'heartbeat' | 'release': the one subject id. */
  subject_id?: string
}

export async function POST(request: NextRequest) {
  const caller = await resolveCaller()
  if (!caller.ok) return Response.json({ error: caller.error }, { status: caller.status })

  let body: Body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!isActivityKey(body.activity)) {
    return Response.json({ error: 'Unknown or missing activity' }, { status: 400 })
  }
  if (!isSubjectType(body.subject_type)) {
    return Response.json({ error: 'Unknown or missing subject_type' }, { status: 400 })
  }
  const activityKey = body.activity
  const subjectType = body.subject_type

  try {
    switch (body.action) {
      case 'next': {
        const ids = Array.isArray(body.candidate_ids)
          ? body.candidate_ids.filter((v): v is string => typeof v === 'string')
          : []
        const reserved = await reserveNextSubject({
          activityKey,
          subjectType,
          candidateIds: ids,
          producerId: caller.producerId,
        })
        return Response.json({ data: { subject_id: reserved } })
      }

      case 'reserve': {
        if (!body.subject_id) {
          return Response.json({ error: 'subject_id is required' }, { status: 400 })
        }
        const res = await reserveSubject({
          activityKey,
          subjectType,
          subjectId: body.subject_id,
          producerId: caller.producerId,
        })
        return Response.json({ data: { mine: res.mine, subject_id: res.mine ? body.subject_id : null } })
      }

      case 'heartbeat': {
        if (!body.subject_id) {
          return Response.json({ error: 'subject_id is required' }, { status: 400 })
        }
        const ok = await heartbeatReservation({
          activityKey,
          subjectType,
          subjectId: body.subject_id,
          producerId: caller.producerId,
        })
        return Response.json({ data: { extended: ok } })
      }

      case 'release': {
        if (!body.subject_id) {
          return Response.json({ error: 'subject_id is required' }, { status: 400 })
        }
        const ok = await releaseSubject({
          activityKey,
          subjectType,
          subjectId: body.subject_id,
          producerId: caller.producerId,
        })
        return Response.json({ data: { released: ok } })
      }

      default:
        return Response.json({ error: 'Unknown or missing action' }, { status: 400 })
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Reservation failed'
    console.error('reservations route error:', message)
    return Response.json({ error: message }, { status: 500 })
  }
}
