import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { DobDisplay, DobEditor, type DobRecord, type DobEditResult } from './ContactDob'
import { normalizeDobParts } from '@/lib/stewardship/dob'

/**
 * Workflow Design System — Contact Date of birth.
 *
 * The reusable DOB surface, rendered as the real shared component. All
 * normalization, storage-precision, display, and the exact-DOB downgrade guard
 * live in `@/lib/stewardship/dob.ts`; these stories exercise the display and the
 * editor. A DOB is stored at whatever precision is known (exact / month-year /
 * year-only) and a known exact date can never be silently downgraded to partial.
 */

const exact: DobRecord = {
  date_of_birth: '1980-06-15',
  date_of_birth_approx: null,
  seed_month: 6,
  seed_day: 15,
  seed_year: 1980,
}

const partial: DobRecord = {
  date_of_birth: null,
  date_of_birth_approx: '06/xx/1980',
  seed_month: 6,
  seed_day: null,
  seed_year: 1980,
}

const missing: DobRecord = {
  date_of_birth: null,
  date_of_birth_approx: null,
}

const meta: Meta<typeof DobDisplay> = {
  title: 'Workflow Design System/Contact Date of birth',
  component: DobDisplay,
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

type Story = StoryObj<typeof DobDisplay>

const valueCls = 'text-lg font-medium text-ink'
const missingCls = 'text-ink-muted'
const approxCls = 'text-sm font-normal text-ink-supporting'

/** A known exact date: shown as MM/DD/YYYY. */
export const Exact: Story = {
  args: { exact: exact.date_of_birth, approx: null, className: valueCls },
}

/** A partial (month + year) date: shown as MM/YYYY, labeled unconfirmed. */
export const Partial: Story = {
  args: { exact: null, approx: partial.date_of_birth_approx, approximate: true, className: valueCls, approxNoteClassName: approxCls },
}

/** Nothing on file: reads "Missing". */
export const Missing: Story = {
  args: { exact: null, approx: null, className: valueCls, missingClassName: missingCls },
}

/** The editor. Save logs the three raw parts (only when the DOB actually
 * changed); the display updates to match. Try entering only a year, or editing
 * a known exact date down to a partial one to see the downgrade guard. */
export const Editor: StoryObj<typeof DobEditor> = {
  render: () => {
    function Harness() {
      const [record, setRecord] = useState<DobRecord>(exact)
      const [editing, setEditing] = useState(true)
      if (editing) {
        return (
          <DobEditor
            record={record}
            onCancel={() => setEditing(false)}
            onSave={(value: DobEditResult) => {
              if (value.parts) {
                const n = normalizeDobParts(value.parts)
                if (n.status !== 'invalid') {
                  setRecord({
                    date_of_birth: n.date_of_birth,
                    date_of_birth_approx: n.date_of_birth_approx,
                    seed_month: null, seed_day: null, seed_year: null,
                  })
                }
              }
              setEditing(false)
            }}
          />
        )
      }
      return (
        <div>
          <DobDisplay
            exact={record.date_of_birth}
            approx={record.date_of_birth_approx}
            approximate={!record.date_of_birth && !!record.date_of_birth_approx}
            className={valueCls}
            missingClassName={missingCls}
            approxNoteClassName={approxCls}
          />
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="mt-3 block rounded-lg border border-surface-border-strong bg-surface-card px-3 py-1.5 text-base font-medium text-ink-secondary hover:bg-surface-muted"
          >
            Edit date of birth
          </button>
        </div>
      )
    }
    return <Harness />
  },
}
