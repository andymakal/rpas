'use client'

import { CircleAlert, Play } from 'lucide-react'
import { ActionPanel, WorkflowButton, NextNote } from '@/components/workflow'
import type { Detail } from '../types'
import { shortDate } from '../shared'

/**
 * A customer who explicitly declined. Outreach is stopped and the item no longer
 * surfaces on the board; this screen (reached from the customer record) states
 * the stop and offers a deliberate Reopen. Nothing is auto-closed.
 */
export function RefusedAction({
  detail, busy, noteBox, act,
}: {
  detail: Detail
  busy: boolean
  noteBox: React.ReactNode
  act: (action: unknown, successNote?: string) => void
}) {
  return (
    <ActionPanel heading={`${detail.customer.first_name} declined`}>
      {noteBox}
      <div className="flex items-start gap-2 rounded-xl border border-status-attention-border bg-status-attention-soft p-4 text-base text-status-attention-strong">
        <CircleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
        <span>
          This customer explicitly declined further servicing-agent outreach
          {detail.refused_at ? ` on ${shortDate(detail.refused_at)}` : ''}. Outreach is stopped: they do
          not appear on the board or in anyone&apos;s work until reopened. Nothing was closed.
        </span>
      </div>
      <WorkflowButton icon={Play} selected disabled={busy}
        onClick={() => act({ type: 'reopen' }, 'Reopened. The customer returns to active outreach.')}>
        Reopen outreach
      </WorkflowButton>
      <NextNote>
        Reopening clears the refusal and returns the customer to active outreach. Only do this on a
        deliberate decision to re-engage.
      </NextNote>
    </ActionPanel>
  )
}
