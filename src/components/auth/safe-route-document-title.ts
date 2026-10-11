import { ASSET_UUID, targetPath } from '@/features/scan/targets';
import { custodySchemas } from '@/features/custody/contracts';

export const safeDocumentTitle = 'IT Inventory';
// These labels are authored by the corresponding page/layout metadata. Never
// learn a fallback from document.title, record data, or a navigation parameter.
const ordinaryTitles: Readonly<Record<string, string>> = {
  '/inventory': 'Inventory',
  '/inventory/assets/new': 'Add individual asset',
  '/inventory/quantity/new': 'Add quantity item',
  '/dashboard': 'Overview',
  '/labels': 'Labels',
  '/scan': 'Scan',
  '/room': 'Spaces & maps',
  '/locations': 'Locations',
  '/sites': 'Sites',
  '/history': 'History',
  '/settings': 'Settings',
  '/settings/categories': 'Categories',
  '/settings/forms': 'Category forms',
  '/settings/locations': 'Location settings',
  '/settings/sites': 'Site settings',
  '/settings/labels': 'Label settings',
};

/** Only called with a live verified navigation grant; values never enter titles. */
export function safeRouteDocumentTitle(navigation: string): string {
  if (/[#\\\u0000-\u001f\u007f]/.test(navigation)) return safeDocumentTitle;
  const path = navigation.split('?')[0];
  if (
    path.length > 256 ||
    /%/.test(path) ||
    !path.startsWith('/') ||
    path.startsWith('//')
  )
    return safeDocumentTitle;
  let label = Object.hasOwn(ordinaryTitles, path)
    ? ordinaryTitles[path]
    : undefined;
  const target = targetPath(path);
  if (target)
    label = {
      asset: 'Individual asset',
      quantity: 'Quantity item',
      location: 'Location details',
    }[target.kind];
  const segments = path.split('/');
  const siteCode = (value: string) =>
    custodySchemas.site_create.shape.code.safeParse(value).success;
  if (segments.length === 3 && segments[1] === 'sites' && siteCode(segments[2]))
    label = 'Site details';
  if (
    segments.length === 5 &&
    segments[1] === 'sites' &&
    siteCode(segments[2]) &&
    segments[3] === 'open' &&
    ['quantity', 'asset'].includes(segments[4])
  )
    label = 'Record existing equipment';
  if (segments.length === 4 && segments[1] === 'settings') {
    if (segments[2] === 'forms' && ASSET_UUID.test(segments[3]))
      label = 'Category forms';
    if (segments[2] === 'locations' && targetPath('/locations/' + segments[3]))
      label = 'Rename location';
    if (segments[2] === 'sites' && siteCode(segments[3]))
      label = 'Site details and settings';
  }
  if (
    segments.length === 5 &&
    segments[1] === 'history' &&
    segments[2] === 'events' &&
    ['quantity', 'asset'].includes(segments[3]) &&
    ASSET_UUID.test(segments[4])
  )
    label = 'History';
  return label ? `${label} · IT Inventory` : safeDocumentTitle;
}
