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
  ShieldQuestion, CheckCircle2, AlertTriangle,
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
  type SelectableEmailAvailability,
  EMAIL_AVAILABILITY_LABEL,
  SELECTABLE_EMAIL_AVAILABILITY_VALUES,
  resolveEmailAvailabilityDisplay,
} from '@/lib/email-availability'
import {
  type SmsAvailabilityDisplay,
  SMS_AVAILABILITY_LABEL,
  SMS_AVAILABILITY_HELP,
  resolveSmsAvailabilityDisplay,
} from '@/lib/sms-availability'
import {
  describeContactUpdate,
  type ContactSnapshot,
  type NextHistoryEntryPreview,
} from '@/lib/stewardship/customer-history'
import { normalizeDobParts, dobToParts, formatDobDisplay, wouldDowngradeExactDob } from '@/lib/stewardship/dob'

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
  /** The customer's best-available-precision age for the identity header
   * (reused project age logic: exact date_of_birth, else the agreed masked
   * policy DOB, UNKNOWN on conflict). Null/omitted means unknown and the age
   * line is not shown — never guessed. The day/DOB is never carried here; this
   * is age only. Supplied by the GET half of /api/customers/[id]/contact when
   * the card fetches its own data. */
  age?: number | null
  /** True when `age` came from the masked policy fallback rather than an exact
   * date_of_birth, so the identity header labels it approximate ("~N (approx.)").
   * Optional; defaults to exact. */
  age_approximate?: boolean
  /** The customer's EXACT date of birth (YYYY-MM-DD) when all three parts are
   * known, else null. Shown MASKED only (day never rendered) beneath the name,
   * alongside age, and editable in the expanded editor. Optional so existing
   * callers that don't select it still satisfy the type. */
  date_of_birth?: string | null
  /** The customer's PARTIAL date of birth (masked 'MM/xx/YYYY' / 'xx/xx/YYYY',
   * no day) when the exact date is not fully known, else null. Optional. */
  date_of_birth_approx?: string | null
  /** The best-available-precision DOB resolved for display ("MM/DD/YYYY" /
   * "MM/YYYY" / "YYYY"), drawn from the exact date, the customer's own partial
   * DOB, or the reliable owner-DOB consensus across the customer's LINKED
   * POLICIES (never the policy insured). Null when nothing usable is on file.
   * Supplied by /api/customers/[id]/contact. The card's scoped full-DOB
   * exception; prefer this over formatting the stored columns directly so a
   * linked-policy partial DOB is also shown. */
  dob_display?: string | null
  /** Where `dob_display` came from: 'exact'/'customer_partial' stored on the
   * customer, 'linked_policy' derived from the customer's policies, 'none'. */
  dob_source?: 'exact' | 'customer_partial' | 'linked_policy' | 'none'
  /** True when `dob_display` is NOT a confirmed exact date on the customer (a
   * partial, or derived from linked policies), so it is labeled not-yet-
   * confirmed — mirroring the approximate-age treatment. */
  dob_approximate?: boolean
  /** The resolved DOB parts for seeding the editor (a partial/linked source has
   * a blank day). Numbers, or null when unknown. */
  dob_month?: number | null
  dob_day?: number | null
  dob_year?: number | null
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

/** The changed fields of a unified contact save. Every key is optional: the
 * card includes ONLY the facts the operator actually changed, so the route
 * applies a minimal update and the one recorded history entry names only real
 * changes. `email_availability` carries a selected "no usable email" reason;
 * `mark_undeliverable` requests recording a text-delivery failure for the number
 * on file (it is never cleared here — replacing the number clears it). */
export interface ContactUpdatePayload {
  first_name?: string | null
  last_name?: string | null
  email?: string | null
  phone?: string | null
  street?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  email_verified?: boolean
  phone_verified?: boolean
  address_verified?: boolean
  email_availability?: SelectableEmailAvailability
  do_not_text?: boolean
  mark_undeliverable?: boolean
  alert?: string | null
  /** Date of birth, sent as the three raw parts the operator entered. Any part
   * may be blank (unknown); the route normalizes them with the same rules the
   * form applies and stores an exact or partial DOB accordingly. Present only
   * when the DOB actually changed. */
  dob_month?: string
  dob_day?: string
  dob_year?: string
}

/** The request the card would send. Exposed so a host (or Storybook) can supply
 * its own persistence and still exercise the exact same payloads. */
export type ContactPersistPayload =
  // The unified save: every changed contact fact in one request. Only the keys
  // that changed are sent; the route applies them in one update and records one
  // "Customer Contact Updated" history entry. This is what the single Save on
  // the card sends.
  | ({ field: 'contact' } & ContactUpdatePayload)
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

// ── Public component (self-contained + legacy invocations) ───────────────────

/** The initial presentation mode of the self-contained card: the compact
 * read-only Overview, or the per-field editing + verification view. */
export type ContactCardMode = 'collapsed' | 'expanded'

/**
 * The props of the self-contained invocation: a page supplies ONLY the customer
 * identity and the initial display mode. The card fetches, displays, edits, and
 * saves ALL of the customer's contact information itself — name, calculated age,
 * email, phone, mailing address, verification, email availability, Do Not Text /
 * Text Undeliverable, and the customer alert — and owns the complete approved
 * collapsed and expanded layouts and the name+age identity header. A future
 * change to the card appears on every screen that uses it without touching the
 * page.
 */
interface SelfContainedProps {
  /** The ONLY data a page supplies: which customer to show. The card fetches the
   * rest from the shared /api/customers/[id]/contact endpoint. */
  customerId: string
  /** Initial display mode: the compact Overview ('collapsed') or the editing
   * view ('expanded'). Find Missing Contact Information and a reached guided call
   * open 'expanded'; every other surface opens 'collapsed'. The worker can
   * toggle in place afterward. Default 'collapsed'. */
  initialMode?: ContactCardMode
  className?: string
  /** Presentation-only overrides (Design Playground). Omit for the production
   * appearance. Never affects behavior, data, or persistence. */
  appearance?: ContactCardAppearance
  /** Optional: notified with the authoritative record after any successful write
   * (contact edit, verification, name correction, alert, texting change), so a
   * host can keep a surrounding view in sync WITHOUT owning the card's data.
   * Purely additive — the card persists and refreshes on its own regardless. */
  onChange?: (updated: CustomerContact) => void
  /** Optional: notified when the card switches between Overview and Edit. */
  onModeChange?: (mode: ContactCardMode) => void
  /** Optional: the live Next History Entry preview of the pending unified edit
   * while the editor is open (null when collapsed or nothing changed). Lets a
   * host render exactly what Save will record WITHOUT re-deriving any diff. */
  onPendingChange?: (preview: NextHistoryEntryPreview | null) => void
  /** Optional: notified whenever the card has work in flight that a host should
   * wait on before advancing — true while the editor holds unsaved changes OR a
   * save is in progress, false once Save or Cancel completes. The card owns this
   * determination (dirty-draft + busy) so hosts never re-derive it. */
  onPendingStateChange?: (pending: boolean) => void
  // Mutually exclusive with the legacy `customer` invocation.
  customer?: never
}

