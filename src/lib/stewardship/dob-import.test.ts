/**
 * Import-source DOB interpretation (Right Path).
 *
 * Exercises interpretSourceDob and the import column mappers that every import
 * path shares, with representative real-world source values. The contract: every
 * genuinely known component (year-only, month+year, or exact) is preserved, and
 * no component is ever invented. The owner mask stays day-less; the insured and
 * exact-customer columns keep the day.
 *
 * Run with: npm run test:dd
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  interpretSourceDob,
  sourceDobToOwnerMask,
  sourceDobToInsuredColumns,
  sourceDobToCustomerColumns,
} from './dob'

test('interpretSourceDob: a real Date cell is exact (keeps the day)', () => {
  // xlsx yields local-time Date cells; the helper reads local components.
  assert.deepEqual(interpretSourceDob(new Date(1959, 6, 15)), {
    precision: 'exact', year: 1959, month: 7, day: 15,
  })
})

test('interpretSourceDob: ISO YYYY-MM-DD is exact (keeps the day)', () => {
  assert.deepEqual(interpretSourceDob('1959-07-15'), { precision: 'exact', year: 1959, month: 7, day: 15 })
  assert.deepEqual(interpretSourceDob('1959-07-15T00:00:00Z'), { precision: 'exact', year: 1959, month: 7, day: 15 })
})

test('interpretSourceDob: M/D/YYYY and M-D-YYYY are exact (keeps the day)', () => {
  assert.deepEqual(interpretSourceDob('7/15/1959'), { precision: 'exact', year: 1959, month: 7, day: 15 })
  assert.deepEqual(interpretSourceDob('07/05/1959'), { precision: 'exact', year: 1959, month: 7, day: 5 })
  assert.deepEqual(interpretSourceDob('7-15-1959'), { precision: 'exact', year: 1959, month: 7, day: 15 })
})

test('interpretSourceDob: month+year forms keep the month, drop no known part', () => {
  assert.deepEqual(interpretSourceDob('07/1959'), { precision: 'month-year', year: 1959, month: 7, day: null })
  assert.deepEqual(interpretSourceDob('1959-07'), { precision: 'month-year', year: 1959, month: 7, day: null })
  assert.deepEqual(interpretSourceDob('07/xx/1959'), { precision: 'month-year', year: 1959, month: 7, day: null })
})

test('interpretSourceDob: year-only forms keep the year', () => {
  assert.deepEqual(interpretSourceDob('1959'), { precision: 'year-only', year: 1959, month: null, day: null })
  assert.deepEqual(interpretSourceDob('xx/xx/1959'), { precision: 'year-only', year: 1959, month: null, day: null })
})

test('interpretSourceDob: an impossible calendar date degrades to its reliable month+year, not none', () => {
  assert.deepEqual(interpretSourceDob('2/30/1959'), { precision: 'month-year', year: 1959, month: 2, day: null })
})

test('interpretSourceDob: blank / unusable / 2-digit year -> none (never invent a year)', () => {
  assert.deepEqual(interpretSourceDob(null), { precision: 'none', year: null, month: null, day: null })
  assert.deepEqual(interpretSourceDob(''), { precision: 'none', year: null, month: null, day: null })
  assert.deepEqual(interpretSourceDob('   '), { precision: 'none', year: null, month: null, day: null })
  assert.deepEqual(interpretSourceDob('unknown'), { precision: 'none', year: null, month: null, day: null })
  assert.deepEqual(interpretSourceDob('7/15/59'), { precision: 'none', year: null, month: null, day: null })
  assert.deepEqual(interpretSourceDob(new Date('not a date')), { precision: 'none', year: null, month: null, day: null })
})

test('sourceDobToOwnerMask: day-less by design, month/year precision preserved', () => {
  assert.equal(sourceDobToOwnerMask('7/15/1959'), '07/xx/1959')   // exact source -> month+year mask, day dropped
  assert.equal(sourceDobToOwnerMask('1959-07-15'), '07/xx/1959')  // ISO exact -> month+year mask
  assert.equal(sourceDobToOwnerMask('07/1959'), '07/xx/1959')     // month+year preserved
  assert.equal(sourceDobToOwnerMask('1959'), 'xx/xx/1959')        // year only
  assert.equal(sourceDobToOwnerMask('unknown'), null)             // no reliable year -> null, not garbage
})

test('sourceDobToInsuredColumns: keeps the owner day when owner is the insured', () => {
  assert.deepEqual(sourceDobToInsuredColumns('7/15/1959'), {
    insured_dob: '1959-07-15', insured_dob_year: 1959, insured_dob_month: 7, insured_dob_precision: 'exact',
  })
  assert.deepEqual(sourceDobToInsuredColumns('1959-07-15'), {
    insured_dob: '1959-07-15', insured_dob_year: 1959, insured_dob_month: 7, insured_dob_precision: 'exact',
  })
  assert.deepEqual(sourceDobToInsuredColumns('07/1959'), {
    insured_dob: null, insured_dob_year: 1959, insured_dob_month: 7, insured_dob_precision: 'month_year',
  })
  assert.deepEqual(sourceDobToInsuredColumns('1959'), {
    insured_dob: null, insured_dob_year: 1959, insured_dob_month: null, insured_dob_precision: 'year_only',
  })
  assert.deepEqual(sourceDobToInsuredColumns('unknown'), {
    insured_dob: null, insured_dob_year: null, insured_dob_month: null, insured_dob_precision: 'missing',
  })
})

test('sourceDobToCustomerColumns: exact -> date_of_birth; partial -> masked date_of_birth_approx', () => {
  assert.deepEqual(sourceDobToCustomerColumns('7/15/1959'), { date_of_birth: '1959-07-15', date_of_birth_approx: null })
  assert.deepEqual(sourceDobToCustomerColumns('1959-07-15'), { date_of_birth: '1959-07-15', date_of_birth_approx: null })
  assert.deepEqual(sourceDobToCustomerColumns('07/1959'), { date_of_birth: null, date_of_birth_approx: '07/xx/1959' })
  assert.deepEqual(sourceDobToCustomerColumns('1959'), { date_of_birth: null, date_of_birth_approx: 'xx/xx/1959' })
  assert.deepEqual(sourceDobToCustomerColumns(''), { date_of_birth: null, date_of_birth_approx: null })
})
