'use client'

/**
 * CustomerContactCard — the reusable customer-contact surface for Right Path.
 *
 * One shared component for showing and correcting a customer's durable contact
 * facts: name, email, phone, and mailing address. It is deliberately NOT tied to
 * any one workflow (stewardship, contact review, the customer record) — it reads
 * and writes only the customer record itself, so the same card can be dropped
 * anywhere the existing contact display can be replaced.
 *
 * Display
 *   - The customer's name is the card heading, with an expandable Mentoring tip
 *     beneath it.
 *   - One outer card holds three compact sections: Email, Phone, Mailing
 *     Address. Each section heading pairs a large status icon (yellow
 *     shield-question = on file not verified, green check-circle = customer
 *     verified, red warning = missing) with the field's contact icon (Mail /
 *     Phone / MapPin) and label, and carries the Customer Verified checkbox at
 *     the right.
 *   - The complete value shows beneath the heading in full (never truncated,
 *     the mailing address on two lines), with Edit at its right. A field with no
 *     usable value reads "Missing".
 *   - Status meaning never relies on color alone: each status icon is a distinct
 *     shape, and its accessible label states the meaning.
 *
 * Editing
 *   - Email and phone edit independently; the mailing address edits as one group
 *     (street, city, state, ZIP). Each editor has Save and Cancel.
 *   - Values are normalized/validated with Right Path's shared contact-input
 *     utilities before saving. Saving writes straight to the customer record and
 *     the display updates immediately from the returned row.
 *
 * Verification
 *   - A Customer Verified checkbox sits beside each field. It reuses the
 *     customer record's existing *_verified_at facts and is independent of
 *     editing. A missing/unusable value cannot be verified. Changing a verified
 *     value clears its prior verification (the server resets it on edit, and the
 *     card reflects that from the returned row).
 *
 * Persistence is injectable so the card is testable and Storybook-friendly:
 *   - Omit `onPersist` and the card calls PATCH /api/customers/[id]/contact.
 *   - Provide `onPersist` (e.g. in Storybook) to intercept writes.
 *
 * Appearance (presentation-only, Storybook-driven)
 *   - A single optional `appearance` prop drives every cosmetic choice the Design
 *     Playground exposes: element visibility, per-role typography (family, size,
 *     weight, color), icon sizing with proportional-to-text scaling plus
 *     independent overrides, layout arrangement of the Verified checkbox and Edit
 *     button, card/control chrome (borders, dividers, backgrounds, rounding,
 *     spacing, padding), and the Mentoring block.
 *   - It never changes behavior, data, or the payloads sent to `onPersist`.
 *     Omitting it (as every production call site does) reproduces the current
 *     production look exactly — see `resolveAppearance`/`isDefault`.
 */

import { useCallback, useMemo, useState } from 'react'
import {
  Mail, Phone, MapPin, Pencil, Check, X, Loader2,
  ShieldQuestion, CheckCircle2, AlertTriangle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useMentorDisclosure, MentorCapButton, MentorCapPanel } from '@/lib/mentoring/MentorUi'
import {
  normalizeEmailInput, normalizePhoneInput, formatPhoneAsTyped,
  type ContactFieldResult,
} from '@/lib/contact-input'
import {
  type EmailAvailability,
  type EmailAvailabilityDisplay,
  EMAIL_AVAILABILITY_LABEL,
  EMAIL_AVAILABILITY_HELP,
  resolveEmailAvailabilityDisplay,
} from '@/lib/email-availability'

// ── Data shape ───────────────────────────────────────────────────────────────

/** The subset of the customer record this card reads and writes. All fields
 * already exist on the customers row; the card introduces no new field. */
export interface CustomerContact {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  /** Mailing street. Mirrors the app convention: `street`, falling back to the
   * (in practice empty) `address_line1`. */
  street: string | null
  address_line1?: string | null
  city: string | null
  state: string | null
  zip: string | null
  email_verified_at: string | null
  phone_verified_at: string | null
  address_verified_at: string | null
  /** Durable email-availability fact (customers.email_availability). NULL means
   * unknown ("Missing"). Governs how the Email section reads and whether email
   * research is worthwhile. See `@/lib/email-availability`. */
  email_availability: EmailAvailability | null
}

type ContactFieldKey = 'email' | 'phone' | 'address'

// ── Appearance (presentation-only, Storybook-driven) ─────────────────────────

/** Which color a recolorable element takes. `status` = the field's green/amber/
 * red status token (the production default for the icons); `black` = plain
 * black, independent of status. */
export type ColorChoice = 'status' | 'black'

/** A font-weight choice for a text role. `default` leaves the component's own
 * weight class in place (so production output is unchanged). */
export type WeightChoice = 'default' | 'normal' | 'medium' | 'semibold' | 'bold'

/** Where the Customer Verified checkbox sits relative to its field. `heading` =
 * the production placement, on the label line at the right. `value` = beneath
 * the value. `bottom` = pulled to a shared bottom row with Edit. */
export type VerifiedPlacement = 'heading' | 'value' | 'bottom'

/** Where the Edit control sits. `value` = the production placement, beside the
 * value at the right. `row` = on its own row beneath the value. `bottom` = a
 * shared bottom row with Verified. */
export type EditPlacement = 'value' | 'row' | 'bottom'

/** Horizontal alignment of a field's content. */
export type AlignChoice = 'left' | 'center' | 'right'

/**
 * Optional presentation configuration for the card. Purely cosmetic: it changes
 * visibility, color assignment, typography, icon sizing, layout arrangement, and
 * chrome — never behavior, data, or the payloads sent to `onPersist`. Any field
 * left out falls back to the component's APPROVED permanent defaults (see
 * `APPROVED_DEFAULTS`), so omitting the whole prop (as production call sites do)
 * renders the approved design. It exists so the Design Playground can drive the
 * REAL component through Storybook controls without a fork, and so the approved
 * look is expressed once as data rather than scattered across screens.
 *
 * Mentoring is deliberately NOT configurable here: it is settled behavior (the
 * one shared MentorGuidance, always shown, expanded when the global Mentoring
 * preference is on and collapsed when off, independently toggleable), not an
 * appearance choice.
 *
 * Convention for reuse: this is the shared shape for a workflow component's
 * presentation lab. A sibling component (e.g. Customer History) should expose an
 * analogous `appearance` prop and reuse the Storybook control factory in
 * `./playground-controls` so the next playground is assembly, not reinvention.
 */
export interface ContactCardAppearance {
  // ── Visibility (each element independently shown/hidden) ──────────────────
  showStatusIndicator?: boolean
  showContactIcon?: boolean
  showFieldLabel?: boolean
  showVerifiedCheckbox?: boolean
  showEditButton?: boolean
  showStatusKey?: boolean

  // ── Colors (status token vs plain black, independently) ───────────────────
  statusIndicatorColor?: ColorChoice
  contactIconColor?: ColorChoice
  fieldLabelColor?: ColorChoice

