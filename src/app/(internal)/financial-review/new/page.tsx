import type { Metadata } from 'next'
import { NewFinancialReviewClient } from './NewFinancialReviewClient'

export const metadata: Metadata = { title: 'New Financial Review' }

export default function NewFinancialReviewPage() {
  return <NewFinancialReviewClient />
}
