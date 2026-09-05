import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Book of Business Import' }

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
