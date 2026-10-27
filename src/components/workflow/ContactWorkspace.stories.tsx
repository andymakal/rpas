import type { Meta, StoryObj } from '@storybook/react'
import { useMemo, useState } from 'react'

import { MentoringProvider } from '@/lib/mentoring/MentoringProvider'
import { WorkflowSurface } from './primitives'
import {
  ContactWorkspace,
  type CustomerContact,
  type ContactPurpose,
  type CommunicationEntry,
  type CallbackCommitment,
  type ContactCardAppearance,
  type CallOutcome,
  type ChannelAvailability,
} from './ContactWorkspace'
import type {
  ContactPersistPayload,
  ColorChoice,
  WeightChoice,
  VerifiedPlacement,
  EditPlacement,
  AlignChoice,
} from './CustomerContactCard'
import {
  CopyDesignButton,
  toggleControl,
  statusOrBlackControl,
  scaleControl,
  pxControl,
  weightControl,
  colorControl,
  choiceControl,
  dateControl,
  hiddenControl,
  formatDesignSummary,
  type DesignGroup,
} from './playground-controls'

/**
 * Workflow Design System — Contact Workspace → Playground.
 *
 * The one interactive design playground for the universal Contact Workspace. It
 * follows the SAME convention as the Customer Contact playground
 * (CustomerContactPlayground.stories.tsx): a single story whose grouped native
 * Storybook Controls drive the REAL composed workspace live, plus a pinned
 * "Copy Selected Design" button that captures every choice as readable text.
 *
 * It renders the actual `ContactWorkspace` composed from the existing shared
 * layer — no fork, no second surface. The controls cover what the underlying
 * components support:
 *
 *   - Scenario: the contact PURPOSE (1035 onboarding vs a general review) and
 *     the sample customer/history/commitment that belong with it.
 *   - Call OUTCOME: the recorded result shown (reached / voicemail / callback /
 *     bad number / not interested), matching the production `CallOutcome`.
 *   - Customer CONTEXT: which contact facts are present/verified.
 *   - HISTORY and COMMITMENT: show/hide and populate them.
 *   - SCRIPTS and COMMUNICATION methods: show/hide, force channels on/off.
 *   - The workspace BLOCK VISIBILITY (guidance, communication, outcome, scripts,
 *     contact card, history, commitment).
 *   - The embedded shared card's full APPEARANCE — visibility, colors,
 *     typography, icons, layout, chrome — forwarded straight to
 *     `CustomerContactCard`'s own `appearance` prop, so the one card the
 *     workspace reuses is tunable here exactly as in its own playground.
 *
 * Nothing here is wired to a route, a schema, or a business rule. The contact
 * card runs on in-memory persistence (same rules as production: a changed value
 * clears its verification), and every outcome selection is a local no-op.
 */

// ── Sample customers, keyed to a context choice ──────────────────────────────

const VERIFIED_AT = '2026-10-12T15:00:00.000Z'

const stephenBase: Omit<CustomerContact, 'email_verified_at' | 'phone_verified_at' | 'address_verified_at'> = {
  id: 'cust-1035-stephen',
  first_name: 'Stephen',
  last_name: 'Remy',
  email: 'sremy@example.com',
  phone: '(215) 555-0142',
  street: null,
  address_line1: null,
  city: null,
  state: null,
  zip: null,
  email_availability: 'available',
}

const mariaBase: Omit<CustomerContact, 'email_verified_at' | 'phone_verified_at' | 'address_verified_at'> = {
  id: 'cust-general-maria',
  first_name: 'Maria',
  last_name: 'DeLuca',
  email: 'maria.deluca@example.com',
  phone: '(610) 555-0188',
  street: '88 Lancaster Ave',
  address_line1: null,
  city: 'Wayne',
  state: 'PA',
  zip: '19087',
  email_availability: 'available',
}

type Scenario = 'onboarding' | 'review'
type ContactContext = 'verified' | 'onfile' | 'missing' | 'mixed'

/** Apply a contact-context choice to a base record: all-green, all-amber (on
 * file, unverified), all-red (missing), or a mix (verified phone, unverified
 * email, missing address). */
