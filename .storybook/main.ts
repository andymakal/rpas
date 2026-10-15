import type { StorybookConfig } from '@storybook/nextjs-vite'

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-mcp'],
  framework: '@storybook/nextjs-vite',
  docs: { autodocs: 'tag' },
  // Storybook is served under the `/storybook/` subpath on the Vercel preview.
  // By default the Vite build emits RELATIVE asset URLs (`./sb-manager/...`),
  // which only resolve correctly when the document URL keeps its trailing slash.
  // On the deployment, `/storybook/` 308-redirects to `/storybook` (no slash),
  // so relative assets resolved against the site root (`/sb-manager/...`), where
  // the auth middleware redirected them to `/login` — leaving a blank page.
  // Setting an absolute Vite base makes every asset URL `/storybook/...`,
  // independent of the trailing slash, so assets always resolve under the
  // proxy-excluded `/storybook` prefix.
  viteFinal: async (viteConfig) => {
    viteConfig.base = '/storybook/'
    return viteConfig
  },
  // The Vite base above fixes the PREVIEW iframe's asset URLs, but the Storybook
  // MANAGER (index.html) is not built by Vite and still emits relative
  // `./sb-manager/...` URLs. A `<base href>` makes every relative URL in the
  // manager resolve against `/storybook/` regardless of whether the document URL
  // kept its trailing slash, so the manager runtime and its `index.json` fetch
  // always load from the proxy-excluded `/storybook/` prefix instead of leaking
  // to the site root (where auth redirects them to /login).
  managerHead: (head) => `${head}\n<base href="/storybook/" />`,
}

export default config
