import type { Meta, StoryObj } from '@storybook/react'

import { RelationshipTimeline } from './RelationshipTimeline'
import type { HistoryEvent } from '@/lib/stewardship/customer-history'

/**
 * Workflow Design System — Relationship Timeline.
 *
 * The improved, opt-in presentation over the same customer history model
 * (case_touches, grouped into interactions) the Customer History card renders.
 * Adopted by Customer Interaction; the existing card and its other consumers
 * are unchanged.
 *
 * Each event shows a bold teal heading that names the ACTUAL event (Email
 * Received, Email Sent, Customer Reached, Voicemail Left, Follow-up Scheduled,
 * …), the employee name and timestamp underneath, and the actual message or
 * meaningful detail when present. Internal markers and channel/prefix
 * boilerplate are removed by the normalization, so a stored
 * "Customer email response received: I need more info. [inbound]" shows as the
 * heading "Email Received" over the message "I need more info." A legacy record
 * of unknown direction falls back to its grouped summary rather than inventing
 * a direction.
 */

function daysAgo(n: number, hour = 10, minute = 15): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(hour, minute, 0, 0)
  return d.toISOString()
}

const LONG_NOTE =
  'Customer called back after the voicemail. She asked a lot about how the 1035 exchange affects the surrender charge on her existing annuity, and wanted to understand whether her current death benefit carries over. She is interested but wants to talk it over with her husband this weekend and will let us know Monday.'

const events: HistoryEvent[] = [
  // John's existing incoming email: "Email Received" over "I need more info."
  {
    at: daysAgo(0, 14, 5),
    summary: 'Email',
    by: 'Bob Pfromm',
    reached: false,
    kind: 'contact',
    direction: 'incoming',
    timelineHeading: 'Email Received',
    communications: [
      { id: 'c1', channel: 'email', outcome: 'touch', reached: false, direction: 'incoming', detail: 'I need more info.', systemDescription: null },
    ],
  },
  // Outgoing email reply.
  {
    at: daysAgo(0, 15, 20),
    summary: 'Email',
    by: 'Bob Pfromm',
    reached: false,
    kind: 'contact',
    direction: 'outgoing',
    timelineHeading: 'Email Sent',
    communications: [
      { id: 'c2', channel: 'email', outcome: 'touch', reached: false, direction: 'outgoing', detail: 'Sent over the details you asked for and the authorization form.', systemDescription: null },
    ],
  },
  // Incoming text.
  {
    at: daysAgo(1, 9, 2),
    summary: 'Text',
    by: 'Dulce Alvarez',
    reached: false,
    kind: 'contact',
    direction: 'incoming',
    timelineHeading: 'Text Received',
    communications: [
      { id: 'c3', channel: 'text', outcome: 'touch', reached: false, direction: 'incoming', detail: 'Got it, thanks!', systemDescription: null },
    ],
  },
  // Reached on a call, with the operator's own note.
  {
    at: daysAgo(2, 11, 0),
    summary: 'Reached',
    description: 'Reached the customer.',
    by: 'Dulce Alvarez',
    reached: true,
    kind: 'contact',
    direction: 'outgoing',
    timelineHeading: 'Customer Reached',
    communications: [
      { id: 'c4', channel: 'call', outcome: 'touch', reached: true, direction: 'outgoing', detail: LONG_NOTE, systemDescription: 'Reached the customer.' },
    ],
  },
  // Voicemail left.
  {
    at: daysAgo(4, 10, 10),
    summary: 'No Answer \u00b7 Voicemail',
    by: 'Dulce Alvarez',
    reached: false,
    kind: 'contact',
    direction: 'outgoing',
    timelineHeading: 'Voicemail Left',
    communications: [
      { id: 'c5', channel: 'call', outcome: 'no_contact', reached: false, direction: 'outgoing', detail: null, systemDescription: null },
      { id: 'c6', channel: 'voicemail', outcome: 'touch', reached: false, direction: 'outgoing', detail: null, systemDescription: null },
    ],
  },
  // Undeliverable email.
  {
    at: daysAgo(6, 13, 0),
    summary: 'Email unusable',
    by: 'Dulce Alvarez',
    reached: false,
    kind: 'contact',
    direction: 'outgoing',
    timelineHeading: 'Email Undeliverable',
    communications: [
      { id: 'c7', channel: 'email', outcome: 'unusable', reached: false, direction: 'outgoing', detail: null, systemDescription: null },
    ],
  },
  // Follow-up scheduled milestone.
  {
    at: daysAgo(7, 9, 30),
    summary: 'Follow-up scheduled',
    description: 'Promised to follow up on 03/14 about the signed authorization.',
    by: 'Dulce Alvarez',
    reached: false,
    kind: 'milestone',
    timelineHeading: 'Follow-up Scheduled',
    communications: [],
  },
  // Follow-up completed milestone.
  {
    at: daysAgo(8, 16, 0),
    summary: 'Follow-up completed',
    description: 'Followed up on the outstanding signed authorization.',
    by: 'Dulce Alvarez',
    reached: false,
    kind: 'milestone',
    timelineHeading: 'Follow-up Completed',
    communications: [],
  },
  // Legacy record of unknown direction: falls back to its grouped summary.
  {
    at: daysAgo(40, 10, 0),
    summary: 'Email',
    by: 'Andy Makal',
    reached: false,
    kind: 'contact',
    direction: 'outgoing',
    timelineHeading: null,
    communications: [
      { id: 'c8', channel: 'email', outcome: 'touch', reached: false, detail: null, systemDescription: null },
    ],
  },
]

const meta: Meta<typeof RelationshipTimeline> = {
  title: 'Workflow Design System/Relationship Timeline',
  component: RelationshipTimeline,
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

type Story = StoryObj<typeof RelationshipTimeline>

/** A full conversation showing each event-specific heading: Email Received /
 * Sent, Text Received, Customer Reached, Voicemail Left, Email Undeliverable,
 * Follow-up Scheduled / Completed, and a legacy record that falls back to its
 * summary. The five most recent show, with Show all for the rest. */
export const ActiveConversation: Story = {
  args: { events },
}

/** A customer with no recorded history yet. */
export const Empty: Story = {
  args: { events: [] },
}
