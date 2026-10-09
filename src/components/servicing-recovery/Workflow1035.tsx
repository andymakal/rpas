'use client'

/**
 * 1035 Workflow — the queue-first work surface. STORYBOOK-ONLY.
 *
 * Three navigation levels, held in local state:
 *   1. Board      — the six queues with counts (landing screen).
 *   2. Queue list — the customers in one opened queue.
 *   3. Task       — the single actionable task for one customer, scoped to the
 *                   queue they are in.
 *
 * Nothing here reads from or writes to Supabase, the APIs, or any production
 * workflow. No GoRules/ZEN. All data is the static board passed in via props.
 */

import { useState } from 'react'
import { type QueueId, type WorkItem } from './data'
import { allItems } from './fixtures'
import { WorkflowSurface } from '@/components/workflow'
import { QueueBoard, QueueList } from './QueueBoard'
import { TaskForItem } from './TaskViews'

type View =
  | { level: 'board' }
  | { level: 'queue'; queue: QueueId }
  | { level: 'task'; item: WorkItem }

export interface Workflow1035Props {
  /** The work board. Defaults to the full static fixture set. */
  items?: WorkItem[]
  /** Start the prototype on a specific view (used by Storybook). */
  initialView?: View
}

export function Workflow1035({ items = allItems, initialView }: Workflow1035Props) {
  const [view, setView] = useState<View>(initialView ?? { level: 'board' })

  return (
    <WorkflowSurface>
      {view.level === 'board' && (
        <QueueBoard
          items={items}
          onOpenQueue={queue => setView({ level: 'queue', queue })}
        />
      )}

      {view.level === 'queue' && (
        <QueueList
          queue={view.queue}
          items={items}
          onBack={() => setView({ level: 'board' })}
          onOpenItem={item => setView({ level: 'task', item })}
        />
      )}

      {view.level === 'task' && (
        <TaskForItem
          item={view.item}
          onBack={() => setView({ level: 'queue', queue: view.item.queue })}
        />
      )}
    </WorkflowSurface>
  )
}
