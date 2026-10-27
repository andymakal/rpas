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

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Mail, Phone, MapPin, Pencil, Check, X, Loader2,
  ShieldQuestion, CheckCircle2, AlertTriangle, Plus, Trash2,
  Ban, MessageSquareOff,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useMentorDisclosure, MentorCapButton, MentorCapPanel } from '@/lib/mentoring/MentorUi'
import {
  normalizeEmailInput, normalizePhoneInput, normalizeNameInput, formatPhoneAsTyped, formatPhoneDisplay,
  type ContactFieldResult,
} from '@/lib/contact-input'
import {
  normalizeEmail, normalizeStreet, normalizeCity, normalizeState,
} from '@/lib/fmt'
import {
  type EmailAvailability,
  type EmailAvailabilityDisplay,
  type SelectableEmailAvailability,
  EMAIL_AVAILABILITY_LABEL,
  EMAIL_AVAILABILITY_HELP,
  SELECTABLE_EMAIL_AVAILABILITY_VALUES,
  resolveEmailAvailabilityDisplay,
} from '@/lib/email-availability'
import {
  type SmsAvailabilityDisplay,
  SMS_AVAILABILITY_LABEL,
  SMS_AVAILABILITY_HELP,
  resolveSmsAvailabilityDisplay,
} from '@/lib/sms-availability'

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
  /** The customer's single current alert (customers.contact_alert). NULL/empty
   * means no alert. Shown as a prominent banner at the top of the card and
   * editable via the Add / Edit / Clear control when alert editing is enabled.
   * Optional so existing callers that don't select it still satisfy the type. */
  contact_alert?: string | null
  /** Do Not Text — the durable customer-level texting opt-out
   * (`customers.sms_opt_out`). True = the customer asked not to be texted (STOP).
   * Follows the customer even if the phone number changes; cleared only
   * deliberately. Disables texting only, never calling. Optional so existing
   * callers that don't select it still satisfy the type (defaults to not opted
   * out). */
  sms_opt_out?: boolean
  /** Text Undeliverable (presentation fact) — whether the NUMBER currently on
   * file has a recorded text-delivery failure (the value-scoped
   * `[channel-unusable:<digits>]` text fact, already matched against the current
   * phone by the attempt-history read). Not a stored customer column: it is the
   * resolved per-number fact the host supplies so the card can show Text
   * Undeliverable. Replacing the number clears it on its own. Optional; defaults
   * to no failure on file. */
  text_undeliverable?: boolean
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
  | { field: 'name'; first_name: string | null; last_name: string | null }
  | { field: 'email'; email: string | null }
  | { field: 'phone'; phone: string | null }
  | { field: 'address'; street: string | null; city: string | null; state: string | null; zip: string | null }
  | { field: ContactFieldKey; verified: boolean }
  | { field: 'email_availability'; availability: SelectableEmailAvailability }
  | { field: 'alert'; alert: string | null }
  // Do Not Text — set/clear the durable customer opt-out (customers.sms_opt_out).
  // Disables texting only; follows the customer regardless of the number.
  | { field: 'sms'; do_not_text: boolean }
  // Text Undeliverable — record a text-DELIVERY FAILURE for the number on file.
  // Scoped to that number (restores on replacement). An ordinary unsent text is
  // not a failure, so this is a deliberate "the text bounced" action.
  | { field: 'sms_undeliverable' }

type Tone = 'confirmed' | 'known' | 'missing'

// ── Helpers ──────────────────────────────────────────────────────────────────

