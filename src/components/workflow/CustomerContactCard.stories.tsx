import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'

import { WorkflowSurface } from './index'
import {
  CustomerContactCard,
  type CustomerContact,
  type ContactPersistPayload,
} from './CustomerContactCard'

/**
 * Workflow Design System — Customer Contact.
 *
 * The reusable customer-contact surface: name on top, then email, phone, and
 * mailing address stacked and shown in full. Each field carries a green / yellow
 * / red status (Customer Verified / On File — Not Verified / Missing or
 * Unusable), an independent Edit action, and a Customer Verified checkbox.
 * Email and phone edit on their own; the mailing address edits as one group.
 *
 * STORYBOOK-ONLY. These stories inject an in-memory `onPersist`, so editing and
 * verifying work interactively without any database or API. The rules the real
 * card enforces are reproduced here: a changed value clears its verification,
 * and a missing/unusable value cannot be verified.
 */
const base: CustomerContact = {
  id: 'demo-customer',
  first_name: 'Jordan',
  last_name: 'Rivera',
  email: 'jordan.rivera@example.com',
  phone: '(215) 555-0142',
  street: '1420 Chestnut St',
  address_line1: null,
  city: 'Philadelphia',
  state: 'PA',
  zip: '19102',
  email_verified_at: null,
  phone_verified_at: null,
  address_verified_at: null,
}

const meta = {
  title: 'Workflow Design System/Customer Contact',
  component: CustomerContactCard,
  // Each story uses an interactive wrapper via `render`, so these args are only
  // here to satisfy the required-prop type; they are not rendered directly.
  args: { customer: base },
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <WorkflowSurface className="min-h-screen p-6">
        <div className="mx-auto max-w-md">
          <Story />
        </div>
      </WorkflowSurface>
    ),
  ],
} satisfies Meta<typeof CustomerContactCard>

export default meta
type Story = StoryObj<typeof meta>

/**
 * An in-memory persistence stub that mirrors the server rules: a save that
 * changes a value clears that field's verification; a verify toggle stamps or
 * clears the timestamp. Keeps the card fully interactive in isolation.
 */
function Interactive({ initial }: { initial: CustomerContact }) {
  const [record, setRecord] = useState<CustomerContact>(initial)

  const onPersist = async (
    _id: string,
    payload: ContactPersistPayload,
  ): Promise<CustomerContact> => {
    const now = new Date().toISOString()
    let next = record

    if ('verified' in payload) {
      const col =
        payload.field === 'email' ? 'email_verified_at'
        : payload.field === 'phone' ? 'phone_verified_at'
        : 'address_verified_at'
      next = { ...record, [col]: payload.verified ? now : null }
    } else if (payload.field === 'email') {
      const changed = (payload.email ?? null) !== (record.email ?? null)
      next = { ...record, email: payload.email, email_verified_at: changed ? null : record.email_verified_at }
    } else if (payload.field === 'phone') {
      const changed = (payload.phone ?? null) !== (record.phone ?? null)
      next = { ...record, phone: payload.phone, phone_verified_at: changed ? null : record.phone_verified_at }
    } else {
      next = {
        ...record,
        street: payload.street, city: payload.city, state: payload.state, zip: payload.zip,
        address_verified_at: null,
      }
    }

    setRecord(next)
    return next
  }

  return <CustomerContactCard heading="Customer contact" customer={record} onPersist={onPersist} />
}

/** Complete information on file, none of it customer-verified yet (all yellow). */
export const Complete: Story = {
  render: () => <Interactive initial={base} />,
}

/** Everything missing: each field reads red and "Missing", and verification is
 * blocked until a usable value is saved. */
export const Missing: Story = {
  render: () => (
    <Interactive
      initial={{
        ...base,
        email: null,
        phone: null,
        street: null,
        city: null,
        state: null,
        zip: null,
        email_verified_at: null,
        phone_verified_at: null,
        address_verified_at: null,
      }}
    />
  ),
}

/** All three fields customer-verified: each reads green. Editing any value here
 * clears that field's verification (try it — the field drops back to yellow). */
export const Verified: Story = {
  render: () => (
    <Interactive
      initial={{
        ...base,
        email_verified_at: '2026-10-10T15:00:00.000Z',
        phone_verified_at: '2026-10-10T15:00:00.000Z',
        address_verified_at: '2026-10-10T15:00:00.000Z',
      }}
    />
  ),
}

/**
 * A mixed, partially complete record: a verified phone (green), an unverified
 * email (yellow), and a missing mailing address (red). Open any field's Edit to
 * see the independent editors — email and phone each on their own, the address
 * as a single street / city / state / ZIP group with Save and Cancel.
 */
export const Editing: Story = {
  render: () => (
    <Interactive
      initial={{
        ...base,
        email: 'jordan.rivera@example.com',
        email_verified_at: null,
        phone: '(215) 555-0142',
        phone_verified_at: '2026-10-10T15:00:00.000Z',
        street: null,
        city: null,
        state: null,
        zip: null,
        address_verified_at: null,
      }}
    />
  ),
}
