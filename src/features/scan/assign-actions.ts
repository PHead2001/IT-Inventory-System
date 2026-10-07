'use server';
import { z } from 'zod';
import { requireMember } from '@/lib/auth/session.server';
import {
  getAssetDetail,
  getQuantityDetail,
} from '@/features/inventory/queries.server';
import { getSites } from '@/features/custody/queries.server';
import { searchLabelRecords } from '@/features/labels/queue.server';
import { resolveScan, resolveItemCode, type ScanMatch } from './resolve.server';
import { targetPath } from './targets';
import type {
  AssignmentInspection,
  AssignmentLookup,
} from './assign-contracts';

async function staff(actorId: string) {
  const session = await requireMember();
  if (
    session.member.role !== 'staff' ||
    !session.member.active ||
    session.member.user_id !== actorId
  )
    throw new Error(
      'Return to the original active staff account before assigning.',
    );
  return session;
}
export async function findAssignmentRecords(
  input: unknown,
): Promise<AssignmentLookup> {
  const parsed = z
    .strictObject({
      actorId: z.uuid(),
      text: z.string().max(1024),
      mode: z.enum(['identifier', 'item_code', 'search']),
      page: z.number().int().min(1).max(100000).default(1),
    })
    .safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      message: 'Enter a supported label, identifier or search.',
    };
  try {
    await staff(parsed.data.actorId);
    if (parsed.data.mode !== 'search') {
      const resolution = await (parsed.data.mode === 'item_code'
        ? resolveItemCode(parsed.data.text)
        : resolveScan(parsed.data.text));
      return { ok: true, ...resolution };
    }
    const query = parsed.data.text.trim();
    if (!query || query.length > 100)
      return { ok: false, message: 'Enter a search from 1 to 100 characters.' };
    // This caller-scoped RPC deduplicates typed records before its bounded
    // pagination, so a quantity's many holdings do not consume candidate slots.
    const result = await searchLabelRecords({
      q: query,
      type: 'all',
      status: 'all',
      category: '',
      location: '',
      page: parsed.data.page,
    });
    const matches: ScanMatch[] = [];
    for (const row of result.rows) {
      const path = `/inventory/${row.kind === 'quantity' ? 'quantity' : 'assets'}/${row.key}`;
      if (!matches.some((match) => match.path === path))
        matches.push({
          kind: row.kind,
          path,
          label: `${row.name}${row.assetTag || row.itemCode ? ` (${row.assetTag ?? row.itemCode})` : ''}`,
          state:
            row.status === 'retired'
              ? 'retired'
              : row.status === 'archived'
                ? 'archived'
                : 'active',
        });
    }
    return {
      ok: true,
      matches,
      status: matches.length ? 'ambiguous' : 'unknown',
      searchPage: {
        query,
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
      },
    };
  } catch {
    return {
      ok: false,
      message:
        'Lookup is unavailable. Check your active staff session and try again.',
    };
  }
}
export async function inspectAssignmentRecord(
  input: unknown,
): Promise<AssignmentInspection> {
  const parsed = z
    .strictObject({
      actorId: z.uuid(),
      path: z.string().max(256),
      siteId: z.uuid(),
    })
    .safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      message: 'Choose a valid inventory record and destination site.',
    };
  try {
    await staff(parsed.data.actorId);
    const target = targetPath(parsed.data.path);
    if (!target || target.kind === 'location')
      return {
        ok: false,
        message:
          'This label identifies a location. Select an existing quantity item or individual asset to assign.',
      };
    const sites = await getSites();
    if (!sites.some((site) => site.id === parsed.data.siteId && site.active))
      return {
        ok: false,
        message:
          'The destination site is no longer active. Choose an active site and inspect again.',
      };
    if (target.kind === 'quantity') {
      const detail = await getQuantityDetail(target.id);
      if (!detail)
        return {
          ok: false,
          message: 'This quantity item no longer exists or is unavailable.',
        };
      return {
        ok: true,
        candidate: {
          kind: 'quantity',
          id: detail.item.id,
          path: target.path,
          name: detail.item.name,
          identifier: detail.item.itemCode,
          version: String(detail.item.version),
          status: detail.item.archived ? 'archived' : 'active',
          currentSite: null,
          sources: detail.balances
            .filter((row) => row.quantity > 0)
            .map((row) => ({
              id: row.location.id,
              name: row.location.breadcrumb,
              active: row.location.active,
              quantity: row.quantity,
            })),
        },
      };
    }
    const detail = await getAssetDetail(target.id);
    if (!detail)
      return {
        ok: false,
        message: 'This asset no longer exists or is unavailable.',
      };
    return {
      ok: true,
      candidate: {
        kind: 'asset',
        id: detail.asset.id,
        path: target.path,
        name: detail.asset.name,
        identifier: detail.asset.assetTag ?? detail.asset.serialNumber,
        version: String(detail.asset.version),
        status: detail.asset.status,
        currentSite: detail.site?.name ?? null,
        sources:
          detail.asset.status === 'active' && detail.location && !detail.site
            ? [
                {
                  id: detail.location.id,
                  name: detail.location.breadcrumb,
                  active: detail.location.active,
                  quantity: 1,
                },
              ]
            : [],
      },
    };
  } catch {
    return {
      ok: false,
      message:
        'The record could not be inspected. Check your active staff session and retry.',
    };
  }
}
