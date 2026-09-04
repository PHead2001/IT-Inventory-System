import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: { default: 'IT Inventory', template: '%s · IT Inventory' },
  description: 'Internal IT inventory foundation',
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