function recordFor(scenario: Scenario, context: ContactContext): CustomerContact {
  const base = scenario === 'onboarding' ? stephenBase : mariaBase
  if (context === 'missing') {
    return {
      ...base,
      email: null, phone: null, street: null, city: null, state: null, zip: null,
      email_verified_at: null, phone_verified_at: null, address_verified_at: null,
      email_availability: null,
    }
  }
  if (context === 'mixed') {
    return {
      ...base,
      phone_verified_at: VERIFIED_AT,
      email_verified_at: null,
      street: null, city: null, state: null, zip: null,
      address_verified_at: null,
    }
  }
  const stamp = context === 'verified' ? VERIFIED_AT : null
  return {
    ...base,
    email_verified_at: stamp,
    phone_verified_at: stamp,
    address_verified_at: base.street ? stamp : null,
  }
}

// ── Purpose blocks (what makes the workspace universal) ──────────────────────

const PURPOSE: Record<Scenario, ContactPurpose> = {
  onboarding: {
    origin: '1035 servicing onboarding',
    actionHeading: 'Call Stephen Remy',
    reason: 'New servicing agent — introduce and send the form',
    reasonTone: 'reason',
    guidance: (
      <>
        This customer has a permanent policy we are taking over servicing on. Introduce yourself as the new
        servicing agent, confirm the policy is theirs, and offer to send the servicing-agent authorization form.
        Reaching them sends the form next; a voicemail schedules the next attempt. Nothing is closed by the system.
      </>
    ),
    nextNote: 'Reached and form sent moves Stephen to Waiting for Form. A human decides any next step.',
    scripts: [
      {
        label: 'Voicemail',
        body: "Hi Stephen, this is Dulce from Allstate Financial Services. I'm the new servicing agent on your life policy and wanted to introduce myself. Give me a call back when you have a minute: (215) 555-0100.",
      },
      {
        label: 'Text (after voicemail)',
        body: 'Hi Stephen, this is Dulce with Allstate — just left you a voicemail about servicing your life policy. Call me back when you get a chance: (215) 555-0100',
      },
    ],
  },
  review: {
    origin: 'Annual policy review',
    actionHeading: 'Call Maria DeLuca',
    reason: 'Annual review due — confirm coverage still fits',
    reasonTone: 'reason',
    guidance: (
      <>
        Maria is due for her annual review. Check in on any life changes (marriage, new child, a move, income
        change) and confirm her current coverage still fits. This is a relationship touch, not a sale: if nothing
        has changed, note it and schedule the next review.
      </>
    ),
    nextNote: 'Reached and reviewed records the annual touch. Anything that needs action is a human decision.',
    scripts: [
      {
        label: 'Opening',
        body: "Hi Maria, this is Gabe from Allstate Financial Services. It's time for your annual check-in on your life coverage — I want to make sure it still fits where you are now. Do you have a couple of minutes?",
      },
      {
        label: 'Voicemail',
        body: "Hi Maria, this is Gabe with Allstate. It's time for your annual life-insurance review — nothing's wrong, I just want to make sure everything still fits. Call me back at (610) 555-0100 when you have a minute.",
      },
    ],
  },
}

const HISTORY: Record<Scenario, CommunicationEntry[]> = {
  onboarding: [
    { id: 'h1', channel: 'voicemail', when: 'Oct 14, 2026', summary: 'Left a voicemail introducing the servicing change', by: 'Dulce' },
    { id: 'h2', channel: 'text', when: 'Oct 14, 2026', summary: 'Sent a follow-up text after the voicemail', by: 'Dulce' },
    { id: 'h3', channel: 'research', when: 'Oct 10, 2026', summary: 'Looked up the record in eAgent — phone confirmed, no mailing address', by: 'Bob' },
  ],
  review: [
    { id: 'r1', channel: 'call', when: 'Oct 9, 2025', summary: 'Last annual review — no changes, renewed as-is', by: 'Gabe', reached: true },
    { id: 'r2', channel: 'email', when: 'Jun 3, 2025', summary: 'Sent the mid-year statement summary', by: 'Gabe' },
  ],
}

const COMMITMENT: Record<Scenario, CallbackCommitment> = {
  onboarding: { date: '2026-10-20', note: 'Stephen asked for a call back Monday after he finds the policy paperwork.' },
  review: { date: '2026-10-22', note: 'Maria asked to reconnect Wednesday when she is off work.' },
}

// ── Flat args (each mapped to one native control) ────────────────────────────

