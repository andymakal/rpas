import type { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Retire a failed email address from active customer contact info when an email
 * is recorded UNDELIVERABLE during outreach, making the outreach workflow
 * consistent with the Contact Card's Undeliverable behavior
 * (`src/app/api/customers/[id]/contact/route.ts`, the `email_availability`
 * branch).
 *
 * The outreach record already PRESERVES the failed address and the outcome in
 * Customer History via the value-scoped unusable marker
 * (`[channel-unusable:<email>]`) written on the email touch, so this helper does
 * NOT write a second history entry — doing so would duplicate the record. Its
 * single job is the customer-row write the outreach routes previously omitted:
 * set `email_availability = 'undeliverable'`, and remove the failed address from
 * active use (`email`/`email_verified_at` cleared). The Contact Card reads
 * `resolveEmailAvailabilityDisplay(email_availability, email)`, so this write
 * makes the card reflect Undeliverable immediately.
 *
 * Guarded on the still-matching failed value: the update only lands when the
 * email on file is still exactly the address that failed
 * (`.eq('email', failedEmail)`). If a replacement email was entered after the
 * failure (a concurrent Contact Card edit, or a research-found value), the row
 * no longer matches and nothing is overwritten — exactly the bad-number
 * phone-clear contract. Entering a usable replacement email restores normal
 * availability through the shared contact route's email-save path (it flips
 * `email_availability` back to `'available'`), and the display resolver already
 * shows a present address as on-file regardless of the stored reason.
 *
 * This is informational only: it never suppresses research, routes a queue,
 * closes a case, stops servicing, or changes any outreach stage. Best-effort and
 * non-fatal: the caller has already saved the attempt history (the source of
 * truth for what failed), so a failure here is logged and swallowed.
 */
export async function retireUndeliverableEmail(
  admin: AdminClient,
  customerId: string,
  failedEmail: string | null,
): Promise<void> {
  const value = failedEmail?.trim()
  if (!value) return // no address was on file to retire

  const { error } = await admin
    .from('customers')
    .update({
      email: null,
      email_verified_at: null,
      email_availability: 'undeliverable',
    })
    .eq('id', customerId)
    .eq('email', value)
    .eq('is_test', false)
  if (error) {
    // Non-fatal: the Undeliverable outcome is already preserved in Customer
    // History via the value-scoped unusable marker. Log for visibility.
    console.error('outreach undeliverable email retire error:', error)
  }
}
