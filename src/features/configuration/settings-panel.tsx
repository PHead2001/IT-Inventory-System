'use client';
import { useLayoutEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { reviewCategoryRemoval, submitConfiguration } from './actions';
import type { ConfigurationCategory, LabelDefaults } from './queries.server';
import type { RemovalReview } from './contracts';
import {
  RequiredFieldsNote,
  RequiredMark,
  useFormValidation,
  ValidationSummary,
} from '@/components/forms/validation';

function codeFor(name: string) {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
export function SettingsPanel({
  categories,
  labelDefaults,
  canManage,
  mode = 'both',
}: {
  categories?: ConfigurationCategory[];
  labelDefaults?: LabelDefaults;
  canManage: boolean;
  mode?: 'both' | 'categories' | 'labels';
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState('');
  const [receipt, setReceipt] = useState<{ key: string; id: string } | null>(
    null,
  );
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const renameValidation = useFormValidation();
  const createValidation = useFormValidation();
  const renameInput = useRef<HTMLInputElement>(null);
  const renameTriggers = useRef(new Map<string, HTMLButtonElement>());
  const returnToCategory = useRef<string | null>(null);
  const categoryList = useRef<HTMLUListElement>(null);
  useLayoutEffect(() => {
    if (editing) renameInput.current?.focus();
    else if (!pending && returnToCategory.current) {
      (
        renameTriggers.current.get(returnToCategory.current) ??
        categoryList.current
      )?.focus();
      returnToCategory.current = null;
    }
  }, [editing, pending]);
  const closeRename = () => {
    setEditing(null);
    renameValidation.clear();
  };
  const [removing, setRemoving] = useState<string | null>(null);
  const [replacement, setReplacement] = useState('');
  const [review, setReview] = useState<RemovalReview | null>(null);
  const [size, setSize] = useState(labelDefaults?.size ?? '90x50');
  const [page, setPage] = useState(labelDefaults?.page ?? 'letter');
  const [format, setFormat] = useState(labelDefaults?.format ?? 'qr');
  const active = (categories ?? []).filter(
    (item) => item.active && !item.removed_at,
  );
  const reviewedHasReferences =
    review !== null &&
    (review.quantity_count !== '0' ||
      review.asset_count !== '0' ||
      review.historical_quantity_count !== '0' ||
      review.historical_asset_count !== '0');
  const submit = (
    operation:
      | 'category_create'
      | 'category_rename'
      | 'category_remove'
      | 'label_defaults_update',
    payload: Record<string, unknown>,
    onSuccess?: () => void,
  ) => {
    const key = JSON.stringify([operation, payload]);
    const requestId = receipt?.key === key ? receipt.id : crypto.randomUUID();
    setReceipt({ key, id: requestId });
    setMessage('');
    startTransition(async () => {
      const result = await submitConfiguration({
        operation,
        requestId,
        payload,
      });
      if (!result.ok) {
        setMessage(result.message);
        if (operation === 'category_remove' && result.code === 'P1017') {
          setReview(null);
          setReceipt(null);
        }
        return;
      }
      setReceipt(null);
      setMessage(
        result.result.changed ? 'Settings saved.' : 'No values changed.',
      );
      onSuccess?.();
      router.refresh();
    });
  };
  const startRemoval = (categoryId: string) => {
    setRemoving(categoryId);
    setReplacement('');
    setReview(null);
    setEditing(null);
    setMessage('');
  };
  const previewRemoval = () => {
    if (!removing) return;
    setMessage('');
    startTransition(async () => {
      const result = await reviewCategoryRemoval(removing, replacement || null);
      if (!result.ok) {
        setMessage(result.message);
        setReview(null);
        return;
      }
      if (!('review' in result)) return;
      setReview(result.review);
    });
  };
  return (
    <div className="space-y-6">
      {!canManage && (
        <p role="note" className="experience-feedback text-sm text-slate-200">
          Settings are read-only for your account. You can view{' '}
          {mode === 'categories'
            ? 'categories'
            : mode === 'labels'
              ? 'shared label defaults'
              : 'categories and shared label defaults'}
          . Editing categories, form fields, and shared defaults requires an
          active staff membership with configuration access. Ask the application
          owner if you need that access.
        </p>
      )}
      {message && (
        <p role="status" className="experience-feedback text-sm">
          {message}
        </p>
      )}
      {mode !== 'labels' && (
        <section aria-labelledby="categories-heading" className="space-y-4">
          <div>
            <h2 id="categories-heading" className="text-xl font-semibold">
              Categories
            </h2>
            <p className="text-sm text-slate-400">
              Names appear in inventory lists, detail pages and exports. Codes
              remain fixed after creation.
            </p>
          </div>
          {active.length === 0 && (
            <p className="rounded border border-amber-700 p-4 text-amber-200">
              No active categories. A configuration maintainer must create one
              before staff can add inventory.
            </p>
          )}
          <ul
            ref={categoryList}
            tabIndex={-1}
            aria-label="Categories"
            className="experience-surface divide-y divide-cyan-100/10 overflow-hidden"
          >
            {(categories ?? []).map((category) => (
              <li
                key={category.id}
                className="min-w-0 p-4 transition-colors hover:bg-cyan-100/5"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 break-words">
                    <strong>{category.name}</strong>
                    <span className="ml-3 text-sm text-slate-400">
                      {category.code}
                    </span>
                    {!category.active && (
                      <span className="ml-3 text-xs text-amber-300">
                        Removed
                      </span>
                    )}
                  </div>
                  {canManage && category.active && (
                    <div className="flex flex-wrap gap-2">
                      <Link
                        className="inline-flex min-h-10 items-center rounded border border-cyan-700 px-3 text-sm text-cyan-200 hover:bg-cyan-950"
                        href={`/settings/forms/${encodeURIComponent(category.id)}`}
                      >
                        Edit form
                      </Link>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={pending}
                        aria-label={'Rename ' + category.name}
                        ref={(element) => {
                          if (element)
                            renameTriggers.current.set(category.id, element);
                          else renameTriggers.current.delete(category.id);
                        }}
                        onClick={() => {
                          returnToCategory.current = category.id;
                          renameValidation.clear();
                          setEditing(category.id);
                          setEditName(category.name);
                          setRemoving(null);
                          setReview(null);
                        }}
                      >
                        Rename
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={pending}
                        onClick={() => startRemoval(category.id)}
                      >
                        Remove
                      </Button>
                    </div>
                  )}
                </div>
                {canManage && editing === category.id && (
                  <form
                    className="mt-4 space-y-3"
                    noValidate
                    onKeyDown={(event) => {
                      if (
                        event.key === 'Escape' &&
                        !event.defaultPrevented &&
                        !pending
                      ) {
                        event.preventDefault();
                        closeRename();
                      }
                    }}
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (
                        pending ||
                        !renameValidation.validate(event.currentTarget)
                      )
                        return;
                      submit(
                        'category_rename',
                        {
                          category_id: category.id,
                          expected_version: category.version,
                          name: editName,
                        },
                        closeRename,
                      );
                    }}
                  >
                    <RequiredFieldsNote />
                    <label
                      className="block text-sm"
                      htmlFor={'rename-' + category.id}
                    >
                      New category name
                      <RequiredMark />
                    </label>
                    <Input
                      id={'rename-' + category.id}
                      ref={renameInput}
                      aria-label="New category name"
                      {...renameValidation.props('rename-' + category.id)}
                      value={editName}
                      maxLength={200}
                      required
                      disabled={pending}
                      onChange={(event) => setEditName(event.target.value)}
                    />
                    {renameValidation.error('rename-' + category.id)}
                    <ValidationSummary issues={renameValidation.issues} />
                    <div className="flex gap-2">
                      <Button disabled={pending}>Save name</Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={pending}
                        onClick={closeRename}
                      >
                        Cancel
                      </Button>
                    </div>
                  </form>
                )}
                {canManage && removing === category.id && (
                  <div
                    className="mt-4 space-y-3 rounded border border-amber-700 p-4"
                    aria-label={'Remove ' + category.name}
                  >
                    <p className="text-sm">
                      Review every affected quantity definition and asset,
                      including archived and retired records. Current stock and
                      movement history stay with each record.
                    </p>
                    <label
                      className="block text-sm"
                      htmlFor={'replacement-' + category.id}
                    >
                      Replacement category
                    </label>
                    <select
                      id={'replacement-' + category.id}
                      className="min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3"
                      value={replacement}
                      onChange={(event) => {
                        setReplacement(event.target.value);
                        setReview(null);
                      }}
                    >
                      <option value="">
                        None, only if no current or historical inventory
                        references
                      </option>
                      {active
                        .filter((item) => item.id !== category.id)
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                    </select>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        disabled={pending}
                        onClick={previewRemoval}
                      >
                        Review impact
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setRemoving(null);
                          setReview(null);
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                    {review && (
                      <div
                        className="space-y-3 rounded border border-slate-600 p-3"
                        role="region"
                        aria-label="Removal impact review"
                      >
                        <p>
                          <strong>
                            {review.quantity_count} current quantity definitions
                          </strong>{' '}
                          and{' '}
                          <strong>
                            {review.asset_count} current serialized assets
                          </strong>{' '}
                          {review.target_name
                            ? 'will be reassigned to ' + review.target_name
                            : 'use ' + review.source_name}
                          .
                        </p>
                        <p>
                          <strong>
                            {review.historical_quantity_count} historical
                            quantity definitions
                          </strong>{' '}
                          and{' '}
                          <strong>
                            {review.historical_asset_count} historical
                            serialized assets
                          </strong>{' '}
                          also reference this category.{' '}
                          {review.will_tombstone
                            ? 'The category will be removed from active choices but retained for readable history.'
                            : 'This truly unreferenced category will be deleted.'}
                        </p>
                        <p>
                          {review.authored_revision_count} authored form
                          revisions and {review.retained_value_count} records
                          with retained custom values also reference this
                          category.
                        </p>
                        {review.target_id && (
                          <p>
                            After reassignment,{' '}
                            {review.quantity_needs_metadata_count} quantity
                            definitions and {review.asset_needs_metadata_count}{' '}
                            serialized assets will need metadata review under
                            the replacement form. Their source custom values
                            stay visible as legacy values.
                          </p>
                        )}
                        <p className="text-sm text-slate-400">
                          This review expires at{' '}
                          {new Date(review.expires_at).toLocaleTimeString()}.
                          New or changed records require another review.
                        </p>
                        {reviewedHasReferences && !review.target_id ? (
                          <p role="alert">
                            Choose a replacement before removal.
                          </p>
                        ) : (
                          <Button
                            type="button"
                            disabled={pending}
                            onClick={() =>
                              submit(
                                'category_remove',
                                {
                                  category_id: review.source_id,
                                  replacement_id: review.target_id,
                                  review_token: review.token,
                                },
                                () => {
                                  setRemoving(null);
                                  setReview(null);
                                },
                              )
                            }
                          >
                            Confirm removal
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
          {canManage && (
            <form
              className="experience-surface max-w-3xl space-y-3 p-4"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                if (pending || !createValidation.validate(event.currentTarget))
                  return;
                submit(
                  'category_create',
                  { name, code, sort_order: active.length + 1 },
                  () => {
                    setName('');
                    setCode('');
                    createValidation.clear();
                  },
                );
              }}
            >
              <h3 className="font-semibold">Add category</h3>
              <RequiredFieldsNote />
              <label className="block text-sm" htmlFor="category-name">
                Display name
                <RequiredMark />
              </label>
              <Input
                id="category-name"
                aria-label="Display name"
                {...createValidation.props('category-name')}
                value={name}
                required
                maxLength={200}
                onChange={(event) => {
                  setName(event.target.value);
                  setCode(codeFor(event.target.value));
                }}
              />
              {createValidation.error('category-name')}
              <label className="block text-sm" htmlFor="category-code">
                Permanent code
                <RequiredMark />
              </label>
              <Input
                id="category-code"
                aria-label="Permanent code"
                {...createValidation.props('category-code')}
                value={code}
                required
                maxLength={100}
                pattern="[A-Z][A-Z0-9]*(-[A-Z0-9]+)*"
                onChange={(event) => setCode(event.target.value)}
              />
              {createValidation.error('category-code')}
              <ValidationSummary issues={createValidation.issues} />
              <p className="text-xs text-slate-400">
                The code identifies this category permanently. You can rename
                its display name later.
              </p>
              <Button disabled={pending}>Add category</Button>
            </form>
          )}
        </section>
      )}
      {mode !== 'categories' && labelDefaults && (
        <section
          aria-labelledby="labels-heading"
          className="experience-surface max-w-4xl space-y-3 p-4"
        >
          <h2 id="labels-heading" className="text-xl font-semibold">
            Shared label defaults
          </h2>
          <p className="text-sm text-slate-400">
            These starting choices apply when opening Print labels. Each print
            can still use different choices.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="space-y-1 text-sm">
              Size
              <select
                className="experience-field min-h-11 w-full px-3"
                value={size}
                disabled={!canManage || pending}
                onChange={(event) =>
                  setSize(event.target.value as LabelDefaults['size'])
                }
              >
                <option value="90x50">90 × 50 mm</option>
                <option value="70x35">70 × 35 mm</option>
              </select>
            </label>
            <label className="space-y-1 text-sm">
              Page
              <select
                className="experience-field min-h-11 w-full px-3"
                value={page}
                disabled={!canManage || pending}
                onChange={(event) =>
                  setPage(event.target.value as LabelDefaults['page'])
                }
              >
                <option value="letter">US Letter</option>
                <option value="A4">A4</option>
              </select>
            </label>
            <label className="space-y-1 text-sm">
              Format
              <select
                className="experience-field min-h-11 w-full px-3"
                value={format}
                disabled={!canManage || pending}
                onChange={(event) =>
                  setFormat(event.target.value as LabelDefaults['format'])
                }
              >
                <option value="qr">QR URL</option>
                <option value="code128">Code 128 when it fits</option>
              </select>
            </label>
          </div>
          {canManage && (
            <Button
              type="button"
              disabled={pending}
              onClick={() =>
                submit('label_defaults_update', {
                  expected_version: labelDefaults.version,
                  size,
                  page,
                  format,
                })
              }
            >
              Save shared defaults
            </Button>
          )}
        </section>
      )}
    </div>
  );
}