interface PlaygroundArgs {
  // Scenario & workflow context
  scenario: Scenario
  contactContext: ContactContext
  callOutcome: CallOutcome | 'none'
  /** The native Storybook `date` control emits a timestamp (number) at runtime;
   * the default below is a YYYY-MM-DD string. `toDateOnly` normalizes both. */
  callbackDate: string | number

  // Workspace block visibility
  showGuidance: boolean
  showCommunication: boolean
  showOutcome: boolean
  showScripts: boolean
  showContactCard: boolean
  showHistory: boolean
  showCommitment: boolean

  // Communication methods (force on/off/auto)
  methodCall: ChannelAvailability
  methodText: ChannelAvailability
  methodEmail: ChannelAvailability

  // Embedded contact-card: Visibility
  cardShowStatusIndicator: boolean
  cardShowContactIcon: boolean
  cardShowFieldLabel: boolean
  cardShowVerifiedCheckbox: boolean
  cardShowEditButton: boolean
  cardShowStatusKey: boolean

  // Embedded contact-card: Colors
  cardStatusIndicatorColor: ColorChoice
  cardContactIconColor: ColorChoice
  cardFieldLabelColor: ColorChoice
  cardNameColor: string
  cardValueColor: string

  // Embedded contact-card: Typography
  cardFontScale: number
  cardNameScale: number
  cardValueScale: number
  cardNameWeight: WeightChoice
  cardValueWeight: WeightChoice

  // Embedded contact-card: Icons
  cardIconScale: number
  cardContactIconPxOverride: number

  // Embedded contact-card: Layout
  cardVerifiedPlacement: VerifiedPlacement
  cardEditPlacement: EditPlacement
  cardFieldAlign: AlignChoice
  cardSectionPaddingPx: number

  // Embedded contact-card: Appearance / chrome
  cardBorderPx: number
  cardBorderColor: string
  cardRadiusPx: number
  cardBackground: string
  cardShowDividers: boolean
}

const BRAND_TEAL = 'var(--brand)'
const SLATE_700 = 'var(--text-secondary)'

const DEFAULT_ARGS: PlaygroundArgs = {
  scenario: 'onboarding',
  contactContext: 'mixed',
  callOutcome: 'voicemail',
  callbackDate: '2026-10-20',

  showGuidance: true,
  showCommunication: true,
  showOutcome: true,
  showScripts: true,
  showContactCard: true,
  showHistory: true,
  showCommitment: true,

  methodCall: 'auto',
  methodText: 'auto',
  methodEmail: 'auto',

  // Card appearance opens on the approved production defaults (same as the
  // Customer Contact playground): hidden status indicator, status-colored
  // contact icons, black labels, a 150% bold teal name, slate-700 border +
  // dividers.
  cardShowStatusIndicator: false,
  cardShowContactIcon: true,
  cardShowFieldLabel: true,
  cardShowVerifiedCheckbox: true,
  cardShowEditButton: true,
  cardShowStatusKey: true,

  cardStatusIndicatorColor: 'status',
  cardContactIconColor: 'status',
  cardFieldLabelColor: 'black',
  cardNameColor: BRAND_TEAL,
  cardValueColor: '',

  cardFontScale: 1,
  cardNameScale: 1.5,
  cardValueScale: 1,
  cardNameWeight: 'bold',
  cardValueWeight: 'default',

  cardIconScale: 1,
  cardContactIconPxOverride: 0,

  cardVerifiedPlacement: 'heading',
  cardEditPlacement: 'value',
  cardFieldAlign: 'left',
  cardSectionPaddingPx: 12,

  cardBorderPx: 1,
  cardBorderColor: SLATE_700,
  cardRadiusPx: 16,
  cardBackground: '',
  cardShowDividers: true,
}

const orUndef = (s: string) => (s.trim() === '' ? undefined : s)
const pxOrUndef = (n: number) => (n > 0 ? n : undefined)

/** Normalize the callback-date arg to a YYYY-MM-DD string. The native date
 * control emits a timestamp number; the default is already a date string. */
function toDateOnly(v: string | number): string {
  if (typeof v === 'number') {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
  }
  return v
}

