/**
 * Everlake-eligible carrier rule — the hardcoded set of carriers whose policies
 * are verified in the Everlake Agent Portal:
 *   - anything containing "allstate";
 *   - anything containing "everlake";
 *   - exactly "Lincoln Benefit Life" (the only eligible Lincoln* label).
 * A bare "Lincoln" / "Lincoln Financial" / "Lincoln Financial Group" is a
 * different company and is NOT eligible; ambiguity is excluded, never guessed.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { isEverlakeCarrier } from './everlake-carrier'

test('Allstate family is eligible (any label containing allstate)', () => {
  assert.equal(isEverlakeCarrier('Allstate'), true)
  assert.equal(isEverlakeCarrier('Allstate Life'), true)
  assert.equal(isEverlakeCarrier('Allstate Fixed Annuity'), true)
})

test('Everlake-branded carriers are eligible', () => {
  assert.equal(isEverlakeCarrier('Everlake Life'), true)
  assert.equal(isEverlakeCarrier('Everlake Assurance'), true)
})

test('Lincoln Benefit Life is eligible; other Lincoln labels are NOT', () => {
  assert.equal(isEverlakeCarrier('Lincoln Benefit Life'), true)
  // Different company — not Everlake.
  assert.equal(isEverlakeCarrier('Lincoln Financial'), false)
  assert.equal(isEverlakeCarrier('Lincoln Financial Group'), false)
  // Bare, ambiguous — never guessed, must be cleaned up in the data.
  assert.equal(isEverlakeCarrier('Lincoln'), false)
})

test('non-Everlake carriers are not eligible', () => {
  for (const c of [
    'Protective Life',
    'Foresters Financial',
    'Sammons Annuity',
    'John Hancock',
    'Corebridge Financial',
    'Equitable',
    'Prudential',
    'Nfs Brokerage',
  ]) {
    assert.equal(isEverlakeCarrier(c), false, `${c} should not be Everlake-eligible`)
  }
})

test('case-insensitive and whitespace-tolerant', () => {
  assert.equal(isEverlakeCarrier('  ALLSTATE  '), true)
  assert.equal(isEverlakeCarrier('lincoln benefit life'), true)
  assert.equal(isEverlakeCarrier('EVERLAKE LIFE'), true)
})

test('null / empty is not eligible', () => {
  assert.equal(isEverlakeCarrier(null), false)
  assert.equal(isEverlakeCarrier(undefined), false)
  assert.equal(isEverlakeCarrier(''), false)
  assert.equal(isEverlakeCarrier('   '), false)
})
