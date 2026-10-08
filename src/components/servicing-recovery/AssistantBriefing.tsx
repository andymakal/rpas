'use client'

/**
 * Assistant briefing for the 1035 Workflow landing page. STORYBOOK-ONLY.
 *
 * The Assistant is the left column of a two-column work surface. It behaves
 * like a capable human operational assistant: a large, friendly heading, short
 * natural-language guidance, and a few large, obvious work-mode actions. It
 * does NOT repeat every queue or its description. The right column (the work
 * queues) is the full inventory.
 *
 * Work is framed in two kinds the worker chooses between:
 *   active outreach — Send emails, Make calls.
 *   quiet work      — research, plus checking the inbox and carrier status.
 *
 * The Assistant may point out the easiest place to start outreach, but it
 * offers quiet work as an equal alternative rather than ranking everything into
 * one order. The waiting queues are never framed as something to "work": the
 * inbox covers email replies and returned forms, and the carrier check covers
 * customers waiting on the carrier.
 */

import { Mail, Phone, ListChecks, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  type QueueId,
  type WorkItem,
  CARRIER_QUEUES,
  INBOX_QUEUES,
} from './data'
import { queueCounts } from './fixtures'
import { AssistantPanel } from '@/components/workflow'

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

function sumQueues(counts: Record<QueueId, number>, queues: QueueId[]): number {
  return queues.reduce((sum, q) => sum + counts[q], 0)
}

export function AssistantBriefing({
  items,
  onOpenQueue,
}: {
  items: WorkItem[]
  /** Open a queue when the worker chooses a work mode. */
  onOpenQueue?: (queue: QueueId) => void
}) {
  const counts = queueCounts(items)

  const emails   = counts['ready-to-email']
  const calls    = counts['ready-to-call']
  const research = counts['research-needed']
  const inbox    = sumQueues(counts, INBOX_QUEUES)
  const carrier  = sumQueues(counts, CARRIER_QUEUES)
  const quiet    = research + inbox + carrier

  const hasOutreach = emails > 0 || calls > 0
  const nothingToDo = !hasOutreach && quiet === 0

  // The easiest place to START OUTREACH, when there is outreach to do. Emails
  // are the easiest to get moving; otherwise calls. Quiet work is an equal
  // alternative, never ranked into this.
  const easiestOutreach: 'emails' | 'calls' | null =
    emails > 0 ? 'emails' : calls > 0 ? 'calls' : null

  // Where "Do quiet work" sends the worker: research first, then the inbox,
  // then carrier. This reuses the queue-first routing, it does not add logic.
  const quietTarget: QueueId | null =
    research > 0 ? 'research-needed'
      : inbox > 0 ? (counts['waiting-for-response'] > 0 ? 'waiting-for-response' : 'waiting-for-form')
        : carrier > 0 ? 'waiting-for-carrier'
          : null

  return (
    <AssistantPanel heading={<>Here{'\u2019'}s what you{'\u2019'}ve got</>}>
      {/* Short, natural-language guidance. Not a per-queue dashboard. Normal
          paragraph line-height, with a clear gap between paragraphs. */}
      {nothingToDo ? (
        <p className="text-lg leading-normal text-slate-600">
          Nothing is waiting on you right now. When new customers enter the 1035 Workflow,
          I{'\u2019'}ll summarize them here.
        </p>
      ) : (
        <div className="space-y-5 text-lg leading-normal text-slate-600">
          {/* One paragraph per work-mode button below: emails, calls, quiet. */}
          {emails > 0 && (
            <p>
              <strong className="font-semibold text-slate-900">{plural(emails, 'email is', 'emails are')} ready to send</strong>.
              That{'\u2019'}s the easiest outreach to get moving.
            </p>
          )}
          {calls > 0 && (
            <p>
              <strong className="font-semibold text-slate-900">{plural(calls, 'customer is', 'customers are')} ready to call</strong>{' '}
              if you want to make calls.
            </p>
          )}
          {quiet > 0 && (
            <p>
              {renderQuietSentence({ research, inbox, carrier })}
            </p>
          )}
        </div>
      )}

      {/* Large, obvious work-mode actions. The worker always chooses. */}
      {!nothingToDo && (
        <div className="flex flex-col gap-3">
          {emails > 0 && (
            <ActionButton
              primary
              icon={Mail}
              label={`Send ${plural(emails, 'email', 'emails')}`}
              hint="Easiest outreach to get moving"
              onClick={() => onOpenQueue?.('ready-to-email')}
            />
          )}
          {calls > 0 && (
            <ActionButton
              primary={easiestOutreach === 'calls'}
              icon={Phone}
              label={`Make ${plural(calls, 'call', 'calls')}`}
              hint={`${plural(calls, 'customer', 'customers')} ready to call`}
              onClick={() => onOpenQueue?.('ready-to-call')}
            />
          )}
          {quiet > 0 && quietTarget && (
            <ActionButton
              icon={ListChecks}
              label="Do quiet work"
              hint={quietHint({ research, inbox, carrier })}
              onClick={() => onOpenQueue?.(quietTarget)}
            />
          )}
        </div>
      )}
    </AssistantPanel>
  )
}

