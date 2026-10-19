import type { Meta, StoryObj } from '@storybook/react'

import { PolicySummaryCard, PolicySummaryList, type PolicySummary } from './PolicySummaryCard'

/**
 * Workflow Design System — Policy Summary.
 *
 * The reusable, read-only Policy Summary card, rendered as the real shared
 * component. It shows the policy facts a worker needs while contacting a
 * customer — policy number, policy type, face amount, issue date, and cash
 * value when the policy carries one — from existing policy data, never an
 * invented value. It matches the Customer Contact card's light section shell so
 * the two sit together as one customer-context column on a working screen.
 */

const permanent: PolicySummary = {
  id: 'p1',
  policy_number: 'UL-4480912',
  product_type: 'Universal Life',
  face_amount: 250000,
  issue_date: '2014-06-01',
  cash_value_amount: 18450,
  carrier: 'Everlake',
}

const term: PolicySummary = {
  id: 'p2',
  policy_number: 'TERM-220641',
  product_type: '20-Year Term',
  face_amount: 500000,
  issue_date: '2019-03-15',
  cash_value_amount: null, // term has no cash value — the row is omitted
  carrier: 'Everlake',
}

const sparse: PolicySummary = {
  id: 'p3',
  policy_number: 'WL-9931',
  product_type: null,
  face_amount: null,
  issue_date: null,
  cash_value_amount: null,
  carrier: null,
}

const meta: Meta<typeof PolicySummaryCard> = {
  title: 'Workflow Design System/Policy Summary',
  component: PolicySummaryCard,
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

type Story = StoryObj<typeof PolicySummaryCard>

/** A permanent policy: the cash-value row is shown. */
export const PermanentPolicy: Story = {
  args: { policy: permanent },
}

/** A term policy: no cash value, so the cash-value row is omitted (not zeroed). */
export const TermPolicy: Story = {
  args: { policy: term },
}

/** Missing fields read plainly as "Not on file" — never a fabricated value. */
export const MissingFields: Story = {
  args: { policy: sparse },
}

/** A set of policies summarized together (several request policies). */
export const SeveralPolicies: StoryObj<typeof PolicySummaryList> = {
  render: () => <PolicySummaryList policies={[permanent, term]} />,
}

/** No policy on file. */
export const NoPolicy: StoryObj<typeof PolicySummaryList> = {
  render: () => <PolicySummaryList policies={[]} />,
}
