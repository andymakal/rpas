import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { PhoneDisplay, PhoneEditor, type PhoneRecord, type PhoneEditResult } from './ContactPhone'

/**
 * Workflow Design System — Contact Phone.
 *
 * The reusable phone surface, rendered as the real shared component. All
 * formatting/validation ((XXX) XXX-XXXX, the one standard) lives in
 * `@/lib/contact-input` and the texting status set in `@/lib/sms-availability`;
 * these stories exercise the display and the editor.
 *
 * Texting belongs to the phone. The editor carries the two restrictions:
 *   - Do Not Text — the durable customer opt-out; togglable even with no number.
 *   - Text Undeliverable — a delivery failure for the number on file; needs a
 *     number, is moot while Do Not Text is on, and is locked on when the current
 *     number already failed (it clears only by replacing the number).
 * Both disable texting only; calls are never affected.
 */

const onFile: PhoneRecord = {
  phone: '(215) 555-0100',
  sms_opt_out: false,
  text_undeliverable: false,
  phone_verified_at: '2026-01-04T12:00:00Z',
}

const missing: PhoneRecord = {
  phone: null,
  sms_opt_out: false,
  text_undeliverable: false,
  phone_verified_at: null,
}

const doNotText: PhoneRecord = {
  phone: '(215) 555-0100',
  sms_opt_out: true,
  text_undeliverable: false,
  phone_verified_at: null,
}

const undeliverable: PhoneRecord = {
  phone: '(215) 555-0100',
  sms_opt_out: false,
  text_undeliverable: true,
  phone_verified_at: null,
}

const meta: Meta<typeof PhoneDisplay> = {
  title: 'Workflow Design System/Contact Phone',
  component: PhoneDisplay,
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

type Story = StoryObj<typeof PhoneDisplay>

const valueCls = 'text-lg font-medium text-ink'
const missingCls = 'text-ink-muted'
const noteCls = 'text-sm font-normal text-status-missing-strong'

/** A usable number with texting available: just the formatted number. */
export const OnFile: Story = {
  args: { phone: onFile.phone, smsOptOut: false, textUndeliverable: false, className: valueCls, noteClassName: noteCls },
}

/** No number on file: reads "Missing". */
export const Missing: Story = {
  args: { phone: missing.phone, smsOptOut: false, textUndeliverable: false, className: valueCls, missingClassName: missingCls, noteClassName: noteCls },
}

/** Do Not Text: the number still shows (calls are fine) with a texting-off note. */
export const DoNotText: Story = {
  args: { phone: doNotText.phone, smsOptOut: true, textUndeliverable: false, className: valueCls, noteClassName: noteCls },
}

/** Text Undeliverable: the number shows with a delivery-failure note. */
export const Undeliverable: Story = {
  args: { phone: undeliverable.phone, smsOptOut: false, textUndeliverable: true, className: valueCls, noteClassName: noteCls },
}

/** The editor. Save logs the resolved number + texting selections + verified
 * intent; the display updates to match. Try clearing the number to see Text
 * Undeliverable and Verified disable, or turning on Do Not Text. */
export const Editor: StoryObj<typeof PhoneEditor> = {
  render: () => {
    function Harness() {
      const [record, setRecord] = useState<PhoneRecord>(onFile)
      const [editing, setEditing] = useState(true)
      if (editing) {
        return (
          <PhoneEditor
            record={record}
            onCancel={() => setEditing(false)}
            onSave={(value: PhoneEditResult) => {
              setRecord({
                phone: value.phone,
                sms_opt_out: value.doNotText,
                // A newly recorded failure, or an existing one preserved while
                // the number is unchanged (the editor never clears a failure).
                text_undeliverable: value.markUndeliverable || (record.text_undeliverable && value.phone === record.phone),
                phone_verified_at: value.verified ? new Date().toISOString() : null,
              })
              setEditing(false)
            }}
          />
        )
      }
      return (
        <div>
          <PhoneDisplay
            phone={record.phone}
            smsOptOut={record.sms_opt_out}
            textUndeliverable={record.text_undeliverable}
            className={valueCls}
            missingClassName={missingCls}
            noteClassName={noteCls}
          />
          <p className="mt-2 text-base text-ink-secondary">
            {record.phone_verified_at ? 'Customer verified' : 'Not verified'}
          </p>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="mt-3 rounded-lg border border-surface-border-strong bg-surface-card px-3 py-1.5 text-base font-medium text-ink-secondary hover:bg-surface-muted"
          >
            Edit phone
          </button>
        </div>
      )
    }
    return <Harness />
  },
}
