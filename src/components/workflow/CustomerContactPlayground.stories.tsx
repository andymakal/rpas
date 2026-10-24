import type { Meta, StoryObj } from '@storybook/react'
import { useMemo, useState } from 'react'

import { MentoringProvider } from '@/lib/mentoring/MentoringProvider'
import {
  CustomerContactCard,
  type CustomerContact,
  type ContactPersistPayload,
  type ContactCardAppearance,
  type ColorChoice,
  type WeightChoice,
  type VerifiedPlacement,
  type EditPlacement,
  type AlignChoice,
} from './CustomerContactCard'
import {
  PlaygroundStage,
  toggleControl,
  statusOrBlackControl,
  scaleControl,
  pxControl,
  weightControl,
  colorControl,
  choiceControl,
  textControl,
  hiddenControl,
  formatDesignSummary,
  type DesignGroup,
} from './playground-controls'

/**
 * Workflow Design System — Customer Contact → Playground.
 *
 * The one interactive visual design playground for the REAL shared
 * `CustomerContactCard`. It renders the actual production component (no copy, no
 * fork, no custom editor) and tunes its look through the component's own
 * `appearance` prop, driven entirely by Storybook's native Args/Controls. Open
 * the Controls panel and every switch, slider, selector, and color picker
 * re-renders the real card immediately — no rebuild, redeploy, or Kiro step.
 *
 * The playground OPENS on the approved permanent defaults (the same look every
 * production call site now renders by omitting `appearance`): hidden status
 * indicator, status-colored contact icons, black labels, a 150% bold teal
 * customer name, a 1px slate-700 card border and slate-700 dividers. The
 * controls remain for future experimentation; they override the approved
 * defaults non-destructively.
 *
 * Nothing here changes the component's source or any customer record. The card
 * runs on an in-memory `onPersist` (identical rules to the app: a changed value
 * clears its verification; a missing value cannot be verified), so editing and
 * verifying stay fully interactive and side-effect free. The `appearance` prop
 * is presentation-only.
 *
 * Mentoring is intentionally NOT a control here: it is settled behavior (always
 * shown, expanded when the global Mentoring preference is on and collapsed when
 * off, independently toggleable). The size/color of the Mentoring tip can still
 * be nudged under Typography / Colors.
 *
 * The pinned "Copy Selected Design" button captures ALL current appearance and
 * layout choices as readable plain text to hand to ChatGPT for a permanent
 * implementation — without switching stories.
 *
 * Reuse: the control panel is assembled from the shared factories in
 * `./playground-controls`. The next shared component (e.g. Customer History)
 * exposes its own `appearance` prop and reuses those same factories, so this
 * playground system is never reimplemented.
 */

// ── Sample record, keyed to a contact-status choice ──────────────────────────

const baseRecord: Omit<
  CustomerContact,
  'email_verified_at' | 'phone_verified_at' | 'address_verified_at'
> = {
  id: 'playground-customer',
  first_name: 'Jordan',
  last_name: 'Rivera',
  email: 'jordan.rivera@example.com',
  phone: '(215) 555-0142',
  street: '1420 Chestnut St',
  address_line1: null,
  city: 'Philadelphia',
  state: 'PA',
  zip: '19102',
  email_availability: 'available',
}

type ContactState = 'verified' | 'onfile' | 'missing' | 'mixed'

const VERIFIED_AT = '2026-10-10T15:00:00.000Z'

/** Build a sample record for the chosen contact state. `verified` → all green;
 * `onfile` → all present, unverified (amber); `missing` → all cleared (red);
 * `mixed` → verified phone, unverified email, missing address (all three at
 * once). */
function recordForState(state: ContactState): CustomerContact {
  if (state === 'missing') {
    return {
      ...baseRecord,
      email: null, phone: null, street: null, city: null, state: null, zip: null,
      email_verified_at: null, phone_verified_at: null, address_verified_at: null,
      email_availability: null,
    }
  }
  if (state === 'mixed') {
    return {
      ...baseRecord,
      email_verified_at: null,
      phone_verified_at: VERIFIED_AT,
      street: null, city: null, state: null, zip: null,
      address_verified_at: null,
    }
  }
  const stamp = state === 'verified' ? VERIFIED_AT : null
  return {
    ...baseRecord,
    email_verified_at: stamp,
    phone_verified_at: stamp,
    address_verified_at: stamp,
  }
}

