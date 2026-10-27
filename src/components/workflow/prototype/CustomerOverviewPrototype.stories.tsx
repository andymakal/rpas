import type { Meta, StoryObj } from '@storybook/react'
import { useMemo, useState } from 'react'

import { MentoringProvider } from '@/lib/mentoring/MentoringProvider'
import { WorkflowSurface } from '@/components/workflow'
import { normalizeStreet, normalizeCity, normalizeState } from '@/lib/fmt'
import type {
  CustomerContact,
  ContactPersistPayload,
} from '@/components/workflow/CustomerContactCard'
import {
  CustomerOverviewPrototype,
  type OverviewCustomer,
} from './CustomerOverviewPrototype'

/**
 * Workflow Design System — Prototypes → Customer Overview.
 *
 * A Storybook-only prototype of a SIMPLIFIED Right Path Customer Overview. It
 * reuses the real shared `CustomerContactCard` in its two presentation modes:
 * a compact read-only Overview with one Edit button, and the existing per-field
 * editing + verification controls. The same card drives both; the prototype
 * only suppresses the card's own name/mentoring and owns the single name,
 * status, classification, and calculated age.
 *
 * Nothing here touches production routes, the customer record screen, the API,
 * the database, or any real customer data. The card runs on an in-memory
 * `onPersist` that mirrors the server rules: changing a value clears that
 * field's verification; selecting an email-availability reason clears the
 * active email. The address is normalized for DISPLAY with Right Path's own
 * `normalizeStreet`/`normalizeCity`/`normalizeState`, so the card shows (and
 * copies) normal capitalization while the stored address is left untouched.
 */

// ── A sample record stored in ALL CAPS to exercise display normalization ──────

const baseCustomer: OverviewCustomer = {
  id: 'overview-prototype-customer',
  first_name: 'Marisol',
  last_name: 'DeLuca',
  email: 'marisol.deluca@example.com',
  phone: '(215) 555-0184',
  // Stored all-caps on purpose: the overview normalizes it for display while
  // preserving the NE abbreviation and the two-letter state.
  street: '1420 NE CHESTNUT ST APT 2B',
  address_line1: null,
  city: 'PHILADELPHIA',
  state: 'pa',
  zip: '19102',
  email_verified_at: '2026-10-10T15:00:00.000Z',
  phone_verified_at: '2026-10-10T15:00:00.000Z',
  address_verified_at: null,
  email_availability: 'available',

  date_of_birth: '1979-06-14',

  is_prospect: false,
  is_former_client: false,
  is_deceased: false,

  segment: 'explorer',
}

// ── In-memory persistence (mirrors the server rules; no network, no data) ─────

/**
 * Build an `onPersist` bound to local React state. It applies the same rules
 * the real contact route does, and additionally normalizes a saved address the
 * same way the overview display does, so an edited address stays in normal
 * capitalization after the card re-renders from the returned row.
 */
function makeInteractivePersist(
  setRecord: React.Dispatch<React.SetStateAction<CustomerContact>>,
) {
  return (_id: string, payload: ContactPersistPayload): Promise<CustomerContact> =>
    new Promise((resolve) => {
      setRecord((prev) => {
        const next = applyPayload(prev, payload)
        // Resolve with the authoritative row the card re-renders from.
        queueMicrotask(() => resolve(next))
        return next
      })
    })
}

/** Apply one contact payload to a record, mirroring the server rules. Split out
 * so the `verified` toggle is discriminated before the field switch (the union
 * shares `field` between the typed-value payloads and the verified payload). */
function applyPayload(
  prev: CustomerContact,
  payload: ContactPersistPayload,
): CustomerContact {
  // Verification toggle first: { field, verified }.
  if ('verified' in payload) {
    const stampKey =
      payload.field === 'email'
        ? 'email_verified_at'
        : payload.field === 'phone'
          ? 'phone_verified_at'
          : 'address_verified_at'
    return { ...prev, [stampKey]: payload.verified ? new Date().toISOString() : null }
  }

  switch (payload.field) {
    case 'email':
      return {
        ...prev,
        email: payload.email,
        // A changed value clears its verification.
        email_verified_at: payload.email === prev.email ? prev.email_verified_at : null,
        // Saving a usable email returns availability to "available".
        email_availability: payload.email ? 'available' : prev.email_availability,
      }
    case 'phone':
      return {
        ...prev,
        phone: payload.phone,
        phone_verified_at: payload.phone === prev.phone ? prev.phone_verified_at : null,
        // A changed number restores text availability (failure was scoped to the
        // old number). Do Not Text follows the customer, so it is unaffected.
        text_undeliverable: payload.phone === prev.phone ? prev.text_undeliverable : false,
      }
    case 'sms':
      return { ...prev, sms_opt_out: payload.do_not_text }
    case 'sms_undeliverable':
      return { ...prev, text_undeliverable: !!prev.phone?.trim() }
    case 'address': {
      // Normalize for display exactly as the overview does.
      const street = normalizeStreet(payload.street)
      const city = normalizeCity(payload.city)
      const state = normalizeState(payload.state)
      const zip = payload.zip
      const changed =
        street !== prev.street ||
        city !== prev.city ||
        state !== prev.state ||
        zip !== prev.zip
      return {
        ...prev,
        street,
        city,
        state,
        zip,
        address_verified_at: changed ? null : prev.address_verified_at,
      }
    }
    case 'email_availability':
      return {
        ...prev,
        // Selecting a "no usable email" reason clears the active email and its
        // verification; 'missing' resets the column to unknown.
        email: null,
        email_verified_at: null,
        email_availability:
          payload.availability === 'missing' ? null : payload.availability,
      }
    case 'alert':
      // One current alert; empty clears it. Mirrors the server's trim+null rule.
      return {
        ...prev,
        contact_alert: payload.alert?.trim() ? payload.alert.trim() : null,
      }
    default:
      return prev
  }
}

