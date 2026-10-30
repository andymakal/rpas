/**
 * Contact history facts + DOB normalization (Right Path).
 *
 * Runs on the Node built-in test runner (node:test) via jiti, exercising the
 * REAL GoRules ZEN rule (contact-history-facts.json) and the REAL DOB
 * normalizer — no copy of the logic. Run with: npm run test:dd
 *
 * Locks in:
 *   1. DOB normalization preserves precision without inventing a day: all-blank
 *      clears; a full valid calendar date is exact; a year (+ optional month)
 *      with a blank day is partial and masked; a day without a month, a lone
 *      day, a missing year, an out-of-range part, or an impossible date is
 *      invalid and never stored.
 *   2. Masked display never exposes the day and an exact DOB wins over a partial.
 *   3. The ZEN classifier maps a change SHAPE to the employee-facing change kind.
 *   4. buildContactHistoryFacts composes concise employee-facing descriptions
 *      (added / corrected / cleared / verified / alert text / DOB masked) and
 *      preserves the project's suppression rules.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  normalizeDobParts,
  maskDobDisplay,
  dobToParts,
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
  const r = normalizeDobParts({ month: '', day: '15', year: '1980' })
  assert.equal(r.status, 'invalid')
})

test('DOB: a year is required (lone month is invalid)', () => {
  const r = normalizeDobParts({ month: '3', day: '', year: '' })
  assert.equal(r.status, 'invalid')
})

test('DOB: an impossible calendar date is invalid', () => {
  const r = normalizeDobParts({ month: '2', day: '30', year: '1980' })
  assert.equal(r.status, 'invalid')
})

test('DOB: out-of-range month/year is invalid', () => {
  assert.equal(normalizeDobParts({ month: '13', day: '', year: '1980' }).status, 'invalid')
  assert.equal(normalizeDobParts({ month: '', day: '', year: '1800' }).status, 'invalid')
})

// ── Masking + round-trip ────────────────────────────────────────────────────

test('mask: exact DOB shows month + year, never the day', () => {
  assert.equal(maskDobDisplay('1980-03-15', null), '03/xx/1980')
})

test('mask: exact wins over a partial (never downgraded)', () => {
  assert.equal(maskDobDisplay('1980-03-15', 'xx/xx/1999'), '03/xx/1980')
})

test('mask: partial renders at its own precision', () => {
  assert.equal(maskDobDisplay(null, '03/xx/1980'), '03/xx/1980')
  assert.equal(maskDobDisplay(null, 'xx/xx/1980'), 'xx/xx/1980')
})

test('mask: no DOB returns null', () => {
  assert.equal(maskDobDisplay(null, null), null)
})

test('dobToParts: a partial DOB yields a BLANK day', () => {
  assert.deepEqual(dobToParts(null, '03/xx/1980'), { month: '3', day: '', year: '1980' })
})

// ── ZEN classification ──────────────────────────────────────────────────────

test('ZEN classifies a value present-only-after as "added"', async () => {
  const k = await classifyContactChange({ changeType: 'value', hadValue: false, hasValue: true })
  assert.equal(k.changeKind, 'added')
})

test('ZEN classifies a value present-before-and-after as "corrected"', async () => {
  const k = await classifyContactChange({ changeType: 'value', hadValue: true, hasValue: true })
  assert.equal(k.changeKind, 'corrected')
})

test('ZEN classifies a value gone-after as "cleared"', async () => {
  const k = await classifyContactChange({ changeType: 'value', hadValue: true, hasValue: false })
  assert.equal(k.changeKind, 'cleared')
})

test('ZEN classifies verification + restriction + alert kinds', async () => {
  assert.equal((await classifyContactChange({ changeType: 'verified', hadValue: false, hasValue: true })).changeKind, 'verified')
  assert.equal((await classifyContactChange({ changeType: 'restriction_set', hadValue: false, hasValue: true })).changeKind, 'restriction_set')
  assert.equal((await classifyContactChange({ changeType: 'alert', hadValue: false, hasValue: true })).changeKind, 'alert_added')
  assert.equal((await classifyContactChange({ changeType: 'alert', hadValue: true, hasValue: true })).changeKind, 'alert_updated')
})

// ── Employee-facing facts ───────────────────────────────────────────────────

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

test('facts: DOB added is described masked, never with a day', async () => {
  const facts = await buildContactHistoryFacts(EMPTY, { ...EMPTY, date_of_birth: '1980-03-15' })
  assert.equal(facts[0].field, 'Date of birth')
  assert.equal(facts[0].description, 'Date of birth added.')
})

test('facts: editing a value suppresses its automatic verification clear', async () => {
  // A verified email that is then changed: the value change is reported, but the
  // automatic verification clear is NOT a separate fact.
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