// ── Flat args (each mapped to one native control) ────────────────────────────

interface PlaygroundArgs {
  contactState: ContactState

  // Visibility
  showStatusIndicator: boolean
  showContactIcon: boolean
  showFieldLabel: boolean
  showVerifiedCheckbox: boolean
  showEditButton: boolean
  showStatusKey: boolean

  // Colors
  statusIndicatorColor: ColorChoice
  contactIconColor: ColorChoice
  fieldLabelColor: ColorChoice
  nameColor: string
  valueColor: string
  verifyColor: string
  mentoringColor: string
  statusKeyColor: string

  // Typography
  fontFamily: string
  fontScale: number
  nameScale: number
  labelScale: number
  valueScale: number
  controlScale: number
  verifyScale: number
  mentoringScale: number
  statusKeyScale: number
  nameWeight: WeightChoice
  labelWeight: WeightChoice
  valueWeight: WeightChoice
  controlWeight: WeightChoice

  // Icons
  iconScale: number
  statusIconPxOverride: number
  contactIconPxOverride: number
  verifyBoxPxOverride: number
  editIconPxOverride: number

  // Layout
  verifiedPlacement: VerifiedPlacement
  editPlacement: EditPlacement
  fieldAlign: AlignChoice
  fieldSpacingPx: number
  sectionPaddingPx: number

  // Appearance / chrome
  cardBorderPx: number
  cardBorderColor: string
  cardRadiusPx: number
  cardPaddingPx: number
  cardBackground: string
  showDividers: boolean
  dividerColor: string
  controlBorderPx: number
  controlRadiusPx: number
}

/** The approved permanent defaults, expressed as Right Path CSS color tokens so
 * the color controls display them and they are not literal Tailwind names:
 * `var(--brand)` is teal-600 and `var(--text-secondary)` is slate-700. These
 * match APPROVED_DEFAULTS in the component, so the playground opens on exactly
 * the production look. The `0` px-override sentinels mean "no override" (icons
 * scale with their text); empty color strings mean "use the role default". */
const BRAND_TEAL = 'var(--brand)'
const SLATE_700 = 'var(--text-secondary)'

const DEFAULT_ARGS: PlaygroundArgs = {
  contactState: 'onfile',

  showStatusIndicator: false,
  showContactIcon: true,
  showFieldLabel: true,
  showVerifiedCheckbox: true,
  showEditButton: true,
  showStatusKey: true,

  statusIndicatorColor: 'status',
  contactIconColor: 'status',
  fieldLabelColor: 'black',
  nameColor: BRAND_TEAL,
  valueColor: '',
  verifyColor: '',
  mentoringColor: '',
  statusKeyColor: '',

  fontFamily: '',
  fontScale: 1,
  nameScale: 1.5,
  labelScale: 1,
  valueScale: 1,
  controlScale: 1,
  verifyScale: 1,
  mentoringScale: 1,
  statusKeyScale: 1,
  nameWeight: 'bold',
  labelWeight: 'default',
  valueWeight: 'default',
  controlWeight: 'default',

  iconScale: 1,
  statusIconPxOverride: 0,
  contactIconPxOverride: 0,
  verifyBoxPxOverride: 0,
  editIconPxOverride: 0,

  verifiedPlacement: 'heading',
  editPlacement: 'value',
  fieldAlign: 'left',
  fieldSpacingPx: 6,
  sectionPaddingPx: 12,

  cardBorderPx: 1,
  cardBorderColor: SLATE_700,
  cardRadiusPx: 16,
  cardPaddingPx: 16,
  cardBackground: '',
  showDividers: true,
  dividerColor: SLATE_700,
  controlBorderPx: 1,
  controlRadiusPx: 8,
}

/** Treat empty-string colors / zero px-overrides as "unset" so the component
 * sees `undefined` and keeps its default (and `isDefault` can hold). */
const orUndef = (s: string) => (s.trim() === '' ? undefined : s)
const pxOrUndef = (n: number) => (n > 0 ? n : undefined)

