import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { AddressDisplay, AddressEditor, type AddressRecord, type AddressEditResult } from './ContactAddress'

/**
 * Workflow Design System — Contact Mailing Address.
 *
 * The reusable mailing-address surface, rendered as the real shared component.
 * Normalization lives in `@/lib/fmt` (street title-cases but keeps
 * directionals/PO uppercase; city title-cases; state uppercases); a usable
 * address needs street, city, state, AND ZIP, and Verified is gated on that.
 */

const full: AddressRecord = {
  street: '123 Main St',
  city: 'Philadelphia',
  state: 'PA',
  zip: '19103',
  address_verified_at: '2026-01-04T12:00:00Z',
}

const partial: AddressRecord = {
  street: '123 Main St',
  city: 'Philadelphia',
  state: null,
  zip: null,
  address_verified_at: null,
}

const missing: AddressRecord = {
  street: null,
  city: null,
  state: null,
  zip: null,
  address_verified_at: null,
}

const meta: Meta<typeof AddressDisplay> = {
  title: 'Workflow Design System/Contact Mailing Address',
  component: AddressDisplay,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="max-w-lg bg-workflow-surface p-6 font-workflow">
        <Story />
      </div>
    ),
  ],
}
export default meta

type Story = StoryObj<typeof AddressDisplay>

const valueCls = 'text-lg font-medium text-ink'
const missingCls = 'text-ink-muted'

/** A complete address: two lines, street then "City, ST ZIP". */
export const Full: Story = {
  args: { address: full, className: valueCls },
}

/** An incomplete address (no state/ZIP): the known parts still show. */
export const Partial: Story = {
  args: { address: partial, className: valueCls, missingClassName: missingCls },
}

/** Nothing on file: reads "Missing". */
export const Missing: Story = {
  args: { address: missing, className: valueCls, missingClassName: missingCls },
}

/** The editor. Save logs the normalized values + verified intent; the display
 * updates to match. Try lowercase input to see normalization, or clearing a
 * field to see Verified disable. */
export const Editor: StoryObj<typeof AddressEditor> = {
  render: () => {
    function Harness() {
      const [record, setRecord] = useState<AddressRecord>(full)
      const [editing, setEditing] = useState(true)
      if (editing) {
        return (
          <AddressEditor
            record={record}
            onCancel={() => setEditing(false)}
            onSave={(value: AddressEditResult) => {
              setRecord({
                street: value.street,
                city: value.city,
                state: value.state,
                zip: value.zip,
                address_verified_at: value.verified ? new Date().toISOString() : null,
              })
              setEditing(false)
            }}
          />
        )
      }
      return (
        <div>
          <AddressDisplay address={record} className={valueCls} missingClassName={missingCls} />
          <p className="mt-2 text-base text-ink-secondary">
            {record.address_verified_at ? 'Customer verified' : 'Not verified'}
          </p>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="mt-3 rounded-lg border border-surface-border-strong bg-surface-card px-3 py-1.5 text-base font-medium text-ink-secondary hover:bg-surface-muted"
          >
            Edit address
          </button>
        </div>
      )
    }
    return <Harness />
  },
}
