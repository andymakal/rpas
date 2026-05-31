/**
 * Client communication templates — Makal Financial Services
 *
 * All templates use {variable} placeholders. Call interpolate() to fill them
 * in, then buildMailto() to generate the mailto: link for Outlook.
 *
 * Delivery model: every template opens in the team member's own Outlook.
 * Nothing is sent automatically — a human always clicks Send.
 */

// ── Template strings ──────────────────────────────────────────────────────────

export const TEMPLATES = {

  /**
   * #1 — Welcome / First Outreach
   * Trigger: case moves to active_referral
   * Sender: team member working the case (Dulce / Gabe / etc.)
   */
  welcome: {
    subject: 'Reaching Out — {topic}',
    body: [
      'Hi {first_name},',
      '',
      'My name is {sender_name} and I work with Andy Makal at Allstate Financial Services. {lsp_name} asked me to reach out regarding your interest in {topic}. We\'d love to connect and answer any questions you have — when\'s a good time for a quick call?',
      '',
      'Looking forward to speaking with you!',
      '',
      '{sender_name}',
      'Allstate Financial Services',
    ].join('\n'),
  },

  /**
   * #2 — Appointment Confirmed
   * Trigger: appointment is set (status = appointment_set)
   * Sender: team member
   */
  appointment_confirmed: {
    subject: 'Appointment Confirmed — Makal Financial Services',
    body: [
      'Hi {first_name},',
      '',
      'Just confirming your appointment with us on {appointment_date} at {appointment_time}. We\'re looking forward to speaking with you!',
      '',
      'If anything comes up and you need to reschedule, just reply to this email or give us a call.',
      '',
      '{sender_name}',
      'Allstate Financial Services',
    ].join('\n'),
  },

  /**
   * #3 — Appointment Reminder (day before)
   * Trigger: daily cron finds cases where appointment_date = tomorrow
   * Sender: team member
   */
  appointment_reminder: {
    subject: 'Reminder — Your Appointment Tomorrow',
    body: [
      'Hi {first_name},',
      '',
      'Just a friendly reminder that your appointment with us is tomorrow, {appointment_date} at {appointment_time}. We\'re looking forward to it — see you then!',
      '',
      'If anything comes up, please don\'t hesitate to reach out.',
      '',
      '{sender_name}',
      'Allstate Financial Services',
    ].join('\n'),
  },

  /**
   * #4 — Quote Follow-Up
   * Trigger: case moves to quoted
   * Sender: team member / producer
   */
  quote_followup: {
    subject: 'Following Up on Your Life Insurance Options',
    body: [
      'Hi {first_name},',
      '',
      'It was great connecting with you! We wanted to follow up and see if you had any questions about what we put together. We\'re happy to walk through the options again or explore anything else that might be a better fit.',
      '',
      'Just reply here or give us a call anytime.',
      '',
      '{sender_name}',
      'Allstate Financial Services',
    ].join('\n'),
  },

  /**
   * #6 — Underwriting Update
   * Trigger: case moves to in_underwriting
   * Sender: team member / producer
   * Note: {underwriting_note} is filled in from the scenario picker
   */
  underwriting_update: {
    subject: 'Application Update — Makal Financial Services',
    body: [
      'Hi {first_name},',
      '',
      'Just a quick update on your application with {carrier}. {underwriting_note}',
      '',
      'The process can take anywhere from a few days to a couple of months depending on how quickly requirements come in, but we\'ll keep you posted every step of the way. As always, feel free to reach out with any questions.',
      '',
      '{sender_name}',
      'Allstate Financial Services',
    ].join('\n'),
  },

  /**
   * #7 — Application Approved
   * Trigger: case moves to approved
   * Sender: team member / producer
   */
  approved: {
    subject: 'Great News — Your Application Has Been Approved!',
    body: [
      'Hi {first_name},',
      '',
      'We have great news — your application with {carrier} has been approved! We\'ll be in touch shortly with the final steps to get your policy officially placed.',
      '',
      'You\'re almost there!',
      '',
      '{sender_name}',
      'Allstate Financial Services',
    ].join('\n'),
  },

  /**
   * #8 — Policy in Force
   * Trigger: case moves to placed
   * Sender: always Andy
   */
  policy_in_force: {
    subject: 'Your Policy Is Now in Force!',
    body: [
      'Hi {first_name},',
      '',
      'We\'re excited to let you know that your life insurance policy with {carrier} is now in force. Thank you for trusting us to help protect your family.',
      '',
      'A digital copy of your policy will be placed in the Vault of your Allstate My Money account. Allstate My Money is your personal, secure financial planning website which has many tools to help you organize and create financial goals and plans. There is no cost or fee for this tool, and you will receive a separate email with instructions as to how to set up the account and create the password for it.',
      '',
      'As a client you\'re also entitled to a comprehensive financial review. In addition to the life insurance you\'ve just purchased, we offer disability, long-term care, and Medicare Supplement insurance as well as financial services such as financial planning, retirement planning, and estate planning. Give us a call anytime to set that up.',
      '',
      'We\'re grateful for the opportunity to help protect what matters most to you. As Ferris Bueller once said, "Life moves pretty fast." So we\'ll reach out at least once a year to check in and see if anything has changed.',
      '',
      'All the best!',
      'Andy',
    ].join('\n'),
  },

  /**
   * #9 — Annual Review
   * Trigger: daily cron finds cases where placed_at ≈ 1 year ago
   * Sender: always Andy
   */
  annual_review: {
    subject: 'Time for Your Annual Check-In',
    body: [
      'Hi {first_name},',
      '',
      'It\'s been a year or so since we got your life insurance in place and I wanted to check in. Life has a way of evolving — new family members, a job change, a home purchase — and it\'s worth making sure your coverage keeps up.',
      '',
      'We\'d love to schedule a quick review. Give us a call or reply here and we\'ll get something on the calendar.',
      '',
      'As always, it\'s our privilege to serve you!',
      '',
      'All the best!',
      'Andy',
    ].join('\n'),
  },

} as const

