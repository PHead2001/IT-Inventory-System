import type { Metadata } from 'next';
import localFont from 'next/font/local';
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
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      data-motion="reduced"
      className={`${uiFont.variable} ${codeFont.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
