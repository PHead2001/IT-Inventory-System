import 'server-only';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { documentPathHeader, documentRecordRoute } from '@/lib/document-route';
import { readQuantityPage } from './inventory/quantity/[id]/read.server';
import { readAssetPage } from './inventory/assets/[id]/read.server';
import { readLocationPage } from './locations/[code]/read.server';
import { readSitePage } from './sites/[code]/read.server';
import { readManagedSitePage } from './settings/sites/[code]/read.server';
import { readManagedLocationPage } from './settings/locations/[code]/read.server';
import { readCategoryFormPage } from './settings/forms/[categoryId]/read.server';
import { readSiteOpeningPage } from './sites/[code]/open/[kind]/read.server';

// Called after requireMember and before the layout returns any Suspense boundary.
// Flight retains page-owned authorization and streaming. Documents share the
// page's React request cache; no existence result survives a request.
export async function admitDocumentRecord() {
  const request = await headers();
  if (request.get('rsc') === '1') return;
  const route = documentRecordRoute(request.get(documentPathHeader) ?? '');
  if (!route) return;
  const { prefix, key, kind } = route;
  let record: unknown;
  switch (prefix) {
    case '/inventory/quantity':
      record = await readQuantityPage(key);
      break;
    case '/inventory/assets':
      record = await readAssetPage(key);
      break;
    case '/locations':
      record = await readLocationPage(key);
      break;
    case '/sites':
      if (kind === undefined) record = await readSitePage(key);
      else {
        if (kind !== 'quantity' && kind !== 'asset') notFound();
        record = (await readSiteOpeningPage(key)).site;
      }
      break;
    case '/settings/sites':
      record = await readManagedSitePage(key);
      break;
    case '/settings/locations':
      record = await readManagedLocationPage(key);
      break;
    case '/settings/forms':
      record = await readCategoryFormPage(key);
      break;
  }
  if (record == null) notFound();
}