function cardAppearanceFromArgs(a: PlaygroundArgs): ContactCardAppearance {
  return {
    showStatusIndicator: a.cardShowStatusIndicator,
    showContactIcon: a.cardShowContactIcon,
    showFieldLabel: a.cardShowFieldLabel,
    showVerifiedCheckbox: a.cardShowVerifiedCheckbox,
    showEditButton: a.cardShowEditButton,
    showStatusKey: a.cardShowStatusKey,

    statusIndicatorColor: a.cardStatusIndicatorColor,
    contactIconColor: a.cardContactIconColor,
    fieldLabelColor: a.cardFieldLabelColor,
    nameColor: orUndef(a.cardNameColor),
    valueColor: orUndef(a.cardValueColor),

    fontScale: a.cardFontScale,
    nameScale: a.cardNameScale,
    valueScale: a.cardValueScale,
    nameWeight: a.cardNameWeight,
    valueWeight: a.cardValueWeight,

    iconScale: a.cardIconScale,
    contactIconPxOverride: pxOrUndef(a.cardContactIconPxOverride),

    verifiedPlacement: a.cardVerifiedPlacement,
    editPlacement: a.cardEditPlacement,
    fieldAlign: a.cardFieldAlign,
    sectionPaddingPx: a.cardSectionPaddingPx,

    cardBorderPx: a.cardBorderPx,
    cardBorderColor: orUndef(a.cardBorderColor),
    cardRadiusPx: a.cardRadiusPx,
    cardBackground: orUndef(a.cardBackground),
    showDividers: a.cardShowDividers,
  }
}

// ── Copy Selected Design: readable summary of every current choice ───────────

function describeDesign(a: PlaygroundArgs): string {
  const yn = (b: boolean) => (b ? 'shown' : 'hidden')
  const col = (s: string) => (s.trim() === '' ? 'default' : s)
  const color = (c: ColorChoice) => (c === 'status' ? 'Status color' : 'Black')
  const pct = (n: number) => `${Math.round(n * 100)}%`
  const px = (n: number) => (n > 0 ? `${n}px` : 'auto (scales with text)')
  const scenarioLabel: Record<Scenario, string> = {
    onboarding: '1035 servicing onboarding (Stephen Remy)',
    review: 'Annual policy review (Maria DeLuca)',
  }
  const contextLabel: Record<ContactContext, string> = {
    verified: 'Verified (green)',
    onfile: 'On file, not verified (amber)',
    missing: 'Missing (red)',
    mixed: 'Mixed (green / amber / red)',
  }
  const outcomeLabel: Record<CallOutcome | 'none', string> = {
    none: 'Not yet recorded',
    reached: 'Reached',
    voicemail: 'Voicemail',
    callback: `Callback promised (${toDateOnly(a.callbackDate) || 'no date set'})`,
    'bad-number': 'Bad number (not reached)',
    'not-interested': 'Not interested',
  }
  const chan = (c: ChannelAvailability) => (c === 'auto' ? 'auto (from record)' : c === 'on' ? 'forced on' : 'forced off')

  const groups: DesignGroup[] = [
    {
      title: 'Scenario',
      lines: [
        { label: 'Purpose', value: scenarioLabel[a.scenario] },
        { label: 'Customer context', value: contextLabel[a.contactContext] },
        { label: 'Call outcome', value: outcomeLabel[a.callOutcome] },
      ],
    },
    {
      title: 'Workspace blocks',
      lines: [
        { label: 'Guidance', value: yn(a.showGuidance) },
        { label: 'Communication', value: yn(a.showCommunication) },
        { label: 'Outcome recorder', value: yn(a.showOutcome) },
        { label: 'Talk tracks', value: yn(a.showScripts) },
        { label: 'Contact card', value: yn(a.showContactCard) },
        { label: 'History', value: yn(a.showHistory) },
        { label: 'Commitment', value: yn(a.showCommitment) },
      ],
    },
    {
      title: 'Communication methods',
      lines: [
        { label: 'Call', value: chan(a.methodCall) },
        { label: 'Text', value: chan(a.methodText) },
        { label: 'Email', value: chan(a.methodEmail) },
      ],
    },
    {
      title: 'Contact card — visibility',
      lines: [
        { label: 'Status indicator', value: yn(a.cardShowStatusIndicator) },
        { label: 'Contact icon', value: yn(a.cardShowContactIcon) },
        { label: 'Field label', value: yn(a.cardShowFieldLabel) },
        { label: 'Verified checkbox', value: yn(a.cardShowVerifiedCheckbox) },
        { label: 'Edit button', value: yn(a.cardShowEditButton) },
        { label: 'Status key', value: yn(a.cardShowStatusKey) },
      ],
    },
    {
      title: 'Contact card — colors',
      lines: [
        { label: 'Status indicator', value: color(a.cardStatusIndicatorColor) },
        { label: 'Contact icon', value: color(a.cardContactIconColor) },
        { label: 'Field label', value: color(a.cardFieldLabelColor) },
        { label: 'Customer name', value: col(a.cardNameColor) },
        { label: 'Contact values', value: col(a.cardValueColor) },
      ],
    },
    {
      title: 'Contact card — typography',
      lines: [
        { label: 'All text (master)', value: pct(a.cardFontScale) },
        { label: 'Customer name', value: `${pct(a.cardNameScale)} / ${a.cardNameWeight}` },
        { label: 'Contact values', value: `${pct(a.cardValueScale)} / ${a.cardValueWeight}` },
      ],
    },
    {
      title: 'Contact card — icons',
      lines: [
        { label: 'All icons (master)', value: pct(a.cardIconScale) },
        { label: 'Contact icon', value: px(a.cardContactIconPxOverride) },
      ],
    },
    {
      title: 'Contact card — layout',
      lines: [
        { label: 'Verified placement', value: a.cardVerifiedPlacement },
        { label: 'Edit placement', value: a.cardEditPlacement },
        { label: 'Field alignment', value: a.cardFieldAlign },
        { label: 'Section padding', value: `${a.cardSectionPaddingPx}px` },
      ],
    },
    {
      title: 'Contact card — appearance',
      lines: [
        { label: 'Card border', value: `${a.cardBorderPx}px / ${col(a.cardBorderColor)}` },
        { label: 'Card radius', value: `${a.cardRadiusPx}px` },
        { label: 'Card background', value: col(a.cardBackground) },
        { label: 'Dividers', value: yn(a.cardShowDividers) },
      ],
    },
  ]

  const ap = cardAppearanceFromArgs(a)
  const code = `  cardAppearance={${JSON.stringify(ap, null, 2).replace(/\n/g, '\n  ')}}`
  return formatDesignSummary('Contact Workspace — selected design', groups, code)
}

