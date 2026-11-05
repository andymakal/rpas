/**
 * Other-specialist restriction: only hands_off restricts, and hands_off needs a
 * specialist (no exclusion without a specific reason).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { isHandsOff, validateOtherSpecialist } from './other-specialist'

test('only hands_off restricts; unknown, clear and null stay workable', () => {
  assert.equal(isHandsOff('hands_off'), true)
  assert.equal(isHandsOff('unknown'), false)
  assert.equal(isHandsOff('clear'), false)
  assert.equal(isHandsOff(null), false)
  assert.equal(isHandsOff(undefined), false)
})

test('hands_off requires a specialist', () => {
  assert.equal(validateOtherSpecialist('hands_off', null).ok, false)
  assert.equal(validateOtherSpecialist('hands_off', 'spec-1').ok, true)
})

test('unknown and clear must not carry a specialist', () => {
  assert.equal(validateOtherSpecialist('unknown', null).ok, true)
  assert.equal(validateOtherSpecialist('clear', null).ok, true)
  assert.equal(validateOtherSpecialist('clear', 'spec-1').ok, false)
})

test('an unrecognized status is rejected', () => {
  assert.equal(validateOtherSpecialist('maybe', null).ok, false)
})