/** The legacy, host-assembled invocation: the host passes a fully resolved
 * `customer` record and optionally its own header/appearance. Preserved
 * unchanged so Storybook, the playgrounds, and any remaining host keep working
 * exactly as before. */
interface LegacyProps {
  customer: CustomerContact
  onChange?: (updated: CustomerContact) => void
  onPersist?: (customerId: string, payload: ContactPersistPayload) => Promise<CustomerContact>
  className?: string
  appearance?: ContactCardAppearance
  header?: ReactNode
  showName?: boolean
  showMentoring?: boolean
  collapsible?: boolean
  defaultExpanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
  alert?: string | null
  onAlertChange?: (next: string | null) => void
  alertEditable?: boolean
  customerId?: never
}

/**
 * CustomerContactCard — the single reusable customer-contact surface.
 *
 * SELF-CONTAINED (the standard for every workflow screen):
 *
 *   <CustomerContactCard customerId={id} initialMode="collapsed" />
 *
 * A page invokes the card with only a customer id and the initial display mode.
 * The card retrieves, displays, edits, and saves all of the customer's contact
 * information itself: name and calculated age; the complete approved collapsed
 * and expanded layouts; Edit Name (expanded only); email, phone, and mailing
 * address; all contact editing, normalization, and verification; email
 * availability and delivery failures; Do Not Text and Text Undeliverable;
 * customer alerts; and every contact-status indicator — all correct immediately
 * on open and consistent after each save. Pages no longer construct a heading,
 * retrieve age, assemble contact fields, or compute texting status, and a future
 * change to the card appears everywhere it is used without editing those pages.
 *
 * LEGACY (host-assembled): passing a resolved `customer` renders the same core
 * exactly as before. Used by Storybook/playgrounds and injectable persistence.
 */
export function CustomerContactCard(props: SelfContainedProps | LegacyProps) {
  if (props.customerId !== undefined) {
    return <SelfContainedContactCard {...(props as SelfContainedProps)} />
  }
  return <ContactCardView {...(props as LegacyProps)} />
}

/**
 * The self-contained card: fetch the customer by id, then render the shared view
 * with the resolved record and the name+age identity header the card now owns.
 * It is the ONE place the identity header is assembled, so every workflow screen
 * gets an identical heading (approved 33px bold teal name, calculated age
 * beneath it in both modes, Edit Name only in the expanded view) without the
 * page building one. The card persists through the shared route and refreshes
 * itself; `onChange` is optional sync for a surrounding view.
 */
function SelfContainedContactCard({
  customerId,
  initialMode = 'collapsed',
  className,
  appearance,
  onChange,
  onModeChange,
  onPendingChange,
  onPendingStateChange,
}: SelfContainedProps) {
  const [record, setRecord] = useState<CustomerContact | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  // Mirror the card's Overview/Edit state so the owned heading shows the Edit
  // Name control only in the expanded Edit view.
  const [expanded, setExpanded] = useState(initialMode === 'expanded')

  // Fetch the customer's own contact record (contact facts + resolved
  // text_undeliverable + calculated age) once per customer. The card is the
  // source of its own data; the page supplied only the id.
  useEffect(() => {
    let active = true
    setRecord(null)
    setLoadError(null)
    void (async () => {
      try {
        const res = await fetch(`/api/customers/${customerId}/contact`, { cache: 'no-store' })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'Could not load customer contact')
        if (active) setRecord(json.data as CustomerContact)
      } catch (e) {
        if (active) setLoadError(e instanceof Error ? e.message : 'Could not load customer contact')
      }
    })()
    return () => { active = false }
  }, [customerId])

  // Re-seed the mode if the page changes the initial mode for the SAME customer
  // (e.g. the calling workbench opening the card in edit the instant the
  // customer is reached), mirroring the view's own defaultExpanded behavior.
  useEffect(() => { setExpanded(initialMode === 'expanded') }, [initialMode])

  const handleChange = useCallback((updated: CustomerContact) => {
    // Preserve the derived age across writes: the PATCH responses carry the
    // contact facts and text_undeliverable but not the age, so keep the age the
    // GET resolved so the heading never drops it after an edit.
    setRecord((prev) => ({
      ...updated,
      age: updated.age ?? prev?.age ?? null,
      age_approximate: updated.age_approximate ?? prev?.age_approximate ?? false,
      // The resolved DOB display travels with every PATCH response now (so a
      // just-saved or just-promoted DOB shows at its true precision); keep the
      // prior resolution if a response ever omits it.
      dob_display: updated.dob_display ?? prev?.dob_display ?? null,
      dob_source: updated.dob_source ?? prev?.dob_source,
      dob_approximate: updated.dob_approximate ?? prev?.dob_approximate ?? false,
    }))
    onChange?.(updated)
  }, [onChange])

  const handleExpandedChange = useCallback((next: boolean) => {
    setExpanded(next)
    onModeChange?.(next ? 'expanded' : 'collapsed')
  }, [onModeChange])

  if (loadError) {
    return (
      <section className={cn('rounded-2xl border border-status-missing-border bg-status-missing-soft p-4 font-workflow', className)}>
        <p className="text-base text-status-missing-strong">{loadError}</p>
      </section>
    )
  }

  if (!record) {
    return (
      <section className={cn('flex items-center gap-2 rounded-2xl border border-surface-border bg-surface-card p-4 font-workflow', className)}>
        <Loader2 className="size-4 animate-spin text-ink-supporting" aria-hidden />
        <span className="text-base text-ink-supporting">Loading customer contact…</span>
      </section>
    )
  }

  return (
    <ContactCardView
      customer={record}
      className={className}
      appearance={appearance}
      // The card owns the identity header now: the uniform name + calculated age
      // heading with the Edit Name control shown only in the expanded view.
      showName={false}
      showMentoring={false}
      collapsible
      defaultExpanded={expanded}
      onExpandedChange={handleExpandedChange}
      // Customer alerts are a standard part of the self-contained card.
      alert={record.contact_alert ?? null}
      alertEditable
      onPendingChange={onPendingChange}
      onPendingStateChange={onPendingStateChange}
      header={
        <CustomerNameHeading
          customerId={record.id}
          firstName={record.first_name}
          lastName={record.last_name}
          className="text-[33px] font-bold leading-tight tracking-tight text-brand"
          // Name is corrected inside the one unified editor now, so the heading
          // never shows its own Edit name control (expanded=false hides it).
          expanded={false}
          age={record.age ?? null}
          ageApproximate={record.age_approximate === true}
          // Prefer the resolved best-available DOB (which includes a reliable
          // partial DOB consensus from the customer's LINKED POLICIES) over the
          // DOB stored directly on the row, falling back to the stored columns
          // if the resolver did not run. The card's scoped full-DOB exception.
          dob={record.dob_display ?? formatDobDisplay(record.date_of_birth, record.date_of_birth_approx)}
          dobApproximate={record.dob_approximate === true}
          onSaved={handleChange}
        />
      }
      onChange={handleChange}
    />
  )
}

