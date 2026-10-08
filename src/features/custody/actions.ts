'use server';
import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { Json } from '@/lib/supabase/database.types';
import { isActiveMember, mayManageConfiguration } from '@/lib/auth/membership';
import { mutationResultSchema } from '@/features/inventory/contracts';
import { z } from 'zod';
import { readCustodyReceipt } from './custody-receipt.server';
import {
  custodyError,
  parseCustodyCommand,
  type CustodyState,
} from './contracts';

export async function submitCustody(input: unknown): Promise<CustodyState> {
  const parsed = parseCustodyCommand(input);
  if (!parsed.success) {
    const fieldErrors = Object.fromEntries(
      parsed.error.issues.map((issue) => [issue.path.join('.'), issue.message]),
    );
    return {
      ok: false,
      code: 'invalid_input',
      message: 'Check the highlighted values.',
      fieldErrors,
    };
  }
  const { operation, requestId, payload } = parsed.data;
  try {
    const supabase = await createSupabaseServerClient(true);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) return custodyError('P1001');
    if (parsed.data.expectedActorId && parsed.data.expectedActorId !== user.id)
      return {
        ok: false,
        code: 'actor_changed',
        message:
          'The signed-in staff member changed. Return to the original account before saving these entries.',
      };
    const { data: member, error: memberError } = await supabase
      .from('app_members')
      .select('user_id,display_name,role,active,can_manage_configuration')
      .eq('user_id', user.id)
      .maybeSingle();
    const configOperation =
      operation.startsWith('location_') || operation.startsWith('site_');
    if (
      memberError ||
      !isActiveMember(member) ||
      member.role !== 'staff' ||
      (configOperation && !mayManageConfiguration(member))
    )
      return custodyError('P1001');
    const { data, error } = await supabase.rpc(operation, {
      p_request_id: requestId,
      p_payload: payload as Json,
    });
    if (error?.message === 'use_site_lifecycle')
      return {
        ok: false,
        code: 'P1012',
        message:
          'Use Archive site or Restore site to change site availability and record a reason.',
      };
    if (error) {
      if (operation === 'location_rename' && error.code === 'P1007')
        return {
          ok: false,
          code: 'P1007',
          message:
            'Another active location with the same parent already uses that name. Choose a different name.',
        };
      if (operation === 'site_create' && error.code === 'P1007')
        return {
          ok: false,
          code: 'P1007',
          message:
            'That site code is already in use. Choose a different site code.',
        };
      return custodyError(error.code);
    }
    const result = mutationResultSchema.safeParse(data);
    if (!result.success) return custodyError();
    const committed: Extract<CustodyState, { ok: true }> = {
      ok: true,
      entityId: result.data.entity_id,
      version: result.data.version,
      changed: result.data.changed,
      ...(result.data.event_id ? { eventId: result.data.event_id } : {}),
    };
    if (
      result.data.event_id &&
      (operation === 'quantity_site_change' ||
        operation === 'asset_site_change' ||
        operation === 'quantity_site_open' ||
        operation === 'asset_site_open')
    ) {
      try {
        committed.custody = await readCustodyReceipt(
          supabase,
          operation.startsWith('quantity') ? 'quantity' : 'asset',
          committed.entityId,
          result.data.event_id,
        );
      } catch {
        committed.refreshFailed = true;
      }
    }
    // The parsed RPC acknowledgement is authoritative even if subsequent reads
    // or cache invalidation fail. Never invite a fresh write after that point.
    try {
      for (const path of [
        '/inventory',
        '/dashboard',
        '/locations',
        '/sites',
        '/history',
        '/settings',
        '/labels',
        '/room',
        '/spaces',
      ])
        revalidatePath(path);
    } catch {
      committed.refreshFailed = true;
    }
    return committed;
  } catch {
    return custodyError();
  }
}

export async function loadCustodyReceipt(input: unknown) {
  const parsed = z
    .strictObject({
      kind: z.enum(['quantity', 'asset']),
      entityId: z.uuid(),
      eventId: z.uuid(),
      expectedActorId: z.uuid(),
    })
    .safeParse(input);
  if (!parsed.success) return null;
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error || !user || user.id !== parsed.data.expectedActorId) return null;
    const member = await supabase
      .from('app_members')
      .select('user_id,display_name,role,active')
      .eq('user_id', user.id)
      .maybeSingle();
    if (member.error || !isActiveMember(member.data)) return null;
    return await readCustodyReceipt(
      supabase,
      parsed.data.kind,
      parsed.data.entityId,
      parsed.data.eventId,
    );
  } catch {
    return null;
  }
}
