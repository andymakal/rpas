import type { Meta, StoryObj } from '@storybook/react'

import { RelationshipTimeline } from './RelationshipTimeline'
import type { HistoryEvent } from '@/lib/stewardship/customer-history'

/**
 * Workflow Design System — Relationship Timeline.
 *
 * The improved, opt-in presentation over the same customer history model
 * (case_touches, grouped into interactions) the Customer History card renders.
 * Adopted by Customer Interaction; the existing card and its other consumers
 * are unchanged. Bold teal headings, incoming/outgoing titles, employee name
 * and timestamp underneath, expandable message content, and no repeated
 * customer name.
 */

function daysAgo(n: number, hour = 10, minute = 15): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(hour, minute, 0, 0)
  return d.toISOString()
}

const LONG_NOTE =
  'Customer called back after the voicemail. She asked a lot about how the 1035 exchange affects the surrender charge on her existing annuity, and wanted to understand whether her current death benefit carries over. She is interested but wants to talk it over with her husband this weekend and will let us know Monday. Asked us to email the authorization form again because she could not find the first one.'

const events: HistoryEvent[] = [
  {
    at: daysAgo(0, 14, 5),
    summary: 'Email',
    by: 'Dulce Alvarez',
    reached: false,
    kind: 'contact',
    direction: 'incoming',
    communications: [
      {
        id: 'c1',
        channel: 'email',
        outcome: 'touch',
        reached: false,
        direction: 'incoming',
        detail: LONG_NOTE,
        systemDescription: null,
      },
    ],
  },
  {
    at: daysAgo(0, 15, 20),
    summary: 'Email',
    by: 'Dulce Alvarez',
    reached: false,
    kind: 'contact',
    direction: 'outgoing',
    communications: [
      {
        id: 'c2',
        channel: 'email',
        outcome: 'touch',
        reached: false,
        direction: 'outgoing',
        detail: 'Re-sent the authorization form and answered her surrender-charge question.',
        systemDescription: null,
      },
    ],
  },
  {
    at: daysAgo(1, 9, 2),
    summary: 'Email',
    by: 'Dulce Alvarez',
    reached: false,
    kind: 'contact',
    direction: 'automated',
    communications: [
      {
        id: 'c3',
        channel: 'email',
        outcome: 'touch',
        reached: false,
        direction: 'automated',
        detail: null,
        systemDescription: null,
      },
    ],
  },
  {
    at: daysAgo(2, 11, 0),
    summary: 'Follow-up scheduled',
    description: 'Promised to follow up on 03/14 about the signed authorization.',
    by: 'Dulce Alvarez',
    reached: false,
    kind: 'milestone',
    communications: [],
  },
  {
    at: daysAgo(5, 10, 10),
    summary: 'Reached',
    description: 'Reached the customer.',
    by: 'Andy Makal',
    reached: true,
    kind: 'contact',
    direction: 'outgoing',
    communications: [
      {
        id: 'c4',
        channel: 'call',
        outcome: 'touch',
        reached: true,
        direction: 'outgoing',
        detail: 'Introduced the servicing move; she was receptive.',
        systemDescription: 'Reached the customer.',
      },
    ],
  },
  {
    at: daysAgo(9, 13, 30),
    summary: 'Added to Project',
    by: 'Andy Makal',
    reached: false,
    kind: 'enrollment',
    projectName: 'Q1 1035 Servicing Outreach',
    communications: [],
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

/** A live conversation: an incoming response with a long (expandable) message,
 * an outgoing reply, an automated reply, a milestone, a reached call, and an
 * enrollment. The five most recent show, with Show all for the rest. */
export const ActiveConversation: Story = {
  args: { events },
}

/** A customer with no recorded history yet. */
export const Empty: Story = {
  args: { events: [] },
}
