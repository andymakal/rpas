import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { AlertBanner, AlertEditor, type AlertRecord, type AlertEditResult } from './ContactAlert'

/**
 * Workflow Design System — Contact Alert.
 *
 * The reusable customer-alert surface: the prominent read-only banner shown at
 * the top of a customer's card, plus the editor. The alert is a single
 * free-text note; saving empty text clears it.
 */

const withAlert: AlertRecord = {
  contact_alert: 'Spouse handles all policy questions. Call after 5pm.',
}

const noAlert: AlertRecord = {
  contact_alert: null,
}

const meta: Meta<typeof AlertBanner> = {
  title: 'Workflow Design System/Contact Alert',
  component: AlertBanner,
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

type Story = StoryObj<typeof AlertBanner>

/** The alert banner as it appears at the top of the card. */
export const Banner: Story = {
  args: { alert: withAlert.contact_alert },
}

/** No alert: the banner renders nothing. */
export const NoAlert: Story = {
  args: { alert: noAlert.contact_alert },
}

/** The editor. Save logs the trimmed note (or null to clear); the banner above
 * updates to match. Clear the text and Save to remove the alert. */
export const Editor: StoryObj<typeof AlertEditor> = {
  render: () => {
    function Harness() {
      const [record, setRecord] = useState<AlertRecord>(withAlert)
      const [editing, setEditing] = useState(true)
      if (editing) {
        return (
          <AlertEditor
            record={record}
            onCancel={() => setEditing(false)}
            onSave={(value: AlertEditResult) => {
              setRecord({ contact_alert: value.alert })
              setEditing(false)
            }}
          />
        )
      }
      return (
        <div>
          <AlertBanner alert={record.contact_alert} />
          {!record.contact_alert && (
            <p className="text-base text-ink-muted">No alert on file.</p>
          )}
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="mt-3 rounded-lg border border-surface-border-strong bg-surface-card px-3 py-1.5 text-base font-medium text-ink-secondary hover:bg-surface-muted"
          >
            Edit alert
          </button>
        </div>
      )
    }
    return <Harness />
  },
}
