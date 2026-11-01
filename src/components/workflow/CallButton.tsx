'use client'

/**
 * CallButton — the one shared "dial the customer" Lego.
 *
 * Every outbound-call surface dials identically through this single control: it
 * opens the system dialer (RingCentral) via a `tel:` link on the stored phone,
 * and shows the number in the standard (XXX) XXX-XXXX display form regardless of
 * how it is stored (`formatPhoneDisplay` strips to digits first). The host
 * passes the phone value it already has on the customer record — per the UI
 * composition vocabulary, a Lego takes host-supplied data and does no fetching
 * of its own. When there is no usable number, it renders the disabled
 * "No phone on file" state. Launching the dialer is NOT proof the call happened;
 * the surface records the outcome separately.
 */

import { Phone } from 'lucide-react'
import { formatPhoneDisplay } from '@/lib/contact-input'
import { PrimaryAction } from './primitives'

export function CallButton({
  phone,
}: {
  /** The customer's stored phone (bare digits or any legacy form). Null/empty
   * renders the disabled "No phone on file" state. */
  phone?: string | null
}) {
  if (!phone) {
    return <PrimaryAction icon={Phone} label="No phone on file" disabled />
  }
  return (
    <a href={`tel:${phone}`} className="block">
      <PrimaryAction icon={Phone} label={`Call ${formatPhoneDisplay(phone)}`} />
    </a>
  )
}
