import type { Meta, StoryObj } from '@storybook/react'
import { useEffect, useState } from 'react'

import { WorkflowSurface } from './index'
import {
  MentoringProvider,
  MENTORING_STORAGE_KEY,
} from '@/lib/mentoring/MentoringProvider'
import { MentorToggle } from '@/lib/mentoring/MentorUi'
import {
  CustomerContactCard,
  type CustomerContact,
  type ContactPersistPayload,
} from './CustomerContactCard'

/**
 * Workflow Design System — Customer Contact.
 *
 * The reusable customer-contact surface: the customer's name is the card
 * heading, with an expandable Mentoring tip beneath it, over one card holding
 * three compact sections — Email, Phone, Mailing Address. In each section the
 * status indicator, contact icon, and field label share one status color (green
 * = verified, amber = on file not verified, red = missing); the value stays in
 * normal high-contrast text. The Verified checkbox sits on the heading line at
 * the right, the full value beneath with Edit at its right, and "Missing" marks
 * an absent value. A compact key at the foot repeats the three icons and
 * colors. Status meaning never relies on color alone — each icon is a distinct
 * shape with an accessible label.
 *
 * STORYBOOK-ONLY. These stories inject an in-memory `onPersist`, so editing and
 * verifying work interactively without any database or API. The rules the real
 * card enforces are reproduced here: a changed value clears its verification,
 * and a missing/unusable value cannot be verified. A Mentoring toggle is shown
 * above the card so the expandable Mentoring tip can be exercised.
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
        <MentoringProvider>
          <div className="mx-auto max-w-md space-y-3">
            {/* The Mentoring tip inside the card follows this global preference. */}
            <div className="flex justify-end"><MentorToggle /></div>
            <Story />
          </div>
        </MentoringProvider>
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
 *
 * `mentoringOn` seeds the shared Mentoring preference so a story can show the
 * tip expanded by default without the reviewer toggling it first.
 */
function Interactive({ initial, mentoringOn = true }: { initial: CustomerContact; mentoringOn?: boolean }) {
  const [record, setRecord] = useState<CustomerContact>(initial)

  // Seed the browser-scoped Mentoring preference before the provider hydrates.
  useEffect(() => {
    try { window.localStorage.setItem(MENTORING_STORAGE_KEY, mentoringOn ? 'on' : 'off') } catch { /* ignore */ }
  }, [mentoringOn])

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

  return <CustomerContactCard customer={record} onPersist={onPersist} />
}

/** Complete information on file, none of it verified yet: each section (icons +
 * label) reads amber. The Mentoring tip is expanded. */
export const Complete: Story = {
  render: () => <Interactive initial={base} />,
}

/** Everything missing: each section (icons + label) reads red with "Missing",
 * and the Verified checkbox is disabled until a usable value is saved. */
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

/** All three fields verified: each section reads green. Editing any value here
 * clears that field's verification (try it — the section drops back to amber). */
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
 * A mixed, partially complete record showing all three status colors at once: a
 * verified phone (green), an unverified email (amber), and a missing mailing
 * address (red). Open any field's Edit to see the independent editors — email
 * and phone each on their own, the address as a single street / city / state /
 * ZIP group with Save and Cancel.
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
