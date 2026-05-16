'use server'

import { createAdminClient } from '@/lib/supabase/admin'

export type LogCaseResult =
  | { success: true; case_id: string }
  | { success: false; error: string }

export async function logCase(data: {
  agency_id: string
  agent_id?: string
  first_name: string
  last_name: string
  phone: string
  email?: string
  referral_type: string
  notes?: string
}): Promise<LogCaseResult> {
  const supabase = createAdminClient()

  try {
    const { data: customer, error: custError } = await supabase
      .from('customers')
      .insert({
        agency_id:  data.agency_id,
        first_name: data.first_name.trim(),
        last_name:  data.last_name.trim(),
        phone:      data.phone.trim(),
        email:      data.email?.trim() || null,
      })
      .select('id')
      .single()

    if (custError) {
      console.error('Customer insert error:', custError)
      return { success: false, error: 'Failed to create customer record.' }
    }

    const noteLines = [
      data.referral_type && `Referral type: ${data.referral_type}`,
      data.notes?.trim(),
    ].filter(Boolean)

    const { data: newCase, error: caseError } = await supabase
      .from('cases')
      .insert({
        agency_id:       data.agency_id,
        customer_id:     customer.id,
        agent_id:        data.agent_id || null,
        internal_status: 'lsp_contact_needed',
        notes:           noteLines.length > 0 ? noteLines.join('\n\n') : null,
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