// ── Component ──────────────────────────────────────────────────────────────

/**
 * The rendering core of the card. It takes a RESOLVED `customer` record and
 * owns display, editing, saving, verification, email availability, Do Not Text /
 * Text Undeliverable, and the alert — exactly as before. The public
 * `CustomerContactCard` below wraps it: in the self-contained mode it fetches
 * the customer by id and supplies this view with the resolved record plus the
 * name+age identity header; in the legacy mode it passes through unchanged.
 */
function ContactCardView({
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
  onPendingChange,
  onPendingStateChange,
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
   * the card header. Omit it and the card has no header slot. */
  header?: ReactNode
  /** Render the customer name as the card heading. Default true. Set false so a
   * host can own a single name heading elsewhere. */
  showName?: boolean
  /** Render the inline mentoring control beside the name. Default true. */
  showMentoring?: boolean
  /** Opt into the two-mode Overview/Edit presentation. Default false. When true,
   * the card shows a compact READ-ONLY overview with a single Edit button that
   * opens the one unified editor. When false the unified editor is always open
   * (the legacy always-editing surface). */
  collapsible?: boolean
  /** When `collapsible`, whether the card starts expanded (Edit) or collapsed
   * (Overview). Default true. Ignored when not collapsible. */
  defaultExpanded?: boolean
  /** Notified when the collapsible card switches between Overview and Edit. */
  onExpandedChange?: (expanded: boolean) => void
  /** The customer's single current alert text, or null/empty when there is no
   * alert. Opt-in — omit `alertEditable` and the card shows no alert affordance. */
  alert?: string | null
  /** Optional notification after the alert is saved/cleared, with the new text. */
  onAlertChange?: (next: string | null) => void
  /** Enable the alert feature (banner in Overview + Add Alert inside the editor). */
  alertEditable?: boolean
  /** Report the live Next History Entry preview of the pending edit while the
   * editor is open (null when collapsed or when nothing has changed), so a host
   * can show what the single Save will record WITHOUT re-deriving the diff. */
  onPendingChange?: (preview: NextHistoryEntryPreview | null) => void
  /** Report whether the card currently has work a host should wait on before
   * advancing: true while the editor holds unsaved changes OR a save is running,
   * false once Save or Cancel settles. Combines the editor's own dirty-draft
   * signal with the card's busy flag, so a host never re-derives either. */
  onPendingStateChange?: (pending: boolean) => void
}) {
  const ap = useMemo(() => resolveAppearance(appearance), [appearance])
  // The card holds the current record locally so the display updates the instant
  // a write returns, without the host round-tripping a reload.
  const [record, setRecord] = useState<CustomerContact>(customer)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Whether the open editor currently holds a non-empty pending change. Reported
  // up from the editor (which already builds the minimal changed-fact payload),
  // so the card does not re-derive dirtiness. False whenever the editor is not
  // open. Combined with `busy` into the single onPendingStateChange signal.
  const [editorDirty, setEditorDirty] = useState(false)
  // Bumped to force the unified editor to remount with fresh drafts after a save
  // or a legacy (non-collapsible) Cancel.
  const [editorKey, setEditorKey] = useState(0)
  // Overview (collapsed) vs the one unified Editor (expanded). Only meaningful
  // when `collapsible`; a non-collapsible card is always "expanded" (the legacy
  // always-editing surface).
  const [expanded, setExpanded] = useState(defaultExpanded)
  // Re-seed the Overview/Edit state when the host's default changes, mirroring
  // MentorGuidance: a host that drives `defaultExpanded` from live state (e.g.
  // the calling workbench opening the card in edit mode the instant the customer
  // is reached) sees the card follow. Callers passing a constant `defaultExpanded`
  // (every existing one) are unaffected, since the value never changes. A worker
  // can still toggle Overview/Edit in between; only a new default re-seeds it.
  useEffect(() => { setExpanded(defaultExpanded) }, [defaultExpanded])
  const isExpanded = !collapsible || expanded

  // When the editor is not open there can be no pending draft; keep the dirty
  // flag honest so a collapsed Overview never reports unsaved changes.
  useEffect(() => { if (!isExpanded) setEditorDirty(false) }, [isExpanded])

  // The single pending signal a host waits on: unsaved draft OR a save in
  // flight. Emitted whenever either input changes, so buttons re-enable the
  // moment Save or Cancel settles.
  useEffect(() => {
    onPendingStateChange?.(editorDirty || busy)
  }, [editorDirty, busy, onPendingStateChange])
  // The current alert value: the controlled `alert` prop when a host manages it,
  // else the durable customers.contact_alert on the record. Shown as a banner in
  // Overview; edited inside the one unified editor.
  const alertText = (alert !== undefined ? alert : record.contact_alert)?.trim()
    ? (alert !== undefined ? alert : record.contact_alert)
    : null

  const setExpandedState = useCallback((next: boolean) => {
    setError(null)
    setExpanded(next)
    // Leaving the editor clears any live pending-change preview.
    if (!next) onPendingChange?.(null)
    onExpandedChange?.(next)
  }, [onExpandedChange, onPendingChange])

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

  // The ONE save. The unified editor hands up every changed fact in a single
  // payload; this persists it in one request (the combined `field: 'contact'`
  // route branch, or the injected onPersist) that records exactly one "Customer
  // Contact Updated" history entry, applies the authoritative returned record,
  // notifies the host, and returns the card to the compact Overview. An empty
  // payload (nothing changed) short-circuits to collapsed with no write, so no
  // history is recorded for a no-op. Cancel never reaches here.
  const saveUnified = useCallback(async (payload: ContactUpdatePayload) => {
    if (Object.keys(payload).length === 0) {
      setExpandedState(false)
      return
    }
    setBusy(true); setError(null)
    try {
      const updated = await persist({ field: 'contact', ...payload })
      setRecord(updated)
      setEditorKey((k) => k + 1)
      onChange?.(updated)
      onAlertChange?.(updated.contact_alert ?? null)
      setExpandedState(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }, [persist, onChange, onAlertChange, setExpandedState])

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
          content (the name + age heading). The single Edit affordance lives in
          the Overview's bottom bar and the Save / Cancel in the editor, so the
          header is pure identity with no control. */}
      {header != null && (
        <div className="min-w-0">{header}</div>
      )}

      {/* The customer alert banner near the top, shown in the compact Overview
          whenever an alert exists. In the editor the alert is one of the fields,
          so the banner is not shown there. */}
      {alertText && !isExpanded && <AlertBanner text={alertText} />}

      {/* The customer's name heading (read-only here). Name is corrected inside
          the one unified editor, so the heading never carries its own Edit name
          control. `showName` / `showMentoring` let a host suppress either. */}
      {showName && (
        <ContactMentoring
          appearance={ap}
          name={fullName(record)}
          showMentoring={showMentoring}
        />
      )}

      {error && (
        <p className="mt-3 rounded-lg border border-status-missing-border bg-status-missing-soft px-3 py-2 text-base text-status-missing-strong">
          {error}
        </p>
      )}

      {isExpanded ? (
        /* The ONE unified editor: every contact fact edited together, with a
           single Save and a single Cancel at the bottom. All edits are pending
           until Save; Cancel discards everything. */
        <UnifiedContactEditor
          // Remount (fresh drafts seeded from the record) whenever the record
          // changes after a save, or when Cancel is used on a non-collapsible
          // card that has no Overview to fall back to.
          key={`${record.id}:${editorKey}`}
          record={record}
          busy={busy}
          alertEditable={alertEditable}
          onSave={saveUnified}
          onCancel={() => {
            onPendingChange?.(null)
            setEditorDirty(false)
            if (collapsible) setExpandedState(false)
            else { setError(null); setEditorKey((k) => k + 1) }
          }}
          onPendingChange={onPendingChange}
          onDirtyChange={setEditorDirty}
        />
      ) : (
        <>
          {/* Overview mode — a compact, read-only summary of the same three
              fields, reusing the status tones and value rendering. One Edit
              button opens the unified editor. */}
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
              the green/amber/red icons above read clearly, and the single Edit
              button on the right that opens the unified editor. */}
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-surface-border-strong pt-2.5">
            <ContactStatusKey appearance={ap} inline />
            {collapsible && (
              <ModeToggleButton
                label="Edit"
                icon={Pencil}
                onClick={() => setExpandedState(true)}
              />
            )}
          </div>
        </>
      )}
    </section>
  )
}

