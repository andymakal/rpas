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
  type OverviewAlert,
} from './CustomerOverviewPrototype'

/**
 * Workflow Design System — Prototypes → Customer Overview.
 *
 * A Storybook-only prototype of a SIMPLIFIED Right Path Customer Overview. It
 * reuses the real shared `CustomerContactCard` for the contact section (so
 * contact editing and the Verified behavior are the production behavior, not a
 * copy) and composes the existing light workflow tokens around it.
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
  gender: 'female',
  marital_status: 'married',

  is_prospect: false,
  is_former_client: false,
  is_deceased: false,

  classification: 'A — Priority household',
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
      }
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
    default:
      return prev
  }
}

/**
 * A live host: keeps the contact record in local state so the embedded card
 * stays fully interactive (edit a field, tick Verified) with no side effects.
 * The non-contact overview fields (status flags, classification, DOB, gender,
 * marital status) come straight from the sample and do not change here.
 */
function LiveOverview({
  initial,
  alert,
  defaultExpanded,
}: {
  initial: OverviewCustomer
  alert?: OverviewAlert
  defaultExpanded?: boolean
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
      alert={alert}
      defaultExpanded={defaultExpanded}
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

/** Default view: prominent name, Active status, secondary classification, and
 * the contact card. Address shows in normal capitalization though it is stored
 * all-caps. The "Customer details" section starts collapsed. */
export const Default: Story = {
  render: () => <LiveOverview initial={baseCustomer} />,
}

/** Expanded view: the secondary customer details (masked DOB, gender, marital
 * status) are open. Tobacco, health notes, preferred language, and the Drive
 * folder are intentionally not here. */
export const Expanded: Story = {
  render: () => <LiveOverview initial={baseCustomer} defaultExpanded />,
}

/** Prospect status, to show the alternate primary badge. */
export const Prospect: Story = {
  render: () => (
    <LiveOverview
      initial={{
        ...baseCustomer,
        is_prospect: true,
        classification: 'Unassigned lead',
      }}
    />
  ),
}

/** Optional variation: a prominent customer alert above the contact
 * information, similar to eAgent's alert box. Display-only — no persistence,
 * no new database field. */
export const WithAlert: Story = {
  render: () => (
    <LiveOverview
      initial={baseCustomer}
      alert={{
        message: 'Do not call before 10:00 AM — customer request.',
        detail: 'Noted on the last review. Mornings go to voicemail.',
      }}
    />
  ),
}