  // ── Typography ────────────────────────────────────────────────────────────
  /** CSS font-family applied to the whole card. Default: the component's own. */
  fontFamily?: string
  /** Master multiplier applied to every scalable text role. Default 1. */
  fontScale?: number
  /** Per-role size multipliers (on top of the master scale). Default 1 each. */
  nameScale?: number
  labelScale?: number
  valueScale?: number
  controlScale?: number
  verifyScale?: number
  mentoringScale?: number
  statusKeyScale?: number
  /** Per-role weight overrides. Default `default` (leave existing weight). */
  nameWeight?: WeightChoice
  labelWeight?: WeightChoice
  valueWeight?: WeightChoice
  controlWeight?: WeightChoice
  /** Per-role color overrides as any CSS color. Omit to keep the role default. */
  nameColor?: string
  valueColor?: string
  verifyColor?: string
  mentoringColor?: string
  statusKeyColor?: string

  // ── Icon sizing ───────────────────────────────────────────────────────────
  /** Master icon multiplier. Icons scale with their associated text by default;
   * this scales every icon on top of that. Default 1. */
  iconScale?: number
  /** Independent override (px) for the status/contact heading icons. When set it
   * replaces the text-proportional size. */
  statusIconPxOverride?: number
  contactIconPxOverride?: number
  /** Independent override (px) for the Verified checkbox box. Default scales with
   * the verify label. */
  verifyBoxPxOverride?: number
  /** Independent override (px) for the Edit pencil icon. Default scales with the
   * Edit button text. */
  editIconPxOverride?: number

  // ── Layout ────────────────────────────────────────────────────────────────
  verifiedPlacement?: VerifiedPlacement
  editPlacement?: EditPlacement
  fieldAlign?: AlignChoice
  /** Vertical gap (px) between the stacked parts within a field. Default 6. */
  fieldSpacingPx?: number
  /** Vertical padding (px) above/below each field section. Default 12. */
  sectionPaddingPx?: number

  // ── Appearance / chrome ───────────────────────────────────────────────────
  /** Card border width (px). Default 1. 0 removes the border. */
  cardBorderPx?: number
  /** Card border color (any CSS color). Default: the surface-border token. */
  cardBorderColor?: string
  /** Card corner radius (px). Default 16 (rounded-2xl). */
  cardRadiusPx?: number
  /** Card inner padding (px). Default 16 (p-4). */
  cardPaddingPx?: number
  /** Card background (any CSS color). Default: the surface-card token (white). */
  cardBackground?: string
  /** Show the dividers between field sections. Default true. */
  showDividers?: boolean
  /** Divider color (any CSS color). Default: the surface-border-strong token. */
  dividerColor?: string
  /** Border on the Edit / control buttons (px). Default 1. */
  controlBorderPx?: number
  /** Control corner radius (px). Default 8 (rounded-lg). */
  controlRadiusPx?: number
}

/** The neutral scalar baseline (the original plain-Tailwind look). The approved
 * design layers over this via `APPROVED_DEFAULTS`; it is kept separate so
 * `isDefault` can still recognize the untouched Tailwind baseline (no inline
 * styles) when the Playground is reset all the way to neutral. */
const DEFAULT_APPEARANCE: Required<Omit<ContactCardAppearance,
  'fontFamily' | 'statusIconPxOverride' | 'contactIconPxOverride' |
  'verifyBoxPxOverride' | 'editIconPxOverride' | 'cardBorderColor' |
  'cardBackground' | 'dividerColor' | 'nameColor' | 'valueColor' |
  'verifyColor' | 'mentoringColor' | 'statusKeyColor'>> = {
  showStatusIndicator: true,
  showContactIcon: true,
  showFieldLabel: true,
  showVerifiedCheckbox: true,
  showEditButton: true,
  showStatusKey: true,
  statusIndicatorColor: 'status',
  contactIconColor: 'status',
  fieldLabelColor: 'black',
  fontScale: 1,
  nameScale: 1,
  labelScale: 1,
  valueScale: 1,
  controlScale: 1,
  verifyScale: 1,
  mentoringScale: 1,
  statusKeyScale: 1,
  nameWeight: 'default',
  labelWeight: 'default',
  valueWeight: 'default',
  controlWeight: 'default',
  iconScale: 1,
  verifiedPlacement: 'heading',
  editPlacement: 'value',
  fieldAlign: 'left',
  fieldSpacingPx: 6,
  sectionPaddingPx: 12,
  cardBorderPx: 1,
  cardRadiusPx: 16,
  cardPaddingPx: 16,
  showDividers: true,
  controlBorderPx: 1,
  controlRadiusPx: 8,
}

/**
 * The APPROVED permanent default appearance for the shared card. This is the
 * single source of truth for the production look; every call site that passes
 * no `appearance` renders exactly this, and the Playground opens on it.
 *
 * Color choices use Right Path CSS color tokens (not literal Tailwind class
 * names): `--brand` is the teal-600 brand accent, `--text-secondary` is the
 * slate-700 ink tier. The copied design named Tailwind palette steps; those map
 * to these existing tokens rather than being pasted as literal color strings.
 *
 * Values the approved design pins (everything else inherits the neutral
 * baseline, so values/controls/other spacing are unchanged):
 *   - Status indicator hidden; contact icons kept with green/amber/red status
 *     color; field labels black.
 *   - Customer name 150% of its 22px base (→ 33px), bold, teal-600 (`--brand`).
 *   - Card border 1px slate-700; section dividers slate-700; radius 16; padding
 *     16; field spacing 6; section padding 12.
 */
const BRAND_TOKEN = 'var(--brand)' // teal-600
const SLATE_700_TOKEN = 'var(--text-secondary)' // slate-700

const APPROVED_DEFAULTS: ContactCardAppearance = {
  showStatusIndicator: false,
  nameScale: 1.5,
  nameWeight: 'bold',
  nameColor: BRAND_TOKEN,
  cardBorderPx: 1,
  cardBorderColor: SLATE_700_TOKEN,
  cardRadiusPx: 16,
  cardPaddingPx: 16,
  fieldSpacingPx: 6,
  sectionPaddingPx: 12,
  showDividers: true,
  dividerColor: SLATE_700_TOKEN,
}

/** The resolved view the component renders from. When the appearance equals the
 * default, `isDefault` is true and the component renders exactly as before: no
 * inline styles, no overrides, byte-identical to the current production output. */
