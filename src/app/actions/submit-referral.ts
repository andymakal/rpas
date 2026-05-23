'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { referralSchema, type ReferralFormData } from '@/lib/schemas/referral'

function toTitleCase(str: string): string {
  return str.trim().replace(/\b\w+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
}

export type SubmitReferralResult =
  | { success: true; referral_id: string; client_name: string }
  | { success: false; error: string }

export async function submitReferral(data: ReferralFormData): Promise<SubmitReferralResult> {
  const parsed = referralSchema.safeParse(data)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Validation failed' }
  }

  const form = parsed.data
  const supabase = createAdminClient()

  try {
    // 1. Find or create customer by name + agency; back-fill any missing contact fields
    let customerId: string

    const { data: existing } = await supabase
      .from('customers')
      .select('id, phone, email, date_of_birth, street')
      .eq('agency_id', form.agency_id)
      .ilike('first_name', form.client_first_name.trim())
      .ilike('last_name',  form.client_last_name.trim())
      .eq('is_test', false)
      .maybeSingle()

    if (existing) {
      customerId = existing.id

      // Back-fill any contact fields that were missing on the original record
      const contactUpdate: Record<string, unknown> = {}
      if (!existing.phone         && form.client_phone)   contactUpdate.phone         = form.client_phone
      if (!existing.email         && form.client_email)   contactUpdate.email         = form.client_email
      if (!existing.date_of_birth && form.client_dob)     contactUpdate.date_of_birth = form.client_dob
      if (!existing.street        && form.client_address) {
        contactUpdate.street = form.client_address
        if (form.client_city)  contactUpdate.city  = form.client_city
        if (form.client_state) contactUpdate.state = form.client_state
        if (form.client_zip)   contactUpdate.zip   = form.client_zip
      }
      if (Object.keys(contactUpdate).length > 0) {
        await supabase.from('customers').update(contactUpdate).eq('id', existing.id)
      }
    } else {
      const { data: newCustomer, error: custErr } = await supabase
        .from('customers')
        .insert({
          agency_id:     form.agency_id,
          first_name:    toTitleCase(form.client_first_name),
          last_name:     toTitleCase(form.client_last_name),
          phone:         form.client_phone    || null,
          email:         form.client_email    || null,
          date_of_birth: form.client_dob      || null,
          street:        form.client_address  || null,
          city:          form.client_city     || null,
          state:         form.client_state    || null,
          zip:           form.client_zip      || null,
          is_test:       false,
        })
        .select('id')
        .single()

      if (custErr || !newCustomer) {
        console.error('Customer insert error:', custErr)
        return { success: false, error: 'Failed to save referral. Please try again.' }
      }

      customerId = newCustomer.id
    }

    // 2. Compose notes from form context
    const flags = [
      form.life_insurance_outside_work && 'Life insurance outside work',
      form.job_change_last_5_years     && 'Job change in last 5 years',
      form.review_401k                 && '401(k) review',
      form.retirement_prep             && 'Retirement prep',
    ].filter(Boolean) as string[]

    const noteLines = [
      `Referred by: ${form.lsp_name}`,
      form.referral_type          ? `Type: ${form.referral_type}` : null,
      form.allstate_policy_number ? `Allstate Policy: ${form.allstate_policy_number.trim()}` : null,
      form.preferred_contact      ? `Contact: ${form.preferred_contact}` : null,
      form.best_contact_time      ? `Best time: ${form.best_contact_time}` : null,
      form.notes                  ? `Notes: ${form.notes}` : null,
      flags.length > 0            ? `Flags: ${flags.join(', ')}` : null,
    ].filter(Boolean)

    // 3. Check if submitted by the agency owner (email match)
    let isOwnerReferral = false
    if (form.lsp_email) {
      const { data: agencyRow } = await supabase
        .from('agencies')
        .select('contact_email')
        .eq('id', form.agency_id)
        .single()
      if (agencyRow?.contact_email &&
          agencyRow.contact_email.toLowerCase() === form.lsp_email.toLowerCase()) {
        isOwnerReferral = true
      }
    }

    // 4. Create case
    const { data: newCase, error: caseErr } = await supabase
      .from('cases')
      .insert({
        agency_id:          form.agency_id,
        customer_id:        customerId,
        internal_status:    'triage',
        notes:              noteLines.join('\n'),
        is_owner_referral:  isOwnerReferral,
        is_hot_lead:        form.is_hot_lead ?? false,
        consent_given_at:   new Date().toISOString(),
        is_test:            false,
      })
      .select('id')
      .single()

    if (caseErr || !newCase) {
      console.error('Case insert error:', caseErr)
      return { success: false, error: 'Failed to save referral. Please try again.' }
    }

    // 5. Create in-app notification for the internal team
    await supabase.from('notifications').insert({
      type:  'new_referral',
      title: `New referral: ${form.client_first_name} ${form.client_last_name}`,
      body:  `Referred by ${form.lsp_name}`,
      link:  `/referrals/${newCase.id}`,
    })

    // 6. Back-fill agent email if provided and not already on file
    if (form.lsp_email && form.lsp_name) {
      const parts     = form.lsp_name.trim().split(/\s+/)
      const firstName = parts[0]
      const lastName  = parts.slice(1).join(' ')
      if (firstName && lastName) {
        const { data: agentRow } = await supabase
          .from('agents')
          .select('id, email')
          .eq('agency_id', form.agency_id)
          .ilike('first_name', firstName)
          .ilike('last_name', lastName)
          .maybeSingle()
        if (agentRow && !agentRow.email) {
          await supabase
            .from('agents')
            .update({ email: form.lsp_email })
            .eq('id', agentRow.id)
        }
      }
    }

    // 7. Save to intake_raw as audit trail (already processed — case_id set)
    // Non-critical: log errors but don't fail the submission over an audit record
    const { error: rawErr } = await supabase.from('intake_raw').insert({
      agency_id:    form.agency_id,
      source:       'form',
      raw_data:     form,
      case_id:      newCase.id,
      processed_at: new Date().toISOString(),
      is_test:      false,
    })
    if (rawErr) console.error('intake_raw insert failed (case still created):', rawErr)

    return {
      success:     true,
      referral_id: newCase.id,
      client_name: `${form.client_first_name} ${form.client_last_name}`,
    }
  } catch (err) {
    console.error('Unexpected error:', err)
    return { success: false, error: 'Something went wrong. Please try again.' }
  }
}