function fullName(c: Pick<CustomerContact, 'first_name' | 'last_name'>): string {
  return `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Unknown customer'
}

function streetOf(c: CustomerContact): string {
  return (c.street ?? c.address_line1 ?? '').trim()
}

/** Street shown with normal capitalization, directional abbreviations
 * preserved (NE/SW/PO/...), via the shared `normalizeStreet` helper. Display
 * only: the stored record is untouched. */
function streetDisplay(c: CustomerContact): string {
  return normalizeStreet(streetOf(c)) ?? ''
}

function addressLines(c: CustomerContact): string[] {
  const street = streetDisplay(c)
  const city = normalizeCity(c.city) ?? ''
  const state = normalizeState(c.state) ?? ''
  const cityStateZip = [[city, state].filter(Boolean).join(', '), c.zip].filter(Boolean).join(' ').trim()
  return [street, cityStateZip].filter(Boolean)
}

function addressUsable(c: CustomerContact): boolean {
  return !!(streetOf(c) && c.city && c.state && c.zip)
}

/** Email shown trimmed and lowercased via the shared `normalizeEmail` helper.
 * Display only: the stored record is untouched. */
function emailDisplay(c: CustomerContact): string | null {
  return normalizeEmail(c.email)
}

/** Phone shown in the `(XXX) XXX-XXXX` standard via the shared formatter.
 * Display only: the stored record is untouched. Falls back to the trimmed
 * stored value if it cannot be reduced to a formatted number. */
function phoneDisplay(c: CustomerContact): string | null {
  const t = c.phone?.trim()
  if (!t) return null
  return formatPhoneDisplay(t) || t
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
  header,
  showName = true,
  showMentoring = true,
  collapsible = false,
  defaultExpanded = true,
  onExpandedChange,
  alert,
  onAlertChange,
  alertEditable = false,
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
  /** Optional content rendered across the TOP of the card, with the single
   * Overview/Edit toggle at its right end (when `collapsible`). A host uses this
   * to place the customer identity (name, age, status, classification) inside
   * the card header. Omit it and the card has no header slot, exactly as today. */
  header?: ReactNode
  /** Render the customer name as the card heading. Default true (the existing
   * behavior). Set false so a host can own a single name heading elsewhere. */
  showName?: boolean
  /** Render the inline mentoring control beside the name. Default true (the
   * existing behavior). Set false to suppress mentoring for this instance only;
   * every other call site is unaffected. */
  showMentoring?: boolean
  /** Opt into the two-mode Overview/Edit presentation. Default false, so every
   * existing call site (including Contact Research) keeps rendering the single
   * always-expanded card with per-field controls exactly as before. When true,
   * the card shows a compact READ-ONLY overview with a single Edit button that
   * expands to the existing per-field editing + verification controls. */
  collapsible?: boolean
  /** When `collapsible`, whether the card starts expanded (Edit) or collapsed
   * (Overview). Default true. Ignored when not collapsible. */
  defaultExpanded?: boolean
  /** Notified when the collapsible card switches between Overview and Edit. */
  onExpandedChange?: (expanded: boolean) => void
  /** The customer's single current alert text, or null/empty when there is no
   * alert. This is an optional, reusable card capability: a prominent banner
   * near the top plus an Add / Edit / Clear control beside the status key. It is
   * opt-in — omit `onAlertChange` and the card shows no alert affordance at all,
   * so every existing call site is unchanged. One alert per customer; no
   * categories, priorities, expiration, or workflow rules. */
  alert?: string | null
  /** Optional notification after the alert is saved/cleared, with the new text
   * (or null). Persistence is handled by the card through the shared route; this
   * just lets a host sync its own copy if needed. */
  onAlertChange?: (next: string | null) => void
  /** Enable the alert feature (banner + Add / Edit / Clear control + editor).
   * Default false, so every existing call site shows no alert affordance and is
   * unchanged. The alert value is the durable `customer.contact_alert`. */
  alertEditable?: boolean
}) {
  const ap = useMemo(() => resolveAppearance(appearance), [appearance])
  // The card holds the current record locally so the display updates the instant
  // a write returns, without the host round-tripping a reload.
  const [record, setRecord] = useState<CustomerContact>(customer)
  const [editing, setEditing] = useState<ContactFieldKey | null>(null)
  const [busyField, setBusyField] = useState<ContactFieldKey | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The name heading has its own in-place editor (first + last), independent of
  // the per-field `editing`/`busyField` which are typed to the contact fields.
  const [nameEditing, setNameEditing] = useState(false)
  const [nameBusy, setNameBusy] = useState(false)
  // Overview (collapsed) vs Edit (expanded). Only meaningful when `collapsible`;
  // a non-collapsible card is always "expanded", preserving today's behavior.
  const [expanded, setExpanded] = useState(defaultExpanded)
  // Re-seed the Overview/Edit state when the host's default changes, mirroring
  // MentorGuidance: a host that drives `defaultExpanded` from live state (e.g.
  // the calling workbench opening the card in edit mode the instant the customer
  // is reached) sees the card follow. Callers passing a constant `defaultExpanded`
  // (every existing one) are unaffected, since the value never changes. A worker
  // can still toggle Overview/Edit in between; only a new default re-seeds it.
  useEffect(() => { setExpanded(defaultExpanded) }, [defaultExpanded])
  const isExpanded = !collapsible || expanded
  // Alert editor. Enabled with `alertEditable`. The alert VALUE is the durable
  // customers.contact_alert carried on the record (with the controlled `alert`
  // prop as an override for hosts that manage it externally). Save/Clear persist
  // through the SAME shared route the card uses for contact (so Add/Edit/Clear
  // survive refresh), update the held record, and notify `onChange`/`onAlertChange`.
  const alertText = (alert !== undefined ? alert : record.contact_alert)?.trim()
    ? (alert !== undefined ? alert : record.contact_alert)
    : null
  const [alertEditing, setAlertEditing] = useState(false)
  const [alertDraft, setAlertDraft] = useState('')
  const [alertBusy, setAlertBusy] = useState(false)
  const openAlertEditor = useCallback(() => {
    setAlertDraft(alertText ?? '')
    setAlertEditing(true)
  }, [alertText])
  const setExpandedState = useCallback((next: boolean) => {
    setEditing(null); setError(null)
    setExpanded(next)
    onExpandedChange?.(next)
  }, [onExpandedChange])

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

  const saveField = useCallback(async (payload: Exclude<ContactPersistPayload, { field: 'name' } | { field: 'email_availability' } | { field: 'alert' } | { field: 'sms' } | { field: 'sms_undeliverable' }>) => {
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

  // Persist a corrected first/last name through the shared route (or injected
  // onPersist), update the held record so the heading changes instantly, and
  // notify the host. The server preserves capitalization and records the
  // correction in Customer History.
  const saveName = useCallback(async (first_name: string | null, last_name: string | null) => {
    setNameBusy(true); setError(null)
    try {
      const updated = await persist({ field: 'name', first_name, last_name })
      applyUpdate(updated)
      setNameEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save name')
    } finally {
      setNameBusy(false)
    }
  }, [persist, applyUpdate])

  // Commit a selected "no usable email" reason (No Usable Email / Undeliverable)
  // as a durable customer fact. This is the Save action of the email editor's
  // single Save/Cancel operation: the server clears the active email and its
  // verification, and the editor closes — exactly like saveField, so a stale
  // email draft can never follow and overwrite the just-saved status.
  const setEmailAvailability = useCallback(
    async (status: SelectableEmailAvailability) => {
      setBusyField('email'); setError(null)
      try {
        const updated = await persist({ field: 'email_availability', availability: status })
        applyUpdate(updated)
        setEditing(null)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not update email availability')
      } finally {
        setBusyField(null)
      }
    },
    [persist, applyUpdate],
  )

  // Set / clear Do Not Text (the durable customers.sms_opt_out opt-out). Part of
  // Commit the phone editor as ONE Save/Cancel operation: the typed number plus
  // the two STAGED texting-availability intents (Do Not Text and Text
  // Undeliverable). Nothing is written while the operator toggles the controls;
  // Save applies only what actually changed, in order, and the editor closes
  // once. Each underlying write is still a single-field route call (one op per
  // request), so this sequences them:
  //   1. Phone value, when it changed. The server clears the value-scoped text
  //      delivery failure on a number change, so saving a NEW number first means
  //      a stale "undeliverable" is already gone before we re-evaluate step 3.
  //   2. Do Not Text, when the staged opt-out differs from the current one.
  //   3. Text Undeliverable, when the operator staged it on and the number on
  //      file (after step 1) is not already undeliverable. An ordinary unsent
  //      text is never this; it is a deliberate "the text bounced" record.
  // Cancel writes nothing, so toggling back and forth leaves the record
  // untouched until Save.
  const savePhone = useCallback(
    async (intents: { phone: string | null; doNotText: boolean; markUndeliverable: boolean }) => {
      setBusyField('phone'); setError(null)
      try {
        let current = record
        const phoneChanged = (intents.phone ?? null) !== (current.phone ?? null)
        if (phoneChanged) {
          current = await persist({ field: 'phone', phone: intents.phone })
        }
        if ((current.sms_opt_out === true) !== intents.doNotText) {
          current = await persist({ field: 'sms', do_not_text: intents.doNotText })
        }
        // Only record a failure when the operator staged it AND the number now on
        // file is not already marked undeliverable (a changed number cleared any
        // prior mark in step 1, so this re-fails the new number only on request).
        if (intents.markUndeliverable && current.text_undeliverable !== true && !!current.phone?.trim()) {
          current = await persist({ field: 'sms_undeliverable' })
        }
        applyUpdate(current)
        setEditing(null)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save')
      } finally {
        setBusyField(null)
      }
    },
    [persist, applyUpdate, record],
  )

  // Persist the alert through the shared route (or injected onPersist), update
  // the held record, and notify the host. Save with empty text clears it.
  const commitAlert = useCallback(async (next: string | null) => {
    setAlertBusy(true); setError(null)
    try {
      const updated = await persist({ field: 'alert', alert: next })
      applyUpdate(updated)
      onAlertChange?.(updated.contact_alert ?? null)
      setAlertEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save alert')
    } finally {
      setAlertBusy(false)
    }
  }, [persist, applyUpdate, onAlertChange])

  const saveAlert = useCallback(() => {
    const t = alertDraft.trim()
    void commitAlert(t.length ? t : null)
  }, [alertDraft, commitAlert])

  const clearAlert = useCallback(() => { void commitAlert(null) }, [commitAlert])

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
      {/* Optional header slot across the top of the card: the host's identity
          content on the left, the single Overview/Edit toggle at the right end.
          Rendered only when a host supplies `header`; otherwise the card has no
          header row, exactly as before. */}
      {header != null && (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">{header}</div>
          {collapsible && (
            <ModeToggleButton
              label={isExpanded ? 'Done' : 'Edit'}
              icon={isExpanded ? Check : Pencil}
              onClick={() => setExpandedState(!isExpanded)}
            />
          )}
        </div>
      )}

      {/* Prominent customer alert near the top. Shown only when an alert exists
          and the feature is enabled; no banner when empty. The editor (opened
          from the Add/Edit control below) replaces the banner while editing. */}
      {alertEditable && alertEditing ? (
        <AlertEditor
          draft={alertDraft}
          busy={alertBusy}
          onDraftChange={setAlertDraft}
          onSave={saveAlert}
          onCancel={() => setAlertEditing(false)}
        />
      ) : (
        alertText && <AlertBanner text={alertText} />
      )}

      {/* The customer's name IS the card heading, with the inline graduation-cap
          mentoring control beside it. The approved default renders the name at
          150% (33px), bold, in the teal brand token; the Playground can override
          any of those. `showName` / `showMentoring` let a host suppress either
          for one instance; both default to true so every existing call site is
          unchanged. */}
      {showName && (
        <ContactMentoring
          appearance={ap}
          name={fullName(record)}
          showMentoring={showMentoring}
          firstName={record.first_name}
          lastName={record.last_name}
          nameEditing={nameEditing}
          nameBusy={nameBusy}
          onEditName={() => { setError(null); setNameEditing(true) }}
          onCancelName={() => setNameEditing(false)}
          onSaveName={saveName}
        />
      )}

      {error && (
        <p className="mt-3 rounded-lg border border-status-missing-border bg-status-missing-soft px-3 py-2 text-base text-status-missing-strong">
          {error}
        </p>
      )}

      {isExpanded ? (
        <>
          {/* Edit mode — the existing per-field editing + verification controls,
              byte-identical to today when not collapsible. */}
          <div
            className={cn('mt-3', ap.isDefault && 'divide-y divide-surface-border-strong')}
            style={ap.isDefault ? undefined : {
              borderColor: ap.dividerColor ?? 'var(--surface-border-strong)',
            }}
          >
            <EmailRow
              present={emailPresent}
              verifiedAt={record.email_verified_at}
              value={emailDisplay(record)}
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
              value={phoneDisplay(record)}
              smsOptOut={record.sms_opt_out === true}
              textUndeliverable={record.text_undeliverable === true}
              editing={editing === 'phone'}
              busy={busyField === 'phone'}
              appearance={ap}
              onEdit={() => { setError(null); setEditing('phone') }}
              onCancel={() => setEditing(null)}
              onSave={(intents) => savePhone(intents)}
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

          {/* Bottom bar in the editable view. The status key is hidden while a
              collapsible card is editing (it belongs to the compact Overview); a
              non-collapsible card keeps the existing `showStatusKey` behavior.
              The alert control stays available here in expanded mode. */}
          {((!collapsible && ap.showStatusKey) || (alertEditable && !alertEditing)) && (
            <div className="mt-3 flex items-center justify-between gap-3 border-t border-surface-border-strong pt-2.5">
              {!collapsible && ap.showStatusKey
                ? <ContactStatusKey appearance={ap} inline />
                : <span />}
              {alertEditable && !alertEditing && (
                <AlertControl hasAlert={!!alertText} onEdit={openAlertEditor} onClear={clearAlert} />
              )}
            </div>
          )}

          {/* The control that returns to the compact Overview. When a header is
              present the toggle lives in the header, so the bottom control is
              only a fallback for a collapsible card with no header slot. */}
          {collapsible && header == null && (
            <div className="mt-3 flex justify-end border-t border-surface-border-strong pt-3">
              <ModeToggleButton
                label="Done"
                icon={Check}
                onClick={() => setExpandedState(false)}
              />
            </div>
          )}
        </>
      ) : (
        <>
          {/* Overview mode — a compact, read-only summary of the same three
              fields, reusing the status tones and value rendering. One Edit
              button expands to the controls above. */}
          <div className="mt-3 divide-y divide-surface-border-strong">
            <OverviewRow
              contactIcon={Mail}
              label="Email"
              tone={toneFor(emailPresent, record.email_verified_at)}
              value={overviewEmailText(record)}
              present={emailPresent}
              first
            />
            <OverviewRow
              contactIcon={Phone}
              label="Phone"
              tone={toneFor(phonePresent, record.phone_verified_at)}
              value={overviewPhoneText(record)}
              present={phonePresent}
            />
            <OverviewRow
              contactIcon={MapPin}
              label="Mailing Address"
              tone={toneFor(addrPresent, record.address_verified_at)}
              value={addrPresent ? addressLines(record).join('\n') : null}
              present={addrPresent}
              last
            />
          </div>

          {/* Bottom bar of the compact Overview: the status key on the left so
              the green/amber/red icons above read clearly, and the Add/Edit
              alert control at the bottom right alongside it. */}
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-surface-border-strong pt-2.5">
            <ContactStatusKey appearance={ap} inline />
            {alertEditable && !alertEditing && (
              <AlertControl hasAlert={!!alertText} onEdit={openAlertEditor} onClear={clearAlert} />
            )}
          </div>

          {/* Fallback Edit control for a collapsible card with no header slot.
              When a header is present the single Edit button lives in it. */}
          {header == null && (
            <div className="mt-3 flex justify-end border-t border-surface-border-strong pt-3">
              <ModeToggleButton
                label="Edit"
                icon={Pencil}
                onClick={() => setExpandedState(true)}
              />
            </div>
          )}
        </>
      )}
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
function ContactMentoring({
  appearance, name, showMentoring = true,
  firstName, lastName, nameEditing, nameBusy, onEditName, onCancelName, onSaveName,
}: {
  appearance: ResolvedAppearance
  name: string
  /** Render the mentoring cap/panel. Default true (the existing behavior). When
   * false, only the name heading renders and no mentoring appears. */
  showMentoring?: boolean
  /** The stored first/last name backing the inline name editor. */
  firstName?: string | null
  lastName?: string | null
  /** Whether the inline name editor is open, and whether a save is in flight. */
  nameEditing?: boolean
  nameBusy?: boolean
  /** Open / cancel the inline name editor, and save the corrected first/last.
   * When these are omitted the name heading is read-only, exactly as before. */
  onEditName?: () => void
  onCancelName?: () => void
  onSaveName?: (first: string | null, last: string | null) => void
}) {
  const body =
    'Changes here update customer information throughout Right Path. Check Verified only when the ' +
    'customer has confirmed the information is correct, including when they confirm it in an email ' +
    'response.'

  const { open, setOpen } = useMentorDisclosure()

  // The name is editable only when the host wired the save handler (every
  // on-card call site does). A read-only host keeps today's plain heading.
  const nameEditable = !!onSaveName

  // Presentation-only overrides for the coaching body (size / color); the cap
  // icon itself keeps its standard purple identity. Only applied when a
  // mentoring-specific override is active, so the neutral baseline is untouched.
  const bodyStyle: React.CSSProperties | undefined = appearance.mentoringOverridden
    ? {
        fontSize: `${appearance.mentoringFontPx.toFixed(3)}px`,
        ...(appearance.mentoringColor ? { color: appearance.mentoringColor } : {}),
      }
    : undefined

  if (nameEditable && nameEditing) {
    return (
      <NameEditor
        appearance={appearance}
        firstName={firstName ?? null}
        lastName={lastName ?? null}
        busy={!!nameBusy}
        onCancel={() => onCancelName?.()}
        onSave={(first, last) => onSaveName?.(first, last)}
      />
    )
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <h3
          className={cn('text-[22px] font-semibold leading-tight text-ink', weightClass(appearance.nameWeight))}
          style={textStyle(appearance, appearance.nameFontPx, appearance.nameColor, appearance.nameWeight)}
        >
          {name}
        </h3>
        {showMentoring && !open && (
          <MentorCapButton onOpen={() => setOpen(true)} label="Show mentoring about these fields" />
        )}
        {nameEditable && (
          <button
            type="button"
            onClick={() => onEditName?.()}
            aria-label="Edit customer name"
            className="inline-flex items-center gap-1.5 rounded-lg border border-surface-border-strong bg-surface-card px-2 py-1 text-sm font-medium text-ink-secondary hover:bg-surface-muted"
          >
            <Pencil className="size-3.5" aria-hidden /> Edit name
          </button>
        )}
      </div>
      {showMentoring && open && (
        <MentorCapPanel className="mt-2" onClose={() => setOpen(false)}>
          <span style={bodyStyle}>{body}</span>
        </MentorCapPanel>
      )}
    </>
  )
}

/**
 * The inline editor for the customer's first and last name, shown in place of
 * the name heading. Two independent fields; capitalization is preserved exactly
 * as typed (McAndrew, DeLuca) and multiword surnames (La Bar, van der Berg) are
 * kept whole — the shared `normalizeNameInput` only collapses whitespace and
 * trims, it never title-cases or splits. First and last are saved independently;
 * either may be cleared to empty. Save is blocked only when NOTHING would remain
 * (both blank), since a customer must keep at least one name.
 */
function NameEditor({
  appearance, firstName, lastName, busy, onCancel, onSave,
}: {
  appearance: ResolvedAppearance
  firstName: string | null
  lastName: string | null
  busy: boolean
  onCancel: () => void
  onSave: (first: string | null, last: string | null) => void
}) {
  const [first, setFirst] = useState(firstName ?? '')
  const [last, setLast] = useState(lastName ?? '')

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    // Normalize for storage: collapse internal whitespace and trim, preserving
    // capitalization exactly as typed. Each field is independent; an empty field
    // is a valid clear (null).
    const f = normalizeNameInput(first)
    const l = normalizeNameInput(last)
    onSave(f.value, l.value)
  }

  // At least one name component must remain after normalization.
  const nothingLeft =
    normalizeNameInput(first).status === 'empty' && normalizeNameInput(last).status === 'empty'

  return (
    <form onSubmit={submit} className="py-1">
      <p className="flex items-center gap-1.5 text-base font-semibold text-ink-secondary">
        <Pencil className="size-4" aria-hidden /> Edit name
      </p>
      <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <label htmlFor="cc-first-name" className="text-sm font-medium text-ink-secondary">First name</label>
          <input
            id="cc-first-name"
            type="text"
            autoFocus
            value={first}
            disabled={busy}
            onChange={(e) => setFirst(e.target.value)}
            onBlur={() => setFirst((v) => normalizeNameInput(v).value ?? '')}
            placeholder="First name"
            className={cn('mt-1', inputCls(false))}
          />
        </div>
        <div>
          <label htmlFor="cc-last-name" className="text-sm font-medium text-ink-secondary">Last name</label>
          <input
            id="cc-last-name"
            type="text"
            value={last}
            disabled={busy}
            onChange={(e) => setLast(e.target.value)}
            onBlur={() => setLast((v) => normalizeNameInput(v).value ?? '')}
            placeholder="Last name"
            className={cn('mt-1', inputCls(false))}
          />
        </div>
      </div>
      {nothingLeft && (
        <p className="mt-1.5 text-base text-status-missing-strong">Enter at least a first or last name.</p>
      )}
      <div className="mt-2.5">
        <NameEditActions busy={busy} disabled={nothingLeft} onCancel={onCancel} appearance={appearance} />
      </div>
    </form>
  )
}

/** Save / Cancel for the name editor. Mirrors `EditActions` but allows the Save
 * button to be disabled independently (when both name fields are blank). */
function NameEditActions({
  busy, disabled, onCancel, appearance,
}: {
  busy: boolean
  disabled: boolean
  onCancel: () => void
  appearance: ResolvedAppearance
}) {
  const style = fontStyle(appearance, appearance.controlFontPx)
  return (
    <div className="flex items-center gap-2">
      <button
        type="submit"
        disabled={busy || disabled}
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

/**
 * A standalone, editable customer-name heading for hosts that render their OWN
 * name heading beside the shared CustomerContactCard (Contact Research, the
 * calling workbench, and other stewardship surfaces that pass `showName={false}`
 * and supply a `header`). It renders the host's existing heading text — with the
 * host's own className/style, so there is NO duplicate heading and the look is
 * unchanged — and adds the same "Edit name" control and inline first/last editor
 * the card heading uses.
 *
 * It persists through the SAME shared route the card uses
 * (`PATCH /api/customers/[id]/contact`, `{ field: 'name' }`), so capitalization
 * is preserved (McAndrew, DeLuca), multiword surnames stay whole (La Bar), and
 * the correction is recorded once in Customer History. On success it calls
 * `onSaved` with the authoritative updated record so the host folds the new name
 * into its own state and the displayed name updates immediately everywhere in
 * the active workflow. A host may inject `onPersist` (Storybook/tests) exactly
 * as the card does.
 */
export function CustomerNameHeading({
  customerId,
  firstName,
  lastName,
  className,
  style,
  expanded = true,
  age = null,
  ageApproximate = false,
  onPersist,
  onSaved,
}: {
  customerId: string
  firstName: string | null
  lastName: string | null
  /** Applied to the heading text so it matches the host's existing name style. */
  className?: string
  style?: React.CSSProperties
  /** The card's Overview/Edit state. This shared heading owns the uniform rule
   * for every workflow screen: the Edit name button shows ONLY in expanded Edit
   * mode and is hidden in the compact Overview. Hosts pass the card's expanded
   * state (from `onExpandedChange`); default true preserves the always-editable
   * behavior for a non-collapsible caller. */
  expanded?: boolean
  /** The customer's best-available-precision age (reused project age logic:
   * exact DOB, else the agreed masked policy DOB). Shown directly beneath the
   * name in BOTH modes. Null omits the age entirely — never guessed. */
  age?: number | null
  /** True when `age` came from the masked policy fallback rather than an exact
   * date_of_birth, so it is labeled approximate ("~N (approx.)"). */
  ageApproximate?: boolean
  /** Inject persistence. Omit to PATCH /api/customers/[id]/contact. Must resolve
   * with the full updated record. */
  onPersist?: (customerId: string, payload: ContactPersistPayload) => Promise<CustomerContact>
  /** Notified with the authoritative updated record after a successful save, so
   * the host can refresh the displayed name throughout the workflow. */
  onSaved?: (updated: CustomerContact) => void
}) {
  const ap = useMemo(() => resolveAppearance(undefined), [])
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const display = `${firstName ?? ''} ${lastName ?? ''}`.trim() || 'Unknown customer'

  const save = useCallback(async (first: string | null, last: string | null) => {
    setBusy(true); setError(null)
    try {
      const payload: ContactPersistPayload = { field: 'name', first_name: first, last_name: last }
      let updated: CustomerContact
      if (onPersist) {
        updated = await onPersist(customerId, payload)
      } else {
        const res = await fetch(`/api/customers/${customerId}/contact`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'Could not save name')
        updated = json.data as CustomerContact
      }
      onSaved?.(updated)
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save name')
    } finally {
      setBusy(false)
    }
  }, [customerId, onPersist, onSaved])

  // The age line beneath the name, shown uniformly in both modes. Omitted when
  // age is unknown; an approximate age (from the masked policy fallback) is
  // marked "~N (approx.)" with a clarifying tooltip. Shared by both the editing
  // and read states so every workflow screen reads identically.
  const ageSubline = age != null ? (
    <div className="mt-0.5">
      <span
        className="text-base font-medium text-ink-supporting"
        title={ageApproximate ? 'Approximate age, estimated from policy records' : undefined}
      >
        Age {ageApproximate ? `~${age}` : age}
        {ageApproximate && <span className="ml-1 text-ink-muted">(approx.)</span>}
      </span>
    </div>
  ) : null

  if (editing) {
    return (
      <div>
        <NameEditor
          appearance={ap}
          firstName={firstName}
          lastName={lastName}
          busy={busy}
          onCancel={() => { setError(null); setEditing(false) }}
          onSave={save}
        />
        {ageSubline}
        {error && <p className="mt-1.5 text-base text-status-missing-strong">{error}</p>}
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <h2 className={className} style={style}>{display}</h2>
        {/* Uniform rule for every workflow screen: Edit name only in expanded
            Edit mode, hidden in the compact Overview. */}
        {expanded && (
          <button
            type="button"
            onClick={() => { setError(null); setEditing(true) }}
            aria-label="Edit customer name"
            className="inline-flex items-center gap-1.5 rounded-lg border border-surface-border-strong bg-surface-card px-2 py-1 text-sm font-medium text-ink-secondary hover:bg-surface-muted"
          >
            <Pencil className="size-3.5" aria-hidden /> Edit name
          </button>
        )}
      </div>
      {ageSubline}
    </div>
  )
}

/**
 * The read-only value for the Email line of the Overview. A usable address
 * shows as-is; otherwise it shows the recorded reason ("No Usable Email",
 * "Undeliverable") or "Missing" — the same wording the editable Email section
 * uses, so Overview and Edit never disagree.
 */
function overviewEmailText(record: CustomerContact): string | null {
  const display = resolveEmailAvailabilityDisplay(record.email_availability, record.email)
  if (display === 'on_file') return emailDisplay(record)
  if (display === 'missing') return null
  return EMAIL_AVAILABILITY_LABEL[display]
}

/**
 * The read-only value for the Phone line of the Overview: the formatted number,
 * with the texting restriction appended on its own line when texting is
 * restricted (Do Not Text / Text Undeliverable). Calls are unaffected, so the
 * number still shows; the note only tells the worker texting is off and why.
 * Keeps Overview and Edit consistent, like overviewEmailText.
 */
function overviewPhoneText(record: CustomerContact): string | null {
  const number = phoneDisplay(record)
  const display = resolveSmsAvailabilityDisplay({
    smsOptOut: record.sms_opt_out === true,
    textUndeliverable: record.text_undeliverable === true && !!number,
  })
  if (display === 'available') return number
  const note = SMS_AVAILABILITY_LABEL[display]
  return number ? `${number}\n${note}` : note
}

/**
 * One compact, read-only row in the Overview: the field's status icon, the
 * contact-method icon, then the actual contact value — all on a single line,
 * with no text label. A long mailing address wraps naturally beneath the icons.
 * No Edit button and no Verified checkbox; the single Edit button on the card
 * reveals those. The status ICON carries the same verified/on-file/missing
 * meaning as the editable view (and the same accessible label), and the
 * contact-method icon carries the field name as its accessible label since the
 * visible text label is gone, so the row stays meaningful without a label.
 *
 * Styling reuses the approved card tokens: the status/contact icons take the
 * field's green/amber/red status color at the same `size-5` as the editable
 * headings, and the value uses the same `text-lg text-ink` as the editable
 * value line.
 */
function OverviewRow({
  contactIcon: ContactIcon, label, tone, value, present, first, last,
}: {
  contactIcon: typeof Mail
  label: string
  tone: Tone
  value: string | null
  present: boolean
  first?: boolean
  last?: boolean
}) {
  const status = STATUS_META[tone]
  const StatusIcon = status.icon
  return (
    <div className={cn('flex items-start gap-2 py-2.5', first && 'pt-0', last && 'pb-0')}>
      <StatusIcon
        className={cn('mt-0.5 size-5 shrink-0', status.color)}
        aria-label={status.label}
        role="img"
      />
      <ContactIcon className={cn('mt-0.5 size-5 shrink-0', status.color)} aria-label={label} role="img" />
      {present ? (
        <p className="min-w-0 whitespace-pre-line break-words text-lg text-ink">{value}</p>
      ) : (
        <p className="mt-0.5 text-lg font-medium text-status-missing-strong">
          {value ?? 'Missing'}
        </p>
      )}
    </div>
  )
}

/**
 * The prominent customer-alert banner near the top of the card. One short,
 * high-contrast amber band (the known/amber status tokens, same family the
 * card already uses) so the alert reads at a glance. Display-only; the text
 * wraps and preserves line breaks from the editor.
 */
function AlertBanner({ text }: { text: string }) {
  return (
    <div
      role="alert"
      className="mt-3 flex items-start gap-2.5 rounded-xl border border-status-known-border bg-status-known-fill px-3 py-2.5"
    >
      <AlertTriangle className="mt-0.5 size-5 shrink-0 text-status-known-strong" aria-hidden />
      <p className="min-w-0 whitespace-pre-line break-words text-base font-medium text-status-known-strong">
        {text}
      </p>
    </div>
  )
}

/**
 * The multiline alert editor with Save and Cancel. Reuses the card's input and
 * button chrome (the same tokens as the field editors) so it feels native to
 * the card. Empty text on Save clears the alert.
 */
function AlertEditor({
  draft, busy = false, onDraftChange, onSave, onCancel,
}: {
  draft: string
  busy?: boolean
  onDraftChange: (v: string) => void
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <div className="mt-3 rounded-xl border border-status-known-border bg-status-known-soft p-3">
      <label htmlFor="cc-alert" className="flex items-center gap-1.5 text-base font-semibold text-status-known-strong">
        <AlertTriangle className="size-4" aria-hidden /> Customer alert
      </label>
      <textarea
        id="cc-alert"
        autoFocus
        rows={3}
        value={draft}
        disabled={busy}
        onChange={(e) => onDraftChange(e.target.value)}
        placeholder="Add a short alert shown at the top of this customer's card."
        className="mt-1.5 w-full rounded-lg border border-surface-border-strong px-3 py-2 text-base text-ink focus:border-brand-ring focus:outline-none focus:ring-2 focus:ring-brand-wash disabled:opacity-50"
      />
      <div className="mt-2.5 flex items-center gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-base font-semibold text-brand-foreground hover:bg-brand-hover disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Check className="size-3.5" aria-hidden />} Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-surface-border-strong bg-surface-card px-3 py-1.5 text-base font-medium text-ink-secondary hover:bg-surface-muted disabled:opacity-40"
        >
          <X className="size-3.5" aria-hidden /> Cancel
        </button>
      </div>
    </div>
  )
}

/**
 * The Add / Edit + Clear alert control, shown in the card's bottom bar in both
 * modes. "Add Alert" when none exists; "Edit alert" + "Clear" when one does.
 */
function AlertControl({
  hasAlert, onEdit, onClear,
}: {
  hasAlert: boolean
  onEdit: () => void
  onClear: () => void
}) {
  const btn =
    'inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-surface-border-strong bg-surface-card px-2.5 py-1 text-sm font-medium text-ink-secondary hover:bg-surface-muted'
  return (
    <div className="flex shrink-0 items-center gap-2">
      <button type="button" onClick={onEdit} className={btn}>
        {hasAlert ? <Pencil className="size-3.5" aria-hidden /> : <Plus className="size-3.5" aria-hidden />}
        {hasAlert ? 'Edit alert' : 'Add Alert'}
      </button>
      {hasAlert && (
        <button type="button" onClick={onClear} className={btn}>
          <Trash2 className="size-3.5" aria-hidden /> Clear
        </button>
      )}
    </div>
  )
}

/**
 * The single control that switches the collapsible card between Overview and
 * Edit. It reuses the same neutral button chrome as the per-field Edit button
 * so the two modes feel like one card, not two components.
 */
function ModeToggleButton({
  label, icon: Icon, onClick,
}: {
  label: string
  icon: typeof Pencil
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border border-surface-border-strong bg-surface-card px-3 py-1.5 text-base font-medium text-ink-secondary hover:bg-surface-muted"
    >
      <Icon className="size-4" aria-hidden /> {label}
    </button>
  )
}

/** The compact status key at the foot of the card: the same Lucide icons and
 * colors as the field headings, so green / amber / red read consistently. */
function ContactStatusKey({ appearance, inline = false }: { appearance: ResolvedAppearance; inline?: boolean }) {
  const order: Tone[] = ['confirmed', 'known', 'missing']
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-supporting',
        // Standalone: its own top divider + spacing (the original look). Inline:
        // it sits inside a shared bottom bar that already owns the border.
        !inline && 'mt-3 border-t border-surface-border-strong pt-2.5',
      )}
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

/** The email-availability states the operator can select directly in the Email
 * section: Missing (reset to unknown), No Usable Email, and Undeliverable.
 * 'available' is never selected here — it is set by the system when a usable
 * address is saved. */
const EMAIL_REASON_CHOICES: readonly SelectableEmailAvailability[] =
  SELECTABLE_EMAIL_AVAILABILITY_VALUES

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
  onSetAvailability: (status: SelectableEmailAvailability) => void
  onVerify: (v: boolean) => void
}) {
  const tone = toneFor(present, verifiedAt)
  const display = resolveEmailAvailabilityDisplay(availability, value)
  const [draft, setDraft] = useState(value ?? '')
  const [result, setResult] = useState<ContactFieldResult | null>(null)
  // A state selected in THIS editing session but not yet committed. The editor
  // is one Save/Cancel operation: picking Missing / No Usable Email /
  // Undeliverable only PREPARES the selection (it is not persisted on click);
  // Save commits either the pending selection or the typed email, and Cancel
  // discards both. This is what prevents a lingering email draft from
  // overwriting a newly selected status.
  const [pendingReason, setPendingReason] =
    useState<SelectableEmailAvailability | null>(null)

  // Reset the draft and any pending selection whenever the editor opens, so
  // Cancel-then-Edit starts clean.
  const open = useCallback(() => {
    setDraft(value ?? ''); setResult(null); setPendingReason(null); onEdit()
  }, [value, onEdit])

  if (!editing) {
    // A recorded reason (No Usable Email / Undeliverable) explains WHY email is
    // absent. 'on_file' needs no help, and 'missing' shows only "Missing" with
    // no explanatory line. Verification stays bound to an actual address
    // (SectionShell disables Verified when !present).
    const helpText = display === 'on_file' || display === 'missing'
      ? null
      : EMAIL_AVAILABILITY_HELP[display]
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

  // Save commits exactly one outcome: a pending "no usable email" reason when
  // one is selected, otherwise the typed email. The two are mutually exclusive,
  // so a stale email draft can never ride along with — and overwrite — a chosen
  // status. An email is validated only when it is the thing being saved.
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (pendingReason) {
      onSetAvailability(pendingReason)
      return
    }
    const r = normalizeEmailInput(draft)
    if (r.status === 'invalid') { setResult(r); return }
    onSave(r.value) // valid canonical value, or null when empty (a valid clear)
  }

  // Selecting a reason only PREPARES it. It clears the email draft so the editor
  // reflects that saving will remove the address, and clears any stale
  // validation. Re-clicking the selected reason toggles it back off, returning
  // to editing the email.
  const selectReason = (choice: SelectableEmailAvailability) => {
    setResult(null)
    setPendingReason((prev) => {
      const next = prev === choice ? null : choice
      setDraft(next ? '' : (value ?? ''))
      return next
    })
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
        disabled={busy || !!pendingReason}
        onChange={(e) => { setDraft(e.target.value); if (result) setResult(null) }}
        onBlur={() => { if (!pendingReason) setResult(normalizeEmailInput(draft)) }}
        placeholder={pendingReason ? EMAIL_AVAILABILITY_LABEL[pendingReason] : 'name@example.com'}
        aria-invalid={result?.status === 'invalid' || undefined}
        className={cn('mt-1.5', inputCls(result?.status === 'invalid'), pendingReason && 'opacity-50')}
      />
      {result?.status === 'invalid' && result.reason && (
        <p className="mt-1.5 text-base text-status-missing-strong">{result.reason}</p>
      )}

      {/* Email availability — an informational customer fact chosen here as part
          of the SAME Save/Cancel operation. Picking a selection only prepares it
          (shown highlighted); Save commits it and clears the active email +
          verification, Cancel discards it. Entering and saving an email returns
          to Email on file. It changes no research or workflow. */}
      <fieldset className="mt-3 border-t border-surface-border-strong pt-3">
        <legend className="text-sm font-semibold text-ink-secondary">Set email availability</legend>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {EMAIL_REASON_CHOICES.map((choice) => {
            const selected = pendingReason === choice
            return (
              <button
                key={choice}
                type="button"
                disabled={busy}
                aria-pressed={selected}
                onClick={() => selectReason(choice)}
                className={cn(
                  'inline-flex items-center rounded-lg border px-2.5 py-1 text-sm font-medium disabled:opacity-60',
                  selected
                    ? 'border-status-missing-border bg-status-missing-soft text-status-missing-strong'
                    : 'border-surface-border-strong bg-surface-card text-ink-secondary hover:bg-surface-muted',
                )}
              >
                {EMAIL_AVAILABILITY_LABEL[choice]}
              </button>
            )
          })}
        </div>
      </fieldset>

      {/* Save / Cancel sits beneath the availability selections so the editor
          reads: email input, then the availability choices, then the single
          Save/Cancel for the whole operation. */}
      <div className="mt-3"><EditActions busy={busy} onCancel={onCancel} appearance={appearance} /></div>
    </form>
  )
}

// ── Phone ──────────────────────────────────────────────────────────────────

function PhoneRow({
  present, verifiedAt, value, smsOptOut, textUndeliverable,
  editing, busy, appearance, onEdit, onCancel, onSave, onVerify,
}: {
  present: boolean
  verifiedAt: string | null
  value: string | null
  /** Do Not Text — the durable customer opt-out (customers.sms_opt_out). */
  smsOptOut: boolean
  /** Whether the number on file has a recorded text-delivery failure. */
  textUndeliverable: boolean
  editing: boolean
  busy: boolean
  appearance: ResolvedAppearance
  onEdit: () => void
  onCancel: () => void
  /** Commit the whole phone editor at once: the typed number plus the STAGED
   * texting intents. Called only on Save. */
  onSave: (intents: { phone: string | null; doNotText: boolean; markUndeliverable: boolean }) => void
  onVerify: (v: boolean) => void
}) {
  const tone = toneFor(present, verifiedAt)
  const [draft, setDraft] = useState(formatPhoneAsTyped(value ?? ''))
  const [result, setResult] = useState<ContactFieldResult | null>(null)
  // Staged texting intents, local to this editing session. They mirror the
  // current facts when the editor opens and change ONLY in local state as the
  // operator clicks; nothing persists until Save. `markUndeliverable` tracks the
  // operator's intent to record a NEW delivery failure for the number on file —
  // it starts true only when the number is already undeliverable (so toggling it
  // off then on is a no-op against an existing mark, and on a clean number it is
  // a deliberate opt-in).
  const [draftDoNotText, setDraftDoNotText] = useState(smsOptOut)
  const [draftUndeliverable, setDraftUndeliverable] = useState(textUndeliverable && present)

  // The effective texting status from the two facts. Do Not Text outranks a
  // delivery failure; it holds even with no number on file (it follows the
  // customer), while Undeliverable is only meaningful when a number is present.
  const smsDisplay: SmsAvailabilityDisplay = resolveSmsAvailabilityDisplay({
    smsOptOut,
    textUndeliverable: textUndeliverable && present,
  })

  const open = useCallback(() => {
    setDraft(formatPhoneAsTyped(value ?? '')); setResult(null)
    setDraftDoNotText(smsOptOut)
    setDraftUndeliverable(textUndeliverable && present)
    onEdit()
  }, [value, smsOptOut, textUndeliverable, present, onEdit])

  if (!editing) {
    return (
      <SectionShell contactIcon={Phone} label="Phone" tone={tone} present={present} verifiedAt={verifiedAt}
        busy={busy} appearance={appearance} onEdit={open} onVerify={onVerify}>
        <ValueText value={value} present={present} appearance={appearance} />
        <SmsStatusLine display={smsDisplay} appearance={appearance} />
      </SectionShell>
    )
  }

  // The number the operator is about to save (used so the texting controls
  // reflect whether a usable number will be on file after Save).
  const stagedPhone = normalizePhoneInput(draft)
  const willHaveNumber = stagedPhone.status !== 'empty' && stagedPhone.status !== 'invalid'
  // The number has NOT changed from the one already on file (compare canonical
  // values). When it is unchanged AND already undeliverable, that mark cannot be
  // cleared here — a delivery failure clears only by REPLACING the number — so
  // the Undeliverable control is locked on. Typing a different (or empty) number
  // means the stale mark will clear on Save, which re-enables the toggle.
  const numberUnchanged = (stagedPhone.value ?? null) === (value ? (normalizePhoneInput(value).value ?? null) : null)
  const lockedUndeliverable = textUndeliverable && present && numberUnchanged && willHaveNumber

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const r = normalizePhoneInput(draft)
    if (r.status === 'invalid') { setResult(r); return }
    onSave({
      phone: r.value,
      doNotText: draftDoNotText,
      // Only a number that will actually be on file can be marked undeliverable.
      markUndeliverable: draftUndeliverable && willHaveNumber,
    })
  }

  // The staged texting status, from the pending toggles, so the editor previews
  // exactly what Save will produce. A number being removed makes Undeliverable
  // moot; Do Not Text still holds (it follows the customer).
  const draftSmsDisplay: SmsAvailabilityDisplay = resolveSmsAvailabilityDisplay({
    smsOptOut: draftDoNotText,
    textUndeliverable: draftUndeliverable && willHaveNumber,
  })

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
        disabled={busy}
        onChange={(e) => { setDraft(formatPhoneAsTyped(e.target.value)); if (result) setResult(null) }}
        onBlur={() => setResult(normalizePhoneInput(draft))}
        placeholder="(215) 555-0100"
        aria-invalid={result?.status === 'invalid' || undefined}
        className={cn('mt-1.5', inputCls(result?.status === 'invalid'))}
      />
      {result?.status === 'invalid' && result.reason && (
        <p className="mt-1.5 text-base text-status-missing-strong">{result.reason}</p>
      )}

      {/* Text-message availability — the two existing restrictions, STAGED here
          as part of the single Save/Cancel operation. Clicking a control only
          toggles the pending selection (shown highlighted); nothing persists
          until Save, and Cancel discards it. Both disable texting only, never
          calling. */}
      <SmsAvailabilityControls
        display={draftSmsDisplay}
        hasNumber={willHaveNumber}
        doNotText={draftDoNotText}
        undeliverable={draftUndeliverable && willHaveNumber}
        lockedUndeliverable={lockedUndeliverable}
        busy={busy}
        onToggleDoNotText={() => setDraftDoNotText((v) => !v)}
        // When the mark is locked (same number, already undeliverable) the toggle
        // is a no-op: it clears only by replacing the number.
        onToggleUndeliverable={() => { if (!lockedUndeliverable) setDraftUndeliverable((v) => !v) }}
      />

      <div className="mt-2.5"><EditActions busy={busy} onCancel={onCancel} appearance={appearance} /></div>
    </form>
  )
}

/** The current texting status beneath the phone value (read view). Shown only
 * when texting is restricted; an available number needs no line, matching how
 * the Email section shows an explanatory line only for a non-normal state. The
 * status is a distinct SHAPE + words, never color alone. */
function SmsStatusLine({ display, appearance }: { display: SmsAvailabilityDisplay; appearance: ResolvedAppearance }) {
  if (display === 'available') return null
  const Icon = display === 'do_not_text' ? Ban : MessageSquareOff
  return (
    <p
      className="mt-0.5 flex items-center gap-1.5 text-sm font-medium text-status-missing-strong"
      style={fontStyle(appearance, appearance.supportingFontPx)}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      {SMS_AVAILABILITY_LABEL[display]}
    </p>
  )
}

/** The Text-message availability controls inside the phone editor. Two
 * restrictions, each a STAGED toggle that is part of the phone editor's single
 * Save/Cancel operation — clicking only flips the pending selection, nothing
 * persists until Save, and Cancel discards it. The parent owns the staged state:
 *   - Do Not Text stages the durable customer opt-out (customers.sms_opt_out).
 *     Togglable even with no number on file, since it follows the customer.
 *   - Text Undeliverable stages a delivery-failure record for the NUMBER that
 *     will be on file. Needs a number; an ordinary unsent text is not a failure,
 *     so this is a deliberate opt-in. Replacing the number restores availability.
 * Both disable texting only; telephone calls are never affected. */
function SmsAvailabilityControls({
  display, hasNumber, doNotText, undeliverable, lockedUndeliverable, busy,
  onToggleDoNotText, onToggleUndeliverable,
}: {
  /** The STAGED status (from the pending toggles), for the help/preview line. */
  display: SmsAvailabilityDisplay
  /** Whether a usable number will be on file after Save. */
  hasNumber: boolean
  /** The staged Do Not Text selection. */
  doNotText: boolean
  /** The staged Text Undeliverable selection (already gated on hasNumber). */
  undeliverable: boolean
  /** The number on file is already undeliverable and unchanged, so the mark
   * cannot be cleared here (it clears only by replacing the number). The toggle
   * shows pressed and is locked. */
  lockedUndeliverable: boolean
  busy: boolean
  onToggleDoNotText: () => void
  onToggleUndeliverable: () => void
}) {
  return (
    <fieldset className="mt-3 border-t border-surface-border-strong pt-3">
      <legend className="text-sm font-semibold text-ink-secondary">Text-message availability</legend>
      <p className="mt-0.5 text-sm text-ink-muted">
        {SMS_AVAILABILITY_HELP[display]}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          aria-pressed={doNotText}
          onClick={onToggleDoNotText}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm font-medium disabled:opacity-60',
            doNotText
              ? 'border-status-missing-border bg-status-missing-soft text-status-missing-strong'
              : 'border-surface-border-strong bg-surface-card text-ink-secondary hover:bg-surface-muted',
          )}
        >
          <Ban className="size-3.5 shrink-0" aria-hidden />
          Do Not Text
        </button>
        <button
          type="button"
          // A delivery failure is recorded against the number that will be on
          // file, so it needs a number and is moot while Do Not Text already
          // disables texting. It is also locked ON when the current number is
          // already undeliverable (it clears only by replacing the number).
          // Disabled (not hidden) so the control stays legible.
          disabled={busy || !hasNumber || doNotText || lockedUndeliverable}
          aria-pressed={undeliverable}
          onClick={onToggleUndeliverable}
          title={
            !hasNumber ? 'Enter a phone number first.'
            : doNotText ? 'Do Not Text already disables texting.'
            : lockedUndeliverable ? 'Already undeliverable. Replace the number to restore texting.'
            : 'Mark that a text to this number failed to deliver (saved on Save).'
          }
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm font-medium disabled:opacity-60',
            undeliverable && !doNotText
              ? 'border-status-missing-border bg-status-missing-soft text-status-missing-strong'
              : 'border-surface-border-strong bg-surface-card text-ink-secondary hover:bg-surface-muted',
          )}
        >
          <MessageSquareOff className="size-3.5 shrink-0" aria-hidden />
          Text Undeliverable
        </button>
      </div>
    </fieldset>
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
  // Seed the editable drafts with the shared display normalization so the
  // operator edits (and can copy) properly-formatted values: street in normal
  // capitalization with directionals preserved, city normal-cased, state
  // uppercased. The stored record is never rewritten by seeding a draft.
  const [street, setStreet] = useState(streetDisplay(record))
  const [city, setCity] = useState(normalizeCity(record.city) ?? '')
  const [stateVal, setStateVal] = useState(normalizeState(record.state) ?? '')
  const [zip, setZip] = useState(record.zip ?? '')

  const open = useCallback(() => {
    setStreet(streetDisplay(record)); setCity(normalizeCity(record.city) ?? '')
    setStateVal(normalizeState(record.state) ?? ''); setZip(record.zip ?? '')
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
    // Save the same normalized forms the operator sees, so a Save before an
    // onBlur fires still stores the display standard: street normal-cased with
    // directionals preserved, city normal-cased, state uppercased. This only
    // normalizes the value being actively edited; it rewrites no other record.
    onSave({
      street: normalizeStreet(street),
      city: normalizeCity(city),
      state: normalizeState(stateVal),
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
            onBlur={() => setStreet((v) => normalizeStreet(v) ?? '')}
            placeholder="123 Main St" className={cn('mt-1', inputCls(false))} />
        </div>
        {/* City, State, and ZIP share one row: City takes most of the width,
            State and ZIP stay narrow. Street keeps its own row above. */}
        <div className="flex gap-2">
          <div className="flex-1">
            <label htmlFor="cc-city" className="text-sm font-medium uppercase tracking-wide text-ink-supporting">City</label>
            <input id="cc-city" value={city} onChange={(e) => setCity(e.target.value)}
              onBlur={() => setCity((v) => normalizeCity(v) ?? '')}
              placeholder="Philadelphia" className={cn('mt-1', inputCls(false))} />
          </div>
          <div className="w-16">
            <label htmlFor="cc-state" className="text-sm font-medium uppercase tracking-wide text-ink-supporting">State</label>
            <input id="cc-state" value={stateVal} onChange={(e) => setStateVal(e.target.value.toUpperCase())}
              maxLength={2} placeholder="PA" className={cn('mt-1 uppercase', inputCls(false))} />
          </div>
          <div className="w-24">
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
