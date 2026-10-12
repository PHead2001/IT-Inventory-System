'use client';

import { notFound } from 'next/navigation';

// The server has already awaited membership and the page's request-cached read.
// Throw only while producing the initial document, before any shell/Suspense.
// In the browser, the page owns missing/auth results, including cached returns:
// this resolved shared-layout node must never replay its initial document error.
export function DocumentAdmission({
  missing,
  children,
}: {
  missing: boolean;
  children: React.ReactNode;
}) {
  if (missing && typeof window === 'undefined') notFound();
  return children;
}
