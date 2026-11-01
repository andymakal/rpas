/**
 * Person name — the single source of truth for how a customer's name is
 * normalized, validated, and presented across Right Path.
 *
 * A person's recorded name has up to five parts: a first name, zero or more
 * middle names, a last name, an optional generational suffix ("Jr", "III"),
 * and an optional "Goes by" name (the name the customer is actually called,
 * e.g. "Bob" for Robert). A separate preference records whether the suffix
 * should appear in the familiar name.
 *
 * This module owns the presentation RULES so every screen renders the same
 * name the same way without copying logic. It produces three presentations:
 *
 *   - familiar : the everyday name — Goes by (or first), last name, and the
 *                suffix when preferred. ("Bob Smith Jr", "Elizabeth Hart")
 *   - greeting : how you'd address them — Goes by (or first) ONLY.
 *                ("Bob", "Elizabeth") Never a middle name, never inferred.
 *   - full     : the complete recorded name — first, middle(s), last, suffix.
 *                ("Robert Anne Smith Jr")
 *
 * Normalization preserves spelling, capitalization (McDonald, DeLuca), and
 * multi-word names exactly as entered; it only collapses runs of whitespace
 * and trims. It never title-cases, never splits a name, and never infers a
 * nickname or pulls a middle name into a greeting. It reuses the shared
 * `normalizeNameInput` so the rule is identical to every other contact field.
 */

import { normalizeNameInput, type ContactFieldResult } from './contact-input'

// ── Shape ──────────────────────────────────────────────────────────────────

/**
 * The recorded parts of a person's name plus the familiar-suffix preference.
 * Every part is optional/nullable so partial records (first only, no middle,
 * no goes-by) are represented faithfully rather than invented.
 */
export interface PersonName {
  firstName: string | null
  /** Middle name(s), kept whole ("Anne Marie"). */
  middleName: string | null
  lastName: string | null
  /** Generational suffix as typed ("Jr", "Sr", "III"). */
  suffix: string | null
  /** The name the customer is called; falls back to firstName when absent. */
  goesBy: string | null
  /**
   * Whether the suffix appears in the FAMILIAR name. `null` means no
   * preference has been recorded, which defaults to YES (include the suffix).
   * `false` suppresses the suffix from the familiar name only; the full
   * recorded name always keeps it.
   */
  suffixInFamiliar: boolean | null
}

/** An empty name record (every part unknown, no preference). */
export const EMPTY_PERSON_NAME: PersonName = {
  firstName: null,
  middleName: null,
  lastName: null,
  suffix: null,
  goesBy: null,
  suffixInFamiliar: null,
}

/** Build a PersonName from arbitrary raw parts, normalizing each component
 * (whitespace-collapse + trim, caps preserved). A blank part becomes null.
 * `suffixInFamiliar` passes through untouched (null = no preference). */
export function toPersonName(raw: {
  firstName?: string | null
  middleName?: string | null
  lastName?: string | null
  suffix?: string | null
  goesBy?: string | null
  suffixInFamiliar?: boolean | null
}): PersonName {
  return {
    firstName: normalizeNameInput(raw.firstName).value,
    middleName: normalizeNameInput(raw.middleName).value,
    lastName: normalizeNameInput(raw.lastName).value,
    suffix: normalizeNameInput(raw.suffix).value,
    goesBy: normalizeNameInput(raw.goesBy).value,
    suffixInFamiliar: raw.suffixInFamiliar ?? null,
  }
}

// ── Suffix options (dropdown model) ──────────────────────────────────────────

/** The fixed generational-suffix choices offered in the editor dropdown.
 * `None` means no suffix; `Other` reveals a free-text field for an unusual
 * suffix the list does not cover. The stored value is always the plain suffix
 * string (e.g. "Jr.", or the custom text), never the sentinel. */
export const SUFFIX_OPTIONS = ['None', 'Jr.', 'Sr.', 'II', 'III', 'IV', 'V', 'Other'] as const
export type SuffixOption = (typeof SUFFIX_OPTIONS)[number]

/** The non-"Other" suffixes that map directly to a stored value. */
const KNOWN_SUFFIXES: readonly string[] = ['Jr.', 'Sr.', 'II', 'III', 'IV', 'V']

