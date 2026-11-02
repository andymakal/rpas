/**
 * Customer zone derivation tests. The four live zones (PA Eastern, Colorado
 * Mountain, Pacific agents, Central), ambiguous straddling states, unknowns,
 * and both code and full-name inputs.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { deriveCustomerZone } from './customer-zone'

test('single-zone states map to their IANA zone (the four live zones)', () => {
  assert.deepEqual(deriveCustomerZone('PA'), { timeZone: 'America/New_York', ambiguous: false })
  assert.deepEqual(deriveCustomerZone('CO'), { timeZone: 'America/Denver', ambiguous: false })
  assert.deepEqual(deriveCustomerZone('CA'), { timeZone: 'America/Los_Angeles', ambiguous: false })
  assert.deepEqual(deriveCustomerZone('IL'), { timeZone: 'America/Chicago', ambiguous: false })
})

test('Arizona uses the no-DST Phoenix zone', () => {
  assert.deepEqual(deriveCustomerZone('AZ'), { timeZone: 'America/Phoenix', ambiguous: false })
})

test('straddling states resolve to a predominant zone, flagged ambiguous', () => {
  assert.deepEqual(deriveCustomerZone('FL'), { timeZone: 'America/New_York', ambiguous: true })
  assert.deepEqual(deriveCustomerZone('TX'), { timeZone: 'America/Chicago', ambiguous: true })
})

test('full state names resolve too', () => {
  assert.deepEqual(deriveCustomerZone('Pennsylvania'), { timeZone: 'America/New_York', ambiguous: false })
  assert.deepEqual(deriveCustomerZone('colorado'), { timeZone: 'America/Denver', ambiguous: false })
})

test('case and whitespace are tolerated', () => {
  assert.deepEqual(deriveCustomerZone('  pa '), { timeZone: 'America/New_York', ambiguous: false })
})

test('unknown / empty returns null (caller falls back to the time-module default)', () => {
  assert.equal(deriveCustomerZone(null), null)
  assert.equal(deriveCustomerZone(''), null)
  assert.equal(deriveCustomerZone('ZZ'), null)
  assert.equal(deriveCustomerZone('Nowhere'), null)
})
