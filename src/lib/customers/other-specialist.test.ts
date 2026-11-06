/**
 * Other-specialist restriction: only hands_off restricts. life_authorized and
 * hands_off both require a named specialist; unknown and clear carry none.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { isHandsOff, requiresSpecialist, validateOtherSpecialist } from './other-specialist'

test('only hands_off restricts; unknown, clear, life_authorized and null stay workable', () => {
  assert.equal(isHandsOff('hands_off'), true)
  assert.equal(isHandsOff('life_authorized'), false)
  assert.equal(isHandsOff('unknown'), false)
  assert.equal(isHandsOff('clear'), false)
  assert.equal(isHandsOff(null), false)
  assert.equal(isHandsOff(undefined), false)
})

test('life_authorized and hands_off require a specialist', () => {
  for (const s of ['life_authorized', 'hands_off']) {
    assert.equal(requiresSpecialist(s), true)
    assert.equal(validateOtherSpecialist(s, null).ok, false)
    assert.equal(validateOtherSpecialist(s, 'spec-1').ok, true)
  }
})

test('unknown and clear must not carry a specialist', () => {
  for (const s of ['unknown', 'clear']) {
    assert.equal(requiresSpecialist(s), false)
    assert.equal(validateOtherSpecialist(s, null).ok, true)
    assert.equal(validateOtherSpecialist(s, 'spec-1').ok, false)
  }
})

test('an unrecognized status is rejected', () => {
  assert.equal(validateOtherSpecialist('maybe', null).ok, false)
})