// ── Underwriting scenarios ─────────────────────────────────────────────────────

export const UNDERWRITING_SCENARIOS = [
  'The carrier has ordered labs — you should expect a call to schedule a brief appointment at your convenience.',
  'The carrier has requested additional medical records from your doctor\'s office.',
  'The carrier needs a signed authorization form — we\'ll be in touch shortly with the details.',
  'Everything is moving along and no additional requirements are needed at this time.',
] as const

// ── Topic mapping from lead_source ─────────────────────────────────────────────

export const TOPIC_MAP: Record<string, string> = {
  mortgage_protection:  'mortgage protection',
  term_life:            'life insurance',
  life_review:          'a life insurance review',
  financial_planning:   'financial planning',
  retirement_planning:  'retirement planning',
  medicare_planning:    'Medicare planning',
  business_owner:       'business planning and insurance',
  '1035_exchange':      'your existing life insurance policy',
  existing_service:     'your existing policy',
  existing_sales:       'life insurance',
  agency_referral:      'life insurance',
  allstate_web:         'life insurance',
  self_generated:       'life insurance',
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Replace {variable} placeholders with values. Unknown keys are left as-is. */
export function interpolate(
  template: string,
  vars: Record<string, string | null | undefined>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => vars[key] ?? match)
}

/**
 * Build a mailto: URI that opens pre-composed in Outlook.
 * Uses RFC 3986 percent-encoding (not URLSearchParams) to avoid + signs.
 */
export function buildMailto(
  to:      string | null | undefined,
  subject: string,
  body:    string,
): string {
  const parts = [
    `subject=${encodeURIComponent(subject)}`,
    `body=${encodeURIComponent(body)}`,
  ]
  return `mailto:${to ?? ''}?${parts.join('&')}`
}

/**
 * Format a date string (YYYY-MM-DD) for use in email copy.
 * e.g. "2026-06-05" → "Thursday, June 5th"
 */
export function fmtEmailDate(dateStr: string | null | undefined): string {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return ''
  const date = new Date(y, m - 1, d)
  const day  = date.toLocaleDateString('en-US', { weekday: 'long' })
  const mon  = date.toLocaleDateString('en-US', { month: 'long' })
  const ord  = d % 10 === 1 && d !== 11 ? 'st'
             : d % 10 === 2 && d !== 12 ? 'nd'
             : d % 10 === 3 && d !== 13 ? 'rd' : 'th'
  return `${day}, ${mon} ${d}${ord}`
}

/**
 * Format a 24-hour time string (HH:MM) to 12-hour AM/PM.
 * e.g. "14:30" → "2:30 PM"
 */
export function fmtTime12(timeStr: string | null | undefined): string {
  if (!timeStr) return ''
  const [hStr, mStr] = timeStr.split(':')
  const h = parseInt(hStr, 10)
  const m = mStr ?? '00'
  if (isNaN(h)) return timeStr
  const period = h >= 12 ? 'PM' : 'AM'
  const h12    = h % 12 || 12
  return `${h12}:${m} ${period}`
}
