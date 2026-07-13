/**
 * Client communication templates — Makal Financial Services
 *
 * All templates use {variable} placeholders. Call interpolate() to fill them
 * in, then buildMailto() to generate the mailto: link for Outlook.
 *
 * Delivery model: every template opens in the team member's own Outlook.
 * Nothing is sent automatically — a human always clicks Send.
 *
 * See SCRIPTS below for voicemail scripts, text messages, and live transfer
 * verbal scripts (displayed as copy cards in the UI — not sent via email).
 */

// ── Email templates ───────────────────────────────────────────────────────────

export const TEMPLATES = {

  /**
   * #1 — Welcome / First Outreach
   * Trigger: case moves to active_referral
   * Sender: team member working the case (Dulce / Gabe / etc.)
   * Variables: first_name, lsp_first_name, lsp_name, topic, sender_name
   */
  welcome: {
    subject: '{lsp_first_name} asked me to reach out — {topic}',
    body: [
      'Hi {first_name},',
      '',
      '{lsp_name} asked me to give you a call — I\'m {sender_name} with Allstate Financial Services. We work with {lsp_name}\'s clients on {topic}.',
      '',
      'When\'s a good time to reach you this week?',
      '',
      'Regards,',
      '{sender_name}',
      'Allstate Financial Services',
    ].join('\n'),
  },

  /**
   * #2 — Appointment Confirmed
   * Trigger: appointment is set (status = appointment_set)
   * Sender: team member
   * Variables: first_name, appointment_type, appointment_duration,
   *            appointment_date, appointment_time, sender_name
   */
  appointment_confirmed: {
    subject: '{appointment_type} confirmed — {appointment_date} at {appointment_time}',
    body: [
      'Hi {first_name},',
      '',
      'You\'re confirmed for a {appointment_type} ({appointment_duration}) on {appointment_date} at {appointment_time}.',
      '',
      'Here\'s what to expect: we\'ll spend the time understanding your situation and whether life insurance makes sense for where you are right now. No paperwork, no pressure.',
      '',
      'If anything comes up, reply here or give us a call.',
      '',
      'Regards,',
      '{sender_name}',
      'Allstate Financial Services',
    ].join('\n'),
  },

  /**
   * #3 — Appointment Reminder (day before)
   * Trigger: daily cron fires an in-app notification; team member sends manually
   * Sender: team member
   * Variables: first_name, appointment_type, appointment_date,
   *            appointment_time, sender_name
   */
  appointment_reminder: {
    subject: 'Tomorrow — {appointment_type} at {appointment_time}',
    body: [
      'Hi {first_name},',
      '',
      'Quick reminder — {appointment_type} tomorrow, {appointment_date} at {appointment_time}.',
      '',
      'If anything comes up, reply here or give us a call.',
      '',
      'Regards,',
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
   * #5a — e-PHI Needed
   * Trigger: app_submitted or in_underwriting — carrier needs health info electronically
   * Sender: Nikki
   */
  ephi_needed: {
    subject: 'Action Needed — Health Info Request from {carrier}',
    body: [
      'Hi {first_name},',
      '',
      'As part of your application with {carrier}, they will be reaching out electronically to collect some health information. Please watch for an email or text from them and complete it as soon as possible — a quick response helps keep your application on track.',
      '',
      'If you have any questions in the meantime, don\'t hesitate to reach out.',
      '',
      '{sender_name}',
      'Allstate Financial Services',
    ].join('\n'),
  },

  /**
   * #5b — E-Interview
   * Trigger: app_submitted — carrier will email a health questionnaire
   * Sender: Nikki
   */
  einterview: {
    subject: 'Your {carrier} Application — Electronic Interview',
    body: [
      'Hi {first_name},',
      '',
      '{carrier} will be sending you an email with a brief health questionnaire to complete electronically as part of your application. Please watch for it and respond as soon as possible.',
      '',
      'Let us know if you have any questions!',
      '',
      '{sender_name}',
      'Allstate Financial Services',
    ].join('\n'),
  },

  /**
   * #5c — Tele-Interview
   * Trigger: app_submitted — carrier will call for a phone interview
   * Sender: Nikki
   */
  tele_interview: {
    subject: 'Your {carrier} Application — Telephone Interview',
    body: [
      'Hi {first_name},',
      '',
      '{carrier} will be calling you for a brief telephone interview as part of your application. The call typically takes about 15–20 minutes and covers basic health history. Please be on the lookout for their call and pick up when they reach out — it\'s an important step in getting your application completed.',
      '',
      'Let us know if you have any questions!',
      '',
      '{sender_name}',
      'Allstate Financial Services',
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

// ── Scripts (voicemail, text, live transfer) ──────────────────────────────────
//
// These are NOT email templates. They are displayed as copy cards in the UI.
// Variables: first_name, lsp_first_name, sender_name, phone

export const SCRIPTS = {

  /**
   * Voicemail — leave when no answer on any attempt
   * Strategy: name the LSP, name the topic, be vague enough to leave a hook.
   */
  voicemail: {
    label: 'Voicemail Script',
    body: [
      'Hi {first_name}, this is {sender_name} calling from Allstate Financial Services.',
      '{lsp_first_name} asked me to give you a call — it\'s about your life insurance.',
      'Give me a call back when you have a minute: {phone}.',
      'Again, {sender_name} at {phone}.',
    ].join(' '),
  },

  /**
   * Post-voicemail text — send immediately after leaving a voicemail
   * Strategy: confirm contact was made, give them a quick path back.
   * Pollard: text after contact, not before.
   */
  post_voicemail_text: {
    label: 'Text (after voicemail)',
    body: 'Hi {first_name}, this is {sender_name} with Allstate — just left you a voicemail. Call me back when you get a chance: {phone}',
  },

  /**
   * First-attempt text — send when no answer and no voicemail was left
   * Strategy: name the LSP connection, short ask.
   */
  first_attempt_text: {
    label: 'Text (no voicemail left)',
    body: 'Hi {first_name}, this is {sender_name} with Allstate Financial Services. {lsp_first_name} asked me to reach out about your life insurance. Good time for a call this week?',
  },

  /**
   * Live transfer — verbal script for handing off to the producer
   * Two parts: what to say to the client, then the briefing for Andy.
   */
  live_transfer_client: {
    label: 'Live Transfer — To Client',
    body: 'Before I let you go — I want to put you in touch with Andy directly. He handles our life insurance conversations and I think it\'s worth two minutes. He\'s available right now. Can I connect you?',
  },

  live_transfer_briefing: {
    label: 'Live Transfer — Producer Briefing',
    body: '{first_name} {last_name}, referred by {lsp_first_name} at {agency_name}. Interested in {topic}. All yours.',
  },

} as const

// ── Appointment type config ───────────────────────────────────────────────────
//
// Used in the confirmation / reminder email UI to fill {appointment_type}
// and {appointment_duration} template variables.

export const APPT_TYPES = [
  { value: 'call',      label: 'Follow-up Call',  duration: '30 min' },
  { value: 'life',      label: 'Life Appointment', duration: '60 min' },
  { value: 'financial', label: 'Financial Appt',   duration: '90 min' },
] as const

export type ApptTypeValue = typeof APPT_TYPES[number]['value']

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
