import type { Preview } from '@storybook/react'
import '../src/app/globals.css'

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
}

export default preview
