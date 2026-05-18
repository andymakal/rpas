import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'GDC Import' }

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
