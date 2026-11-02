/**
 * Customer IANA time zone, derived from the customer's US state.
 *
 * Right Path does not (yet) store a customer timezone; `customers` carries only
 * `state` and `zip`. An exact-time appointment MUST be interpreted on the
 * customer's clock (CALENDAR_DESIGN.md §3), so Layer A derives the zone from the
 * state we already have. This is a pragmatic, mostly-correct mapping — the right
 * end state is a stored, confirmable customer timezone (a later layer) — but it
 * makes the real four-zone cases (PA Eastern, Colorado Mountain, Pacific agents,
 * Central) correct from existing data without expanding Layer A into a capture
 * surface.
 *
 * Returns null when the state is unknown or genuinely spans more than one zone
 * at a granularity a state code cannot resolve; the caller then falls back to
 * the shared time module's documented default (never a fabricated offset). A few
 * states straddle a zone line; those map to their PREDOMINANT zone and are
 * flagged `ambiguous` so a caller can warn the operator to confirm.
 *
 * Pure data + a lookup. No IO, no runtime-zone dependence.
 */

/** IANA zone + whether the state straddles a line (predominant zone chosen). */
export interface DerivedZone {
  timeZone: string
  ambiguous: boolean
}

// Single-zone states -> IANA zone. Keyed by USPS two-letter code (upper-case).
const SINGLE_ZONE: Record<string, string> = {
  // Eastern
  CT: 'America/New_York', DE: 'America/New_York', DC: 'America/New_York',
  GA: 'America/New_York', ME: 'America/New_York', MD: 'America/New_York',
  MA: 'America/New_York', NH: 'America/New_York', NJ: 'America/New_York',
  NY: 'America/New_York', NC: 'America/New_York', OH: 'America/New_York',
  PA: 'America/New_York', RI: 'America/New_York', SC: 'America/New_York',
  VT: 'America/New_York', VA: 'America/New_York', WV: 'America/New_York',
  // Central
  AL: 'America/Chicago', AR: 'America/Chicago', IL: 'America/Chicago',
  IA: 'America/Chicago', LA: 'America/Chicago', MN: 'America/Chicago',
  MS: 'America/Chicago', MO: 'America/Chicago', OK: 'America/Chicago',
  WI: 'America/Chicago',
  // Mountain
  AZ: 'America/Phoenix', // no DST in most of Arizona; Phoenix zone is correct
  CO: 'America/Denver', MT: 'America/Denver', NM: 'America/Denver',
  UT: 'America/Denver', WY: 'America/Denver',
  // Pacific
  CA: 'America/Los_Angeles', WA: 'America/Los_Angeles', NV: 'America/Los_Angeles',
  // Alaska / Hawaii
  AK: 'America/Anchorage', HI: 'Pacific/Honolulu',
}

// States that straddle a zone boundary -> predominant IANA zone, flagged.
const AMBIGUOUS_ZONE: Record<string, string> = {
  FL: 'America/New_York',   // panhandle is Central; most of the state Eastern
  IN: 'America/New_York',   // mostly Eastern; a few counties Central
  MI: 'America/New_York',   // mostly Eastern; western UP Central
  KY: 'America/New_York',   // eastern Eastern; western Central
  TN: 'America/Chicago',    // mostly Central; east Eastern
  KS: 'America/Chicago',    // mostly Central; far west Mountain
  NE: 'America/Chicago',    // mostly Central; west Mountain
  SD: 'America/Chicago',    // east Central; west Mountain
  ND: 'America/Chicago',    // mostly Central; southwest Mountain
  TX: 'America/Chicago',    // mostly Central; far west (El Paso) Mountain
  OR: 'America/Los_Angeles',// mostly Pacific; a sliver Mountain
  ID: 'America/Denver',     // south Mountain; north Pacific
}

/**
 * Derive the customer's IANA zone from a US state code or name. Returns null
 * when the state is empty or unrecognized (caller falls back to the time
 * module's default). An ambiguous (zone-straddling) state resolves to its
 * predominant zone with `ambiguous: true`.
 */
export function deriveCustomerZone(state: string | null | undefined): DerivedZone | null {
  const code = normalizeStateCode(state)
  if (!code) return null
  if (code in SINGLE_ZONE) return { timeZone: SINGLE_ZONE[code], ambiguous: false }
  if (code in AMBIGUOUS_ZONE) return { timeZone: AMBIGUOUS_ZONE[code], ambiguous: true }
  return null
}

// Full state name -> USPS code, so a stored "Pennsylvania" resolves too.
const NAME_TO_CODE: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC',
  florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL',
  indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
  maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
  wyoming: 'WY',
}

/** Normalize a state input (code or full name) to an upper-case USPS code. */
function normalizeStateCode(state: string | null | undefined): string | null {
  const raw = (state ?? '').trim()
  if (!raw) return null
  if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase()
  const byName = NAME_TO_CODE[raw.toLowerCase()]
  return byName ?? null
}