interface ResolvedAppearance {
  // visibility
  showStatusIndicator: boolean
  showContactIcon: boolean
  showFieldLabel: boolean
  showVerifiedCheckbox: boolean
  showEditButton: boolean
  showStatusKey: boolean
  // colors
  statusIndicatorColor: ColorChoice
  contactIconColor: ColorChoice
  fieldLabelColor: ColorChoice
  nameColor?: string
  valueColor?: string
  verifyColor?: string
  mentoringColor?: string
  statusKeyColor?: string
  // typography
  fontFamily?: string
  nameFontPx: number
  labelFontPx: number
  valueFontPx: number
  controlFontPx: number
  verifyFontPx: number
  mentoringFontPx: number
  mentoringOverridden: boolean
  statusKeyFontPx: number
  supportingFontPx: number
  nameWeight: WeightChoice
  labelWeight: WeightChoice
  valueWeight: WeightChoice
  controlWeight: WeightChoice
  // icon sizing (resolved px, already including iconScale)
  statusIconPx: number
  contactIconPx: number
  verifyBoxPx: number
  editIconPx: number
  // layout
  verifiedPlacement: VerifiedPlacement
  editPlacement: EditPlacement
  fieldAlign: AlignChoice
  fieldSpacingPx: number
  sectionPaddingPx: number
  // chrome
  cardBorderPx: number
  cardBorderColor?: string
  cardRadiusPx: number
  cardPaddingPx: number
  cardBackground?: string
  showDividers: boolean
  dividerColor?: string
  controlBorderPx: number
  controlRadiusPx: number
  isDefault: boolean
}

// Baseline px per role, mirroring the Tailwind utilities the card uses:
// name text-[22px], label text-base (16), value text-lg (18),
// control text-base (16), supporting/status-key text-sm (14).
const BASE = { name: 22, label: 16, value: 18, control: 16, supporting: 14 }
// Baseline icon px, mirroring size-5 (20) headings, size-4 (16) checkbox,
// size-3.5 (14) edit pencil.
const ICON_BASE = { status: 20, contact: 20, verify: 16, edit: 14 }

function resolveAppearance(a?: ContactCardAppearance): ResolvedAppearance {
  // Merge order: neutral Tailwind baseline, then the APPROVED permanent design,
  // then any explicit override (the Playground). Omitting `appearance` therefore
  // yields the approved design, which is the production look.
  const m = { ...DEFAULT_APPEARANCE, ...APPROVED_DEFAULTS, ...a }

  // `isDefault` means "resolves to the untouched plain-Tailwind baseline", used
  // only to skip inline styling. The approved design differs from that baseline
  // (hidden status indicator, teal bold name, slate-700 chrome), so this is true
  // only when the Playground is reset all the way back to neutral.
  const isDefault =
    m.showStatusIndicator && m.showContactIcon && m.showFieldLabel &&
    m.showVerifiedCheckbox && m.showEditButton && m.showStatusKey &&
    m.statusIndicatorColor === 'status' && m.contactIconColor === 'status' &&
    m.fieldLabelColor === 'black' &&
    m.fontFamily === undefined &&
    m.fontScale === 1 && m.nameScale === 1 && m.labelScale === 1 &&
    m.valueScale === 1 && m.controlScale === 1 && m.verifyScale === 1 &&
    m.mentoringScale === 1 && m.statusKeyScale === 1 &&
    m.nameWeight === 'default' && m.labelWeight === 'default' &&
    m.valueWeight === 'default' && m.controlWeight === 'default' &&
    m.nameColor === undefined && m.valueColor === undefined &&
    m.verifyColor === undefined && m.mentoringColor === undefined &&
    m.statusKeyColor === undefined &&
    m.iconScale === 1 &&
    m.statusIconPxOverride === undefined && m.contactIconPxOverride === undefined &&
    m.verifyBoxPxOverride === undefined && m.editIconPxOverride === undefined &&
    m.verifiedPlacement === 'heading' && m.editPlacement === 'value' &&
    m.fieldAlign === 'left' && m.fieldSpacingPx === 6 && m.sectionPaddingPx === 12 &&
    m.cardBorderPx === 1 && m.cardBorderColor === undefined &&
    m.cardRadiusPx === 16 && m.cardPaddingPx === 16 &&
    m.cardBackground === undefined && m.showDividers &&
    m.dividerColor === undefined && m.controlBorderPx === 1 &&
    m.controlRadiusPx === 8

  const labelPx = BASE.label * m.fontScale * m.labelScale
  const controlPx = BASE.control * m.fontScale * m.controlScale
  const verifyPx = BASE.control * m.fontScale * m.verifyScale

  return {
    showStatusIndicator: m.showStatusIndicator,
    showContactIcon: m.showContactIcon,
    showFieldLabel: m.showFieldLabel,
    showVerifiedCheckbox: m.showVerifiedCheckbox,
    showEditButton: m.showEditButton,
    showStatusKey: m.showStatusKey,
    statusIndicatorColor: m.statusIndicatorColor,
    contactIconColor: m.contactIconColor,
    fieldLabelColor: m.fieldLabelColor,
    nameColor: m.nameColor,
    valueColor: m.valueColor,
    verifyColor: m.verifyColor,
    mentoringColor: m.mentoringColor,
    statusKeyColor: m.statusKeyColor,
    fontFamily: m.fontFamily,
    nameFontPx: BASE.name * m.fontScale * m.nameScale,
    labelFontPx: labelPx,
    valueFontPx: BASE.value * m.fontScale * m.valueScale,
    controlFontPx: controlPx,
    verifyFontPx: verifyPx,
    // Mentoring body matches the shared MentorGuidance body (text-base, 16px).
    mentoringFontPx: 16 * m.fontScale * m.mentoringScale,
    // True only when a mentoring-specific presentation override is active, so the
    // approved default leaves the shared Mentoring tip visually untouched.
    mentoringOverridden:
      m.mentoringColor !== undefined || m.mentoringScale !== 1 || m.fontScale !== 1,
    statusKeyFontPx: BASE.supporting * m.fontScale * m.statusKeyScale,
    supportingFontPx: BASE.supporting * m.fontScale * m.labelScale,
    nameWeight: m.nameWeight,
    labelWeight: m.labelWeight,
    valueWeight: m.valueWeight,
    controlWeight: m.controlWeight,
    // Icons scale proportionally with their associated text unless an explicit
    // px override is given. The master iconScale multiplies either way.
    statusIconPx: (m.statusIconPxOverride ?? ICON_BASE.status * (labelPx / BASE.label)) * m.iconScale,
    contactIconPx: (m.contactIconPxOverride ?? ICON_BASE.contact * (labelPx / BASE.label)) * m.iconScale,
    verifyBoxPx: (m.verifyBoxPxOverride ?? ICON_BASE.verify * (verifyPx / BASE.control)) * m.iconScale,
    editIconPx: (m.editIconPxOverride ?? ICON_BASE.edit * (controlPx / BASE.control)) * m.iconScale,
    verifiedPlacement: m.verifiedPlacement,
    editPlacement: m.editPlacement,
    fieldAlign: m.fieldAlign,
    fieldSpacingPx: m.fieldSpacingPx,
    sectionPaddingPx: m.sectionPaddingPx,
    cardBorderPx: m.cardBorderPx,
    cardBorderColor: m.cardBorderColor,
    cardRadiusPx: m.cardRadiusPx,
    cardPaddingPx: m.cardPaddingPx,
    cardBackground: m.cardBackground,
    showDividers: m.showDividers,
    dividerColor: m.dividerColor,
    controlBorderPx: m.controlBorderPx,
    controlRadiusPx: m.controlRadiusPx,
    isDefault,
  }
}

