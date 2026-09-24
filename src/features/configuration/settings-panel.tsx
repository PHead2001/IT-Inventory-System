'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { reviewCategoryRemoval, submitConfiguration } from './actions';
import type { ConfigurationCategory, LabelDefaults } from './queries.server';
import type { RemovalReview } from './contracts';

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
}: {
  categories: ConfigurationCategory[];
  labelDefaults: LabelDefaults;
  canManage: boolean;
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
  const [removing, setRemoving] = useState<string | null>(null);
  const [replacement, setReplacement] = useState('');
  const [review, setReview] = useState<RemovalReview | null>(null);
  const [size, setSize] = useState(labelDefaults.size);
  const [page, setPage] = useState(labelDefaults.page);
  const [format, setFormat] = useState(labelDefaults.format);
  const active = categories.filter((item) => item.active && !item.removed_at);
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
    <div className="space-y-8">
      {message && (
        <p role="status" className="rounded border border-cyan-700 p-3 text-sm">
          {message}
        </p>
      )}
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
        <ul className="space-y-3">
          {categories.map((category) => (
            <li
              key={category.id}
              className="rounded-lg border border-slate-700 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <strong>{category.name}</strong>
                  <span className="ml-3 text-sm text-slate-400">
                    {category.code}
                  </span>
                  {!category.active && (
                    <span className="ml-3 text-xs text-amber-300">Removed</span>
                  )}
                </div>
                {canManage && category.active && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={pending}
                      onClick={() => {
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
                  onSubmit={(event) => {
                    event.preventDefault();
                    submit(
                      'category_rename',
                      {
                        category_id: category.id,
                        expected_version: category.version,
                        name: editName,
                      },
                      () => setEditing(null),
                    );
                  }}
                >
                  <label
                    className="block text-sm"
                    htmlFor={'rename-' + category.id}
                  >
                    New category name
                  </label>
                  <Input
                    id={'rename-' + category.id}
                    value={editName}
                    maxLength={200}
                    required
                    onChange={(event) => setEditName(event.target.value)}
                  />
                  <div className="flex gap-2">
                    <Button disabled={pending}>Save name</Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setEditing(null)}
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
                      None, only if no records reference this category
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
                          {review.quantity_count} quantity definitions
                        </strong>{' '}
                        and{' '}
                        <strong>{review.asset_count} serialized assets</strong>{' '}
                        will move from {review.source_name}{' '}
                        {review.target_name
                          ? 'to ' + review.target_name
                          : 'and the unreferenced category will be deleted'}
                        .
                      </p>
                      <p className="text-sm text-slate-400">
                        This review expires at{' '}
                        {new Date(review.expires_at).toLocaleTimeString()}. New
                        or changed records require another review.
                      </p>
                      {Number(review.quantity_count) +
                        Number(review.asset_count) >
                        0 && !review.target_id ? (
                        <p role="alert">Choose a replacement before removal.</p>
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
            className="space-y-3 rounded-lg border border-slate-700 p-4"
            onSubmit={(event) => {
              event.preventDefault();
              submit(
                'category_create',
                { name, code, sort_order: active.length + 1 },
                () => {
                  setName('');
                  setCode('');
                },
              );
            }}
          >
            <h3 className="font-semibold">Add category</h3>
            <label className="block text-sm" htmlFor="category-name">
              Display name
            </label>
            <Input
              id="category-name"
              value={name}
              required
              maxLength={200}
              onChange={(event) => {
                setName(event.target.value);
                setCode(codeFor(event.target.value));
              }}
            />
            <label className="block text-sm" htmlFor="category-code">
              Permanent code
            </label>
            <Input
              id="category-code"
              value={code}
              required
              maxLength={100}
              pattern="[A-Z][A-Z0-9]*(-[A-Z0-9]+)*"
              onChange={(event) => setCode(event.target.value)}
            />
            <p className="text-xs text-slate-400">
              The code identifies this category permanently. You can rename its
              display name later.
            </p>
            <Button disabled={pending}>Add category</Button>
          </form>
        )}
      </section>
      <section
        aria-labelledby="labels-heading"
        className="space-y-3 rounded-lg border border-slate-700 p-4"
      >
        <h2 id="labels-heading" className="text-xl font-semibold">
          Shared label defaults
        </h2>
        <p className="text-sm text-slate-400">
          These starting choices apply when opening Print labels. Each print can
          still use different choices.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1 text-sm">
            Size
            <select
              className="min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3"
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
              className="min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3"
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
              className="min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3"
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
    </div>
  );
}