/** The editor's suffix selection, split into the dropdown choice and (when the
 * choice is `Other`) the custom text. This is the editor's working state; the
 * stored `PersonName.suffix` is resolved from it via `resolveSuffixSelection`. */
export interface SuffixSelection {
  option: SuffixOption
  /** The custom suffix text, meaningful only when `option` is `Other`. */
  custom: string
}

/** Derive the dropdown selection from a stored suffix string. A known suffix
 * selects its option; any other non-empty value is `Other` with the value as
 * the custom text; empty/null is `None`. Matching is done on the trimmed value
 * so "jr." or " Jr. " still maps to the Jr. option. */
export function suffixSelectionFrom(suffix: string | null | undefined): SuffixSelection {
  const trimmed = (suffix ?? '').trim()
  if (!trimmed) return { option: 'None', custom: '' }
  const match = KNOWN_SUFFIXES.find((s) => s.toLowerCase() === trimmed.toLowerCase())
  if (match) return { option: match as SuffixOption, custom: '' }
  return { option: 'Other', custom: trimmed }
}

/** Resolve a dropdown selection to the stored suffix string (or null for None).
 * `Other` uses the normalized custom text; an `Other` with blank custom text
 * resolves to null here (validation reports that as an error separately). */
export function resolveSuffixSelection(sel: SuffixSelection): string | null {
  if (sel.option === 'None') return null
  if (sel.option === 'Other') return normalizeNameInput(sel.custom).value
  return sel.option
}

// ── Preference ───────────────────────────────────────────────────────────────

/**
 * Whether the suffix should appear in the familiar name. The recorded
 * preference wins; when none is recorded (null) the default is YES. A name
 * with no suffix at all is trivially "no suffix to show", so the preference
 * only matters when a suffix exists.
 */
export function includeSuffixInFamiliar(name: Pick<PersonName, 'suffixInFamiliar'>): boolean {
  return name.suffixInFamiliar ?? true
}

// ── Presentations ────────────────────────────────────────────────────────────

/** The part used as the spoken/first name: the Goes by name when present,
 * otherwise the recorded first name. Never inferred from the first name. */
export function spokenFirst(name: Pick<PersonName, 'firstName' | 'goesBy'>): string | null {
  return name.goesBy ?? name.firstName
}

/**
 * The GREETING name: how you'd address the customer — the Goes by name (or
 * first name) ONLY. No last name, no middle name, no suffix. Falls back to the
 * last name only if there is genuinely no first/goes-by on file, so a greeting
 * is never empty for a named customer; empty string when nothing is recorded.
 */
export function greetingName(name: PersonName): string {
  return (spokenFirst(name) ?? name.lastName ?? '').trim()
}

/**
 * The FAMILIAR name: the everyday name — Goes by (or first), last name, and
 * the suffix when preferred. Each part is omitted when absent, so a first-only
 * record yields just the first name and a last-only record just the surname.
 *
 *   {first:Robert, goesBy:Bob, last:Smith, suffix:Jr, pref:null}  → "Bob Smith Jr"
 *   {first:Elizabeth, last:Hart}                                  → "Elizabeth Hart"
 *   {first:Robert, last:Smith, suffix:III, pref:false}            → "Robert Smith"
 */
export function familiarName(name: PersonName): string {
  const parts: string[] = []
  const first = spokenFirst(name)
  if (first) parts.push(first)
  if (name.lastName) parts.push(name.lastName)
  if (name.suffix && includeSuffixInFamiliar(name)) parts.push(name.suffix)
  return parts.join(' ').trim()
}

/**
 * The FULL RECORDED name: first, middle(s), last, suffix — every recorded part
 * in order, the Goes by name intentionally excluded (it is a familiar name,
 * not part of the legal/recorded name). Each part omitted when absent.
 *
 *   {first:Robert, middle:Anne, last:Smith, suffix:Jr}  → "Robert Anne Smith Jr"
 *   {first:Elizabeth, last:Hart}                        → "Elizabeth Hart"
 */
export function fullRecordedName(name: PersonName): string {
  return [name.firstName, name.middleName, name.lastName, name.suffix]
    .filter((p): p is string => !!p)
    .join(' ')
    .trim()
}