function appearanceFromArgs(a: PlaygroundArgs): ContactCardAppearance {
  return {
    showStatusIndicator: a.showStatusIndicator,
    showContactIcon: a.showContactIcon,
    showFieldLabel: a.showFieldLabel,
    showVerifiedCheckbox: a.showVerifiedCheckbox,
    showEditButton: a.showEditButton,
    showStatusKey: a.showStatusKey,

    statusIndicatorColor: a.statusIndicatorColor,
    contactIconColor: a.contactIconColor,
    fieldLabelColor: a.fieldLabelColor,
    nameColor: orUndef(a.nameColor),
    valueColor: orUndef(a.valueColor),
    verifyColor: orUndef(a.verifyColor),
    mentoringColor: orUndef(a.mentoringColor),
    statusKeyColor: orUndef(a.statusKeyColor),

    fontFamily: orUndef(a.fontFamily),
    fontScale: a.fontScale,
    nameScale: a.nameScale,
    labelScale: a.labelScale,
    valueScale: a.valueScale,
    controlScale: a.controlScale,
    verifyScale: a.verifyScale,
    mentoringScale: a.mentoringScale,
    statusKeyScale: a.statusKeyScale,
    nameWeight: a.nameWeight,
    labelWeight: a.labelWeight,
    valueWeight: a.valueWeight,
    controlWeight: a.controlWeight,

    iconScale: a.iconScale,
    statusIconPxOverride: pxOrUndef(a.statusIconPxOverride),
    contactIconPxOverride: pxOrUndef(a.contactIconPxOverride),
    verifyBoxPxOverride: pxOrUndef(a.verifyBoxPxOverride),
    editIconPxOverride: pxOrUndef(a.editIconPxOverride),

    verifiedPlacement: a.verifiedPlacement,
    editPlacement: a.editPlacement,
    fieldAlign: a.fieldAlign,
    fieldSpacingPx: a.fieldSpacingPx,
    sectionPaddingPx: a.sectionPaddingPx,

    cardBorderPx: a.cardBorderPx,
    cardBorderColor: orUndef(a.cardBorderColor),
    cardRadiusPx: a.cardRadiusPx,
    cardPaddingPx: a.cardPaddingPx,
    cardBackground: orUndef(a.cardBackground),
    showDividers: a.showDividers,
    dividerColor: orUndef(a.dividerColor),
    controlBorderPx: a.controlBorderPx,
    controlRadiusPx: a.controlRadiusPx,
  }
}

// ── Copy Selected Design: readable summary of every current choice ───────────

