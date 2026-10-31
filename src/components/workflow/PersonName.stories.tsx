import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { PersonNameDisplay, PersonNameEditor } from './PersonName'
import { type PersonName, presentPersonName } from '@/lib/person-name'

/**
 * Workflow Design System — Person Name.
 *
 * The reusable name surface, rendered as the real shared component. All
 * presentation rules (familiar / greeting / full recorded, the suffix-in-
 * familiar preference, caps-preserving normalization) live in
 * `@/lib/person-name`; these stories exercise the display and the editor over
 * representative records.
 */

const goesByWithSuffix: PersonName = {
  firstName: 'Robert',
  middleName: 'Anne',
  lastName: 'Smith',
  suffix: 'Jr',
  goesBy: 'Bob',
  suffixInFamiliar: null, // no preference → defaults to include
}

const plain: PersonName = {
  firstName: 'Elizabeth',
  middleName: null,
  lastName: 'Hart',
  suffix: null,
  goesBy: null,
  suffixInFamiliar: null,
}

const suffixSuppressed: PersonName = {
  firstName: 'Robert',
  middleName: null,
  lastName: 'Smith',
  suffix: 'III',
  goesBy: null,
  suffixInFamiliar: false, // explicitly omitted from the familiar name
}

const preservedCaps: PersonName = {
  firstName: 'Jean',
  middleName: 'de la',
  lastName: 'DeLuca',
  suffix: null,
  goesBy: null,
  suffixInFamiliar: null,
}

const meta: Meta<typeof PersonNameDisplay> = {
  title: 'Workflow Design System/Person Name',
  component: PersonNameDisplay,
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

type Story = StoryObj<typeof PersonNameDisplay>

const headingCls = 'text-[33px] font-bold leading-tight tracking-tight text-brand'

/** Goes-by + middle + suffix: the familiar name ("Bob Smith Jr") is prominent,
 * the full recorded name ("Robert Anne Smith Jr") beneath it since they differ. */
export const GoesByWithSuffix: Story = {
  args: { name: goesByWithSuffix, className: headingCls },
}

/** A plain first + last: nothing differs, so no full-name line appears. */
export const PlainName: Story = {
  args: { name: plain, className: headingCls },
}

/** Suffix suppressed from the familiar name by preference; the full recorded
 * name still shows it ("Robert Smith III"). */
export const SuffixSuppressed: Story = {
  args: { name: suffixSuppressed, className: headingCls },
}

/** Capitalization and multi-word names are preserved exactly (DeLuca, de la). */
export const PreservedCapitalization: Story = {
  args: { name: preservedCaps, className: headingCls },
}

/** The editor, with the live familiar + greeting preview. Save logs the
 * normalized parts; Cancel resets. */
export const Editor: StoryObj<typeof PersonNameEditor> = {
  render: () => {
    function Harness() {
      const [name, setName] = useState<PersonName>(goesByWithSuffix)
      const [editing, setEditing] = useState(true)
      const p = presentPersonName(name)
      if (editing) {
        return (
          <PersonNameEditor
            name={name}
            onCancel={() => setEditing(false)}
            onSave={(value) => { setName(value); setEditing(false) }}
          />
        )
      }
      return (
        <div>
          <PersonNameDisplay name={name} className={headingCls} />
          <p className="mt-2 text-base text-ink-secondary">Greeting: Hi {p.greeting}</p>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="mt-3 rounded-lg border border-surface-border-strong bg-surface-card px-3 py-1.5 text-base font-medium text-ink-secondary hover:bg-surface-muted"
          >
            Edit name
          </button>
        </div>
      )
    }
    return <Harness />
  },
}
