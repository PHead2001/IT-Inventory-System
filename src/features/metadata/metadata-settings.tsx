'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import type { MetadataForm } from './contracts';
import { reviewMetadataPublish, submitMetadataDraft } from './actions';
import type { z } from 'zod';
import type { reviewSchema } from './contracts';

type Review = z.infer<typeof reviewSchema>;
type Category = { id: string; name: string; active: boolean };
export function MetadataSettings({
  categories,
  forms,
  memberId,
}: {
  categories: Category[];
  forms: Record<string, MetadataForm>;
  memberId: string;
}) {
  const router = useRouter();
  const active = categories.filter((category) => category.active);
  const [categoryId, setCategoryId] = useState(active[0]?.id ?? '');
  const selected = forms[categoryId];
  const [editor, setEditor] = useState(() =>
    JSON.stringify(
      selected?.draft_definition ??
        selected?.published_definition ?? { fields: [], layout: [] },
      null,
      2,
    ),
  );
  const [draftVersion, setDraftVersion] = useState(
    selected?.draft_version ?? '0',
  );
  const [draftId, setDraftId] = useState<string | null>(
    selected?.draft_id ?? null,
  );
  const [publishedRevisionId, setPublishedRevisionId] = useState(
    selected?.published_revision_id ?? '',
  );
  const [review, setReview] = useState<Review | null>(null);
  const [message, setMessage] = useState('');
  const [receipt, setReceipt] = useState<{ key: string; id: string } | null>(
    null,
  );
  const [pending, startTransition] = useTransition();
  const changeCategory = (next: string) => {
    setCategoryId(next);
    const form = forms[next];
    setEditor(
      JSON.stringify(
        form?.draft_definition ??
          form?.published_definition ?? { fields: [], layout: [] },
        null,
        2,
      ),
    );
    setDraftVersion(form?.draft_version ?? '0');
    setDraftId(form?.draft_id ?? null);
    setPublishedRevisionId(form?.published_revision_id ?? '');
    setReview(null);
    setMessage('');
    setReceipt(null);
  };
  const submit = (
    operation:
      'metadata_draft_save' | 'metadata_draft_discard' | 'metadata_publish',
    payload: Record<string, unknown>,
  ) => {
    const submittedPayload = {
      category_id: categoryId,
      expected_actor_id: memberId,
      expected_draft_id: draftId,
      expected_draft_version: draftVersion,
      expected_published_revision_id: publishedRevisionId,
      ...payload,
    };
    const key = JSON.stringify([operation, submittedPayload]);
    const requestId = receipt?.key === key ? receipt.id : crypto.randomUUID();
    setReceipt({ key, id: requestId });
    setMessage('');
    startTransition(async () => {
      const response = await submitMetadataDraft({
        operation,
        requestId,
        expectedActorId: memberId,
        payload: submittedPayload,
      });
      if (!response.ok) {
        setMessage(response.message);
        if (response.code === 'P1002' || response.code === 'P1017')
          setReview(null);
        return;
      }
      setReceipt(null);
      if (operation === 'metadata_draft_save') {
        setDraftVersion(String(response.data.version));
        setDraftId(String(response.data.draft_id));
        setMessage('Draft saved. Review its impact before publishing.');
      } else if (operation === 'metadata_draft_discard') {
        setDraftVersion('0');
        setDraftId(null);
        setReview(null);
        setEditor(JSON.stringify(selected.published_definition, null, 2));
        setMessage('Draft discarded.');
      } else {
        setDraftVersion('0');
        setDraftId(null);
        setPublishedRevisionId(String(response.data.published_revision_id));
        setReview(null);
        setMessage(
          'Published form revision ' + String(response.data.version) + '.',
        );
      }
      router.refresh();
    });
  };
  const save = () => {
    try {
      const definition: unknown = JSON.parse(editor);
      submit('metadata_draft_save', {
        category_id: categoryId,
        expected_draft_version: draftVersion,
        definition,
      });
      setReview(null);
    } catch {
      setMessage(
        'Enter valid JSON. Draft content may still have validation errors until publication.',
      );
    }
  };
  const reviewImpact = () => {
    setMessage('');
    startTransition(async () => {
      if (!draftId) return;
      const result = await reviewMetadataPublish({
        categoryId,
        expectedActorId: memberId,
        expectedDraftId: draftId,
        expectedDraftVersion: draftVersion,
        expectedPublishedRevisionId: publishedRevisionId,
      });
      if (!result.ok) {
        setMessage(result.message);
        setReview(null);
        return;
      }
      setReview(result.review);
    });
  };
  return (
    <section
      className="space-y-4 rounded-lg border border-slate-700 p-4"
      aria-labelledby="metadata-settings-heading"
    >
      <div>
        <h2 id="metadata-settings-heading" className="text-xl font-semibold">
          Published inventory forms
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          Edit a JSON draft, review affected records, then publish. Form fields
          and layouts are validated when published. A visual drag designer is
          planned for the next slice.
        </p>
      </div>
      {active.length === 0 ? (
        <p>No active category is available.</p>
      ) : (
        <>
          <label className="block space-y-1">
            <span>Category</span>
            <select
              className="min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3"
              value={categoryId}
              onChange={(event) => changeCategory(event.target.value)}
            >
              {active.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <p className="text-sm text-slate-400">
            Current published revision {selected?.published_number ?? 'unknown'}{' '}
            · Draft version {draftVersion === '0' ? 'none' : draftVersion}
          </p>
          <label className="block space-y-2">
            <span>Form definition JSON</span>
            <textarea
              className="min-h-80 w-full rounded border border-slate-600 bg-slate-950 p-3 font-mono text-xs"
              spellCheck={false}
              value={editor}
              onChange={(event) => {
                setEditor(event.target.value);
                setReview(null);
                setMessage('');
              }}
            />
          </label>
          <p className="text-xs text-slate-400">
            Fields have stable UUID, type, label, applicability, required,
            rules, default and options. Layout sections contain field, builtin
            and help controls with widths Auto, 3, 4, 6, 8, 9 or 12. Name and
            category must each appear once.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={pending} onClick={save}>
              Save draft
            </Button>
            {draftVersion !== '0' && (
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  submit('metadata_draft_discard', {
                    category_id: categoryId,
                    expected_draft_version: draftVersion,
                  })
                }
              >
                Discard draft
              </Button>
            )}
            {draftVersion !== '0' && (
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={reviewImpact}
              >
                Review publish impact
              </Button>
            )}
          </div>
          {review && (
            <div
              className="space-y-3 rounded border border-amber-700 p-3"
              role="region"
              aria-label="Form publication impact"
            >
              <p>
                Revision {review.draft_version} will become current for{' '}
                {review.affected_quantity} quantity definitions and{' '}
                {review.affected_assets} assets. Existing values remain
                unchanged; records with tightened rules may need metadata
                review.
              </p>
              <p className="text-xs text-slate-400">
                Review expires at{' '}
                {new Date(review.expires_at).toLocaleTimeString()}.
              </p>
              <Button
                type="button"
                disabled={pending}
                onClick={() =>
                  submit('metadata_publish', {
                    category_id: categoryId,
                    expected_draft_id: review.draft_id,
                    expected_draft_version: review.draft_version,
                    expected_published_revision_id:
                      review.published_revision_id,
                    review_token: review.token,
                  })
                }
              >
                Publish reviewed revision
              </Button>
            </div>
          )}
          {message && (
            <p
              role="status"
              className="rounded border border-cyan-700 p-3 text-sm"
            >
              {message}
            </p>
          )}
        </>
      )}
    </section>
  );
}