/**
 * A live host: keeps the contact record in local state so the embedded card
 * stays fully interactive (edit a field, tick Verified) with no side effects.
 * The non-contact overview fields (status flags, classification, DOB) come
 * straight from the sample and do not change here.
 */
function LiveOverview({
  initial,
  initialAlert,
  startExpanded,
}: {
  initial: OverviewCustomer
  initialAlert?: string | null
  startExpanded?: boolean
}) {
  const [contact, setContact] = useState<CustomerContact>(initial)
  const onPersist = useMemo(() => makeInteractivePersist(setContact), [])

  // Compose the overview record from the live contact fields + the static
  // identity/classification fields of the sample.
  const customer: OverviewCustomer = {
    ...initial,
    email: contact.email,
    phone: contact.phone,
    street: contact.street,
    address_line1: contact.address_line1 ?? null,
    city: contact.city,
    state: contact.state,
    zip: contact.zip,
    email_verified_at: contact.email_verified_at,
    phone_verified_at: contact.phone_verified_at,
    address_verified_at: contact.address_verified_at,
    email_availability: contact.email_availability,
  }

  return (
    <CustomerOverviewPrototype
      customer={customer}
      onPersist={onPersist}
      onContactChange={setContact}
      initialAlert={initialAlert}
      startExpanded={startExpanded}
    />
  )
}

// ── Meta + stories ───────────────────────────────────────────────────────────

const meta = {
  title: 'Workflow Design System/Prototypes/Customer Overview',
  component: CustomerOverviewPrototype,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Storybook-only prototype of a simplified Right Path Customer Overview. Reuses the real CustomerContactCard; interactive and side-effect free. Address is normalized for display with the existing utilities; stored data is never modified.',
      },
    },
  },
  decorators: [
    (Story) => (
      <MentoringProvider>
        <WorkflowSurface>
          <Story />
        </WorkflowSurface>
      </MentoringProvider>
    ),
  ],
} satisfies Meta<typeof CustomerOverviewPrototype>

export default meta
type Story = StoryObj<typeof CustomerOverviewPrototype>

/**
 * Overview mode (the Customer Overview default): one name, status, Right Path
 * classification, calculated age, and a compact read-only email / phone /
 * address with a single Edit button. The address shows in normal capitalization
 * though it is stored all-caps. Click Edit to expand the same card into its
 * editing + verification controls, then Done to return.
 */
export const Overview: Story = {
  render: () => <LiveOverview initial={baseCustomer} />,
}

/**
 * Edit mode (how Contact Research would start): the same card opened to its
 * existing per-field editing + verification controls. Click Done to collapse
 * back to the Overview. This is the identical card, started expanded.
 */
export const Edit: Story = {
  render: () => <LiveOverview initial={baseCustomer} startExpanded />,
}

/** Prospect status with an unassigned classification, to show the alternate
 * badges. */
export const Prospect: Story = {
  render: () => (
    <LiveOverview
      initial={{
        ...baseCustomer,
        is_prospect: true,
        segment: null,
      }}
    />
  ),
}

/**
 * Starts with a customer alert already set, so the prominent banner shows near
 * the top of the card and the bottom control offers Edit alert / Clear. The
 * alert is in-memory and card-owned; edit or clear it live. The Overview and
 * Edit stories above start with no alert, so the control reads "Add Alert".
 */
export const WithAlert: Story = {
  render: () => (
    <LiveOverview
      initial={baseCustomer}
      initialAlert={'Do not call before 10:00 AM (customer request).\nMornings go to voicemail.'}
    />
  ),
}