/** Natural sentence describing the quiet-work options that actually exist. */
function renderQuietSentence({
  research, inbox, carrier,
}: {
  research: number
  inbox: number
  carrier: number
}): React.ReactNode {
  const lead = research > 0
    ? <><strong className="font-semibold text-slate-900">{plural(research, 'customer needs', 'customers need')} research</strong>.</>
    : null

  const checks: string[] = []
  if (inbox > 0)   checks.push('check the inbox for replies or forms')
  if (carrier > 0) checks.push('check carrier updates')

  const checksJoined =
    checks.length === 0 ? null
      : checks.length === 1 ? checks[0]
        : `${checks[0]}, or ${checks[1]}`

  // With research present, lead with it, then offer the checks as "also".
  if (lead && checksJoined) {
    return <>{lead} If you want quiet work, you can also {checksJoined}.</>
  }
  if (lead) return lead
  // No research: the checks are the quiet work on offer.
  if (checksJoined) return <>If you want quiet work, you can {checksJoined}.</>
  return null
}

/** Compact hint under the "Do quiet work" action. */
function quietHint({
  research, inbox, carrier,
}: {
  research: number
  inbox: number
  carrier: number
}): string {
  const parts: string[] = []
  if (research > 0) parts.push(`${research} to research`)
  if (inbox > 0)    parts.push(`${inbox} with customer`)
  if (carrier > 0)  parts.push(`${carrier} with carrier`)
  return parts.join(' \u00b7 ')
}

function ActionButton({
  icon: Icon, label, hint, primary, onClick,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  hint: string
  primary?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label}. ${hint}`}
      className={cn(
        'group flex items-center gap-4 rounded-2xl border p-5 text-left transition-colors',
        primary
          ? 'border-teal-600 bg-teal-600 text-white hover:bg-teal-700'
          : 'border-slate-200 bg-white text-slate-900 hover:border-teal-300 hover:bg-teal-50/50',
      )}
    >
      <span className={cn(
        'flex size-12 shrink-0 items-center justify-center rounded-xl',
        primary ? 'bg-white/20 text-white' : 'bg-teal-100 text-teal-700',
      )}>
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-lg font-semibold leading-tight">{label}</span>
        <span className={cn('mt-1 block text-[15px] leading-snug', primary ? 'text-teal-50' : 'text-slate-600')}>
          {hint}
        </span>
      </span>
      <ArrowRight
        className={cn('size-5 shrink-0 transition-transform group-hover:translate-x-0.5',
          primary ? 'text-teal-100' : 'text-slate-300')}
        aria-hidden
      />
    </button>
  )
}
