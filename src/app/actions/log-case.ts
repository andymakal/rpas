'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { normalizePhone, normalizeEmail, normalizeStreet, normalizeCity, normalizeState } from '@/lib/fmt'

export type LogCaseResult =
  | { success: true; case_id: string }
  | { success: false; error: string }

export type LeadSource = 'agency_referral' | 'allstate_web' | 'self_generated'

export async function logCase(data: {
  // Source
  agency_id?: string
  agent_id?: string
  lead_source: LeadSource
  // Contact
  first_name: string
  last_name: string
  phone: string
  email?: string
  dob?: string
  street?: string
  city?: string
  state?: string
  zip?: string
  spanish_speaking?: boolean
  // Referral details
  referral_type: string
  is_hot_lead?: boolean
  preferred_contact?: string
  best_contact_time?: string
  // Qualifying flags
  life_insurance_outside_work?: boolean
  job_change_last_5_years?: boolean
  review_401k?: boolean
  retirement_prep?: boolean
  // Free-form notes
  notes?: string
}): Promise<LogCaseResult> {
  if (data.lead_source === 'agency_referral' && !data.agency_id) {
    return { success: false, error: 'Agency is required for agency referrals.' }
  }

  const supabase = createAdminClient()

  try {
    const { data: customer, error: custError } = await supabase
      .from('customers')
      .insert({
        agency_id:        data.agency_id ?? null,
        first_name:       data.first_name.trim(),
        last_name:        data.last_name.trim(),
        phone:            normalizePhone(data.phone)        ?? data.phone.trim(),
        email:            normalizeEmail(data.email)        ?? null,
        date_of_birth:    data.dob                        || null,
        street:           normalizeStreet(data.street)    ?? null,
        city:             normalizeCity(data.city)        ?? null,
        state:            normalizeState(data.state)      ?? null,
        zip:              data.zip?.trim()                || null,
        spanish_speaking: data.spanish_speaking ?? false,
      })
      .select('id')
      .single()

    if (custError) {
      console.error('Customer insert error:', custError)
      return { success: false, error: 'Failed to create customer record.' }
    }

    // Build notes in the same key:value format as the portal intake form
    // so the Triage page can parse them consistently.
    const flags = [
      data.life_insurance_outside_work && 'Life insurance outside work',
      data.job_change_last_5_years     && 'Job change in last 5 years',
      data.review_401k                 && '401(k) review',
      data.retirement_prep             && 'Retirement prep',
    ].filter(Boolean) as string[]

    const noteLines = [
      data.referral_type      ? `Type: ${data.referral_type}` : null,
      data.preferred_contact  ? `Contact: ${data.preferred_contact}` : null,
      data.best_contact_time  ? `Best time: ${data.best_contact_time}` : null,
      data.notes?.trim()      ? `Notes: ${data.notes.trim()}` : null,
      flags.length > 0        ? `Flags: ${flags.join(', ')}` : null,
    ].filter(Boolean)

    // Route to the correct initial status:
    //   • Agency referral / Allstate.com lead → triage (Dulce's queue to work)
    //   • Self-generated → active_referral (producer already owns it)
    const initialStatus =
      data.lead_source === 'self_generated' ? 'active_referral' : 'triage'

    const { data: newCase, error: caseError } = await supabase
      .from('cases')
      .insert({
        agency_id:       data.agency_id ?? null,
        customer_id:     customer.id,
        agent_id:        data.agent_id || null,
        internal_status: initialStatus,
        lead_source:     data.lead_source,
        is_hot_lead:     data.is_hot_lead ?? false,
        notes:           noteLines.length > 0 ? noteLines.join('\n') : null,
      })
      .select('id')
      .single()

    if (caseError) {
      console.error('Case insert error:', caseError)
      return { success: false, error: 'Failed to create case record.' }
    }

    return { success: true, case_id: newCase.id }
  } catch (err) {
    console.error('Unexpected error:', err)
    return { success: false, error: 'Something went wrong. Please try again.' }
  }
}
