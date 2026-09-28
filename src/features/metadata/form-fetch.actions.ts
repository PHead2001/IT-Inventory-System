'use server';

import { z } from 'zod';
import { requireMember } from '@/lib/auth/session.server';
import { getPublishedForm } from './queries.server';
import type { MetadataForm } from './contracts';

export type CategoryFormResult =
  { ok: true; form: MetadataForm | null } | { ok: false; message: string };

/** Each Server Action invocation checks the current actor before its one-form read. */
export async function fetchCategoryForm(
  categoryId: string,
): Promise<CategoryFormResult> {
  await requireMember();
  if (!z.uuid().safeParse(categoryId).success)
    return { ok: false, message: 'Choose a valid category.' };
  try {
    return { ok: true, form: await getPublishedForm(categoryId) };
  } catch {
    return {
      ok: false,
      message: 'The selected category form could not be loaded. Retry.',
    };
  }
}
