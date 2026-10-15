import type { Preview } from '@storybook/react'
import { useEffect } from 'react'
import { Geist, Geist_Mono } from 'next/font/google'
import '../src/app/globals.css'

// Load the SAME fonts the application loads in src/app/layout.tsx. The app sets
// these CSS variables on <html> (`geistSans.variable geistMono.variable`), which
// is what `--font-workflow` (and therefore every workflow component, including
// CustomerContactCard) resolves to. Storybook never renders that layout, so
// without this the `--font-geist-sans` variable is undefined and components fall
// back to the generic sans in `--font-workflow`. Defining the fonts here with
// the identical config reproduces the application's typography exactly.
const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

const preview: Preview = {
  // Project-level default tag. Storybook shows an entry in the sidebar only
  // when it carries the `dev` tag; a story or meta can opt out of the visible
  // catalog with the negated tag `!dev`. This makes the "hide non-canonical
  // internal test states" convention explicit rather than relying on
  // Storybook's implicit default.
  tags: ['dev'],
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
  decorators: [
    (Story) => {
      // Apply the font variable classes (and `antialiased`) to the preview
      // iframe's <html>, mirroring how src/app/layout.tsx applies them to the
      // real document root. Doing it on <html> rather than a wrapper <div> means
      // the variables are defined for the whole document, including any content
      // portaled to <body> (tooltips, popovers), exactly as in the app.
      useEffect(() => {
        const root = document.documentElement
        const classes = [
          geistSans.variable,
          geistMono.variable,
          'antialiased',
        ].filter(Boolean)
        root.classList.add(...classes)
        return () => root.classList.remove(...classes)
      }, [])
      return <Story />
    },
  ],
}

export default preview
