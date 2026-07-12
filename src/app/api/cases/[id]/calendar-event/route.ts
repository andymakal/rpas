import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

const DURATIONS: Record<string, number> = {
  call:      30,
  life:      60,
  financial: 90,
}

const TYPE_LABELS: Record<string, string> = {
  call:      'Follow-up Call',
  life:      'Life Appt',
  financial: 'Financial Appt',
}

// Format local ISO datetime string ("2024-01-15T14:00") to iCal floating time ("20240115T140000").
// Floating time (no Z, no TZID) is interpreted by Outlook as local time — which is what we want
// since the user entered the time in their own timezone.
function toIcsDt(localIso: string): string {
  const [date, time] = localIso.split('T')
  const d = date.replace(/-/g, '')
  const t = time.replace(/:/g, '').padEnd(6, '0').slice(0, 6)
  return `${d}T${t}`
}

// Add minutes to a local ISO string without touching timezone — pure arithmetic to avoid
// Node.js treating bare ISO strings as UTC.
function addMinutes(localIso: string, mins: number): string {
  const [date, time] = localIso.split('T')
  const [h, m] = time.split(':').map(Number)
  const total = h * 60 + m + mins
  const nh = Math.floor(total / 60) % 24
  const nm = total % 60
  return `${date}T${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`
}

// RFC 5545 line folding: max 75 octets per line, continuation lines start with a space.
function fold(line: string): string {
  const out: string[] = []
  while (line.length > 75) {
    out.push(line.slice(0, 75))
    line = ' ' + line.slice(75)
  }
  out.push(line)
  return out.join('\r\n')
}

function esc(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g,  '\\;')
    .replace(/,/g,  '\\,')
    .replace(/\n/g, '\\n')
}

/**
 * GET /api/cases/[id]/calendar-event?start=2024-01-15T14:00&type=life
 *
 * Returns an .ics file for the appointment. Phone number is in the subject line
 * so it appears in the Outlook reminder popup without opening the event.
 *
 * type: "call" (30 min) | "life" (60 min) | "financial" (90 min)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { searchParams } = new URL(request.url)
  const start = searchParams.get('start')
  const type  = searchParams.get('type') ?? 'life'

  if (!start) {
    return NextResponse.json({ error: 'start param required' }, { status: 400 })
  }

  const durationMins = DURATIONS[type] ?? 60
  const typeLabel    = TYPE_LABELS[type] ?? 'Appointment'
  const end          = addMinutes(start, durationMins)

  const supabase = createAdminClient()
  const { data: c } = await supabase
    .from('cases')
    .select(`
      id,
      notes,
      allstate_policy_number,
      customers!customer_id ( first_name, last_name, phone, email ),
      agencies ( name, display_name ),
      agents ( first_name, last_name, email )
    `)
    .eq('id', id)
    .eq('is_test', false)
    .single()

  if (!c) {
    return NextResponse.json({ error: 'Case not found' }, { status: 404 })
  }

  const customer  = c.customers as unknown as { first_name: string; last_name: string; phone: string | null; email: string | null } | null
  const agency    = c.agencies  as unknown as { name: string; display_name: string | null } | null
  const agent     = c.agents    as unknown as { first_name: string; last_name: string; email: string | null } | null

  const clientName  = customer ? `${customer.first_name} ${customer.last_name}` : 'Client'
  const clientPhone = customer?.phone ?? ''
  const agencyName  = agency?.display_name ?? agency?.name ?? ''
  const lspName     = agent ? `${agent.first_name} ${agent.last_name}` : ''
  const lspEmail    = agent?.email ?? ''

  const referralType = (() => {
    const match = (c.notes ?? '').match(/^Type: (.+)$/m)
    return match?.[1] ?? ''
  })()

  // Phone number leads the subject so it's visible in the Outlook reminder without opening the event
  const subject = [
    clientPhone || null,
    `${typeLabel} | ${clientName}`,
    lspName ? `${lspName} (LSP)` : null,
  ].filter(Boolean).join(' — ')

  // Body: phone prominent at top, then structured context
  const descParts = [
    clientPhone ? `📞 ${clientPhone}` : null,
    '',
    clientName,
    agencyName                             ? `Agency: ${agencyName}`                       : null,
    lspName                                ? `LSP: ${lspName}${lspEmail ? ` | ${lspEmail}` : ''}` : null,
    referralType                           ? `Referral: ${referralType}`                   : null,
    customer?.email                        ? `Email: ${customer.email}`                    : null,
    c.allstate_policy_number               ? `Allstate Policy: ${c.allstate_policy_number}` : null,
    '',
    'Location: RingCentral',
  ].filter(l => l !== null).join('\n')

  const uid      = `${id}-${Date.now()}@rpas`
  const dtstamp  = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z'
  const filename = `appt-${clientName.replace(/\s+/g, '-').toLowerCase()}.ics`

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//RPAS//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    fold(`UID:${uid}`),
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${toIcsDt(start)}`,
    `DTEND:${toIcsDt(end)}`,
    fold(`SUMMARY:${esc(subject)}`),
    fold(`DESCRIPTION:${esc(descParts)}`),
    'LOCATION:RingCentral',
    'STATUS:CONFIRMED',
    'BEGIN:VALARM',
    'TRIGGER:-PT15M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Appointment reminder',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')

  return new NextResponse(ics, {
    headers: {
      'Content-Type':        'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