// ── The one unified editor ───────────────────────────────────────────────────

/**
 * The single editing experience for the whole card. It opens with every durable
 * contact fact — name, email (+ availability reason), phone (+ Do Not Text /
 * Text Undeliverable), mailing address, the three Customer Verified checkboxes,
 * and the customer alert — all editable together, with compact, consistently
 * divided sections and ONE Save + ONE Cancel at the bottom. There are no
 * per-field Edit/Save/Cancel controls.
 *
 * Every change is LOCAL pending state until Save. Save builds a minimal payload
 * of only the facts that actually changed and hands it up (`onSave`); Cancel
 * discards everything. Normalization and validation reuse the shared
 * contact-input utilities, so the same rules the server enforces are enforced
 * here and an invalid changed value blocks Save. While the editor is open it
 * reports a live Next History Entry preview of the pending change up through
 * `onPendingChange`, so the history column shows exactly what Save will record.
 */
function UnifiedContactEditor({
  record, busy, alertEditable, onSave, onCancel, onPendingChange, onDirtyChange,
}: {
  record: CustomerContact
  busy: boolean
  alertEditable: boolean
  onSave: (payload: ContactUpdatePayload) => void
  onCancel: () => void
  onPendingChange?: (preview: NextHistoryEntryPreview | null) => void
  /** Report whether the current drafts differ from the record — true when the
   * minimal changed-fact payload is non-empty. The host card lifts this into the
   * single pending signal it exposes; the editor already builds this payload for
   * the live preview, so dirtiness is reported from the same place. */
  onDirtyChange?: (dirty: boolean) => void
}) {
  // ── Drafts, seeded from the current record (display-normalized where the
  // read view shows a normalized value, so the operator edits what they saw). ──
  const [first, setFirst] = useState(record.first_name ?? '')
  const [last, setLast] = useState(record.last_name ?? '')
  const [email, setEmail] = useState(record.email ?? '')
  const [emailResult, setEmailResult] = useState<ContactFieldResult | null>(null)
  // A staged "no usable email" reason selected in this session; mutually
  // exclusive with a typed email, exactly like the former per-field editor.
  const [emailReason, setEmailReason] = useState<SelectableEmailAvailability | null>(null)
  const [phone, setPhone] = useState(formatPhoneAsTyped(record.phone ?? ''))
  const [phoneResult, setPhoneResult] = useState<ContactFieldResult | null>(null)
  const [doNotText, setDoNotText] = useState(record.sms_opt_out === true)
  const [markUndeliverable, setMarkUndeliverable] = useState(
    record.text_undeliverable === true && !!record.phone?.trim(),
  )
  const [street, setStreet] = useState(streetDisplay(record))
  const [city, setCity] = useState(normalizeCity(record.city) ?? '')
  const [stateVal, setStateVal] = useState(normalizeState(record.state) ?? '')
  const [zip, setZip] = useState(record.zip ?? '')
  // Verified reflects the value that will be on file. An edited value clears its
  // own verification; the checkbox follows that below.
  const [emailVerified, setEmailVerified] = useState(!!record.email_verified_at)
  const [phoneVerified, setPhoneVerified] = useState(!!record.phone_verified_at)
  const [addressVerified, setAddressVerified] = useState(!!record.address_verified_at)
  const [alertDraft, setAlertDraft] = useState(record.contact_alert ?? '')
  // DOB drafts — three independent parts, seeded from the stored exact or
  // partial DOB. A partial DOB yields a BLANK day (the day was never stored, so
  // it stays unknown). Edited freely; the route re-normalizes with the same
  // rules on save.
  // Seed from the RESOLVED best-available DOB when present (which may be a
  // reliable month/year consensus from the customer's linked policies), so the
  // operator confirms and saves that onto the customer rather than starting
  // blank; otherwise seed from the DOB stored directly on the row. A partial or
  // linked source carries a blank day — the day was never known, so it stays
  // unknown and the downgrade guard still protects any stored exact date.
  const seededDob = record.dob_year != null
    ? {
        month: record.dob_month == null ? '' : String(record.dob_month),
        day: record.dob_day == null ? '' : String(record.dob_day),
        year: String(record.dob_year),
      }
    : dobToParts(record.date_of_birth, record.date_of_birth_approx)
  const [dobMonth, setDobMonth] = useState(seededDob.month)
  const [dobDay, setDobDay] = useState(seededDob.day)
  const [dobYear, setDobYear] = useState(seededDob.year)
  // The live normalization of the DOB drafts, for the inline validity message
  // and to block Save on an invalid changed DOB.
  const dobResult = normalizeDobParts({ month: dobMonth, day: dobDay, year: dobYear })
  // A known EXACT DOB must never be silently downgraded to partial info: if the
  // record holds a full date and the draft would store a partial one, Save is
  // blocked with an explicit message rather than quietly dropping the day.
  const dobWouldDowngrade = wouldDowngradeExactDob(
    { date_of_birth: record.date_of_birth ?? null, date_of_birth_approx: record.date_of_birth_approx ?? null },
    dobResult,
  )

  // The number that WILL be on file after Save, so the texting controls and the
  // address verifiability reflect the pending state, not the stored one.
  const stagedPhone = normalizePhoneInput(phone)
  const willHaveNumber = stagedPhone.status !== 'empty' && stagedPhone.status !== 'invalid'
  const numberUnchanged =
    (stagedPhone.value ?? null) === (record.phone ? (normalizePhoneInput(record.phone).value ?? null) : null)
  // Text Undeliverable clears only by replacing the number, so when the number
  // is unchanged and already undeliverable the control is locked on.
  const lockedUndeliverable = record.text_undeliverable === true && !!record.phone?.trim() && numberUnchanged && willHaveNumber

  // Build the minimal payload of ONLY changed facts, plus the before/after
  // snapshots for the live preview. Verification reflects the value that will be
  // on file: an edited value clears its own verification first, then an explicit
  // check re-affirms it. A staged email reason clears the active email.
  const buildChange = useCallback((): { payload: ContactUpdatePayload; after: ContactSnapshot; before: ContactSnapshot } => {
    const payload: ContactUpdatePayload = {}

    const nf = normalizeNameInput(first).value
    const nl = normalizeNameInput(last).value
    if ((nf ?? null) !== (record.first_name ?? null)) payload.first_name = nf
    if ((nl ?? null) !== (record.last_name ?? null)) payload.last_name = nl

    // DOB: normalize the three parts the same way the route will. The masked
    // form is the stable identity of the DOB (day never compared), so a change
    // in the normalized columns is what we send and preview. An invalid DOB
    // contributes no change here (Save is blocked separately on it). Normalized
    // locally from the drafts so this callback's deps fully cover it.
    const dobNorm = normalizeDobParts({ month: dobMonth, day: dobDay, year: dobYear })
    // A downgrade (exact -> partial) is never applied: keep the stored value and
    // emit no DOB change, so the preview and payload don't reflect a loss the
    // Save guard rejects.
    const dobDowngrade = wouldDowngradeExactDob(
      { date_of_birth: record.date_of_birth ?? null, date_of_birth_approx: record.date_of_birth_approx ?? null },
      dobNorm,
    )
    const nextDob = (dobNorm.status === 'invalid' || dobDowngrade)
      ? { date_of_birth: record.date_of_birth ?? null, date_of_birth_approx: record.date_of_birth_approx ?? null }
      : { date_of_birth: dobNorm.date_of_birth, date_of_birth_approx: dobNorm.date_of_birth_approx }
    const dobDidChange =
      dobNorm.status !== 'invalid' && !dobDowngrade &&
      ((nextDob.date_of_birth ?? null) !== (record.date_of_birth ?? null) ||
        (nextDob.date_of_birth_approx ?? null) !== (record.date_of_birth_approx ?? null))
    if (dobDidChange) {
      payload.dob_month = dobMonth
      payload.dob_day = dobDay
      payload.dob_year = dobYear
    }

    // Email: a staged reason wins (clears the email); else the typed value.
    let nextEmail: string | null = record.email
    let nextAvailability = (record.email_availability ?? null)
    if (emailReason) {
      payload.email_availability = emailReason
      nextEmail = null
      nextAvailability = emailReason === 'missing' ? null : emailReason
    } else {
      const er = normalizeEmailInput(email)
      if (er.status !== 'invalid' && (er.value ?? null) !== (record.email ?? null)) {
        payload.email = er.value
        nextEmail = er.value ?? null
        if (er.value) nextAvailability = 'available'
      }
    }

    const pr = normalizePhoneInput(phone)
    let nextPhone: string | null = record.phone
    if (pr.status !== 'invalid' && (pr.value ?? null) !== (record.phone ?? null)) {
      payload.phone = pr.value
      nextPhone = pr.value ?? null
    }

    const ns = normalizeStreet(street)
    const nc = normalizeCity(city)
    const nst = normalizeState(stateVal)
    const nz = ((): string | null => { const t = zip.replace(/\s+/g, ' ').trim(); return t.length ? t : null })()
    const beforeStreet = (record.street ?? record.address_line1 ?? '').trim() || null
    const addrChanged =
      (ns ?? null) !== (beforeStreet ?? null) ||
      (nc ?? null) !== (record.city ?? null) ||
      (nst ?? null) !== (record.state ?? null) ||
      (nz ?? null) !== (record.zip ?? null)
    if (addrChanged) {
      payload.street = ns; payload.city = nc; payload.state = nst; payload.zip = nz
    }

    // Do Not Text / Text Undeliverable.
    if (doNotText !== (record.sms_opt_out === true)) payload.do_not_text = doNotText
    const willMarkUndeliverable =
      markUndeliverable && willHaveNumber && !lockedUndeliverable &&
      !((numberUnchanged) && record.text_undeliverable === true)
    if (willMarkUndeliverable) payload.mark_undeliverable = true

    // Alert.
    const nextAlert = alertDraft.trim().length ? alertDraft.trim() : null
    if ((nextAlert ?? null) !== ((record.contact_alert ?? '').trim() ? record.contact_alert : null)) {
      payload.alert = nextAlert
    }

    // Verification: compare the desired state against the value that will be on
    // file, accounting for the auto-clear a changed value triggers.
    const emailEdited = payload.email !== undefined || payload.email_availability !== undefined
    const phoneEdited = payload.phone !== undefined
    const addrEdited = payload.street !== undefined
    const emailUsableAfter = !!(nextEmail && nextEmail.trim())
    const phoneUsableAfter = !!(nextPhone && nextPhone.trim())
    const addrUsableAfter = !!(ns && nc && nst && nz)
    const emailVerifiedAfter = emailEdited ? false : !!record.email_verified_at
    const phoneVerifiedAfter = phoneEdited ? false : !!record.phone_verified_at
    const addrVerifiedAfter = addrEdited ? false : !!record.address_verified_at
    const wantEmailVerified = emailVerified && emailUsableAfter
    const wantPhoneVerified = phoneVerified && phoneUsableAfter
    const wantAddrVerified = addressVerified && addrUsableAfter
    if (wantEmailVerified !== emailVerifiedAfter) payload.email_verified = wantEmailVerified
    if (wantPhoneVerified !== phoneVerifiedAfter) payload.phone_verified = wantPhoneVerified
    if (wantAddrVerified !== addrVerifiedAfter) payload.address_verified = wantAddrVerified

    const toSnapshot = (): ContactSnapshot => ({
      first_name: record.first_name,
      last_name: record.last_name,
      email: record.email,
      phone: record.phone,
      street: beforeStreet,
      city: record.city,
      state: record.state,
      zip: record.zip,
      email_verified_at: record.email_verified_at,
      phone_verified_at: record.phone_verified_at,
      address_verified_at: record.address_verified_at,
      email_availability: record.email_availability ?? null,
      sms_opt_out: record.sms_opt_out === true,
      date_of_birth: record.date_of_birth ?? null,
      date_of_birth_approx: record.date_of_birth_approx ?? null,
      text_undeliverable: record.text_undeliverable === true && !!record.phone?.trim(),
      contact_alert: record.contact_alert ?? null,
    })
    const before = toSnapshot()
    const after: ContactSnapshot = {
      first_name: nf,
      last_name: nl,
      email: nextEmail,
      phone: nextPhone,
      street: ns,
      city: nc,
      state: nst,
      zip: nz,
      email_verified_at: wantEmailVerified ? (record.email_verified_at ?? 'pending') : null,
      phone_verified_at: wantPhoneVerified ? (record.phone_verified_at ?? 'pending') : null,
      address_verified_at: wantAddrVerified ? (record.address_verified_at ?? 'pending') : null,
      email_availability: nextAvailability,
      sms_opt_out: doNotText,
      date_of_birth: nextDob.date_of_birth,
      date_of_birth_approx: nextDob.date_of_birth_approx,
      text_undeliverable: willMarkUndeliverable || (numberUnchanged && record.text_undeliverable === true && willHaveNumber),
      contact_alert: nextAlert,
    }
    return { payload, before, after }
  }, [
    first, last, email, emailReason, phone, doNotText, markUndeliverable,
    street, city, stateVal, zip, emailVerified, phoneVerified, addressVerified,
    alertDraft, dobMonth, dobDay, dobYear,
    willHaveNumber, lockedUndeliverable, numberUnchanged, record,
  ])

  // Report the live preview of the pending change AND whether the drafts are
  // dirty (a non-empty changed-fact payload) up as drafts change. Both come from
  // the one buildChange() the editor already runs, so neither the preview nor
  // dirtiness is derived twice.
  useEffect(() => {
    const { payload, before, after } = buildChange()
    onPendingChange?.(describeContactUpdate(before, after))
    onDirtyChange?.(Object.keys(payload).length > 0)
  }, [buildChange, onPendingChange, onDirtyChange])

  // On unmount (Save collapses the editor, or the customer changes), the editor
  // no longer holds a draft; make sure the host's dirty flag does not stay stuck
  // on from the last render.
  useEffect(() => () => { onDirtyChange?.(false) }, [onDirtyChange])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    // Block Save on an invalid typed value (unless the email is being replaced
    // by a staged reason). Validation mirrors the server, so bad formatting
    // cannot slip through.
    if (!emailReason) {
      const er = normalizeEmailInput(email)
      if (er.status === 'invalid') { setEmailResult(er); return }
    }
    const pr = normalizePhoneInput(phone)
    if (pr.status === 'invalid') { setPhoneResult(pr); return }
    const nf = normalizeNameInput(first)
    const nl = normalizeNameInput(last)
    if (nf.status === 'empty' && nl.status === 'empty') { return }
    // Block Save on an invalid DOB, or on a downgrade of a known exact DOB to
    // partial info (same guards the route enforces).
    if (dobResult.status === 'invalid') { return }
    if (dobWouldDowngrade) { return }
    onSave(buildChange().payload)
  }

  const selectReason = (choice: SelectableEmailAvailability) => {
    setEmailResult(null)
    setEmailReason((prev) => {
      const next = prev === choice ? null : choice
      setEmail(next ? '' : (record.email ?? ''))
      if (next) setEmailVerified(false)
      return next
    })
  }

  const nameInvalid =
    normalizeNameInput(first).status === 'empty' && normalizeNameInput(last).status === 'empty'

  const draftSmsDisplay: SmsAvailabilityDisplay = resolveSmsAvailabilityDisplay({
    smsOptOut: doNotText,
    textUndeliverable: markUndeliverable && willHaveNumber,
  })

  return (
    <form onSubmit={submit} className="mt-3">
      <div className="divide-y divide-surface-border-strong">
        {/* Name */}
        <div className="py-3 first:pt-0">
          <p className="flex items-center gap-1.5 text-base font-semibold text-ink-secondary">
            <Pencil className="size-4" aria-hidden /> Name
          </p>
          <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <label htmlFor="uc-first" className="text-sm font-medium text-ink-secondary">First name</label>
              <input id="uc-first" type="text" value={first} disabled={busy}
                onChange={(e) => setFirst(e.target.value)}
                onBlur={() => setFirst((v) => normalizeNameInput(v).value ?? '')}
                placeholder="First name" className={cn('mt-1', inputCls(false))} />
            </div>
            <div>
              <label htmlFor="uc-last" className="text-sm font-medium text-ink-secondary">Last name</label>
              <input id="uc-last" type="text" value={last} disabled={busy}
                onChange={(e) => setLast(e.target.value)}
                onBlur={() => setLast((v) => normalizeNameInput(v).value ?? '')}
                placeholder="Last name" className={cn('mt-1', inputCls(false))} />
            </div>
          </div>
          {nameInvalid && (
            <p className="mt-1.5 text-base text-status-missing-strong">Enter at least a first or last name.</p>
          )}
        </div>

        {/* Date of birth — separate month / day / year; leave unknown parts
            blank. A year with a blank day is kept as a partial DOB; a full
            month+day+year is kept exact. A known exact DOB cannot be downgraded
            to partial info. */}
        <div className="py-3">
          <p className="flex items-center gap-1.5 text-base font-semibold text-ink-secondary">
            <Pencil className="size-4" aria-hidden /> Date of birth
          </p>
          <div className="mt-1.5 grid grid-cols-3 gap-2 sm:max-w-xs">
            <div>
              <label htmlFor="uc-dob-month" className="text-sm font-medium text-ink-secondary">Month</label>
              <input id="uc-dob-month" type="text" inputMode="numeric" value={dobMonth} disabled={busy}
                maxLength={2} onChange={(e) => setDobMonth(e.target.value.replace(/\D/g, '').slice(0, 2))}
                placeholder="MM" className={cn('mt-1', inputCls(false))} />
            </div>
            <div>
              <label htmlFor="uc-dob-day" className="text-sm font-medium text-ink-secondary">Day</label>
              <input id="uc-dob-day" type="text" inputMode="numeric" value={dobDay} disabled={busy}
                maxLength={2} onChange={(e) => setDobDay(e.target.value.replace(/\D/g, '').slice(0, 2))}
                placeholder="DD" className={cn('mt-1', inputCls(false))} />
            </div>
            <div>
              <label htmlFor="uc-dob-year" className="text-sm font-medium text-ink-secondary">Year</label>
              <input id="uc-dob-year" type="text" inputMode="numeric" value={dobYear} disabled={busy}
                maxLength={4} onChange={(e) => setDobYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="YYYY" className={cn('mt-1', inputCls(dobResult.status === 'invalid'))} />
            </div>
          </div>
          {dobResult.status === 'invalid' && (
            <p className="mt-1.5 text-base text-status-missing-strong">{dobResult.reason}</p>
          )}
          {dobResult.status !== 'invalid' && dobWouldDowngrade && (
            <p className="mt-1.5 text-base text-status-missing-strong">
              A full date of birth is already on file. Enter the complete date to correct it, or leave it unchanged — it can&rsquo;t be replaced with a partial date.
            </p>
          )}
          <p className="mt-1.5 text-sm text-ink-muted">Leave the day (or month) blank if only part of the date is known.</p>
        </div>

        {/* Email + availability + verification */}
        <div className="py-3">
          <label htmlFor="uc-email" className="flex items-center gap-1.5 text-base font-semibold text-ink-secondary">
            <Mail className="size-4" aria-hidden /> Email
          </label>
          <input id="uc-email" type="email" value={email} disabled={busy || !!emailReason}
            onChange={(e) => { setEmail(e.target.value); if (emailResult) setEmailResult(null) }}
            onBlur={() => { if (!emailReason) setEmailResult(normalizeEmailInput(email)) }}
            placeholder={emailReason ? EMAIL_AVAILABILITY_LABEL[emailReason] : 'name@example.com'}
            aria-invalid={emailResult?.status === 'invalid' || undefined}
            className={cn('mt-1.5', inputCls(emailResult?.status === 'invalid'), emailReason && 'opacity-50')} />
          {emailResult?.status === 'invalid' && emailResult.reason && (
            <p className="mt-1.5 text-base text-status-missing-strong">{emailResult.reason}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            {SELECTABLE_EMAIL_AVAILABILITY_VALUES.map((choice) => {
              const selected = emailReason === choice
              return (
                <button key={choice} type="button" disabled={busy} aria-pressed={selected}
                  onClick={() => selectReason(choice)}
                  className={cn(
                    'inline-flex items-center rounded-lg border px-2.5 py-1 text-sm font-medium disabled:opacity-60',
                    selected
                      ? 'border-status-missing-border bg-status-missing-soft text-status-missing-strong'
                      : 'border-surface-border-strong bg-surface-card text-ink-secondary hover:bg-surface-muted',
                  )}>
                  {EMAIL_AVAILABILITY_LABEL[choice]}
                </button>
              )
            })}
          </div>
          <div className="mt-2">
            <VerifiedToggle label="Email verified" checked={emailVerified}
              disabled={busy || !!emailReason || !normalizeEmailInput(email).value}
              onChange={setEmailVerified} />
          </div>
        </div>

        {/* Phone + texting restrictions + verification */}
        <div className="py-3">
          <label htmlFor="uc-phone" className="flex items-center gap-1.5 text-base font-semibold text-ink-secondary">
            <Phone className="size-4" aria-hidden /> Phone
          </label>
          <input id="uc-phone" type="tel" value={phone} disabled={busy}
            onChange={(e) => { setPhone(formatPhoneAsTyped(e.target.value)); if (phoneResult) setPhoneResult(null) }}
            onBlur={() => setPhoneResult(normalizePhoneInput(phone))}
            placeholder="(215) 555-0100" aria-invalid={phoneResult?.status === 'invalid' || undefined}
            className={cn('mt-1.5', inputCls(phoneResult?.status === 'invalid'))} />
          {phoneResult?.status === 'invalid' && phoneResult.reason && (
            <p className="mt-1.5 text-base text-status-missing-strong">{phoneResult.reason}</p>
          )}
          <SmsAvailabilityControls
            display={draftSmsDisplay}
            hasNumber={willHaveNumber}
            doNotText={doNotText}
            undeliverable={markUndeliverable && willHaveNumber}
            lockedUndeliverable={lockedUndeliverable}
            busy={busy}
            onToggleDoNotText={() => setDoNotText((v) => !v)}
            onToggleUndeliverable={() => { if (!lockedUndeliverable) setMarkUndeliverable((v) => !v) }}
          />
          <div className="mt-2">
            <VerifiedToggle label="Phone verified" checked={phoneVerified}
              disabled={busy || !normalizePhoneInput(phone).value}
              onChange={setPhoneVerified} />
          </div>
        </div>

        {/* Mailing address + verification */}
        <div className="py-3 last:pb-0">
          <p className="flex items-center gap-1.5 text-base font-semibold text-ink-secondary">
            <MapPin className="size-4" aria-hidden /> Mailing Address
          </p>
          <div className="mt-1.5 space-y-2">
            <div>
              <label htmlFor="uc-street" className="text-sm font-medium uppercase tracking-wide text-ink-supporting">Street</label>
              <input id="uc-street" value={street} disabled={busy} onChange={(e) => setStreet(e.target.value)}
                onBlur={() => setStreet((v) => normalizeStreet(v) ?? '')}
                placeholder="123 Main St" className={cn('mt-1', inputCls(false))} />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label htmlFor="uc-city" className="text-sm font-medium uppercase tracking-wide text-ink-supporting">City</label>
                <input id="uc-city" value={city} disabled={busy} onChange={(e) => setCity(e.target.value)}
                  onBlur={() => setCity((v) => normalizeCity(v) ?? '')}
                  placeholder="Philadelphia" className={cn('mt-1', inputCls(false))} />
              </div>
              <div className="w-16">
                <label htmlFor="uc-state" className="text-sm font-medium uppercase tracking-wide text-ink-supporting">State</label>
                <input id="uc-state" value={stateVal} disabled={busy} onChange={(e) => setStateVal(e.target.value.toUpperCase())}
                  maxLength={2} placeholder="PA" className={cn('mt-1 uppercase', inputCls(false))} />
              </div>
              <div className="w-24">
                <label htmlFor="uc-zip" className="text-sm font-medium uppercase tracking-wide text-ink-supporting">ZIP</label>
                <input id="uc-zip" value={zip} disabled={busy} onChange={(e) => setZip(e.target.value)}
                  placeholder="19103" className={cn('mt-1', inputCls(false))} />
              </div>
            </div>
          </div>
          <div className="mt-2">
            <VerifiedToggle label="Address verified"
              checked={addressVerified}
              disabled={busy || !(normalizeStreet(street) && normalizeCity(city) && normalizeState(stateVal) && zip.trim())}
              onChange={setAddressVerified} />
          </div>
        </div>

        {/* Customer alert — part of the one editing area. */}
        {alertEditable && (
          <div className="py-3">
            <label htmlFor="uc-alert" className="flex items-center gap-1.5 text-base font-semibold text-status-known-strong">
              <AlertTriangle className="size-4" aria-hidden /> Customer alert
            </label>
            <textarea id="uc-alert" rows={2} value={alertDraft} disabled={busy}
              onChange={(e) => setAlertDraft(e.target.value)}
              placeholder="Add a short alert shown at the top of this customer's card."
              className="mt-1.5 w-full rounded-lg border border-surface-border-strong px-3 py-2 text-base text-ink focus:border-brand-ring focus:outline-none focus:ring-2 focus:ring-brand-wash disabled:opacity-50" />
          </div>
        )}
      </div>

      {/* One Save and one Cancel at the bottom of the whole editor. */}
      <div className="mt-3 flex items-center gap-2 border-t border-surface-border-strong pt-3">
        <button type="submit" disabled={busy || nameInvalid}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-base font-semibold text-brand-foreground hover:bg-brand-hover disabled:opacity-50">
          {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
          Save
        </button>
        <button type="button" onClick={onCancel} disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-surface-border-strong bg-surface-card px-3 py-1.5 text-base font-medium text-ink-secondary hover:bg-surface-muted disabled:opacity-40">
          <X className="size-3.5" aria-hidden /> Cancel
        </button>
      </div>
    </form>
  )
}

/** A compact Customer Verified checkbox used inside the unified editor. */
function VerifiedToggle({
  label, checked, disabled, onChange,
}: {
  label: string
  checked: boolean
  disabled: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label
      className={cn(
        'flex w-fit items-center gap-2 text-base font-medium',
        disabled ? 'cursor-not-allowed text-ink-muted' : 'cursor-pointer text-ink-secondary',
      )}
      title={disabled ? 'A missing or unusable value cannot be marked verified.' : undefined}
    >
      <input type="checkbox" checked={checked} disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 rounded border-slate-400 text-teal-600 focus:ring-teal-500 disabled:opacity-40" />
      <span>{label}</span>
    </label>
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
  dob = null,
  dobApproximate = false,
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
  /** The customer's date of birth, ALREADY FORMATTED for display by the caller
   * ("MM/DD/YYYY" when the exact date is known, "MM/YYYY" or "YYYY" when only
   * those parts are known). Shown beneath the name alongside age. Null omits it.
   * This is the shared card's scoped exception to the DOB-masking rule (it shows
   * the day when known); see AGENTS.md and src/lib/stewardship/dob.ts. */
  dob?: string | null
  /** True when `dob` is NOT a confirmed exact date stored on the customer (a
   * partial, or one derived from the customer's linked policies), so it is
   * labeled "(unconfirmed)" — the operator can open Edit to confirm and save it
   * onto the customer. Mirrors the approximate-age treatment. */
  dobApproximate?: boolean
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

  // The DOB + age line beneath the name, shown uniformly in both modes. The DOB
  // is shown MASKED (the day is never rendered) alongside the calculated age; an
  // approximate age (from the masked policy fallback or a partial DOB) is marked
  // "~N (approx.)" with a clarifying tooltip. Each part is omitted when unknown,
  // never guessed. Shared by both the editing and read states so every workflow
  // screen reads identically.
  const ageSubline = (dob || age != null) ? (
    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-base font-medium text-ink-supporting">
      {dob && (
        <span title={dobApproximate ? 'Partial or derived from linked records — open Edit to confirm' : undefined}>
          DOB <span className="font-mono text-ink-secondary">{dob}</span>
          {dobApproximate && <span className="ml-1 text-ink-muted">(unconfirmed)</span>}
        </span>
      )}
      {dob && age != null && <span aria-hidden className="text-ink-muted">·</span>}
      {age != null && (
        <span title={ageApproximate ? 'Approximate age, estimated from available records' : undefined}>
          Age {ageApproximate ? `~${age}` : age}
          {ageApproximate && <span className="ml-1 text-ink-muted">(approx.)</span>}
        </span>
      )}
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
/**
 * The single control that opens the unified editor from the compact Overview.
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

const inputCls = (invalid: boolean) =>
  cn(
    'w-full rounded-lg border px-3 py-2 text-lg text-ink focus:outline-none focus:ring-2',
    invalid
      ? 'border-status-missing-border focus:border-status-missing-border focus:ring-status-missing-soft'
      : 'border-surface-border-strong focus:border-brand-ring focus:ring-brand-wash',
  )

// ── Phone texting-availability controls (used by the unified editor) ─────────

/** The Text-message availability controls inside the phone section. Two
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


