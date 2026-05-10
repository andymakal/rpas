'use server'

import { createClient } from '@/lib/supabase/server'
import { referralSchema, type ReferralFormData } from '@/lib/schemas/referral'
import { PRODUCER_ROUTING, type ReferralTypeValue } from '@/lib/constants/referral-options'

export type SubmitReferralResult =
  | { success: true; referral_id: string; client_name: string; assigned_to: string }
  | { success: false; error: string }

export async function submitReferral(data: ReferralFormData): Promise<SubmitReferralResult> {
  const parsed = referralSchema.safeParse(data)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Validation failed' }
  }

  const form = parsed.data
  const assigned_to = PRODUCER_ROUTING[form.referral_type as ReferralTypeValue] ?? 'producer'
  const requires_escalation = assigned_to === 'senior_escalate'

  try {
    const supabase = await createClient()

    const { data: referral, error } = await supabase
      .from('referrals')
      .insert({
        agency_id: form.agency_id,
        lsp_name: form.lsp_name,
        client_first_name: form.client_first_name,
        client_last_name: form.client_last_name,
        client_phone: form.client_phone,
        client_email: form.client_email || null,
        client_dob: form.client_dob || null,
        client_marital_status: form.client_marital_status || null,
        client_address: form.client_address,
        client_city: form.client_city,
        client_state: form.client_state,
        client_zip: form.client_zip,
        referral_type: form.referral_type,
        is_existing_client: form.is_existing_client,
        preferred_contact: form.preferred_contact || null,
        best_contact_time: form.best_contact_time || null,
        notes: form.notes || null,
        assigned_to,
        requires_escalation,
        status: 'new',
      })
      .select('id')
      .single()

    if (error) {
      console.error('Supabase insert error:', error)
      return { success: false, error: 'Failed to save referral. Please try again.' }
    }

    return {
      success: true,
      referral_id: referral.id,
      client_name: `${form.client_first_name} ${form.client_last_name}`,
      assigned_to,
    }
  } catch (err) {
    console.error('Unexpected error:', err)
    return { success: false, error: 'Something went wrong. Please try again.' }
  }
}