const WEIGHT_CLASS: Record<Exclude<WeightChoice, 'default'>, string> = {
  normal: 'font-normal',
  medium: 'font-medium',
  semibold: 'font-semibold',
  bold: 'font-bold',
}

/** Weight class override for a role, or '' to leave the existing class in place. */
function weightClass(w: WeightChoice): string {
  return w === 'default' ? '' : WEIGHT_CLASS[w]
}

/** Numeric CSS font-weight for a role, or undefined to leave the base class.
 * Emitting the weight inline (rather than only a utility class) guarantees it
 * overrides a role's base `font-semibold`/`font-medium` class regardless of
 * stylesheet order. */
const WEIGHT_VALUE: Record<Exclude<WeightChoice, 'default'>, number> = {
  normal: 400, medium: 500, semibold: 600, bold: 700,
}
function weightValue(w: WeightChoice): number | undefined {
  return w === 'default' ? undefined : WEIGHT_VALUE[w]
}

/** A text style for a role: inline font-size (plus optional color/weight) when
 * appearance is non-default, else undefined so the Tailwind size class alone
 * governs. */
function textStyle(
  ap: ResolvedAppearance, px: number, color?: string, weight?: WeightChoice,
): React.CSSProperties | undefined {
  if (ap.isDefault) return undefined
  const s: React.CSSProperties = { fontSize: `${px.toFixed(3)}px` }
  if (color) s.color = color
  const w = weight && weightValue(weight)
  if (w) s.fontWeight = w
  return s
}

/** Backwards-compatible helper kept for the value/address renderers. */
function fontStyle(ap: ResolvedAppearance, px: number): React.CSSProperties | undefined {
  return ap.isDefault ? undefined : { fontSize: `${px.toFixed(3)}px` }
}

/** Icon style: an explicit px size when non-default, else undefined so the
 * size-* class governs. */
function iconStyle(ap: ResolvedAppearance, px: number): React.CSSProperties | undefined {
  return ap.isDefault ? undefined : { width: `${px.toFixed(2)}px`, height: `${px.toFixed(2)}px` }
}

/** Resolve an icon/label color: the status token color (`statusColor`) when the
 * choice is `status`, or an explicit black override when the choice is `black`. */
function colorClass(choice: ColorChoice, statusColor: string): string {
  return choice === 'black' ? 'text-black' : statusColor
}

/** The request the card would send. Exposed so a host (or Storybook) can supply
 * its own persistence and still exercise the exact same payloads. */
export type ContactPersistPayload =
  | { field: 'email'; email: string | null }
  | { field: 'phone'; phone: string | null }
  | { field: 'address'; street: string | null; city: string | null; state: string | null; zip: string | null }
  | { field: ContactFieldKey; verified: boolean }
  | { field: 'email_availability'; availability: Exclude<EmailAvailability, 'available'> }

type Tone = 'confirmed' | 'known' | 'missing'

// ── Helpers ──────────────────────────────────────────────────────────────────

