'use client'

/**
 * Landing screen for the 1035 Workflow. STORYBOOK-ONLY.
 *
 * Queue-first: the worker lands on the six working queues in a fixed order,
 * each with a count. A queue with zero customers stays visible but grayed out.
 * There is no Complete queue; a confirmed customer exits to the Review
 * workflow. Clicking a queue opens that queue's actionable task list; clicking
 * a customer opens only the current actionable task for that queue.
 *
 * This screen composes the shared Right Path workflow components
 * (src/components/workflow); the 1035-specific data and icons are supplied here.
 */

import { Mail, Phone, Search, Clock, FileText, Building2 } from 'lucide-react'
import {
  type QueueId,
  type WorkItem,
  CALL_REASON_LABEL,
  QUEUE_GROUPS,
  QUEUE_META,
  fullName,
} from './data'
import { itemsInQueue, queueCounts } from './fixtures'
import { AssistantBriefing } from './AssistantBriefing'
import {
  WorkflowPage,
  WorkflowHeader,
  QueueSection,
  QueueRow,
  QueueListHeader,
  CustomerQueueCard,
  QueueEmptyState,
  OperationalTag,
} from '@/components/workflow'

const QUEUE_ICON: Record<QueueId, React.ComponentType<{ className?: string }>> = {
  'ready-to-email':       Mail,
  'ready-to-call':        Phone,
  'research-needed':      Search,
  'waiting-for-response': Clock,
  'waiting-for-form':     FileText,
  'waiting-for-carrier':  Building2,
}

/**
 * Landing page. Desktop-first two-column work surface:
 *   left  (~40%) — the Assistant, a human operational guide.
 *   right (~60%) — the work queues, the project inventory, grouped visually.
 *
 * The right column is the complete queue view. There is no separate "all
 * queues" list; the Assistant does not repeat every queue.
 */
export function QueueBoard({
  items,
  onOpenQueue,
}: {
  items: WorkItem[]
  /** Open a queue's task list. Prototype wires this to a story state. */
  onOpenQueue?: (queue: QueueId) => void
}) {
  const counts = queueCounts(items)

  return (
    <WorkflowPage>
      <WorkflowHeader primary="1035 Workflow" secondary={<>Today{'\u2019'}s work</>} />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[2fr_3fr]">
        {/* LEFT: Assistant */}
        <AssistantBriefing items={items} onOpenQueue={onOpenQueue} />

        {/* RIGHT: Work queues, the project inventory. */}
        <div className="space-y-6">
          {QUEUE_GROUPS.map(group => (
            <QueueSection key={group.id} label={group.label}>
              {group.queues.map(id => {
                const meta = QUEUE_META[id]
                return (
                  <QueueRow
                    key={id}
                    icon={QUEUE_ICON[id]}
                    label={meta.label}
                    count={counts[id]}
                    tone={meta.kind === 'action' ? 'action' : 'waiting'}
                    onOpen={() => onOpenQueue?.(id)}
                  />
                )
              })}
            </QueueSection>
          ))}
          <p className="text-xs text-slate-400">
            Prototype with static data. No database, API, or production workflow logic.
          </p>
        </div>
      </div>
    </WorkflowPage>
  )
}

/**
 * A compact list of the customers in one queue. Shown when a worker opens a
 * queue from the board. Clicking a customer opens their current actionable
 * task (wired by the story).
 */
export function QueueList({
  queue,
  items,
  onBack,
  onOpenItem,
}: {
  queue: QueueId
  items: WorkItem[]
  onBack?: () => void
  onOpenItem?: (item: WorkItem) => void
}) {
  const meta = QUEUE_META[queue]
  const inQueue = itemsInQueue(items, queue)

  return (
    <WorkflowPage>
      <QueueListHeader
        icon={QUEUE_ICON[queue]}
        label={meta.label}
        count={inQueue.length}
        blurb={meta.blurb}
        onBack={onBack}
      />

      {inQueue.length === 0 ? (
        <QueueEmptyState>No customers in this queue.</QueueEmptyState>
      ) : (
        <ul className="space-y-3">
          {inQueue.map(item => {
            const n = item.holdings.filter(h => h.inRequest).length
            const reason = queue === 'ready-to-call' && item.callReason
              ? CALL_REASON_LABEL[item.callReason]
              : null
            return (
              <li key={item.id}>
                <CustomerQueueCard
                  name={fullName(item)}
                  detail={`${n} ${n === 1 ? 'holding' : 'holdings'} in request`}
                  trailing={reason ? <OperationalTag>{reason}</OperationalTag> : undefined}
                  onOpen={() => onOpenItem?.(item)}
                />
              </li>
            )
          })}
        </ul>
      )}
    </WorkflowPage>
  )
}
