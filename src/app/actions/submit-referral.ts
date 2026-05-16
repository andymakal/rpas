'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { referralSchema, type ReferralFormData } from '@/lib/schemas/referral'

export type SubmitReferralResult =
  | { success: true; referral_id: string; client_name: string }
  | { success: false; error: string }

export async function submitReferral(data: ReferralFormData): Promise<SubmitReferralResult> {
  const parsed = referralSchema.safeParse(data)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Validation failed' }
  }

  const form = parsed.data

  try {
    const supabase = createAdminClient()

    const { data: raw, error } = await supabase
      .from('intake_raw')
      .insert({
        agency_id: form.agency_id,
        source: 'form',
        raw_data: form,
      })
      .select('id')
      .single()

    if (error) {
      console.error('Supabase insert error:', error)
      return { success: false, error: 'Failed to save referral. Please try again.' }
    }

    const triggers = [
      form.life_insurance_outside_work && 'Life insurance outside work',
      form.job_change_last_5_years     && 'Job change in last 5 years',
      form.review_401k                 && '401(k) review',
      form.retirement_prep             && 'Retirement prep',
    ].filter(Boolean)

    console.log(`[RPAS] New intake: ${form.client_first_name} ${form.client_last_name} | Triggers: ${triggers.length > 0 ? triggers.join(', ') : 'none'}`)

    return {
      success: true,
      referral_id: raw.id,
      client_name: `${form.client_first_name} ${form.client_last_name}`,
    }
  } catch (err) {
    console.error('Unexpected error:', err)
    return { success: false, error: 'Something went wrong. Please try again.' }
  }
}
