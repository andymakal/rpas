import type { Meta, StoryObj } from '@storybook/react'

import { WorkflowPage, ActionPanel, ContextLabel, SpokenScriptCard } from './index'

/**
 * Workflow Design System — Spoken Script Card.
 *
 * `SpokenScriptCard` is for script text the worker SAYS to a person who is on
 * the line right now: a live call opening, an in-person greeting, any prompt
 * read out loud. Spoken words have no paste destination, so this card carries
 * NO Copy affordance — it only presents the label and the talk track to read.
 *
 * It is deliberately the sibling of, not the same as, the copy-to-clipboard
 * script cards (the stewardship `CallScriptCard` / the `ContactWorkspace`
 * `LightScriptCard`), which exist for text the worker transmits through another
 * channel: a voicemail greeting note, a Hearsay text, an email. Those keep
 * Copy because they have somewhere to paste. A live greeting does not.
 *
 * Reach for this component wherever a worker reads a script aloud; reach for a
 * copy card only when the text is handed off to another channel.
 *
 * STORYBOOK-ONLY. No data, APIs, or production workflow logic.
 */
const meta = {
  title: 'Workflow Design System/Spoken Script Card',
  component: SpokenScriptCard,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof SpokenScriptCard>

export default meta

type Story = StoryObj<typeof meta>

/** The live-call opening talk track, as it appears on the calling workbench. */
export const OpeningCall: Story = {
  args: {
    label: 'Opening script',
    body: 'Hi, may I speak with Sam? This is Jordan calling from your Right Path servicing team about your policies. We are confirming the servicing agent on your account so we can keep helping you. Do you have a couple of minutes?',
  },
}

/** A multi-line spoken prompt; line breaks are preserved for the reader. */
export const MultiLine: Story = {
  args: {
    label: 'Opening script',
    body: [
      'Hi, may I speak with Sam?',
      '',
      'This is Jordan from your Right Path servicing team. I am reaching out about your life insurance policies so we can keep servicing them for you.',
      '',
      'Is now a good time?',
    ].join('\n'),
  },
}

/** In context: the spoken opening sits in the action column above the controls. */
export const InTaskContext: Story = {
  render: (args) => (
    <WorkflowPage>
      <ActionPanel heading="Call Sam Sample">
        <ContextLabel>First Outreach Call</ContextLabel>
        <SpokenScriptCard {...args} />
      </ActionPanel>
    </WorkflowPage>
  ),
  args: {
    label: 'Opening script',
    body: 'Hi, may I speak with Sam? This is Jordan calling from your Right Path servicing team. We are confirming the servicing agent on your account so we can keep helping you. Do you have a couple of minutes?',
  },
}
