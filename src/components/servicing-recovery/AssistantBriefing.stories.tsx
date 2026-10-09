import type { Meta, StoryObj } from '@storybook/react'

import { WorkflowSurface } from '@/components/workflow'
import { AssistantBriefing } from './AssistantBriefing'
import { allItems } from './fixtures'

/**
 * The Assistant briefing in isolation. It summarizes the work available right
 * now in plain language and offers a few large work-mode actions (Send emails,
 * Make calls, Do quiet work). It frames the choice naturally rather than
 * ranking everything into one order, and may point out the easiest place to
 * START outreach. The waiting queues are reached through quiet work (inbox and
 * carrier checks), never framed as queues to "work." STORYBOOK-ONLY static data.
 */
const meta = {
  title: '1035 Workflow/Assistant',
  component: AssistantBriefing,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <WorkflowSurface>
        <div className="mx-auto max-w-md">
          <Story />
        </div>
      </WorkflowSurface>
    ),
  ],
} satisfies Meta<typeof AssistantBriefing>

export default meta

type Story = StoryObj<typeof meta>

/**
 * A full board: emails and calls are both ready, so the Assistant points to the
 * emails as the easiest place to start outreach and offers quiet work alongside.
 */
export const Briefing: Story = {
  args: { items: allItems },
}

/**
 * No emails ready, but calls are. The easiest outreach start shifts to calls.
 */
export const RecommendsCalls: Story = {
  args: {
    items: allItems.filter(i => i.queue !== 'ready-to-email'),
  },
}

/**
 * No outreach ready at all. The Assistant leads with quiet work: research plus
 * the inbox and carrier checks.
 */
export const QuietWorkOnly: Story = {
  args: {
    items: allItems.filter(
      i => i.queue !== 'ready-to-email' && i.queue !== 'ready-to-call',
    ),
  },
}

/**
 * Everything is in waiting states: no outreach and no research, so only the
 * two check actions remain (Check inbox and Check carrier status).
 */
export const OnlyChecks: Story = {
  args: {
    items: allItems.filter(i => i.queue.startsWith('waiting-')),
  },
}

/** An empty board: nothing is waiting on the worker. */
export const NothingToDo: Story = {
  args: { items: [] },
}