function fullName(c: Pick<CustomerContact, 'first_name' | 'last_name'>): string {
  return `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Unknown customer'
}

function streetOf(c: CustomerContact): string {
  return (c.street ?? c.address_line1 ?? '').trim()
}

function addressLines(c: CustomerContact): string[] {
  const street = streetOf(c)
  const cityStateZip = [[c.city, c.state].filter(Boolean).join(', '), c.zip].filter(Boolean).join(' ').trim()
  return [street, cityStateZip].filter(Boolean)
}

function addressUsable(c: CustomerContact): boolean {
  return !!(streetOf(c) && c.city && c.state && c.zip)
}

/** The field's green/amber/red tone. Verified → green; present but unverified →
 * amber; missing/unusable → red. Verification can only hold for a usable value,
 * so a cleared value always reads amber or red, never stale green. */
function toneFor(present: boolean, verifiedAt: string | null): Tone {
  if (!present) return 'missing'
  return verifiedAt ? 'confirmed' : 'known'
}

/** The status presentation per tone. Distinct SHAPES so the meaning survives
 * without color: a check for verified, a question-shield for on-file, a warning
 * triangle for missing. `color` is applied uniformly to the status icon, the
 * contact icon, and the field label so a field reads as one colored unit; the
 * accessible label carries the meaning in words. Shared between the field
 * headings and the status key so both stay identical. */
const STATUS_META: Record<Tone, { label: string; icon: typeof ShieldQuestion; color: string }> = {
  confirmed: { label: 'Verified', icon: CheckCircle2, color: 'text-status-confirmed' },
  known: { label: 'On file, not verified', icon: ShieldQuestion, color: 'text-status-known' },
  missing: { label: 'Missing', icon: AlertTriangle, color: 'text-status-missing' },
}

// ── Component ──────────────────────────────────────────────────────────────

export function CustomerContactCard({
  customer,
  onChange,
  onPersist,
  className,
  appearance,
}: {
  customer: CustomerContact
  /** Called with the authoritative updated record after any successful write,
   * so a host can keep its own copy of the customer in sync. */
  onChange?: (updated: CustomerContact) => void
  /** Inject persistence. Omit to PATCH /api/customers/[id]/contact. Must resolve
   * with the full updated record. */
  onPersist?: (customerId: string, payload: ContactPersistPayload) => Promise<CustomerContact>
  className?: string
  /** Presentation-only overrides. Omit for the production appearance. Used by the
   * Design Playground to tune the REAL card. Never affects behavior, data, or
   * `onPersist` payloads. */
  appearance?: ContactCardAppearance
}) {
  const ap = useMemo(() => resolveAppearance(appearance), [appearance])
  // The card holds the current record locally so the display updates the instant
  // a write returns, without the host round-tripping a reload.
  const [record, setRecord] = useState<CustomerContact>(customer)
  const [editing, setEditing] = useState<ContactFieldKey | null>(null)
  const [busyField, setBusyField] = useState<ContactFieldKey | null>(null)
  const [error, setError] = useState<string | null>(null)

  const persist = useCallback(
    async (payload: ContactPersistPayload): Promise<CustomerContact> => {
      if (onPersist) return onPersist(record.id, payload)
      const res = await fetch(`/api/customers/${record.id}/contact`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not save')
      return json.data as CustomerContact
    },
    [onPersist, record.id],
  )

  const applyUpdate = useCallback((updated: CustomerContact) => {
    setRecord(updated)
    onChange?.(updated)
  }, [onChange])

  // Verification: toggle a field's customer-verified flag. Independent of
  // editing; disabled when the value is not usable.
  const toggleVerify = useCallback(async (field: ContactFieldKey, verified: boolean) => {
    setBusyField(field); setError(null)
    try {
      const updated = await persist({ field, verified })
      applyUpdate(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update verification')
    } finally {
      setBusyField(null)
    }
  }, [persist, applyUpdate])

  const saveField = useCallback(async (payload: Exclude<ContactPersistPayload, { field: 'email_availability' }>) => {
    const field = payload.field
    setBusyField(field); setError(null)
    try {
      const updated = await persist(payload)
      applyUpdate(updated)
      setEditing(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setBusyField(null)
    }
  }, [persist, applyUpdate])

  // Record a "no usable email" reason (No Email Address / Email Refused /
  // Undeliverable) as a durable customer fact. The editor stays open so the
  // operator sees the status update in place; the authoritative returned row
  // reflects any address the server cleared (Undeliverable removes the address
  // from active use and preserves it in Customer History).
  const setEmailAvailability = useCallback(
    async (status: Exclude<EmailAvailability, 'available'>) => {
      setBusyField('email'); setError(null)
      try {
        const updated = await persist({ field: 'email_availability', availability: status })
        applyUpdate(updated)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not update email availability')
      } finally {
        setBusyField(null)
      }
    },
    [persist, applyUpdate],
  )

  const emailPresent = !!record.email?.trim()
  const phonePresent = !!record.phone?.trim()
  const addrPresent = addressUsable(record)

  return (
    <section
      className={cn(
        'rounded-2xl border border-surface-border bg-surface-card p-4 font-workflow',
        className,
      )}
      style={ap.isDefault ? undefined : {
        fontFamily: ap.fontFamily,
        borderWidth: `${ap.cardBorderPx}px`,
        borderStyle: 'solid',
        borderColor: ap.cardBorderColor ?? 'var(--surface-border)',
        borderRadius: `${ap.cardRadiusPx}px`,
        padding: `${ap.cardPaddingPx}px`,
        background: ap.cardBackground ?? 'var(--surface-card)',
      }}
    >
      {/* The customer's name IS the card heading, with the inline graduation-cap
          mentoring control beside it. The approved default renders the name at
          150% (33px), bold, in the teal brand token; the Playground can override
          any of those. */}
      <ContactMentoring appearance={ap} name={fullName(record)} />

      {error && (
        <p className="mt-3 rounded-lg border border-status-missing-border bg-status-missing-soft px-3 py-2 text-base text-status-missing-strong">
          {error}
        </p>
      )}

      {/* Three compact sections in one card. The dividers use the stronger
          surface border token so they read clearly against the white card. */}
      <div
        className={cn('mt-3', ap.isDefault && 'divide-y divide-surface-border-strong')}
        style={ap.isDefault ? undefined : {
          borderColor: ap.dividerColor ?? 'var(--surface-border-strong)',
        }}
      >
        <EmailRow
          present={emailPresent}
          verifiedAt={record.email_verified_at}
          value={record.email}
          availability={record.email_availability}
          onSetAvailability={(status) => setEmailAvailability(status)}
          editing={editing === 'email'}
          busy={busyField === 'email'}
          appearance={ap}
          first
          onEdit={() => { setError(null); setEditing('email') }}
          onCancel={() => setEditing(null)}
          onSave={(email) => saveField({ field: 'email', email })}
          onVerify={(v) => toggleVerify('email', v)}
        />

        <PhoneRow
          present={phonePresent}
          verifiedAt={record.phone_verified_at}
          value={record.phone}
          editing={editing === 'phone'}
          busy={busyField === 'phone'}
          appearance={ap}
          onEdit={() => { setError(null); setEditing('phone') }}
          onCancel={() => setEditing(null)}
          onSave={(phone) => saveField({ field: 'phone', phone })}
          onVerify={(v) => toggleVerify('phone', v)}
        />

        <AddressRow
          present={addrPresent}
          verifiedAt={record.address_verified_at}
          record={record}
          editing={editing === 'address'}
          busy={busyField === 'address'}
          appearance={ap}
          last
          onEdit={() => { setError(null); setEditing('address') }}
          onCancel={() => setEditing(null)}
          onSave={(a) => saveField({ field: 'address', ...a })}
          onVerify={(v) => toggleVerify('address', v)}
        />
      </div>

      {ap.showStatusKey && <ContactStatusKey appearance={ap} />}
    </section>
  )
}

/**
 * The customer-name heading with the inline graduation-cap mentoring control —
 * the same large purple cap used in My Work, replacing the former boxed
 * MentorGuidance disclosure. The cap sits beside the name; clicking it expands
 * the coaching directly beneath the heading, and the open/closed default follows
 * the global Mentoring preference (global ON -> expanded, OFF -> collapsed), with
 * the employee able to toggle it independently. Settled behavior, never hidden
 * or forced.
 *
 * The only thing appearance layers on is presentation (font-size / color) of the
 * coaching body, which the Playground exposes for experimentation; when the
 * appearance is the untouched neutral baseline the body renders verbatim.
 */
function ContactMentoring({ appearance, name }: { appearance: ResolvedAppearance; name: string }) {
  const body =
    'Changes here update customer information throughout Right Path. Check Verified only when the ' +
    'customer has confirmed the information is correct, including when they confirm it in an email ' +
    'response.'

  const { open, setOpen } = useMentorDisclosure()

  // Presentation-only overrides for the coaching body (size / color); the cap
  // icon itself keeps its standard purple identity. Only applied when a
  // mentoring-specific override is active, so the neutral baseline is untouched.
  const bodyStyle: React.CSSProperties | undefined = appearance.mentoringOverridden
    ? {
        fontSize: `${appearance.mentoringFontPx.toFixed(3)}px`,
        ...(appearance.mentoringColor ? { color: appearance.mentoringColor } : {}),
      }
    : undefined

  return (
    <>
      <div className="flex items-center gap-2">
        <h3
          className={cn('text-[22px] font-semibold leading-tight text-ink', weightClass(appearance.nameWeight))}
          style={textStyle(appearance, appearance.nameFontPx, appearance.nameColor, appearance.nameWeight)}
        >
          {name}
        </h3>
        {!open && <MentorCapButton onOpen={() => setOpen(true)} label="Show mentoring about these fields" />}
      </div>
      {open && (
        <MentorCapPanel className="mt-2" onClose={() => setOpen(false)}>
          <span style={bodyStyle}>{body}</span>
        </MentorCapPanel>
      )}
    </>
  )
}

/** The compact status key at the foot of the card: the same Lucide icons and
 * colors as the field headings, so green / amber / red read consistently. */
function ContactStatusKey({ appearance }: { appearance: ResolvedAppearance }) {
  const order: Tone[] = ['confirmed', 'known', 'missing']
  return (
    <div
      className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-surface-border-strong pt-2.5 text-sm text-ink-supporting"
      style={textStyle(appearance, appearance.statusKeyFontPx, appearance.statusKeyColor)}
    >
      {order.map((tone) => {
        const meta = STATUS_META[tone]
        const Icon = meta.icon
        // The key repeats the status indicator, so it follows the status-indicator
        // color choice.
        return (
          <span key={tone} className="inline-flex items-center gap-1.5">
            <Icon
              className={cn('size-4 shrink-0', colorClass(appearance.statusIndicatorColor, meta.color))}
              style={iconStyle(appearance, appearance.statusIconPx * 0.8)}
              aria-hidden
            />
            {meta.label}
          </span>
        )
      })}
    </div>
  )
}

// ── Shared section chrome ─────────────────────────────────────────────────────

function VerifyCheckbox({
  checked, disabled, busy, onChange, appearance,
}: {
  checked: boolean
  disabled: boolean
  busy: boolean
  onChange: (v: boolean) => void
  appearance: ResolvedAppearance
}) {
  return (
    <label
      className={cn(
        'flex shrink-0 items-center gap-2 text-base font-medium',
        disabled ? 'cursor-not-allowed text-ink-muted' : 'cursor-pointer text-ink-secondary',
      )}
      style={textStyle(appearance, appearance.verifyFontPx, appearance.verifyColor)}
      title={disabled ? 'A missing or unusable value cannot be marked verified.' : undefined}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled || busy}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 rounded border-slate-400 text-teal-600 focus:ring-teal-500 disabled:opacity-40"
        style={iconStyle(appearance, appearance.verifyBoxPx)}
      />
      <span>Verified</span>
      {busy && <Loader2 className="size-3.5 animate-spin text-ink-muted" aria-hidden />}
    </label>
  )
}

function EditButton({
  busy, onEdit, appearance,
}: {
  busy: boolean
  onEdit: () => void
  appearance: ResolvedAppearance
}) {
  return (
    <button
      type="button"
      onClick={onEdit}
      disabled={busy}
      style={{
        ...(textStyle(appearance, appearance.controlFontPx) ?? {}),
        ...(appearance.isDefault ? {} : {
          borderWidth: `${appearance.controlBorderPx}px`,
          borderRadius: `${appearance.controlRadiusPx}px`,
        }),
      }}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-surface-border-strong bg-surface-card px-2.5 py-1 text-base font-medium text-ink-secondary hover:bg-surface-muted disabled:opacity-40',
        weightClass(appearance.controlWeight),
      )}
    >
      <Pencil className="size-3.5" style={iconStyle(appearance, appearance.editIconPx)} aria-hidden /> Edit
    </button>
  )
}

/**
 * One contact section inside the shared card. The heading line pairs the large
 * status icon and the contact icon with the field label. The Verified checkbox
 * and Edit button are placed per the appearance's layout choices: Verified on
 * the heading / beneath the value / on a bottom row; Edit beside the value / on
 * its own row / on a bottom row.
 */
function SectionShell({
  contactIcon: ContactIcon, label, tone, present, verifiedAt, busy, appearance, first, last,
  onEdit, onVerify, children,
}: {
  contactIcon: typeof Mail
  label: string
  tone: Tone
  present: boolean
  verifiedAt: string | null
  busy: boolean
  appearance: ResolvedAppearance
  first?: boolean
  last?: boolean
  onEdit: () => void
  onVerify: (v: boolean) => void
  children: React.ReactNode
}) {
  const status = STATUS_META[tone]
  const StatusIcon = status.icon
  // Black = dark text; Status = the field's actual green/amber/red status color
  // (the same token the icons use), so the two choices visibly differ.
  const labelColor =
    appearance.fieldLabelColor === 'black' ? 'text-black' : status.color
  const ap = appearance

  const verify = ap.showVerifiedCheckbox ? (
    <VerifyCheckbox
      checked={!!verifiedAt}
      disabled={!present}
      busy={busy}
      appearance={ap}
      onChange={onVerify}
    />
  ) : null

  const edit = ap.showEditButton ? (
    <EditButton busy={busy} onEdit={onEdit} appearance={ap} />
  ) : null

  const verifyOnHeading = ap.verifiedPlacement === 'heading'
  const verifyOnValue = ap.verifiedPlacement === 'value'
  const verifyOnBottom = ap.verifiedPlacement === 'bottom'
  const editOnValue = ap.editPlacement === 'value'
  const editOnRow = ap.editPlacement === 'row'
  const editOnBottom = ap.editPlacement === 'bottom'

  // Container style carries field-section padding, inner spacing, divider.
  const containerStyle: React.CSSProperties | undefined = ap.isDefault
    ? undefined
    : {
        paddingTop: first ? 0 : `${ap.sectionPaddingPx}px`,
        paddingBottom: last ? 0 : `${ap.sectionPaddingPx}px`,
        ...(ap.showDividers && !first
          ? { borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: ap.dividerColor ?? 'var(--surface-border-strong)' }
          : {}),
      }

  const gap = ap.isDefault ? undefined : { marginTop: `${ap.fieldSpacingPx}px` }
  const headingLabel = ap.showFieldLabel ? label : null

  // Alignment: left (default) keeps the full-width justify-between rows. Center
  // and right turn the section into a flex column aligned to that edge, with the
  // rows sized to content so they visibly shift. Only diverges when non-default.
  const aligned = !ap.isDefault && ap.fieldAlign !== 'left'
  const rootCls = aligned
    ? cn('flex flex-col py-3 first:pt-0 last:pb-0', ap.fieldAlign === 'center' ? 'items-center text-center' : 'items-end text-right')
    : 'py-3 first:pt-0 last:pb-0'
  // When aligned, rows hug their content; when not, they span full width.
  const rowCls = aligned ? 'flex items-center gap-3' : 'flex items-center justify-between gap-3'
  const valueRowCls = aligned ? 'flex flex-col gap-1.5' : 'flex items-start justify-between gap-3'

  return (
    <div className={rootCls} style={containerStyle}>
      {/* Heading row: status + contact icons + label on the left; Verified at
          the right only when its placement is `heading`. */}
      <div className={rowCls}>
        <p
          className={cn('flex items-center gap-2 text-base font-semibold', labelColor, weightClass(ap.labelWeight))}
          style={textStyle(ap, ap.labelFontPx)}
        >
          {ap.showStatusIndicator && (
            <StatusIcon
              className={cn('size-5 shrink-0', colorClass(ap.statusIndicatorColor, status.color))}
              style={iconStyle(ap, ap.statusIconPx)}
              aria-label={status.label}
              role="img"
            />
          )}
          {ap.showContactIcon && (
            <ContactIcon
              className={cn('size-5 shrink-0', colorClass(ap.contactIconColor, status.color))}
              style={iconStyle(ap, ap.contactIconPx)}
              aria-hidden
            />
          )}
          {headingLabel}
        </p>
        {verifyOnHeading && verify}
      </div>

      {/* Value row: the value; Edit at the right only when its placement is
          `value`; Verified beneath the value when its placement is `value`. */}
      <div className={valueRowCls} style={gap}>
        <div className="min-w-0">
          {children}
          {verifyOnValue && <div className="mt-1.5">{verify}</div>}
        </div>
        {editOnValue && edit}
      </div>

      {/* Edit on its own row. */}
      {editOnRow && edit && <div style={gap}>{edit}</div>}

      {/* Shared bottom row for whichever of Verified / Edit chose `bottom`. */}
      {(verifyOnBottom || editOnBottom) && (
        <div className="flex items-center justify-between gap-3" style={gap}>
          {verifyOnBottom ? verify : <span />}
          {editOnBottom ? edit : <span />}
        </div>
      )}
    </div>
  )
}

/** The value line (~18px): full value, or an explicit "Missing". Never truncated. */
function ValueText({ value, present, appearance }: { value: string | null; present: boolean; appearance: ResolvedAppearance }) {
  const style = textStyle(appearance, appearance.valueFontPx, appearance.valueColor)
  if (!present) {
    return <p className={cn('text-lg font-medium text-status-missing-strong', weightClass(appearance.valueWeight))} style={fontStyle(appearance, appearance.valueFontPx)}>Missing</p>
  }
  return <p className={cn('break-words text-lg text-ink', weightClass(appearance.valueWeight))} style={style}>{value}</p>
}

function EditActions({ busy, onCancel, appearance }: { busy: boolean; onCancel: () => void; appearance: ResolvedAppearance }) {
  const style = fontStyle(appearance, appearance.controlFontPx)
  return (
    <div className="flex items-center gap-2">
      <button
        type="submit"
        disabled={busy}
        style={style}
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-base font-semibold text-brand-foreground hover:bg-brand-hover disabled:opacity-50"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
        Save
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        style={style}
        className="inline-flex items-center gap-1.5 rounded-lg border border-surface-border-strong bg-surface-card px-3 py-1.5 text-base font-medium text-ink-secondary hover:bg-surface-muted disabled:opacity-40"
      >
        <X className="size-3.5" aria-hidden /> Cancel
      </button>
    </div>
  )
}

const inputCls = (invalid: boolean) =>
  cn(
    'w-full rounded-lg border px-3 py-2 text-lg text-ink focus:outline-none focus:ring-2',
    invalid
      ? 'border-status-missing-border focus:border-status-missing-border focus:ring-status-missing-soft'
      : 'border-surface-border-strong focus:border-brand-ring focus:ring-brand-wash',
  )

// ── Email ──────────────────────────────────────────────────────────────────

/** The selectable "no usable email" reasons the operator can record directly in
 * the Email section. 'available' is never selected here — it is set by the
 * system when a usable address is saved — so the choices are exactly the two
 * reasons plus entering an address. */
const EMAIL_REASON_CHOICES: readonly Exclude<EmailAvailability, 'available'>[] = [
  'no_address', 'undeliverable',
]

/**
 * The read-only value line for the Email section. A usable address shows
 * normally; otherwise it shows the recorded reason ("No Usable Email",
 * "Undeliverable") or plain "Missing" when the reason is unknown — so the card
 * explains WHY there is no email, not merely that it is absent.
 */
function EmailValue({
  value, display, appearance,
}: {
  value: string | null
  display: EmailAvailabilityDisplay
  appearance: ResolvedAppearance
}) {
  if (display === 'on_file') {
    return <ValueText value={value} present appearance={appearance} />
  }
  const label = display === 'missing' ? 'Missing' : EMAIL_AVAILABILITY_LABEL[display]
  return (
    <p
      className={cn('text-lg font-medium text-status-missing-strong', weightClass(appearance.valueWeight))}
      style={fontStyle(appearance, appearance.valueFontPx)}
    >
      {label}
    </p>
  )
}

function EmailRow({
  present, verifiedAt, value, availability, editing, busy, appearance, first,
  onEdit, onCancel, onSave, onSetAvailability, onVerify,
}: {
  present: boolean
  verifiedAt: string | null
  value: string | null
  availability: EmailAvailability | null
  editing: boolean
  busy: boolean
  appearance: ResolvedAppearance
  first?: boolean
  onEdit: () => void
  onCancel: () => void
  onSave: (email: string | null) => void
  onSetAvailability: (status: Exclude<EmailAvailability, 'available'>) => void
  onVerify: (v: boolean) => void
}) {
  const tone = toneFor(present, verifiedAt)
  const display = resolveEmailAvailabilityDisplay(availability, value)
  const [draft, setDraft] = useState(value ?? '')
  const [result, setResult] = useState<ContactFieldResult | null>(null)

  // Reset the draft whenever the editor opens, so Cancel-then-Edit starts clean.
  const open = useCallback(() => { setDraft(value ?? ''); setResult(null); onEdit() }, [value, onEdit])

  if (!editing) {
    // A terminal reason reads as the field status when there is no usable
    // address, so the section explains WHY email is absent. Verification stays
    // bound to an actual address (SectionShell disables Verified when !present).
    const helpText = display === 'on_file' ? null : EMAIL_AVAILABILITY_HELP[display]
    return (
      <SectionShell contactIcon={Mail} label="Email" tone={tone} present={present} verifiedAt={verifiedAt}
        busy={busy} appearance={appearance} first={first} onEdit={open} onVerify={onVerify}>
        <EmailValue value={value} display={display} appearance={appearance} />
        {helpText && (
          <p className="mt-0.5 text-sm text-ink-muted" style={fontStyle(appearance, appearance.supportingFontPx)}>
            {helpText}
          </p>
        )}
      </SectionShell>
    )
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const r = normalizeEmailInput(draft)
    if (r.status === 'invalid') { setResult(r); return }
    onSave(r.value) // valid canonical value, or null when empty (a valid clear)
  }

  return (
    <form onSubmit={submit} className="py-3 first:pt-0 last:pb-0">
      <label htmlFor="cc-email" className="flex items-center gap-1.5 text-base font-semibold text-ink-secondary">
        <Mail className="size-4" aria-hidden /> Edit email
      </label>
      <input
        id="cc-email"
        type="email"
        autoFocus
        value={draft}
        onChange={(e) => { setDraft(e.target.value); if (result) setResult(null) }}
        onBlur={() => setResult(normalizeEmailInput(draft))}
        placeholder="name@example.com"
        aria-invalid={result?.status === 'invalid' || undefined}
        className={cn('mt-1.5', inputCls(result?.status === 'invalid'))}
      />
      {result?.status === 'invalid' && result.reason && (
        <p className="mt-1.5 text-base text-status-missing-strong">{result.reason}</p>
      )}
      <div className="mt-2.5"><EditActions busy={busy} onCancel={onCancel} appearance={appearance} /></div>

      {/* Email availability — an informational customer fact recorded directly in
          the card. Entering an address above and saving returns the status to
          "on file" and clears any prior No Usable Email / Undeliverable. Each
          button records the reason (and, for Undeliverable, moves the current
          address into Customer History). It changes no research or workflow. */}
      <fieldset className="mt-3 border-t border-surface-border-strong pt-3">
        <legend className="text-sm font-semibold text-ink-secondary">No usable email? Record why</legend>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {EMAIL_REASON_CHOICES.map((choice) => {
            const active = availability === choice
            return (
              <button
                key={choice}
                type="button"
                disabled={busy || active}
                aria-pressed={active}
                onClick={() => onSetAvailability(choice)}
                className={cn(
                  'inline-flex items-center rounded-lg border px-2.5 py-1 text-sm font-medium disabled:opacity-60',
                  active
                    ? 'border-status-missing-border bg-status-missing-soft text-status-missing-strong'
                    : 'border-surface-border-strong bg-surface-card text-ink-secondary hover:bg-surface-muted',
                )}
              >
                {EMAIL_AVAILABILITY_LABEL[choice]}
              </button>
            )
          })}
        </div>
        <p className="mt-1.5 text-sm text-ink-muted">
          No Usable Email records that the customer has no email or will not provide one. Undeliverable
          removes the current address from use while keeping it in Customer History. Entering an email
          returns this to Email on file.
        </p>
      </fieldset>
    </form>
  )
}

// ── Phone ──────────────────────────────────────────────────────────────────

function PhoneRow({
  present, verifiedAt, value, editing, busy, appearance, onEdit, onCancel, onSave, onVerify,
}: {
  present: boolean
  verifiedAt: string | null
  value: string | null
  editing: boolean
  busy: boolean
  appearance: ResolvedAppearance
  onEdit: () => void
  onCancel: () => void
  onSave: (phone: string | null) => void
  onVerify: (v: boolean) => void
}) {
  const tone = toneFor(present, verifiedAt)
  const [draft, setDraft] = useState(formatPhoneAsTyped(value ?? ''))
  const [result, setResult] = useState<ContactFieldResult | null>(null)

  const open = useCallback(() => { setDraft(formatPhoneAsTyped(value ?? '')); setResult(null); onEdit() }, [value, onEdit])

  if (!editing) {
    return (
      <SectionShell contactIcon={Phone} label="Phone" tone={tone} present={present} verifiedAt={verifiedAt}
        busy={busy} appearance={appearance} onEdit={open} onVerify={onVerify}>
        <ValueText value={value} present={present} appearance={appearance} />
      </SectionShell>
    )
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const r = normalizePhoneInput(draft)
    if (r.status === 'invalid') { setResult(r); return }
    onSave(r.value)
  }

  return (
    <form onSubmit={submit} className="py-3 first:pt-0 last:pb-0">
      <label htmlFor="cc-phone" className="flex items-center gap-1.5 text-base font-semibold text-ink-secondary">
        <Phone className="size-4" aria-hidden /> Edit phone
      </label>
      <input
        id="cc-phone"
        type="tel"
        autoFocus
        value={draft}
        onChange={(e) => { setDraft(formatPhoneAsTyped(e.target.value)); if (result) setResult(null) }}
        onBlur={() => setResult(normalizePhoneInput(draft))}
        placeholder="(215) 555-0100"
        aria-invalid={result?.status === 'invalid' || undefined}
        className={cn('mt-1.5', inputCls(result?.status === 'invalid'))}
      />
      {result?.status === 'invalid' && result.reason && (
        <p className="mt-1.5 text-base text-status-missing-strong">{result.reason}</p>
      )}
      <div className="mt-2.5"><EditActions busy={busy} onCancel={onCancel} appearance={appearance} /></div>
    </form>
  )
}

// ── Mailing address (edited as one group) ─────────────────────────────────────

function AddressRow({
  present, verifiedAt, record, editing, busy, appearance, last, onEdit, onCancel, onSave, onVerify,
}: {
  present: boolean
  verifiedAt: string | null
  record: CustomerContact
  editing: boolean
  busy: boolean
  appearance: ResolvedAppearance
  last?: boolean
  onEdit: () => void
  onCancel: () => void
  onSave: (a: { street: string | null; city: string | null; state: string | null; zip: string | null }) => void
  onVerify: (v: boolean) => void
}) {
  const tone = toneFor(present, verifiedAt)
  const [street, setStreet] = useState(streetOf(record))
  const [city, setCity] = useState(record.city ?? '')
  const [stateVal, setStateVal] = useState(record.state ?? '')
  const [zip, setZip] = useState(record.zip ?? '')

  const open = useCallback(() => {
    setStreet(streetOf(record)); setCity(record.city ?? '')
    setStateVal(record.state ?? ''); setZip(record.zip ?? '')
    onEdit()
  }, [record, onEdit])

  const lines = useMemo(() => addressLines(record), [record])

  if (!editing) {
    return (
      <SectionShell contactIcon={MapPin} label="Mailing Address" tone={tone} present={present} verifiedAt={verifiedAt}
        busy={busy} appearance={appearance} last={last} onEdit={open} onVerify={onVerify}>
        {present ? (
          // The complete mailing address on two lines: street, then city/state/ZIP.
          <address className={cn('not-italic text-lg leading-snug text-ink', weightClass(appearance.valueWeight))} style={textStyle(appearance, appearance.valueFontPx, appearance.valueColor)}>
            {lines.map((line, i) => <span key={i} className="block break-words">{line}</span>)}
          </address>
        ) : (
          <p className={cn('text-lg font-medium text-status-missing-strong', weightClass(appearance.valueWeight))} style={fontStyle(appearance, appearance.valueFontPx)}>Missing</p>
        )}
      </SectionShell>
    )
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const clean = (v: string) => { const t = v.replace(/\s+/g, ' ').trim(); return t.length ? t : null }
    onSave({
      street: clean(street),
      city: clean(city),
      state: clean(stateVal) ? clean(stateVal)!.toUpperCase() : null,
      zip: clean(zip),
    })
  }

  return (
    <form onSubmit={submit} className="py-3 first:pt-0 last:pb-0">
      <p className="flex items-center gap-1.5 text-base font-semibold text-ink-secondary">
        <MapPin className="size-4" aria-hidden /> Edit mailing address
      </p>
      <div className="mt-1.5 space-y-2">
        <div>
          <label htmlFor="cc-street" className="text-sm font-medium uppercase tracking-wide text-ink-supporting">Street</label>
          <input id="cc-street" autoFocus value={street} onChange={(e) => setStreet(e.target.value)}
            placeholder="123 Main St" className={cn('mt-1', inputCls(false))} />
        </div>
        <div>
          <label htmlFor="cc-city" className="text-sm font-medium uppercase tracking-wide text-ink-supporting">City</label>
          <input id="cc-city" value={city} onChange={(e) => setCity(e.target.value)}
            placeholder="Philadelphia" className={cn('mt-1', inputCls(false))} />
        </div>
        <div className="flex gap-2">
          <div className="w-24">
            <label htmlFor="cc-state" className="text-sm font-medium uppercase tracking-wide text-ink-supporting">State</label>
            <input id="cc-state" value={stateVal} onChange={(e) => setStateVal(e.target.value)}
              maxLength={2} placeholder="PA" className={cn('mt-1 uppercase', inputCls(false))} />
          </div>
          <div className="flex-1">
            <label htmlFor="cc-zip" className="text-sm font-medium uppercase tracking-wide text-ink-supporting">ZIP</label>
            <input id="cc-zip" value={zip} onChange={(e) => setZip(e.target.value)}
              placeholder="19103" className={cn('mt-1', inputCls(false))} />
          </div>
        </div>
      </div>
      <p className="mt-1.5 text-sm text-ink-supporting">
        A mailing address needs street, city, state, and ZIP to be usable and verifiable.
      </p>
      <div className="mt-2.5"><EditActions busy={busy} onCancel={onCancel} appearance={appearance} /></div>
    </form>
  )
}
