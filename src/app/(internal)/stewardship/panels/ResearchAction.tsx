'use client'

import { Search, ExternalLink } from 'lucide-react'
import { ActionPanel, PrimaryAction, OperationalTag, NextNote, ContactSearch } from '@/components/workflow'
import type { Detail, Holding } from '../types'
import { fullName } from '../shared'

export function ResearchAction({
  detail, request,
}: {
  detail: Detail
  request: Holding[]
  busy: boolean
  noteBox: React.ReactNode
  act: (action: unknown, successNote?: string) => void
}) {
  // Every distinct policy number on file for the customer pairs with the last
  // name for the shared Search Gateway look-up, exactly like the consolidated
  // Contact Research task the worker is sent to. The GET route gathers these
  // customer-wide (service policies + associated cases, de-duplicated); if that
  // field is unavailable, fall back to the request holdings' numbers so the
  // look-up still works.
  const policyNumbers =
    detail.gateway_policy_numbers && detail.gateway_policy_numbers.length > 0
      ? detail.gateway_policy_numbers
      : Array.from(
          new Set(
            request
              .map(h => (h.policy_number ?? '').trim())
              .filter(p => p.length > 0),
          ),
        )
  // Research Needed is no longer a separate correction screen. Contact research
  // is ONE consolidated surface: the project Contact Research task. From the
  // shared board this task hands the worker to that single screen for THIS
  // customer, so the look-up, the found-value capture, and the "nothing usable"
  // outcome all happen in one place (and a replacement value recalculates work
  // the same way everywhere). The customer's active 1035 project owns that task.
  const contactResearchHref = detail.contact_research_project_id
    ? `/projects/${detail.contact_research_project_id}/contact-review?customer_id=${encodeURIComponent(detail.customer.id)}`
    : null
  return (
    <ActionPanel heading={`Find contact for ${fullName(detail.customer)}`}>
      <div className="flex items-center gap-2 rounded-xl border border-status-missing-border bg-status-missing-soft p-4 text-base text-status-missing-strong">
        <Search className="size-5" aria-hidden /> Usable contact information is missing or has failed.
      </div>
      {/* The shared Search Gateway look-up — last name + every policy number on
          file, each with its own Copy button; identical to the consolidated
          Contact Research task. */}
      <ContactSearch
        lastName={detail.customer.last_name}
        firstName={detail.customer.first_name}
        fallbackName={fullName(detail.customer)}
        policyNumbers={policyNumbers}
        city={detail.customer.city}
        state={detail.customer.state}
      />
      {/* Hand off to the ONE consolidated Contact Research task. The capture,
          the "nothing usable" outcome, and the save-and-recalculate all live
          there now, so there is a single contact-research surface rather than a
          duplicate board screen. */}
      {contactResearchHref ? (
        <a href={contactResearchHref} className="block">
          <PrimaryAction icon={ExternalLink} label="Open Contact Research for this customer" />
        </a>
      ) : (
        <OperationalTag tone="info">
          This customer is not in an active 1035 project, so there is no Contact Research task to
          open. Add them to the 1035 project to research their contact information.
        </OperationalTag>
      )}
      <NextNote>
        Contact Research is one screen. Opening it takes you to this customer&apos;s task, where you
        enter the email or phone Gateway shows (saved field by field to the customer record,
        clearing that value&apos;s prior verification and recalculating available work), or record
        that nothing usable was found. The customer is never closed; anyone whose details later turn
        up returns automatically, and you can always research again.
      </NextNote>
    </ActionPanel>
  )
}
