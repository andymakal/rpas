/**
 * Contact history facts + DOB normalization, display, and change detection
 * (Right Path).
 *
 * Runs on the Node built-in test runner (node:test) via jiti, exercising the
 * REAL GoRules ZEN rule (contact-history-facts.json) and the REAL DOB helpers —
 * no copy of the logic. Run with: npm run test:dd
 *
 * Locks in the corrected behavior:
 *   1. DOB normalization preserves precision without inventing a day.
 *   2. Display shows the COMPLETE DOB when known (MM/DD/YYYY), only the known
 *      parts when partial (MM/YYYY / YYYY), nothing when absent.
 *   3. Change detection compares the TRUE stored values, so a day-only
 *      correction is detected; a known exact DOB is never downgraded to partial.
 *   4. History prose never prints the day (precision-appropriate wording).
 *   5. The ZEN rule OWNS the employee-facing wording (label + description
 *      templates); the TS layer only substitutes {field} and {detail}.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  normalizeDobParts,
  formatDobDisplay,
  dobPrecisionLabel,
  dobChanged,
  wouldDowngradeExactDob,
  dobToParts,
  readStoredDob,
} from './dob'
import {
  classifyContactChange,
  buildContactHistoryFacts,
} from './contact-history-facts'
import type { ContactSnapshot } from './customer-history'

// A fully-empty snapshot to diff against; each case flips only what it tests.
const EMPTY: ContactSnapshot = {
  first_name: null,
  last_name: null,
  email: null,
  phone: null,
  street: null,
  city: null,
  state: null,
  zip: null,
  email_verified_at: null,
  phone_verified_at: null,
  address_verified_at: null,
  email_availability: null,
  sms_opt_out: false,
  text_undeliverable: false,
  contact_alert: null,
  date_of_birth: null,
  date_of_birth_approx: null,
}

// ── DOB normalization ─────────────────────────────────────────────────────────

test('DOB: all-blank parts clear both columns', () => {
  const r = normalizeDobParts({ month: '', day: '', year: '' })
  assert.equal(r.status, 'empty')
  assert.equal(r.date_of_birth, null)
  assert.equal(r.date_of_birth_approx, null)
})

test('DOB: full valid date is exact (ISO in date_of_birth, approx cleared)', () => {
  const r = normalizeDobParts({ month: '3', day: '15', year: '1980' })
  assert.equal(r.status, 'exact')
  assert.equal(r.date_of_birth, '1980-03-15')
  assert.equal(r.date_of_birth_approx, null)
})

test('DOB: month + year, blank day is partial masked MM/xx/YYYY', () => {
  const r = normalizeDobParts({ month: '3', day: '', year: '1980' })
  assert.equal(r.status, 'partial')
  assert.equal(r.date_of_birth, null)
  assert.equal(r.date_of_birth_approx, '03/xx/1980')
})

test('DOB: year only is partial masked xx/xx/YYYY', () => {
  const r = normalizeDobParts({ month: '', day: '', year: '1980' })
  assert.equal(r.status, 'partial')
  assert.equal(r.date_of_birth_approx, 'xx/xx/1980')
})

test('DOB: a day without a month is invalid (no day invented)', () => {
  assert.equal(normalizeDobParts({ month: '', day: '15', year: '1980' }).status, 'invalid')
})

test('DOB: a year is required (lone month is invalid)', () => {
  assert.equal(normalizeDobParts({ month: '3', day: '', year: '' }).status, 'invalid')
})

test('DOB: an impossible calendar date is invalid', () => {
  assert.equal(normalizeDobParts({ month: '2', day: '30', year: '1980' }).status, 'invalid')
})

test('DOB: out-of-range month/year is invalid', () => {
  assert.equal(normalizeDobParts({ month: '13', day: '', year: '1980' }).status, 'invalid')
  assert.equal(normalizeDobParts({ month: '', day: '', year: '1800' }).status, 'invalid')
})

// ── Display: complete when known, known parts when partial ──────────────────

test('display: an exact DOB shows the COMPLETE date MM/DD/YYYY', () => {
  assert.equal(formatDobDisplay('1980-03-15', null), '03/15/1980')
})

test('display: exact wins over a stale partial (never downgraded in view)', () => {
  assert.equal(formatDobDisplay('1980-03-15', 'xx/xx/1999'), '03/15/1980')
})

test('display: a month+year partial shows MM/YYYY; year-only shows YYYY', () => {
  assert.equal(formatDobDisplay(null, '03/xx/1980'), '03/1980')
  assert.equal(formatDobDisplay(null, 'xx/xx/1980'), '1980')
})

test('display: no DOB returns null', () => {
  assert.equal(formatDobDisplay(null, null), null)
})

test('readStoredDob: exact exposes the day; partial never invents one', () => {
  assert.deepEqual(readStoredDob('1980-03-15', null), { precision: 'exact', year: 1980, month: 3, day: 15 })
  assert.deepEqual(readStoredDob(null, '03/xx/1980'), { precision: 'month-year', year: 1980, month: 3, day: null })
  assert.deepEqual(readStoredDob(null, 'xx/xx/1980'), { precision: 'year-only', year: 1980, month: null, day: null })
})

test('dobToParts: a partial DOB yields a BLANK day', () => {
  assert.deepEqual(dobToParts(null, '03/xx/1980'), { month: '3', day: '', year: '1980' })
})

// ── Change detection on TRUE values ─────────────────────────────────────────

test('dobChanged: a DAY-ONLY correction to an exact date is detected', () => {
  assert.equal(dobChanged('1980-03-15', null, '1980-03-16', null), true)
})

test('dobChanged: an identical exact date is NOT a change', () => {
  assert.equal(dobChanged('1980-03-15', null, '1980-03-15', null), false)
})

test('dobChanged: exact -> partial of the same month/year still differs (precision)', () => {
  assert.equal(dobChanged('1980-03-15', null, null, '03/xx/1980'), true)
})

test('no-downgrade: a partial entry over an existing EXACT date is a downgrade', () => {
  const prior = { date_of_birth: '1980-03-15', date_of_birth_approx: null }
  assert.equal(wouldDowngradeExactDob(prior, normalizeDobParts({ month: '3', day: '', year: '1980' })), true)
})

test('no-downgrade: correcting an exact date to another exact date is NOT a downgrade', () => {
  const prior = { date_of_birth: '1980-03-15', date_of_birth_approx: null }
  assert.equal(wouldDowngradeExactDob(prior, normalizeDobParts({ month: '3', day: '16', year: '1980' })), false)
})

test('no-downgrade: clearing an exact date entirely is NOT a downgrade', () => {
  const prior = { date_of_birth: '1980-03-15', date_of_birth_approx: null }
  assert.equal(wouldDowngradeExactDob(prior, normalizeDobParts({ month: '', day: '', year: '' })), false)
})

test('no-downgrade: a partial over an existing PARTIAL is not a downgrade', () => {
  const prior = { date_of_birth: null, date_of_birth_approx: 'xx/xx/1980' }
  assert.equal(wouldDowngradeExactDob(prior, normalizeDobParts({ month: '3', day: '', year: '1980' })), false)
})

test('history precision label never contains a day', () => {
  assert.equal(dobPrecisionLabel('1980-03-15', null), 'a full date')
  assert.equal(dobPrecisionLabel(null, '03/xx/1980'), 'month and year')
  assert.equal(dobPrecisionLabel(null, 'xx/xx/1980'), 'year only')
  assert.equal(dobPrecisionLabel(null, null), 'not on file')
})

// ── ZEN owns the wording (label + description templates) ─────────────────────

test('ZEN returns the agreed wording templates, not just a classification', async () => {
  const added = await classifyContactChange({ changeType: 'value', hadValue: false, hasValue: true })
  assert.equal(added.changeKind, 'added')
  assert.equal(added.template, '{field} added.')
  assert.equal(added.label, '{field} added')

  const corrected = await classifyContactChange({ changeType: 'value', hadValue: true, hasValue: true })
  assert.equal(corrected.changeKind, 'corrected')
  assert.equal(corrected.template, '{field} corrected.')

  const cleared = await classifyContactChange({ changeType: 'value', hadValue: true, hasValue: false })
  assert.equal(cleared.changeKind, 'cleared')
  assert.equal(cleared.template, '{field} cleared.')
})

test('ZEN templates for verification, restriction, availability, and alert', async () => {
  assert.equal((await classifyContactChange({ changeType: 'verified', hadValue: false, hasValue: true })).template, '{field} verified.')
  assert.equal((await classifyContactChange({ changeType: 'restriction_set', hadValue: false, hasValue: true })).template, '{field} set.')
  assert.equal((await classifyContactChange({ changeType: 'availability_changed', hadValue: true, hasValue: true })).template, 'Email availability changed to {detail}.')
  assert.equal((await classifyContactChange({ changeType: 'alert', hadValue: false, hasValue: true })).template, 'Alert added: {detail}')
  assert.equal((await classifyContactChange({ changeType: 'alert', hadValue: true, hasValue: true })).template, 'Alert updated: {detail}')
})

// ── Employee-facing facts (wording rendered from the ZEN templates) ─────────

test('facts: email added yields "Email added."', async () => {
  const facts = await buildContactHistoryFacts(EMPTY, { ...EMPTY, email: 'jo@example.com' })
  assert.equal(facts.length, 1)
  assert.equal(facts[0].description, 'Email added.')
})

test('facts: phone corrected yields "Phone corrected."', async () => {
  const before = { ...EMPTY, phone: '(215) 555-0100' }
  const after = { ...EMPTY, phone: '(215) 555-0199' }
  const facts = await buildContactHistoryFacts(before, after)
  assert.equal(facts[0].description, 'Phone corrected.')
})

test('facts: an alert carries the actual text', async () => {
  const facts = await buildContactHistoryFacts(EMPTY, { ...EMPTY, contact_alert: 'Spouse handles all calls' })
  assert.equal(facts[0].description, 'Alert added: Spouse handles all calls')
})

test('facts: address verification yields "Address verified."', async () => {
  const before = { ...EMPTY, street: '1 Main St', city: 'Phila', state: 'PA', zip: '19106' }
  const after = { ...before, address_verified_at: '2026-01-01T00:00:00Z' }
  const facts = await buildContactHistoryFacts(before, after)
  assert.equal(facts[0].description, 'Address verified.')
})

test('facts: email availability change names the resulting state in plain words', async () => {
  const facts = await buildContactHistoryFacts(EMPTY, { ...EMPTY, email_availability: 'no_address' })
  assert.equal(facts[0].description, 'Email availability changed to No Usable Email.')
})

test('facts: DOB added is described WITHOUT a day', async () => {
  const facts = await buildContactHistoryFacts(EMPTY, { ...EMPTY, date_of_birth: '1980-03-15' })
  assert.equal(facts[0].field, 'Date of birth')
  assert.equal(facts[0].description, 'Date of birth added.')
  // The day must not leak into the fact.
  assert.ok(!facts[0].description.includes('15'))
})

test('facts: a DAY-ONLY DOB correction still produces a "corrected" fact, no day', async () => {
  const before = { ...EMPTY, date_of_birth: '1980-03-15' }
  const after = { ...EMPTY, date_of_birth: '1980-03-16' }
  const facts = await buildContactHistoryFacts(before, after)
  assert.equal(facts.length, 1)
  assert.equal(facts[0].description, 'Date of birth corrected.')
  assert.ok(!facts[0].description.includes('16'))
})

test('facts: editing a value suppresses its automatic verification clear', async () => {
  const before = { ...EMPTY, email: 'a@example.com', email_verified_at: '2026-01-01T00:00:00Z' }
  const after = { ...EMPTY, email: 'b@example.com', email_verified_at: null }
  const facts = await buildContactHistoryFacts(before, after)
  assert.equal(facts.length, 1)
  assert.equal(facts[0].description, 'Email corrected.')
})

test('facts: nothing changed yields no facts', async () => {
  const facts = await buildContactHistoryFacts(EMPTY, { ...EMPTY })
  assert.equal(facts.length, 0)
})
