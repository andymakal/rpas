import type { Meta, StoryObj } from '@storybook/react'

import { Workflow1035 } from './Workflow1035'
import { allItems } from './fixtures'

/**
 * 1035 Workflow — a queue-first work system (not a per-customer wizard).
 *
 * The landing page leads with the Assistant: it summarizes the work available
 * in plain language, recommends the lowest-friction option, and offers work-
 * mode actions (send emails, make calls, do research, check responses). The
 * worker always chooses. Below the Assistant, every queue stays visible with
 * its count, so a worker can jump straight to one.
 *
 * Opening a queue lists its customers; opening a customer shows ONLY the
 * current actionable task for that queue. When the carrier confirms servicing-
 * agent status, the customer leaves the 1035 Workflow and moves into the
 * Review workflow. There is no Complete queue.
 *
 * STORYBOOK-ONLY. Static data. No database, API, or production workflow logic.
 */
const meta = {
  title: '1035 Workflow/Work Surface',
  component: Workflow1035,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Workflow1035>

export default meta

type Story = StoryObj<typeof meta>

/** The landing screen: Assistant briefing on top, all queues below. */
export const Board: Story = {
  args: { items: allItems },
}

/**
 * A quiet-work day: no emails or calls ready, so the Assistant recommends
 * research and surfaces the status queues as check actions instead.
 */
export const QuietWorkDay: Story = {
  args: {
    items: allItems.filter(
      i => i.queue !== 'ready-to-email' && i.queue !== 'ready-to-call',
    ),
  },
}

/** Opened straight into the Ready to Email queue list. */
export const ReadyToEmailQueue: Story = {
  args: {
    items: allItems,
    initialView: { level: 'queue', queue: 'ready-to-email' },
  },
}

/** Opened straight into the Ready to Call queue list. */
export const ReadyToCallQueue: Story = {
  args: {
    items: allItems,
    initialView: { level: 'queue', queue: 'ready-to-call' },
  },
}

/** Opened straight into the Waiting for Carrier queue list. */
export const WaitingForCarrierQueue: Story = {
  args: {
    items: allItems,
    initialView: { level: 'queue', queue: 'waiting-for-carrier' },
  },
}