// ── In-memory persistence (identical rules to the app) ───────────────────────

function makeInteractivePersist(record: CustomerContact, setRecord: (c: CustomerContact) => void) {
  return async (_id: string, payload: ContactPersistPayload): Promise<CustomerContact> => {
    const now = new Date().toISOString()
    let next = record
    if ('verified' in payload) {
      const colKey =
        payload.field === 'email' ? 'email_verified_at'
        : payload.field === 'phone' ? 'phone_verified_at'
        : 'address_verified_at'
      next = { ...record, [colKey]: payload.verified ? now : null }
    } else if (payload.field === 'email_availability') {
      // Every selection clears the active email and its verification (the
      // removed address is kept in history in the app). 'missing' resets the
      // stored fact to unknown (null); the reasons store their value. Mirrors
      // the app route.
      next = {
        ...record,
        email_availability: payload.availability === 'missing' ? null : payload.availability,
        email: null,
        email_verified_at: null,
      }
    } else if (payload.field === 'email') {
      const changed = (payload.email ?? null) !== (record.email ?? null)
      // A usable replacement clears No Usable Email / Undeliverable -> available.
      const clearable = record.email_availability === 'no_address' || record.email_availability === 'undeliverable'
      const email_availability = payload.email && (clearable || record.email_availability == null)
        ? 'available'
        : record.email_availability
      next = { ...record, email: payload.email, email_verified_at: changed ? null : record.email_verified_at, email_availability }
    } else if (payload.field === 'phone') {
      const changed = (payload.phone ?? null) !== (record.phone ?? null)
      next = { ...record, phone: payload.phone, phone_verified_at: changed ? null : record.phone_verified_at }
    } else if (payload.field === 'alert') {
      next = { ...record, contact_alert: payload.alert?.trim() ? payload.alert.trim() : null }
    } else {
      next = {
        ...record,
        street: payload.street, city: payload.city, state: payload.state, zip: payload.zip,
        address_verified_at: null,
      }
    }
    setRecord(next)
    return next
  }
}

