/**
 * Calendar invite (.ics) builder.
 *
 * Buy-before-build: RFC 5545 serialization (line folding, escaping, the
 * VTIMEZONE block, DST-correct local times) is a solved problem, so we use the
 * maintained `ical-generator` library rather than hand-roll an ICS writer. This
 * module is a thin, Right-Path-shaped wrapper around it.
 *
 * Timezone contract (CALENDAR_DESIGN.md §3): the caller passes an ABSOLUTE
 * instant (already resolved through `@/lib/time`) plus the IANA zone the
 * appointment was STATED in. The invite is emitted in that stated zone so the
 * recipient's device lands it at the right local time, and DST is resolved by
 * the IANA zone, never a hard-coded offset.
 *
 * DELIVERY CONTRACT: Right Path never sends email. This builder only PRODUCES
 * the .ics text/attachment. The operator sends it from Outlook (the mailto
 * contract) and then confirms it was sent, exactly like every other Right Path
 * email. Nothing here transmits anything.
 */

import ical, { ICalCalendarMethod, type ICalAttendeeData } from 'ical-generator'
import { DateTime } from 'luxon'

export interface CalendarInviteParty {
  /** Display name, when known. */
  name?: string | null
  /** Email address, when known. */
  email?: string | null
}

export interface CalendarInviteInput {
  /** Absolute start instant (already resolved via @/lib/time). */
  start: Date
  /** Absolute end instant. Must be after `start`. */
  end: Date
  /**
   * The IANA zone the appointment was STATED in (e.g. the customer's
   * 'America/New_York'). The event's local times are expressed in this zone.
   */
  statedTimeZone: string
  /** Short event title, e.g. "Call with Right Path". */
  summary: string
  /** Optional longer description (agenda, who is calling, phone number). */
  description?: string | null
  /** Optional location (a phone number for a call, an address, etc.). */
  location?: string | null
  /** The organizer (the agency / the producer placing the commitment). */
  organizer?: CalendarInviteParty | null
  /** Invited parties (the customer, the assigned producer). */
  attendees?: CalendarInviteParty[] | null
  /**
   * A stable identifier for this commitment, used as the iCal UID so a later
   * reschedule/cancel for the same commitment updates the recipient's calendar
   * entry rather than creating a duplicate. Typically the calendar_block id.
   */
  uid: string
  /**
   * Sequence number (bumped on each reschedule of the same UID). 0 for a new
   * invite; a higher number supersedes a prior one in the recipient's client.
   */
  sequence?: number
}

/** Drop parties with no usable email; ical attendees require an email. */
function toAttendees(parties: CalendarInviteParty[] | null | undefined): ICalAttendeeData[] {
  if (!parties) return []
  const out: ICalAttendeeData[] = []
  for (const p of parties) {
    const email = p.email?.trim()
    if (!email) continue
    out.push({ email, name: p.name?.trim() || undefined })
  }
  return out
}

/**
 * Build a single-event .ics string for an appointment, expressed in the stated
 * IANA zone. REQUEST method, so a mail client treats it as an invitation the
 * recipient can accept or decline.
 */
export function buildAppointmentIcs(input: CalendarInviteInput): string {
  if (!(input.end.getTime() > input.start.getTime())) {
    throw new Error('Calendar invite end must be after start')
  }

  const cal = ical({ prodId: { company: 'Right Path', product: 'RPAS' } })
  // REQUEST: this is an invitation (accept/decline), not a published feed.
  cal.method(ICalCalendarMethod.REQUEST)

  // Pass ZONED Luxon DateTimes, not native Date objects. Given a native Date +
  // a `timezone`, ical-generator interprets the Date's wall-clock components in
  // the RUNTIME zone and merely labels them with the timezone, which shifts the
  // emitted local time on any server not already in the stated zone. Converting
  // the absolute instant to a Luxon DateTime in the stated zone makes the
  // wall-clock it emits unambiguous and DST-correct. (Verified by smoke test:
  // 9:00 America/New_York emits DTSTART;TZID=America/New_York:...T090000.)
  const startZoned = DateTime.fromJSDate(input.start, { zone: input.statedTimeZone })
  const endZoned = DateTime.fromJSDate(input.end, { zone: input.statedTimeZone })

  const event = cal.createEvent({
    id: input.uid,
    sequence: input.sequence ?? 0,
    // The stated zone is attached to the event so local times render correctly
    // on the recipient's device, DST included. ical-generator emits the
    // matching VTIMEZONE.
    timezone: input.statedTimeZone,
    start: startZoned,
    end: endZoned,
    summary: input.summary,
    description: input.description?.trim() || undefined,
    location: input.location?.trim() || undefined,
    attendees: toAttendees(input.attendees),
  })

  // iCal requires an organizer to carry an email (the address attendees reply
  // to); a name-only organizer is not valid per RFC 5545 and the library
  // rejects it. So the organizer is set ONLY when a usable email is supplied.
  // Without one the event simply carries no ORGANIZER line, which is valid.
  const orgEmail = input.organizer?.email?.trim()
  if (orgEmail) {
    event.organizer({ name: input.organizer?.name?.trim() || 'Right Path', email: orgEmail })
  }

  return cal.toString()
}

/** A filesystem-safe .ics filename for an appointment summary. */
export function icsFilename(summary: string): string {
  const base = summary
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return `${base || 'appointment'}.ics`
}
