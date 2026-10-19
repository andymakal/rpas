import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'

import { CustomerHistoryCard, NextHistoryEntry } from './CustomerHistoryCard'
import type { HistoryEvent } from '@/lib/stewardship/customer-history'
import { describeNextHistoryEntry } from '@/lib/stewardship/customer-history'

/**
 * Workflow Design System — Customer History.
 *
 * The reusable Customer History card, rendered as the real shared component
 * over the existing customer history model (case_touches, grouped into
 * interactions). It shows the five most recent interactions newest first, with
 * Show All and its own independent scroll; each event reads as what happened,
 * who recorded it, and when (MM/DD/YYYY, h:mm AM/PM). Several communications
 * from one interaction are grouped into one event while the underlying
 * communications stay available.
 *
 * NextHistoryEntry (shown below) is the preview of what completing the current
 * work will record — completing the work logs it automatically, so the worker
 * never logs the same activity by hand.
 */

function daysAgo(n: number, hour = 10, minute = 15): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(hour, minute, 0, 0)
  return d.toISOString()
}

const events: HistoryEvent[] = [
  {
    at: daysAgo(0, 14, 5),
    summary: 'Spoke with the customer (also sent a text)',
    by: 'Dulce Alvarez',
    reached: true,
    communications: [
      { id: 'c1', channel: 'call', outcome: 'touch', reached: true, detail: 'Spoke with the customer' },
      { id: 'c2', channel: 'text', outcome: 'touch', reached: false, detail: null },
    ],
  },
  {
    at: daysAgo(3, 9, 40),
    summary: 'Called the customer, no answer \u00b7 Left a voicemail',
    by: 'Dulce Alvarez',
    reached: false,
    communications: [
      { id: 'c3', channel: 'call', outcome: 'no_contact', reached: false, detail: null },
      { id: 'c4', channel: 'voicemail', outcome: 'touch', reached: false, detail: null },
    ],
  },
  {
    at: daysAgo(6, 11, 20),
    summary: 'Sent an email',
    by: 'Andy Makal',
    reached: false,
    communications: [
      { id: 'c5', channel: 'email', outcome: 'touch', reached: false, detail: 'Introductory servicing-agent email sent to the customer.' },
    ],
  },
  {
    at: daysAgo(9, 15, 0),
    summary: 'Called the customer, no answer',
    by: 'Andy Makal',
    reached: false,
    communications: [{ id: 'c6', channel: 'call', outcome: 'no_contact', reached: false, detail: null }],
  },
  {
    at: daysAgo(12, 10, 10),
    summary: 'Left a voicemail',
    by: 'Andy Makal',
    reached: false,
    communications: [{ id: 'c7', channel: 'voicemail', outcome: 'touch', reached: false, detail: null }],
  },
  {
    at: daysAgo(15, 13, 30),
    summary: 'Sent a text',
    by: 'Andy Makal',
    reached: false,
    communications: [{ id: 'c8', channel: 'text', outcome: 'touch', reached: false, detail: null }],
  },
]

const meta: Meta<typeof CustomerHistoryCard> = {
  title: 'Workflow Design System/Customer History',
  component: CustomerHistoryCard,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="max-w-md bg-workflow-surface p-6">
        <Story />
      </div>
    ),
  ],
}
export default meta

type Story = StoryObj<typeof CustomerHistoryCard>

/** Six interactions: the five most recent show, with Show All to reveal the
 * rest in the card's own scroll region. */
export const WithHistory: Story = {
  args: { events },
}

/** A customer with no recorded history yet. */
export const Empty: Story = {
  args: { events: [] },
}

/** The Next History Entry preview for the calling activity, with the optional
 * additional-notes field enabled. */
export const NextEntryPreview: StoryObj = {
  render: () => {
    const Demo = () => {
      const [notes, setNotes] = useState('')
      return (
        <NextHistoryEntry
          preview={describeNextHistoryEntry('calling', { customerName: 'Stephen' })}
          notes={notes}
          onNotesChange={setNotes}
        />
      )
    }
    return <Demo />
  },
}