/** The REAL workspace wired to in-memory persistence. Keyed by scenario+context
 * on the caller so switching either reloads the matching sample record. */
function LiveWorkspace({ args }: { args: PlaygroundArgs }) {
  const initial = useMemo(() => recordFor(args.scenario, args.contactContext), [args.scenario, args.contactContext])
  const [record, setRecord] = useState<CustomerContact>(initial)
  const onPersist = useMemo(() => makeInteractivePersist(record, setRecord), [record])

  return (
    <ContactWorkspace
      customer={record}
      purpose={PURPOSE[args.scenario]}
      history={HISTORY[args.scenario]}
      commitment={COMMITMENT[args.scenario]}
      recordedOutcome={args.callOutcome === 'none' ? null : args.callOutcome}
      recordedCallbackDate={toDateOnly(args.callbackDate)}
      cardAppearance={cardAppearanceFromArgs(args)}
      methods={{ call: args.methodCall, text: args.methodText, email: args.methodEmail }}
      visibility={{
        guidance: args.showGuidance,
        communication: args.showCommunication,
        outcome: args.showOutcome,
        scripts: args.showScripts,
        contactCard: args.showContactCard,
        history: args.showHistory,
        commitment: args.showCommitment,
      }}
      onPersistContact={onPersist}
      onRecordOutcome={() => {}}
      onBack={() => {}}
    />
  )
}

// ── argTypes, assembled from the shared factories ────────────────────────────

const argTypes = {
  scenario: choiceControl<Scenario>(
    'Purpose',
    ['onboarding', 'review'],
    { onboarding: '1035 onboarding', review: 'Annual review' },
    'Scenario',
  ),
  contactContext: choiceControl<ContactContext>(
    'Customer context',
    ['verified', 'onfile', 'missing', 'mixed'],
    { verified: 'Verified (green)', onfile: 'On file (amber)', missing: 'Missing (red)', mixed: 'Mixed' },
    'Scenario',
  ),
  callOutcome: choiceControl<CallOutcome | 'none'>(
    'Call outcome',
    ['none', 'reached', 'voicemail', 'callback', 'bad-number', 'not-interested'],
    {
      none: 'Not recorded',
      reached: 'Reached',
      voicemail: 'Voicemail',
      callback: 'Callback',
      'bad-number': 'Bad number (not reached)',
      'not-interested': 'Not interested',
    },
    'Scenario',
  ),
  callbackDate: dateControl('Callback date', 'Scenario'),

  showGuidance: toggleControl('Guidance', 'Workspace blocks'),
  showCommunication: toggleControl('Communication', 'Workspace blocks'),
  showOutcome: toggleControl('Outcome recorder', 'Workspace blocks'),
  showScripts: toggleControl('Talk tracks', 'Workspace blocks'),
  showContactCard: toggleControl('Contact card', 'Workspace blocks'),
  showHistory: toggleControl('History', 'Workspace blocks'),
  showCommitment: toggleControl('Commitment', 'Workspace blocks'),

  methodCall: choiceControl<ChannelAvailability>(
    'Call', ['auto', 'on', 'off'], { auto: 'Auto', on: 'On', off: 'Off' }, 'Communication methods',
  ),
  methodText: choiceControl<ChannelAvailability>(
    'Text', ['auto', 'on', 'off'], { auto: 'Auto', on: 'On', off: 'Off' }, 'Communication methods',
  ),
  methodEmail: choiceControl<ChannelAvailability>(
    'Email', ['auto', 'on', 'off'], { auto: 'Auto', on: 'On', off: 'Off' }, 'Communication methods',
  ),

  cardShowStatusIndicator: toggleControl('Status indicator', 'Card · Visibility'),
  cardShowContactIcon: toggleControl('Contact icon', 'Card · Visibility'),
  cardShowFieldLabel: toggleControl('Field label', 'Card · Visibility'),
  cardShowVerifiedCheckbox: toggleControl('Verified checkbox', 'Card · Visibility'),
  cardShowEditButton: toggleControl('Edit button', 'Card · Visibility'),
  cardShowStatusKey: toggleControl('Status key', 'Card · Visibility'),

  cardStatusIndicatorColor: statusOrBlackControl('Status indicator', 'Card · Colors'),
  cardContactIconColor: statusOrBlackControl('Contact icon', 'Card · Colors'),
  cardFieldLabelColor: statusOrBlackControl('Field label', 'Card · Colors'),
  cardNameColor: colorControl('Customer name', 'Card · Colors'),
  cardValueColor: colorControl('Contact values', 'Card · Colors'),

  cardFontScale: scaleControl('All text (master)', 'Card · Typography'),
  cardNameScale: scaleControl('Customer name size', 'Card · Typography'),
  cardValueScale: scaleControl('Contact value size', 'Card · Typography'),
  cardNameWeight: weightControl('Customer name weight', 'Card · Typography'),
  cardValueWeight: weightControl('Contact value weight', 'Card · Typography'),

  cardIconScale: scaleControl('All icons (master)', 'Card · Icons'),
  cardContactIconPxOverride: pxControl('Contact icon px (0 = auto)', 'Card · Icons', { max: 64 }),

  cardVerifiedPlacement: choiceControl<VerifiedPlacement>(
    'Verified placement', ['heading', 'value', 'bottom'],
    { heading: 'Beside heading', value: 'Beneath value', bottom: 'Bottom row' }, 'Card · Layout',
  ),
  cardEditPlacement: choiceControl<EditPlacement>(
    'Edit placement', ['value', 'row', 'bottom'],
    { value: 'Beside value', row: 'Separate row', bottom: 'Bottom row' }, 'Card · Layout',
  ),
  cardFieldAlign: choiceControl<AlignChoice>(
    'Field alignment', ['left', 'center', 'right'],
    { left: 'Left', center: 'Center', right: 'Right' }, 'Card · Layout',
  ),
  cardSectionPaddingPx: pxControl('Section padding', 'Card · Layout', { max: 40 }),

  cardBorderPx: pxControl('Card border', 'Card · Appearance', { max: 8 }),
  cardBorderColor: colorControl('Card border color', 'Card · Appearance'),
  cardRadiusPx: pxControl('Card rounding', 'Card · Appearance', { max: 40 }),
  cardBackground: colorControl('Card background', 'Card · Appearance'),
  cardShowDividers: toggleControl('Dividers', 'Card · Appearance'),

  // A playground-only free-text control for the callback date lives above; no
  // required component prop needs hiding here because `render` supplies them all.
  customer: hiddenControl,
  purpose: hiddenControl,
}

