/**
 * The one consistent FHIR partial-date interpretation (Right Path).
 *
 * Exercises the helpers that let any DOB source — the stored customer columns
 * OR a reliable partial DOB resolved from the customer's linked policies — be
 * read, displayed, and emitted at one of the four FHIR precisions
 * (YYYY-MM-DD / YYYY-MM / YYYY / none) without ever inventing a missing part.
 *
 * Run with: npm run test:dd
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  dobPrecisionFromToken,
  formatDobParts,
  toFhirDob,
  storedDobToFhir,
  dobSourceToParts,
  type DobSourceParts,
} from './dob'

const exact: DobSourceParts = { year: 1980, month: 3, day: 15, precision: 'exact', source: 'exact' }
const monthYear: DobSourceParts = { year: 1985, month: 6, day: null, precision: 'month-year', source: 'linked_policy' }
const yearOnly: DobSourceParts = { year: 1962, month: null, day: null, precision: 'year-only', source: 'customer_partial' }
const none: DobSourceParts = { year: null, month: null, day: null, precision: 'none', source: 'none' }

test('precision token maps DB values to the FHIR precision', () => {
  assert.equal(dobPrecisionFromToken('exact'), 'exact')
  assert.equal(dobPrecisionFromToken('month_year'), 'month-year')
  assert.equal(dobPrecisionFromToken('year_only'), 'year-only')
  assert.equal(dobPrecisionFromToken('none'), 'none')
  assert.equal(dobPrecisionFromToken(undefined), 'none')
  assert.equal(dobPrecisionFromToken('garbage'), 'none')
})

test('formatDobParts shows the complete date only at exact precision', () => {
  assert.equal(formatDobParts(exact), '03/15/1980')
  assert.equal(formatDobParts(monthYear), '06/1985')
  assert.equal(formatDobParts(yearOnly), '1962')
  assert.equal(formatDobParts(none), null)
})

test('formatDobParts never prints a day for a partial source even if one leaks in', () => {
  // A partial precision must not render a day, no matter what day value is present.
  const partialWithStrayDay: DobSourceParts = { year: 1985, month: 6, day: 9, precision: 'month-year', source: 'linked_policy' }
  assert.equal(formatDobParts(partialWithStrayDay), '06/1985')
})

test('toFhirDob emits the canonical partial-date token at each precision', () => {
  assert.equal(toFhirDob(exact), '1980-03-15')
  assert.equal(toFhirDob(monthYear), '1985-06')
  assert.equal(toFhirDob(yearOnly), '1962')
  assert.equal(toFhirDob(none), null)
})

test('storedDobToFhir reads the stored customer columns into a FHIR token', () => {
  assert.equal(storedDobToFhir('1980-03-15', null), '1980-03-15')
  assert.equal(storedDobToFhir(null, '03/xx/1980'), '1980-03')
  assert.equal(storedDobToFhir(null, 'xx/xx/1980'), '1980')
  assert.equal(storedDobToFhir(null, null), null)
  // Exact always wins over a stale partial — never downgraded.
  assert.equal(storedDobToFhir('1980-03-15', 'xx/xx/1999'), '1980-03-15')
})

test('dobSourceToParts seeds the editor, leaving the day blank for a partial source', () => {
  assert.deepEqual(dobSourceToParts(exact), { month: '3', day: '15', year: '1980' })
  assert.deepEqual(dobSourceToParts(monthYear), { month: '6', day: '', year: '1985' })
  assert.deepEqual(dobSourceToParts(yearOnly), { month: '', day: '', year: '1962' })
  assert.deepEqual(dobSourceToParts(none), { month: '', day: '', year: '' })
})
