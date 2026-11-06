'use client'

/**
 * FastPeopleSearchSource — the Fast People Search source Lego.
 *
 * A free people finder that works for ANYONE, customer or not: it searches by
 * full name and city/state (the name alone often finds the person; the location
 * narrows it). Unlike Gateway it needs no policy, so ContactSearch always shows
 * it. The title links to the site (new tab). The worker reads the result and
 * types what they find into the Customer Contact card; nothing is scraped.
 *
 * Own file per the design-system one-component-per-file rule; composed by the
 * ContactSearch subassembly.
 */

import { FileText, ExternalLink } from 'lucide-react'
import { SourceCard, SourceHeader, ValueRow, useCopyField } from './contactSearchShared'

const FAST_PEOPLE_SEARCH_URL = 'https://www.fastpeoplesearch.com/'

export function FastPeopleSearchSource({
  firstName,
  lastName,
  fallbackName,
  city,
  state,
}: {
  firstName?: string | null
  lastName: string | null
  fallbackName?: string
  city?: string | null
  state?: string | null
}) {
  const { copied, copy } = useCopyField()
  const first = (firstName ?? '').trim()
  const last = (lastName ?? '').trim()
  const fullName = [first, last].filter(Boolean).join(' ') || (fallbackName ?? '').trim()
  const cityState = [city?.trim(), state?.trim()].filter(Boolean).join(', ')

  return (
    <SourceCard>
      <SourceHeader
        title={
          <a
            href={FAST_PEOPLE_SEARCH_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-lg font-bold leading-tight tracking-tight text-brand transition-colors hover:text-brand-hover"
          >
            Fast People Search <ExternalLink className="size-4" aria-hidden />
          </a>
        }
      >
        Search by full name and city and state. The name alone often finds the person; the city and
        state narrow it.
      </SourceHeader>
      <ValueRow field="fps-name" display={fullName} copied={copied} onCopy={copy} disabled={!fullName} />
      {cityState ? (
        <ValueRow field="fps-location" display={cityState} copied={copied} onCopy={copy} />
      ) : (
        <span className="inline-flex items-center gap-1.5 text-sm text-ink-supporting">
          <FileText className="size-4 shrink-0" aria-hidden /> No city/state on file — search by name
        </span>
      )}
    </SourceCard>
  )
}