// ── Meta + the single Playground story ───────────────────────────────────────

const meta = {
  title: 'Workflow Design System/Contact Workspace',
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Interactive design playground for the universal Contact Workspace, composed from the existing shared layer. Use the grouped Controls (Scenario, Workspace blocks, Communication methods, and the embedded Contact card’s Visibility / Colors / Typography / Icons / Layout / Appearance) to tune the real workspace live, then use the pinned Copy Selected Design button to capture every choice as plain text. Nothing here changes component defaults, routes, schema, or data.',
      },
    },
  },
} satisfies Meta<typeof LiveWorkspace>

export default meta
type Story = StoryObj<PlaygroundArgs>

/**
 * The single Contact Workspace playground. Adjust the grouped controls and the
 * REAL composed workspace re-renders instantly; the embedded shared card stays
 * fully interactive (edit a value or tick Verified, in-memory only). The pinned
 * "Copy Selected Design" button captures every current choice as readable text.
 */
export const Playground: Story = {
  args: DEFAULT_ARGS,
  argTypes,
  render: (args) => {
    const copyText = describeDesign(args)
    return (
      <MentoringProvider>
        {/* The shared PlaygroundStage centers a single narrow card; the
            workspace is a full two-column task surface, so this playground uses
            the shared WorkflowSurface and the shared CopyDesignButton directly
            in a wide layout. Same convention (live real component + pinned copy
            action), sized for the workspace. */}
        <WorkflowSurface className="min-h-screen">
          <div className="pointer-events-none sticky top-0 z-10 flex justify-end p-4">
            <div className="pointer-events-auto rounded-xl border border-slate-200 bg-white/90 p-2 shadow-sm backdrop-blur">
              <CopyDesignButton summary={copyText} />
            </div>
          </div>
          <LiveWorkspace key={`${args.scenario}:${args.contactContext}`} args={args} />
        </WorkflowSurface>
      </MentoringProvider>
    )
  },
}
