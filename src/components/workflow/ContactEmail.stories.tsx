import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { EmailDisplay, EmailEditor, type EmailRecord, type EmailEditResult } from './ContactEmail'
import type { EmailAvailability } from '@/lib/email-availability'

/**
 * Workflow Design System — Contact Email.
 *
 * The reusable email surface, rendered as the real shared component. All
 * normalization/validation (trim + lowercase + shape check) lives in
 * `@/lib/contact-input` and the availability state set in
 * `@/lib/email-availability`; these stories exercise the display and the editor.
 *
 * The editor: a usable address and the three availability reasons (Missing /
 * No Usable Email / Undeliverable) are mutually exclusive — picking a reason
 * clears the typed email and the Verified checkbox; a usable address re-enables
 * Verified and, on save, flips availability back to "on file".
 */

const onFile: EmailRecord = {
  email: 'jane.doe@example.com',
  email_availability: 'available',
  email_verified_at: '2026-01-04T12:00:00Z',
}

const missing: EmailRecord = {
  email: null,
  email_availability: null,
  email_verified_at: null,
}

const noUsable: EmailRecord = {
  email: null,
  email_availability: 'no_address',
  email_verified_at: null,
}

const undeliverable: EmailRecord = {
  email: null,
  email_availability: 'undeliverable',
  email_verified_at: null,
}

const meta: Meta<typeof EmailDisplay> = {
  title: 'Workflow Design System/Contact Email',
  component: EmailDisplay,
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

type Story = StoryObj<typeof EmailDisplay>

const valueCls = 'text-lg font-medium text-ink'
const missingCls = 'text-ink-muted'

/** A usable address on file: shown as-is, trimmed and lowercased. */
export const OnFile: Story = {
  args: { email: onFile.email, availability: onFile.email_availability, className: valueCls },
}

/** Nothing on file and no reason recorded: reads "Missing". */
export const Missing: Story = {
  args: { email: missing.email, availability: missing.email_availability, className: valueCls, missingClassName: missingCls },
}

/** No usable email reason recorded: reads "No Usable Email". */
export const NoUsableEmail: Story = {
  args: { email: noUsable.email, availability: noUsable.email_availability, className: valueCls, missingClassName: missingCls },
}

/** A known address permanently failed: reads "Undeliverable". */
export const Undeliverable: Story = {
  args: { email: undeliverable.email, availability: undeliverable.email_availability, className: valueCls, missingClassName: missingCls },
}

/** The editor. Save logs the resolved email + availability + verified intent;
 * the display updates to match. Try typing an invalid address, or picking a
 * reason, to see the mutual exclusivity and verified gating. */
export const Editor: StoryObj<typeof EmailEditor> = {
  render: () => {
    function Harness() {
      const [record, setRecord] = useState<EmailRecord>(onFile)
      const [editing, setEditing] = useState(true)
      if (editing) {
        return (
          <EmailEditor
            record={record}
            onCancel={() => setEditing(false)}
            onSave={(value: EmailEditResult) => {
              setRecord({
                email: value.email,
                email_availability: value.availability as EmailAvailability | null,
                email_verified_at: value.verified ? new Date().toISOString() : null,
              })
              setEditing(false)
            }}
          />
        )
      }
      return (
        <div>
          <EmailDisplay email={record.email} availability={record.email_availability} className={valueCls} missingClassName={missingCls} />
          <p className="mt-2 text-base text-ink-secondary">
            {record.email_verified_at ? 'Customer verified' : 'Not verified'}
          </p>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="mt-3 rounded-lg border border-surface-border-strong bg-surface-card px-3 py-1.5 text-base font-medium text-ink-secondary hover:bg-surface-muted"
          >
            Edit email
          </button>
        </div>
      )
    }
    return <Harness />
  },
}