function describeDesign(a: PlaygroundArgs): string {
  const color = (c: ColorChoice) => (c === 'status' ? 'Status color' : 'Black')
  const pct = (n: number) => `${Math.round(n * 100)}%`
  const px = (n: number) => (n > 0 ? `${n}px` : 'auto (scales with text)')
  const yn = (b: boolean) => (b ? 'shown' : 'hidden')
  const col = (s: string) => (s.trim() === '' ? 'default' : s)
  const stateLabel: Record<ContactState, string> = {
    verified: 'Verified (green)',
    onfile: 'On file, not verified (amber)',
    missing: 'Missing (red)',
    mixed: 'Mixed (green / amber / red)',
  }

  const groups: DesignGroup[] = [
    {
      title: 'Contact state shown',
      lines: [{ label: 'State', value: stateLabel[a.contactState] }],
    },
    {
      title: 'Visibility',
      lines: [
        { label: 'Status indicator', value: yn(a.showStatusIndicator) },
        { label: 'Contact icon', value: yn(a.showContactIcon) },
        { label: 'Field label', value: yn(a.showFieldLabel) },
        { label: 'Verified checkbox', value: yn(a.showVerifiedCheckbox) },
        { label: 'Edit button', value: yn(a.showEditButton) },
        { label: 'Status key', value: yn(a.showStatusKey) },
      ],
    },
    {
      title: 'Colors',
      lines: [
        { label: 'Status indicator', value: color(a.statusIndicatorColor) },
        { label: 'Contact icon', value: color(a.contactIconColor) },
        { label: 'Field label', value: color(a.fieldLabelColor) },
        { label: 'Customer name', value: col(a.nameColor) },
        { label: 'Contact values', value: col(a.valueColor) },
        { label: 'Verify text', value: col(a.verifyColor) },
        { label: 'Mentoring text', value: col(a.mentoringColor) },
        { label: 'Status key', value: col(a.statusKeyColor) },
      ],
    },
    {
      title: 'Typography',
      lines: [
        { label: 'Font family', value: col(a.fontFamily) },
        { label: 'All text (master)', value: pct(a.fontScale) },
        { label: 'Customer name', value: `${pct(a.nameScale)} / ${a.nameWeight}` },
        { label: 'Field labels', value: `${pct(a.labelScale)} / ${a.labelWeight}` },
        { label: 'Contact values', value: `${pct(a.valueScale)} / ${a.valueWeight}` },
        { label: 'Buttons', value: `${pct(a.controlScale)} / ${a.controlWeight}` },
        { label: 'Verify labels', value: pct(a.verifyScale) },
        { label: 'Mentoring', value: pct(a.mentoringScale) },
        { label: 'Status key', value: pct(a.statusKeyScale) },
      ],
    },
    {
      title: 'Icons',
      lines: [
        { label: 'All icons (master)', value: pct(a.iconScale) },
        { label: 'Status icon', value: px(a.statusIconPxOverride) },
        { label: 'Contact icon', value: px(a.contactIconPxOverride) },
        { label: 'Verify box', value: px(a.verifyBoxPxOverride) },
        { label: 'Edit icon', value: px(a.editIconPxOverride) },
      ],
    },
    {
      title: 'Layout',
      lines: [
        { label: 'Verified placement', value: a.verifiedPlacement },
        { label: 'Edit placement', value: a.editPlacement },
        { label: 'Field alignment', value: a.fieldAlign },
        { label: 'Field spacing', value: `${a.fieldSpacingPx}px` },
        { label: 'Section padding', value: `${a.sectionPaddingPx}px` },
      ],
    },
    {
      title: 'Appearance',
      lines: [
        { label: 'Card border', value: `${a.cardBorderPx}px / ${col(a.cardBorderColor)}` },
        { label: 'Card radius', value: `${a.cardRadiusPx}px` },
        { label: 'Card padding', value: `${a.cardPaddingPx}px` },
        { label: 'Card background', value: col(a.cardBackground) },
        { label: 'Dividers', value: a.showDividers ? `shown / ${col(a.dividerColor)}` : 'hidden' },
        { label: 'Control border', value: `${a.controlBorderPx}px` },
        { label: 'Control radius', value: `${a.controlRadiusPx}px` },
      ],
    },
  ]

  const ap = appearanceFromArgs(a)
  const code = `  appearance={${JSON.stringify(ap, null, 2).replace(/\n/g, '\n  ')}}`

  return formatDesignSummary('Customer Contact Card — selected design', groups, code)
}

// ── In-memory persistence (identical rules to the app) ───────────────────────

