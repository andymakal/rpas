import type { Meta, StoryObj } from '@storybook/react'

import {
  ReadyToEmailTask,
  ReadyToCallTask,
  ResearchNeededTask,
  WaitingForResponseTask,
  WaitingForFormTask,
  WaitingForCarrierTask,
} from './TaskViews'
import {
  ritaEburuoh,
  geraldCassidy,
  demoSpouseComm,
  stephenRemy,
  demoCallAfterBounce,
  demoCallbackDue,
  demoResearchNeeded,
  demoWaitingResponse,
  demoJointSigners,
  demoWaitingCarrier,
  demoCarrierCorrection,
} from './fixtures'
import { WorkflowSurface } from '@/components/workflow'

/**
 * A no-op back handler so every page-level Task View story demonstrates the
 * COMPLETE approved task shell, exactly as it appears when reached through the
 * Work Surface: "\u2190 All queues" on the left of the slim header and
 * "View full customer" on the right. The back control is rendered by the
 * shared SlimTaskHeader only when an onBack callback is present (the Work
 * Surface supplies one as it navigates queue \u2192 task); the stories render the
 * task components in isolation, so they must supply it too. This is a Storybook
 * action placeholder, not new navigation logic.
 */
const backToQueues = () => console.log('[story] \u2190 All queues')

/**
 * Individual queue task views. Each shows ONLY the current actionable task for
 * a customer in that queue: a compact header, the relevant holdings, and the
 * one action that queue affords. STORYBOOK-ONLY static data.
 */
const meta = {
  title: '1035 Workflow/Task Views',
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (Story) => (
      <WorkflowSurface className="min-h-screen">
        <Story />
      </WorkflowSurface>
    ),
  ],
} satisfies Meta

export default meta

// ── Ready to Email ──

export const ReadyToEmail: StoryObj<typeof ReadyToEmailTask> = {
  render: (args) => <ReadyToEmailTask {...args} />,
  args: { item: ritaEburuoh, onBack: backToQueues },
}

/** Email path where routine communication is handled by a linked spouse. */
export const ReadyToEmailLinkedSpouse: StoryObj<typeof ReadyToEmailTask> = {
  render: (args) => <ReadyToEmailTask {...args} />,
  args: { item: demoSpouseComm, onBack: backToQueues },
}

/** Email path with a confirmed email and a single large holding. */
export const ReadyToEmailConfirmed: StoryObj<typeof ReadyToEmailTask> = {
  render: (args) => <ReadyToEmailTask {...args} />,
  args: { item: geraldCassidy, onBack: backToQueues },
}

// ── Ready to Call ──

/** No email on file, so we call. Real customer Stephen Remy. */
export const ReadyToCallNoEmail: StoryObj<typeof ReadyToCallTask> = {
  render: (args) => <ReadyToCallTask {...args} />,
  args: { item: stephenRemy, onBack: backToQueues },
}

/** Emailed outreach bounced, phone on file. */
export const ReadyToCallAfterBounce: StoryObj<typeof ReadyToCallTask> = {
  render: (args) => <ReadyToCallTask {...args} />,
  args: { item: demoCallAfterBounce, onBack: backToQueues },
}

/** A scheduled callback is due. */
export const ReadyToCallCallbackDue: StoryObj<typeof ReadyToCallTask> = {
  render: (args) => <ReadyToCallTask {...args} />,
  args: { item: demoCallbackDue, onBack: backToQueues },
}

// ── Research Needed ──

export const ResearchNeeded: StoryObj<typeof ResearchNeededTask> = {
  render: (args) => <ResearchNeededTask {...args} />,
  args: { item: demoResearchNeeded, onBack: backToQueues },
}

// ── Waiting for Response ──

export const WaitingForResponse: StoryObj<typeof WaitingForResponseTask> = {
  render: (args) => <WaitingForResponseTask {...args} />,
  args: { item: demoWaitingResponse, onBack: backToQueues },
}

// ── Waiting for Form ──

/** Jointly owned policy: both spouses must sign, one has no usable email. */
export const WaitingForFormJointSigners: StoryObj<typeof WaitingForFormTask> = {
  render: (args) => <WaitingForFormTask {...args} />,
  args: { item: demoJointSigners, onBack: backToQueues },
}

// ── Waiting for Carrier ──

export const WaitingForCarrier: StoryObj<typeof WaitingForCarrierTask> = {
  render: (args) => <WaitingForCarrierTask {...args} />,
  args: { item: demoWaitingCarrier, onBack: backToQueues },
}

/** Carrier requested a correction: actionable work within the stage. */
export const WaitingForCarrierCorrection: StoryObj<typeof WaitingForCarrierTask> = {
  render: (args) => <WaitingForCarrierTask {...args} />,
  args: { item: demoCarrierCorrection, onBack: backToQueues },
}
