import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { headers } from 'next/headers';
import {
  themeScope,
  themeScopeHeader,
} from '@/components/experience/theme-scope';
import { ThemePreferenceProvider } from '@/components/experience/theme-preference';
import { supabaseConfig } from '@/lib/supabase/config';
import './globals.css';
const uiFont = localFont({
  src: '../../public/fonts/inter-latin-v5.2.8.woff2',
  variable: '--font-ui',
  weight: '100 900',
  display: 'swap',
  fallback: ['Arial', 'sans-serif'],
});
const codeFont = localFont({
  src: '../../public/fonts/jetbrains-mono-v2.304-regular.woff2',
  variable: '--font-code',
  weight: '400',
  preload: false,
  display: 'swap',
  fallback: ['Consolas', 'monospace'],
});
export const metadata: Metadata = {
  title: { default: 'IT Inventory', template: '%s · IT Inventory' },
  description:
    'Find IT equipment, track stock and assignments, and browse storage locations.',
  robots: { index: false, follow: false },
};
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const scope = themeScope(
    supabaseConfig().url,
    (await headers()).get(themeScopeHeader),
  );
  return (
    <html
      lang="en"
      data-motion="reduced"
      data-theme="dark"
      data-theme-preference="dark"
      data-theme-scope={scope}
      suppressHydrationWarning
      className={`${uiFont.variable} ${codeFont.variable}`}
    >
      <head>
        {/* Apply the scoped presentation choice before first paint. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/theme-bootstrap.v1.js" />
      </head>
      <body>
        <ThemePreferenceProvider scope={scope}>
          {children}
        </ThemePreferenceProvider>
      </body>
    </html>
  );
}