function makeInteractivePersist(
  record: CustomerContact,
  setRecord: (c: CustomerContact) => void,
) {
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
      // Either reason clears the active email and its verification (the removed
      // address is kept in history in the app). Mirrors the app route.
      next = { ...record, email_availability: payload.availability, email: null, email_verified_at: null }
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

/** The REAL card wired to in-memory persistence, driven by the given appearance.
 * Keyed by contact state on the caller so switching the state arg reloads the
 * matching sample into the card's in-memory record. */
function LiveCard({ initial, appearance }: { initial: CustomerContact; appearance: ContactCardAppearance }) {
  const [record, setRecord] = useState<CustomerContact>(initial)
  const onPersist = useMemo(() => makeInteractivePersist(record, setRecord), [record])
  return <CustomerContactCard customer={record} onPersist={onPersist} appearance={appearance} />
}

// ── argTypes, assembled from the shared factories ────────────────────────────

const argTypes = {
  contactState: choiceControl<ContactState>(
    'Contact state',
    ['verified', 'onfile', 'missing', 'mixed'],
    {
      verified: 'Verified (green)',
      onfile: 'On file (amber)',
      missing: 'Missing (red)',
      mixed: 'Mixed',
    },
    'Contact state',
  ),

  showStatusIndicator: toggleControl('Status indicator'),
  showContactIcon: toggleControl('Contact icon'),
  showFieldLabel: toggleControl('Field label'),
  showVerifiedCheckbox: toggleControl('Verified checkbox'),
  showEditButton: toggleControl('Edit button'),
  showStatusKey: toggleControl('Status key'),

  statusIndicatorColor: statusOrBlackControl('Status indicator'),
  contactIconColor: statusOrBlackControl('Contact icon'),
  fieldLabelColor: statusOrBlackControl('Field label'),
  nameColor: colorControl('Customer name', 'Colors'),
  valueColor: colorControl('Contact values', 'Colors'),
  verifyColor: colorControl('Verify text', 'Colors'),
  mentoringColor: colorControl('Mentoring text', 'Colors'),
  statusKeyColor: colorControl('Status key', 'Colors'),

  fontFamily: textControl('Font family', 'Typography'),
  fontScale: scaleControl('All text (master)'),
  nameScale: scaleControl('Customer name size'),
  labelScale: scaleControl('Field label size'),
  valueScale: scaleControl('Contact value size'),
  controlScale: scaleControl('Button size'),
  verifyScale: scaleControl('Verify label size'),
  mentoringScale: scaleControl('Mentoring size'),
  statusKeyScale: scaleControl('Status key size'),
  nameWeight: weightControl('Customer name weight'),
  labelWeight: weightControl('Field label weight'),
  valueWeight: weightControl('Contact value weight'),
  controlWeight: weightControl('Button weight'),

  iconScale: scaleControl('All icons (master)', 'Icons'),
  statusIconPxOverride: pxControl('Status icon px (0 = auto)', 'Icons', { max: 64 }),
  contactIconPxOverride: pxControl('Contact icon px (0 = auto)', 'Icons', { max: 64 }),
  verifyBoxPxOverride: pxControl('Verify box px (0 = auto)', 'Icons', { max: 40 }),
  editIconPxOverride: pxControl('Edit icon px (0 = auto)', 'Icons', { max: 40 }),

  verifiedPlacement: choiceControl<VerifiedPlacement>(
    'Verified placement',
    ['heading', 'value', 'bottom'],
    { heading: 'Beside heading', value: 'Beneath value', bottom: 'Bottom row' },
    'Layout',
  ),
  editPlacement: choiceControl<EditPlacement>(
    'Edit placement',
    ['value', 'row', 'bottom'],
    { value: 'Beside value', row: 'Separate row', bottom: 'Bottom row' },
    'Layout',
  ),
  fieldAlign: choiceControl<AlignChoice>(
    'Field alignment',
    ['left', 'center', 'right'],
    { left: 'Left', center: 'Center', right: 'Right' },
    'Layout',
  ),
  fieldSpacingPx: pxControl('Field spacing', 'Layout', { max: 32 }),
  sectionPaddingPx: pxControl('Section padding', 'Layout', { max: 40 }),

  cardBorderPx: pxControl('Card border', 'Appearance', { max: 8 }),
  cardBorderColor: colorControl('Card border color', 'Appearance'),
  cardRadiusPx: pxControl('Card rounding', 'Appearance', { max: 40 }),
  cardPaddingPx: pxControl('Card padding', 'Appearance', { max: 48 }),
  cardBackground: colorControl('Card background', 'Appearance'),
  showDividers: toggleControl('Dividers', 'Appearance'),
  dividerColor: colorControl('Divider color', 'Appearance'),
  controlBorderPx: pxControl('Control border', 'Appearance', { max: 6 }),
  controlRadiusPx: pxControl('Control rounding', 'Appearance', { max: 32 }),

  // The required prop is set by `render`; hide it from the panel.
  customer: hiddenControl,
}

// ── Meta + the single Playground story ───────────────────────────────────────

const meta = {
  title: 'Workflow Design System/Customer Contact',
  component: CustomerContactCard,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Interactive visual design playground for the real shared CustomerContactCard. Use the Controls panel (grouped Visibility, Colors, Typography, Icons, Layout, Appearance) to tune the real component live, then use the pinned Copy Selected Design button to capture every choice as plain text. Nothing here changes the component defaults or any data.',
      },
    },
  },
} satisfies Meta<typeof CustomerContactCard>

export default meta
type Story = StoryObj<PlaygroundArgs>

/**
 * The single Customer Contact playground. Adjust the grouped controls and the
 * REAL card re-renders instantly; it stays interactive (edit a value or tick
 * Verified, in-memory only). The pinned "Copy Selected Design" button captures
 * all current appearance and layout choices as readable text.
 */
export const Playground: Story = {
  args: DEFAULT_ARGS,
  argTypes,
  render: (args) => {
    const appearance = appearanceFromArgs(args)
    const initial = recordForState(args.contactState)
    const copyText = describeDesign(args)
    return (
      <MentoringProvider>
        <PlaygroundStage copyText={copyText}>
          <LiveCard key={args.contactState} initial={initial} appearance={appearance} />
        </PlaygroundStage>
      </MentoringProvider>
    )
  },
}
