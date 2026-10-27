import type { Meta, StoryObj } from '@storybook/react'
import type { ReactNode } from 'react'

import { WorkflowPage, WorkflowHeader, TaskShell, ActionPanel } from './index'

/**
 * Verification harness for the shared workflow scroll model. It reproduces the
 * REAL production chain so the fixed-header + fixed-heading + scrolling-work-area
 * behavior (and the three-column independent scroll) can be exercised in a
 * browser:
 *
 *   [fixed-height viewport, like the internal shell's <main overflow-y:auto>]
 *     └─ WorkflowChrome-like flex column (h-full, min-h-0)
 *         ├─ a fixed app-header band (shrink-0) — stands in for InternalHeader,
 *         │   using a NON-default height so the "account for any header height"
 *         │   requirement is exercised
 *         └─ flex-1 min-h-0 page region
 *             └─ WorkflowPage heading={fixed band} + children (scrolling work area)
 *
 * Story-only: it imports the real shared components and changes no production
 * code or data.
 */

/** Stand-in for the internal shell's fixed-height <main> scroll container. The
 * app header below is a DIFFERENT height than production on purpose, to prove
 * the flex model needs no header-height assumption. */
function ShellFrame({ headerHeight, children }: { headerHeight: number; children: ReactNode }) {
  return (
    <div style={{ height: '100vh', overflowY: 'auto' }} data-testid="main-scroll">
      <div className="flex h-full min-h-0 flex-col">
        <header
          data-testid="app-header"
          className="sticky top-0 z-30 flex shrink-0 items-center border-b border-surface-border bg-surface-card px-4"
          style={{ height: `${headerHeight}px` }}
        >
          <span className="text-sm font-semibold text-ink">App header ({headerHeight}px)</span>
        </header>
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </div>
  )
}

function LongBlocks({ label, n }: { label: string; n: number }) {
  return (
    <ActionPanel heading={`${label} (${n} blocks)`}>
      {Array.from({ length: n }, (_, i) => (
        <div
          key={i}
          data-testid={`${label}-block-${i}`}
          className="rounded-xl border border-surface-border bg-surface-card p-4 text-base text-ink-secondary"
        >
          {label} block {i + 1}. The quick brown fox jumps over the lazy dog.
        </div>
      ))}
    </ActionPanel>
  )
}

function ShortBlock({ label }: { label: string }) {
  return (
    <ActionPanel heading={label}>
      <div className="rounded-xl border border-surface-border bg-surface-card p-4 text-base text-ink-secondary">
        {label}: a single short block, shorter than the available height.
      </div>
    </ActionPanel>
  )
}

function HeadingBand({ title }: { title: string }) {
  return (
    <div className="space-y-8" data-testid="page-heading">
      <span className="text-base font-medium text-brand-hover">Back to My Work</span>
      <WorkflowHeader primary={title} />
    </div>
  )
}

const meta = {
  title: 'Workflow Design System/TaskShell Scroll',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

/** Three-column workbench: LONG left column, SHORT center and right. Each column
 * should scroll independently; the app header and page heading stay fixed. */
export const ThreeColumnLongLeft: Story = {
  render: () => (
    <ShellFrame headerHeight={56}>
      <WorkflowPage heading={<HeadingBand title="Make the Calls That Are Due" />}>
        <TaskShell
          header={null}
          action={<LongBlocks label="action" n={40} />}
          context={<ShortBlock label="context" />}
          history={<ShortBlock label="history" />}
        />
      </WorkflowPage>
    </ShellFrame>
  ),
}

/** Three-column workbench with SHORT content in every column: the columns must
 * use their NATURAL height (no cap, no scrollbars, no forced empty space), since
 * everything fits on screen. */
export const ThreeColumnShort: Story = {
  render: () => (
    <ShellFrame headerHeight={56}>
      <WorkflowPage heading={<HeadingBand title="Make the Calls That Are Due" />}>
        <TaskShell
          header={null}
          action={<LongBlocks label="action" n={3} />}
          context={<ShortBlock label="context" />}
          history={<ShortBlock label="history" />}
        />
      </WorkflowPage>
    </ShellFrame>
  ),
}

/** A single long work area (Contact Research / My Work shape): the app header
 * and page heading stay fixed while only the work area scrolls. A taller app
 * header is used to prove the model adapts to any header height. */
export const SingleLongWorkArea: Story = {
  render: () => (
    <ShellFrame headerHeight={88}>
      <WorkflowPage heading={<HeadingBand title="Contact Research" />}>
        <div className="space-y-4" data-testid="work-area-content">
          {Array.from({ length: 40 }, (_, i) => (
            <div
              key={i}
              className="rounded-xl border border-surface-border bg-surface-card p-4 text-base text-ink-secondary"
            >
              Work row {i + 1}. The quick brown fox jumps over the lazy dog.
            </div>
          ))}
        </div>
      </WorkflowPage>
    </ShellFrame>
  ),
}

/** Short content: nothing should scroll at all (no unnecessary page scroll). */
export const ShortContentNoScroll: Story = {
  render: () => (
    <ShellFrame headerHeight={56}>
      <WorkflowPage heading={<HeadingBand title="Short Page" />}>
        <div data-testid="work-area-content">
          <ShortBlock label="only" />
        </div>
      </WorkflowPage>
    </ShellFrame>
  ),
}
