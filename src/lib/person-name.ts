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
  | { status: 'invalid'; reason: string }

/**
 * Validate and normalize raw name input for saving. The one rule mirrors the
 * existing contact standard: a customer must keep at least one of first or
 * last name after normalization — everything else (middle, suffix, goes-by) is
 * optional and may be cleared. Capitalization and multi-word names are
 * preserved; nothing is inferred.
 */
export function validatePersonName(raw: {
  firstName?: string | null
  middleName?: string | null
  lastName?: string | null
  suffix?: string | null
  goesBy?: string | null
  suffixInFamiliar?: boolean | null
}): PersonNameValidation {
  const first = normalizeNameInput(raw.firstName)
  const last = normalizeNameInput(raw.lastName)
  if (first.status === 'empty' && last.status === 'empty') {
    return { status: 'invalid', reason: 'Enter at least a first or last name.' }
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