/** All three presentations at once, plus a stable fallback label when nothing
 * is recorded. `fullDiffersFromFamiliar` is true only when the full recorded
 * name carries information the familiar name does not (a middle name, a
 * suppressed suffix, or a Goes-by that replaces the recorded first) — the
 * signal a display uses to decide whether to show the full name beneath the
 * familiar one. */
export interface PersonNamePresentations {
  familiar: string
  greeting: string
  full: string
  /** True when the full recorded name is meaningfully different from the
   * familiar name and worth showing beneath it. */
  fullDiffersFromFamiliar: boolean
}

export function presentPersonName(
  name: PersonName,
  fallback = 'Unknown customer',
): PersonNamePresentations {
  const familiar = familiarName(name)
  const greeting = greetingName(name)
  const full = fullRecordedName(name)
  const familiarResolved = familiar || fallback
  // The full name is worth showing only when it differs from the familiar name
  // after a case-insensitive comparison (so "bob"/"Bob" alone is not a diff),
  // and only when a full name actually exists.
  const fullDiffersFromFamiliar =
    full.length > 0 && full.toLowerCase() !== familiarResolved.toLowerCase()
  return {
    familiar: familiarResolved,
    greeting,
    full,
    fullDiffersFromFamiliar,
  }
}

// ── Validation ───────────────────────────────────────────────────────────────

/** A normalized, save-ready set of name parts (null = cleared). */
export interface NormalizedPersonName {
  firstName: string | null
  middleName: string | null
  lastName: string | null
  suffix: string | null
  goesBy: string | null
  suffixInFamiliar: boolean | null
}

export type PersonNameValidation =
  | { status: 'valid'; value: NormalizedPersonName }
  | { status: 'invalid'; reason: string; fieldErrors: PersonNameFieldErrors }

/** A field-level validity map so the editor can mark exactly which required
 * field is blank. Each flag is true when that field FAILS its required check. */
export interface PersonNameFieldErrors {
  firstName?: boolean
  lastName?: boolean
  /** Other was chosen but the custom suffix is blank. */
  suffix?: boolean
}

/**
 * Validate and normalize raw name input for saving. The required rules:
 *   - First and Last are BOTH required and cannot be blank or whitespace-only.
 *   - Middle, Suffix, and Goes by are optional and may be cleared.
 *   - A suffix of "Other" (passed as `suffixOtherBlank`) requires nonblank
 *     custom text.
 * Capitalization, accents, and multi-word names are preserved; nothing is
 * inferred. On failure it returns the first reason plus a per-field error map
 * so the editor can mark each offending field.
 */
export function validatePersonName(raw: {
  firstName?: string | null
  middleName?: string | null
  lastName?: string | null
  suffix?: string | null
  goesBy?: string | null
  suffixInFamiliar?: boolean | null
  /** True when the suffix dropdown is on "Other" with blank custom text. */
  suffixOtherBlank?: boolean
}): PersonNameValidation {
  const first = normalizeNameInput(raw.firstName)
  const last = normalizeNameInput(raw.lastName)

  const fieldErrors: PersonNameFieldErrors = {}
  if (first.status === 'empty') fieldErrors.firstName = true
  if (last.status === 'empty') fieldErrors.lastName = true
  if (raw.suffixOtherBlank) fieldErrors.suffix = true

  if (fieldErrors.firstName || fieldErrors.lastName) {
    const reason =
      fieldErrors.firstName && fieldErrors.lastName
        ? 'First and last name are required.'
        : fieldErrors.firstName
          ? 'First name is required.'
          : 'Last name is required.'
    return { status: 'invalid', reason, fieldErrors }
  }
  if (fieldErrors.suffix) {
    return { status: 'invalid', reason: 'Enter the suffix, or choose None.', fieldErrors }
  }

  return {
    status: 'valid',
    value: {
      firstName: first.value,
      middleName: normalizeNameInput(raw.middleName).value,
      lastName: last.value,
      suffix: normalizeNameInput(raw.suffix).value,
      goesBy: normalizeNameInput(raw.goesBy).value,
      suffixInFamiliar: raw.suffixInFamiliar ?? null,
    },
  }
}

/** Re-export for callers that normalize a single part directly. */
export type { ContactFieldResult }
export { normalizeNameInput }
