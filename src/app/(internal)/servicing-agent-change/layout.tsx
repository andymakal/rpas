import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Servicing Agent Change' }

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
