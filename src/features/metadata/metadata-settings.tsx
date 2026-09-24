'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  fieldTypes,
  metadataDefinition,
  type FieldType,
  type MetadataDefinition,
  type MetadataForm,
} from './contracts';
import type { z } from 'zod';
import type { reviewSchema } from './contracts';
import {
  reviewMetadataPublish,
  submitMetadataDraft,
  verifyMetadataDesignerIdentity,
} from './actions';
import { MetadataFormPreview } from './metadata-form';
import { controlLayoutStyle } from './control-layout';
import { ChoiceDefaultEditor, OptionTreeEditor } from './option-tree-editor';
import {
  clearDesignerRecovery,
  readDesignerRecovery,
  writeDesignerRecovery,
  type DesignerRecovery,
} from './designer-recovery';
import {
  builtins,
  designerIssues,
  initialDefinition,
  moveControl,
  newId,
  selectTypes,
  widths,
  type Control,
  type Field,
} from './designer-model';

type Review = z.infer<typeof reviewSchema>;
type Category = { id: string; name: string; active: boolean };
const input =
  'min-h-10 w-full min-w-0 rounded border border-slate-600 bg-slate-950 px-2 py-1 text-sm';
const label = (value: string) =>
  value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const source = (form?: MetadataForm) =>
  form?.draft_definition ??
  form?.published_definition ?? { fields: [], layout: [] };
const copy = <T,>(value: T): T => structuredClone(value);
function newField(type: FieldType, name = ''): Field {
  return {
    id: newId(),
    type,
    label: name,
    applies_to: ['quantity', 'asset'],
    required: false,
    rules: type === 'currency' ? { currencyCode: 'USD', precision: 2 } : {},
    options: [],
  };
}

function FieldPanel({
  field,
  change,
  remove,
  replace,
  lockedCurrency,
  moveUp,
  moveDown,
}: {
  field: Field;
  change: (field: Field) => void;
  remove: () => void;
  replace: (type: FieldType) => void;
  lockedCurrency: boolean;
  moveUp: () => void;
  moveDown: () => void;
}) {
  const [replacement, setReplacement] = useState<FieldType>(field.type);
  const selection = selectTypes.includes(field.type);
  const ruleKeys = ['short_text', 'long_text'].includes(field.type)
    ? ['minLength', 'maxLength']
    : ['integer', 'decimal', 'currency', 'date', 'datetime'].includes(
          field.type,
        )
      ? ['min', 'max']
      : field.type === 'multi_select'
        ? ['maxSelections']
        : [];
  const setRule = (key: string, raw: string) => {
    const rules = { ...field.rules };
    if (raw === '') delete rules[key];
    else
      rules[key] = [
        'minLength',
        'maxLength',
        'maxSelections',
        'precision',
      ].includes(key)
        ? Number(raw)
        : raw;
    change({ ...field, rules });
  };
  const defaultText =
    field.default === undefined
      ? ''
      : field.type === 'currency' &&
          field.default &&
          typeof field.default === 'object' &&
          'amount' in field.default
        ? String(field.default.amount)
        : String(field.default);
  const setDefault = (raw: string) => {
    let value: unknown =
      raw ||
      (['short_text', 'long_text'].includes(field.type) ? '' : undefined);
    if (raw) {
      if (field.type === 'boolean') value = raw === 'true';
      else if (field.type === 'integer') value = Number(raw);
      else if (field.type === 'currency')
        value = { amount: raw, currency: field.rules.currencyCode };
    }
    change({ ...field, default: value });
  };
  return (
    <div
      className="min-w-0 space-y-3 rounded border border-slate-700 p-3"
      data-testid={`field-${field.id}`}
    >
      <div className="flex flex-wrap gap-2">
        <h4 className="min-w-0 flex-1 break-words font-semibold">
          {field.label || 'Untitled field'} · {label(field.type)}
        </h4>
        <button
          type="button"
          className="min-h-11 px-2 underline"
          onClick={moveUp}
        >
          Field up
        </button>
        <button
          type="button"
          className="min-h-11 px-2 underline"
          onClick={moveDown}
        >
          Field down
        </button>
        <button
          type="button"
          className="min-h-11 px-2 text-rose-300 underline"
          onClick={remove}
        >
          Remove field
        </button>
      </div>
      <p className="break-all text-xs text-slate-400">Stable ID: {field.id}</p>
      <label className="block text-sm">
        Label
        <input
          className={input}
          maxLength={200}
          value={field.label}
          onChange={(event) => change({ ...field, label: event.target.value })}
        />
      </label>
      <label className="block text-sm">
        Help text
        <textarea
          className={input}
          rows={2}
          maxLength={2000}
          value={field.help ?? ''}
          onChange={(event) => change({ ...field, help: event.target.value })}
        />
      </label>
      <div className="flex flex-wrap gap-4 text-sm">
        {(['quantity', 'asset'] as const).map((kind) => (
          <label key={kind}>
            <input
              type="checkbox"
              checked={field.applies_to.includes(kind)}
              onChange={(event) =>
                change({
                  ...field,
                  applies_to: event.target.checked
                    ? [...new Set([...field.applies_to, kind])]
                    : field.applies_to.filter((item) => item !== kind),
                })
              }
            />{' '}
            {label(kind)}
          </label>
        ))}
        <label>
          <input
            type="checkbox"
            checked={field.required}
            onChange={(event) =>
              change({ ...field, required: event.target.checked })
            }
          />{' '}
          Required
        </label>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {ruleKeys.map((key) => (
          <label key={key} className="text-xs">
            {label(key)}
            <input
              className={input}
              type={
                ['minLength', 'maxLength', 'maxSelections'].includes(key)
                  ? 'number'
                  : field.type === 'date'
                    ? 'date'
                    : 'text'
              }
              value={String(field.rules[key] ?? '')}
              onChange={(event) => setRule(key, event.target.value)}
            />
          </label>
        ))}
        {['decimal', 'currency'].includes(field.type) && (
          <label className="text-xs">
            Precision
            <select
              className={input}
              disabled={lockedCurrency}
              value={String(field.rules.precision ?? '')}
              onChange={(event) => setRule('precision', event.target.value)}
            >
              {field.type === 'decimal' && (
                <option value="">Default (6)</option>
              )}
              {Array.from(
                { length: field.type === 'currency' ? 5 : 7 },
                (_, index) => (
                  <option key={index} value={index}>
                    {index}
                  </option>
                ),
              )}
            </select>
          </label>
        )}
        {field.type === 'currency' && (
          <label className="text-xs">
            ISO 4217 code
            <input
              className={input}
              disabled={lockedCurrency}
              maxLength={3}
              value={String(field.rules.currencyCode ?? '')}
              onChange={(event) =>
                setRule('currencyCode', event.target.value.toUpperCase())
              }
            />
          </label>
        )}
      </div>
      {selection && <OptionTreeEditor field={field} change={change} />}
      {selection ? (
        <ChoiceDefaultEditor field={field} change={change} />
      ) : (
        <label className="block text-sm">
          Default (optional)
          {field.type === 'boolean' ? (
            <select
              className={input}
              value={defaultText}
              onChange={(event) => setDefault(event.target.value)}
            >
              <option value="">Unset</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          ) : (
            <input
              className={input}
              type={
                field.type === 'date'
                  ? 'date'
                  : field.type === 'url'
                    ? 'url'
                    : 'text'
              }
              value={defaultText}
              onChange={(event) => setDefault(event.target.value)}
            />
          )}
        </label>
      )}
      {!selection && field.default !== undefined && (
        <button
          type="button"
          className="text-xs underline"
          onClick={() => change({ ...field, default: undefined })}
        >
          Unset default
        </button>
      )}
      <div className="rounded border border-amber-800 p-2 text-xs">
        <p>
          Type and currency meaning cannot change for this field ID. A
          replacement receives a new ID; old values remain in history.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <select
            aria-label={`Replacement type for ${field.label}`}
            className={input + ' max-w-48'}
            value={replacement}
            onChange={(event) =>
              setReplacement(event.target.value as FieldType)
            }
          >
            {fieldTypes.map((type) => (
              <option key={type} value={type}>
                {label(type)}
              </option>
            ))}
          </select>
          <Button
            type="button"
            variant="outline"
            onClick={() => replace(replacement)}
          >
            Add replacement
          </Button>
        </div>
      </div>
    </div>
  );
}

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
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);
  const active = categories.filter((category) => category.active);
  const [categoryId, setCategoryId] = useState(active[0]?.id ?? '');
  const selected = forms[categoryId];
  const [definition, setDefinition] = useState<MetadataDefinition | null>(() =>
    initialDefinition(source(forms[active[0]?.id ?? ''])),
  );
  const [saved, setSaved] = useState(() =>
    JSON.stringify(
      initialDefinition(source(forms[active[0]?.id ?? ''])) ??
        source(forms[active[0]?.id ?? '']),
    ),
  );
  const [draftVersion, setDraftVersion] = useState(
    selected?.draft_version ?? '0',
  );
  const [draftId, setDraftId] = useState<string | null>(
    selected?.draft_id ?? null,
  );
  const [publishedBaseline, setPublishedBaseline] = useState(
    selected?.published_revision_id ?? '',
  );
  const [review, setReview] = useState<Review | null>(null);
  const [message, setMessage] = useState('');
  const [receipt, setReceipt] = useState<{ key: string; id: string } | null>(
    null,
  );
  const [pending, startTransition] = useTransition();
  const [operationPending, setOperationPending] = useState(false);
  const [recovery, setRecovery] = useState<DesignerRecovery | null>(null);
  const [storageWarning, setStorageWarning] = useState('');
  const [identityStatus, setIdentityStatus] = useState<
    'verified' | 'checking' | 'blocked'
  >('verified');
  const identityCheck = useRef(0);
  const busy = useRef(false);
  const categorySession = useRef(0);
  const editEpoch = useRef(0);
  const [history, setHistory] = useState<MetadataDefinition[]>([]);
  const [fieldType, setFieldType] = useState<FieldType>('short_text');
  const [previewKind, setPreviewKind] = useState<'quantity' | 'asset'>(
    'quantity',
  );
  const [phone, setPhone] = useState(false);
  const [previewVersion, setPreviewVersion] = useState(0);
  const drag = useRef<string | null>(null);
  const resize = useRef<{
    id: string;
    x: number;
    span: number;
    container: number;
  } | null>(null);
  const refreshRequested = useRef(false);
  const dirty = definition !== null && JSON.stringify(definition) !== saved;
  const issues = definition
    ? designerIssues(definition)
    : [
        'This draft has an unsupported structure. Discard it to return to the published form.',
      ];
  useEffect(() => {
    let mounted = true;
    const verify = async () => {
      const check = ++identityCheck.current;
      setIdentityStatus('checking');
      try {
        const result = await verifyMetadataDesignerIdentity(memberId);
        if (!mounted || check !== identityCheck.current) return;
        setIdentityStatus(result.ok ? 'verified' : 'blocked');
        if (!result.ok) routerRef.current.refresh();
      } catch {
        if (mounted && check === identityCheck.current)
          setIdentityStatus('blocked');
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void verify();
    };
    window.addEventListener('focus', verify);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      mounted = false;
      identityCheck.current += 1;
      window.removeEventListener('focus', verify);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [memberId]);
  useEffect(() => {
    let active = true;
    const result = readDesignerRecovery(memberId, categoryId);
    queueMicrotask(() => {
      if (!active) return;
      setRecovery(result.item);
      setStorageWarning(
        result.available
          ? ''
          : 'Unsaved recovery is unavailable in this browser. Keep this page open until the draft is saved.',
      );
    });
    return () => {
      active = false;
    };
  }, [memberId, categoryId]);
  useEffect(() => {
    if (!dirty || !definition) return;
    const stored = writeDesignerRecovery({
      memberId,
      categoryId,
      definition,
      savedDefinition: saved,
      expectedDraftId: draftId,
      expectedDraftVersion: draftVersion,
      expectedPublishedRevisionId: publishedBaseline,
    });
    if (!stored)
      queueMicrotask(() =>
        setStorageWarning(
          'Unsaved recovery is unavailable in this browser. Keep this page open until the draft is saved.',
        ),
      );
  }, [
    memberId,
    categoryId,
    definition,
    dirty,
    saved,
    draftVersion,
    draftId,
    publishedBaseline,
  ]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const guardLink = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest('a[href]');
      if (
        !anchor ||
        anchor.getAttribute('href')?.startsWith('#') ||
        event.ctrlKey ||
        event.metaKey
      )
        return;
      if (!window.confirm('Leave this page and discard unsaved form edits?')) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener('beforeunload', warn);
    document.addEventListener('click', guardLink, true);
    return () => {
      window.removeEventListener('beforeunload', warn);
      document.removeEventListener('click', guardLink, true);
    };
  }, [dirty]);
  const edit = (next: MetadataDefinition) => {
    editEpoch.current += 1;
    setPreviewVersion((version) => version + 1);
    if (definition)
      setHistory((prior) => [...prior.slice(-19), copy(definition)]);
    setDefinition(next);
    setReview(null);
    setMessage('');
  };
  const reset = (
    value: unknown,
    version: string,
    publishedId: string,
    nextDraftId: string | null,
  ) => {
    editEpoch.current += 1;
    setPreviewVersion((version) => version + 1);
    const parsed = initialDefinition(value);
    setDefinition(parsed);
    setSaved(JSON.stringify(parsed ?? value));
    setDraftVersion(version);
    setDraftId(nextDraftId);
    setPublishedBaseline(publishedId);
    setReview(null);
    setReceipt(null);
    setHistory([]);
    setMessage('');
  };
  useEffect(() => {
    if (!refreshRequested.current) return;
    refreshRequested.current = false;
    reset(
      source(selected),
      selected?.draft_version ?? '0',
      selected?.published_revision_id ?? '',
      selected?.draft_id ?? null,
    );
    // The explicit refresh request is the only route for adopting server revisions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forms]);
  const switchCategory = (id: string) => {
    if (busy.current) return;
    if (dirty && !window.confirm('Discard unsaved edits and switch category?'))
      return;
    if (dirty) clearDesignerRecovery(memberId, categoryId);
    categorySession.current += 1;
    setCategoryId(id);
    reset(
      source(forms[id]),
      forms[id]?.draft_version ?? '0',
      forms[id]?.published_revision_id ?? '',
      forms[id]?.draft_id ?? null,
    );
  };
  const submit = (
    operation:
      'metadata_draft_save' | 'metadata_draft_discard' | 'metadata_publish',
    payload: Record<string, unknown>,
  ) => {
    if (busy.current) return;
    busy.current = true;
    setOperationPending(true);
    const submittedCategory = categoryId;
    const submittedSession = categorySession.current;
    const key = JSON.stringify([operation, payload]);
    const requestId = receipt?.key === key ? receipt.id : newId();
    setReceipt({ key, id: requestId });
    setMessage('');
    startTransition(async () => {
      try {
        const response = await submitMetadataDraft({
          operation,
          requestId,
          expectedActorId: memberId,
          payload,
        });
        if (
          categorySession.current !== submittedSession ||
          categoryId !== submittedCategory
        )
          return;
        if (!response.ok) {
          if (response.code === 'P1001') setIdentityStatus('blocked');
          setMessage(
            response.message +
              (response.code === 'P1002'
                ? ' Refresh from server after reviewing your unsaved edits.'
                : ''),
          );
          if (['P1002', 'P1017'].includes(response.code)) setReview(null);
          return;
        }
        setReceipt(null);
        if (operation === 'metadata_draft_save') {
          clearDesignerRecovery(memberId, submittedCategory);
          setRecovery(null);
          setDraftVersion(String(response.data.version));
          setDraftId(String(response.data.draft_id));
          setSaved(JSON.stringify(payload.definition));
          setMessage('Draft saved. Review its impact before publishing.');
        } else if (operation === 'metadata_draft_discard') {
          clearDesignerRecovery(memberId, submittedCategory);
          setRecovery(null);
          reset(
            selected.published_definition,
            '0',
            selected.published_revision_id,
            null,
          );
          setMessage('Saved draft discarded.');
        } else {
          clearDesignerRecovery(memberId, submittedCategory);
          setRecovery(null);
          setDraftVersion('0');
          setDraftId(null);
          setPublishedBaseline(String(response.data.published_revision_id));
          setReview(null);
          setSaved(JSON.stringify(definition));
          setMessage(
            'Published form revision ' + String(response.data.version) + '.',
          );
        }
        router.refresh();
      } finally {
        busy.current = false;
        setOperationPending(false);
      }
    });
  };
  const updateField = (next: Field) => {
    if (definition)
      edit({
        ...definition,
        fields: definition.fields.map((field) =>
          field.id === next.id ? next : field,
        ),
      });
  };
  const updateControl = (id: string, patch: Partial<Control>) => {
    if (definition)
      edit({
        ...definition,
        layout: definition.layout.map((section) => ({
          ...section,
          controls: section.controls.map((control) =>
            control.id === id ? { ...control, ...patch } : control,
          ),
        })),
      });
  };
  const addField = (type: FieldType, name = '') => {
    if (!definition || definition.fields.length >= 100) return;
    const field = newField(type, name);
    const first = definition.layout[0];
    edit({
      fields: [...definition.fields, field],
      layout: first
        ? definition.layout.map((section) =>
            section.id === first.id
              ? {
                  ...section,
                  controls: [
                    ...section.controls,
                    {
                      id: newId(),
                      kind: 'field',
                      field_id: field.id,
                      width: 'Auto',
                    },
                  ],
                }
              : section,
          )
        : [
            {
              id: newId(),
              label: 'Details',
              controls: [
                {
                  id: newId(),
                  kind: 'field',
                  field_id: field.id,
                  width: 'Auto',
                },
              ],
            },
          ],
    });
  };
  const removeField = (id: string) => {
    if (
      definition &&
      window.confirm(
        'Remove this field from the new revision? Existing values remain in history.',
      )
    )
      edit({
        fields: definition.fields.filter((field) => field.id !== id),
        layout: definition.layout.map((section) => ({
          ...section,
          controls: section.controls.filter(
            (control) => control.field_id !== id,
          ),
        })),
      });
  };
  const addControl = (sectionId: string, control: Control) => {
    if (definition)
      edit({
        ...definition,
        layout: definition.layout.map((section) =>
          section.id === sectionId
            ? { ...section, controls: [...section.controls, control] }
            : section,
        ),
      });
  };
  const move = (id: string, sectionId: string, index: number) => {
    if (definition) edit(moveControl(definition, id, sectionId, index));
  };
  return (
    <section
      className="min-w-0 space-y-5 rounded-lg border border-slate-700 p-3 sm:p-4"
      aria-labelledby="metadata-settings-heading"
    >
      <div>
        <h2 id="metadata-settings-heading" className="text-xl font-semibold">
          Forms and fields
        </h2>
        <p className="text-sm text-slate-400">
          Build a category form, save a draft, review affected inventory, then
          publish.
        </p>
      </div>
      {identityStatus !== 'verified' ? (
        <div
          role="status"
          className="rounded border border-amber-700 p-3 text-sm"
        >
          {identityStatus === 'checking'
            ? 'Checking configuration access…'
            : 'Configuration access changed. Refresh this page to continue.'}
          {identityStatus === 'blocked' && (
            <Button
              type="button"
              variant="outline"
              onClick={() => router.refresh()}
            >
              Refresh access
            </Button>
          )}
        </div>
      ) : active.length === 0 ? (
        <p>No active category is available.</p>
      ) : (
        <>
          <label className="block">
            Category
            <select
              className={input}
              value={categoryId}
              disabled={operationPending}
              onChange={(event) => switchCategory(event.target.value)}
            >
              {active.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <p className="text-sm text-slate-400">
            Published revision {selected?.published_number ?? 'unknown'} · Draft
            version {draftVersion === '0' ? 'none' : draftVersion}
            {dirty ? ' · Unsaved edits' : ''}
          </p>
          {recovery && (
            <div
              role="region"
              aria-label="Recover unsaved form edits"
              className="space-y-2 rounded border border-amber-700 p-3 text-sm"
            >
              <p>
                Unsaved edits for this category were kept in this browser tab.
                Choose whether to recover them. Recovery keeps the original
                draft version and still requires a new save and impact review.
              </p>
              {(recovery.expectedDraftVersion !==
                (selected?.draft_version ?? '0') ||
                recovery.expectedPublishedRevisionId !==
                  (selected?.published_revision_id ?? '') ||
                recovery.expectedDraftId !== (selected?.draft_id ?? null)) && (
                <p className="text-amber-200">
                  The server form has changed since these edits began. A save
                  may be rejected; review the latest form before deciding how to
                  proceed.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setDefinition(recovery.definition);
                    editEpoch.current += 1;
                    setPreviewVersion((version) => version + 1);
                    setSaved(recovery.savedDefinition);
                    setDraftVersion(recovery.expectedDraftVersion);
                    setDraftId(recovery.expectedDraftId);
                    setPublishedBaseline(recovery.expectedPublishedRevisionId);
                    setReview(null);
                    setReceipt(null);
                    setHistory([]);
                    setRecovery(null);
                    setMessage(
                      'Unsaved edits recovered. Review and save the draft.',
                    );
                  }}
                >
                  Recover edits
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    clearDesignerRecovery(memberId, categoryId);
                    setRecovery(null);
                  }}
                >
                  Discard recovered edits
                </Button>
              </div>
            </div>
          )}
          {storageWarning && (
            <p
              role="status"
              className="break-words rounded border border-amber-700 p-3 text-sm"
            >
              {storageWarning}
            </p>
          )}
          {!recovery && (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={!dirty || pending}
                onClick={() => {
                  if (window.confirm('Discard unsaved edits?')) {
                    clearDesignerRecovery(memberId, categoryId);
                    setRecovery(null);
                    reset(
                      JSON.parse(saved),
                      draftVersion,
                      publishedBaseline,
                      draftId,
                    );
                  }
                }}
              >
                Discard unsaved edits
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={history.length === 0 || pending}
                onClick={() => {
                  const prior = history.at(-1);
                  if (prior) {
                    setDefinition(prior);
                    setPreviewVersion((version) => version + 1);
                    setHistory(history.slice(0, -1));
                    setReview(null);
                  }
                }}
              >
                Undo edit
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  if (
                    dirty &&
                    !window.confirm(
                      'Discard unsaved edits and load the latest form from the server?',
                    )
                  )
                    return;
                  refreshRequested.current = true;
                  router.refresh();
                  setMessage(
                    'Refresh requested. Review the latest form before resubmitting.',
                  );
                }}
              >
                Refresh from server
              </Button>
            </div>
          )}
          {definition && !recovery && (
            <>
              <div className="space-y-3">
                <h3 className="font-semibold">Fields</h3>
                <div className="flex flex-wrap gap-2">
                  <select
                    aria-label="New field type"
                    className={input + ' max-w-52'}
                    value={fieldType}
                    onChange={(event) =>
                      setFieldType(event.target.value as FieldType)
                    }
                  >
                    {fieldTypes.map((type) => (
                      <option key={type} value={type}>
                        {label(type)}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={definition.fields.length >= 100}
                    onClick={() => addField(fieldType)}
                  >
                    Add field
                  </Button>
                </div>
                <div className="grid gap-3 xl:grid-cols-2">
                  {definition.fields.map((field, index) => (
                    <FieldPanel
                      key={field.id}
                      field={field}
                      change={updateField}
                      remove={() => removeField(field.id)}
                      replace={(type) =>
                        addField(
                          type,
                          (field.label || 'Untitled field') + ' replacement',
                        )
                      }
                      lockedCurrency={
                        field.type === 'currency' &&
                        !!selected?.published_definition.fields.some(
                          (published) => published.id === field.id,
                        )
                      }
                      moveUp={() => {
                        if (index < 1) return;
                        const fields = [...definition.fields];
                        [fields[index - 1], fields[index]] = [
                          fields[index],
                          fields[index - 1],
                        ];
                        edit({ ...definition, fields });
                      }}
                      moveDown={() => {
                        if (index >= definition.fields.length - 1) return;
                        const fields = [...definition.fields];
                        [fields[index + 1], fields[index]] = [
                          fields[index],
                          fields[index + 1],
                        ];
                        edit({ ...definition, fields });
                      }}
                    />
                  ))}
                </div>
              </div>
              <div className="space-y-3">
                <h3 className="font-semibold">Sections and layout</h3>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    edit({
                      ...definition,
                      layout: [
                        ...definition.layout,
                        { id: newId(), label: 'New section', controls: [] },
                      ],
                    })
                  }
                >
                  Add section
                </Button>
                {definition.layout.map((section, sectionIndex) => (
                  <div
                    key={section.id}
                    data-section-id={section.id}
                    className="min-w-0 space-y-3 rounded border border-slate-700 p-3"
                  >
                    <div className="flex flex-wrap gap-2">
                      <label className="min-w-40 flex-1 text-sm">
                        Section heading
                        <input
                          className={input}
                          value={section.label}
                          onChange={(event) =>
                            edit({
                              ...definition,
                              layout: definition.layout.map((item) =>
                                item.id === section.id
                                  ? { ...item, label: event.target.value }
                                  : item,
                              ),
                            })
                          }
                        />
                      </label>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={sectionIndex === 0}
                        onClick={() => {
                          const layout = [...definition.layout];
                          [layout[sectionIndex - 1], layout[sectionIndex]] = [
                            layout[sectionIndex],
                            layout[sectionIndex - 1],
                          ];
                          edit({ ...definition, layout });
                        }}
                      >
                        Section up
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={sectionIndex === definition.layout.length - 1}
                        onClick={() => {
                          const layout = [...definition.layout];
                          [layout[sectionIndex + 1], layout[sectionIndex]] = [
                            layout[sectionIndex],
                            layout[sectionIndex + 1],
                          ];
                          edit({ ...definition, layout });
                        }}
                      >
                        Section down
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={section.controls.length > 0}
                        onClick={() =>
                          edit({
                            ...definition,
                            layout: definition.layout.filter(
                              (item) => item.id !== section.id,
                            ),
                          })
                        }
                      >
                        Remove section
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      {section.controls.map((control, index) => {
                        const field = definition.fields.find(
                          (item) => item.id === control.field_id,
                        );
                        const name =
                          control.kind === 'field'
                            ? field?.label || 'Missing field'
                            : control.kind === 'builtin'
                              ? label(control.builtin ?? '')
                              : 'Help text';
                        return (
                          <div
                            key={control.id}
                            data-control-id={control.id}
                            style={controlLayoutStyle(
                              control.width,
                              field?.type === 'boolean',
                            )}
                            className="min-w-0 space-y-2 rounded border border-slate-600 p-2 text-sm"
                          >
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                aria-label={`Drag ${name}`}
                                title="Drag to reorder"
                                className="min-h-11 min-w-11 cursor-grab touch-none select-none rounded border px-2 py-1"
                                onPointerDown={(event) => {
                                  event.preventDefault();
                                  drag.current = control.id;
                                  event.currentTarget.setPointerCapture(
                                    event.pointerId,
                                  );
                                }}
                                onPointerUp={(event) => {
                                  if (drag.current !== control.id) return;
                                  drag.current = null;
                                  const element = document
                                    .elementFromPoint(
                                      event.clientX,
                                      event.clientY,
                                    )
                                    ?.closest(
                                      '[data-control-id]',
                                    ) as HTMLElement | null;
                                  const sectionElement = document
                                    .elementFromPoint(
                                      event.clientX,
                                      event.clientY,
                                    )
                                    ?.closest(
                                      '[data-section-id]',
                                    ) as HTMLElement | null;
                                  const target = definition.layout.find(
                                    (item) =>
                                      item.controls.some(
                                        (candidate) =>
                                          candidate.id ===
                                          element?.dataset.controlId,
                                      ),
                                  );
                                  if (
                                    target &&
                                    element?.dataset.controlId !== control.id
                                  ) {
                                    const hit = target.controls.findIndex(
                                      (candidate) =>
                                        candidate.id ===
                                        element?.dataset.controlId,
                                    );
                                    const sourceIndex =
                                      target.controls.findIndex(
                                        (candidate) =>
                                          candidate.id === control.id,
                                      );
                                    move(
                                      control.id,
                                      target.id,
                                      sourceIndex >= 0 && sourceIndex < hit
                                        ? hit + 1
                                        : hit,
                                    );
                                  } else if (
                                    sectionElement?.dataset.sectionId &&
                                    sectionElement.dataset.sectionId !==
                                      section.id
                                  )
                                    move(
                                      control.id,
                                      sectionElement.dataset.sectionId,
                                      definition.layout.find(
                                        (item) =>
                                          item.id ===
                                          sectionElement.dataset.sectionId,
                                      )?.controls.length ?? 0,
                                    );
                                }}
                              >
                                ⋮⋮
                              </button>
                              <span className="min-w-0 flex-1 break-words">
                                {name}
                              </span>
                            </div>
                            {control.kind === 'help' && (
                              <label className="block">
                                Help text
                                <textarea
                                  className={input}
                                  rows={2}
                                  value={control.help ?? ''}
                                  onChange={(event) =>
                                    updateControl(control.id, {
                                      help: event.target.value,
                                    })
                                  }
                                />
                              </label>
                            )}
                            <div className="grid grid-cols-2 gap-2">
                              <label className="text-xs">
                                Section
                                <select
                                  className={input}
                                  value={section.id}
                                  onChange={(event) =>
                                    move(
                                      control.id,
                                      event.target.value,
                                      definition.layout.find(
                                        (item) =>
                                          item.id === event.target.value,
                                      )?.controls.length ?? 0,
                                    )
                                  }
                                >
                                  {definition.layout.map((item) => (
                                    <option key={item.id} value={item.id}>
                                      {item.label || 'Untitled'}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="text-xs">
                                Width
                                <select
                                  className={input}
                                  value={control.width}
                                  onChange={(event) =>
                                    updateControl(control.id, {
                                      width:
                                        event.target.value === 'Auto'
                                          ? 'Auto'
                                          : (Number(
                                              event.target.value,
                                            ) as Control['width']),
                                    })
                                  }
                                >
                                  {widths.map((width) => (
                                    <option key={width} value={width}>
                                      {width === 'Auto'
                                        ? 'Auto'
                                        : `${width}/12`}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </div>
                            <button
                              type="button"
                              aria-label={`Resize ${name}`}
                              title="Drag to snap width; width selector is also available"
                              className="min-h-11 w-full cursor-ew-resize touch-none select-none rounded border border-slate-600 py-1 text-xs"
                              onPointerDown={(event) => {
                                event.preventDefault();
                                const container =
                                  event.currentTarget
                                    .closest('[data-section-id]')
                                    ?.getBoundingClientRect().width ?? 1;
                                resize.current = {
                                  id: control.id,
                                  x: event.clientX,
                                  span:
                                    control.width === 'Auto'
                                      ? field?.type === 'boolean'
                                        ? 3
                                        : 4
                                      : control.width,
                                  container,
                                };
                                event.currentTarget.setPointerCapture(
                                  event.pointerId,
                                );
                              }}
                              onPointerUp={(event) => {
                                const current = resize.current;
                                resize.current = null;
                                if (!current || current.id !== control.id)
                                  return;
                                const desired =
                                  current.span +
                                  ((event.clientX - current.x) /
                                    current.container) *
                                    12;
                                const snapped = (
                                  [3, 4, 6, 8, 9, 12] as const
                                ).reduce((best, candidate) =>
                                  Math.abs(candidate - desired) <
                                  Math.abs(best - desired)
                                    ? candidate
                                    : best,
                                );
                                updateControl(control.id, { width: snapped });
                              }}
                            >
                              ↔ Resize width
                            </button>
                            <div className="flex flex-wrap gap-2 text-xs">
                              <button
                                type="button"
                                className="min-h-11 px-2 underline"
                                disabled={index === 0}
                                onClick={() =>
                                  move(control.id, section.id, index - 1)
                                }
                              >
                                Move up
                              </button>
                              <button
                                type="button"
                                className="min-h-11 px-2 underline"
                                disabled={index === section.controls.length - 1}
                                onClick={() =>
                                  move(control.id, section.id, index + 2)
                                }
                              >
                                Move down
                              </button>
                              <button
                                type="button"
                                className="min-h-11 px-2 text-rose-300 underline"
                                disabled={
                                  control.kind === 'builtin' &&
                                  ['name', 'category_id'].includes(
                                    control.builtin ?? '',
                                  )
                                }
                                onClick={() =>
                                  edit({
                                    ...definition,
                                    layout: definition.layout.map((item) => ({
                                      ...item,
                                      controls: item.controls.filter(
                                        (candidate) =>
                                          candidate.id !== control.id,
                                      ),
                                    })),
                                  })
                                }
                              >
                                Remove control
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          addControl(section.id, {
                            id: newId(),
                            kind: 'help',
                            help: '',
                            width: 12,
                          })
                        }
                      >
                        Add help text
                      </Button>
                      <select
                        aria-label={`Add existing field to ${section.label}`}
                        className={input + ' max-w-56'}
                        defaultValue=""
                        onChange={(event) => {
                          if (event.target.value)
                            addControl(section.id, {
                              id: newId(),
                              kind: 'field',
                              field_id: event.target.value,
                              width: 'Auto',
                            });
                          event.target.value = '';
                        }}
                      >
                        <option value="">Add field control…</option>
                        {definition.fields
                          .filter(
                            (field) =>
                              !definition.layout.some((item) =>
                                item.controls.some(
                                  (control) => control.field_id === field.id,
                                ),
                              ),
                          )
                          .map((field) => (
                            <option key={field.id} value={field.id}>
                              {field.label || 'Untitled field'}
                            </option>
                          ))}
                      </select>
                      <select
                        aria-label={`Add standard control to ${section.label}`}
                        className={input + ' max-w-56'}
                        defaultValue=""
                        onChange={(event) => {
                          if (event.target.value)
                            addControl(section.id, {
                              id: newId(),
                              kind: 'builtin',
                              builtin: event.target.value,
                              width: 'Auto',
                            });
                          event.target.value = '';
                        }}
                      >
                        <option value="">Add standard control…</option>
                        {builtins
                          .filter(
                            (name) =>
                              !definition.layout.some((item) =>
                                item.controls.some(
                                  (control) =>
                                    control.kind === 'builtin' &&
                                    control.builtin === name,
                                ),
                              ),
                          )
                          .map((name) => (
                            <option key={name} value={name}>
                              {label(name)}
                            </option>
                          ))}
                      </select>
                    </div>
                  </div>
                ))}
              </div>
              <div className="space-y-3">
                <h3 className="font-semibold">Live preview</h3>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant={previewKind === 'quantity' ? 'default' : 'outline'}
                    onClick={() => setPreviewKind('quantity')}
                  >
                    Quantity
                  </Button>
                  <Button
                    type="button"
                    variant={previewKind === 'asset' ? 'default' : 'outline'}
                    onClick={() => setPreviewKind('asset')}
                  >
                    Asset
                  </Button>
                  <Button
                    type="button"
                    variant={phone ? 'default' : 'outline'}
                    onClick={() => setPhone(!phone)}
                  >
                    {phone ? 'Desktop' : 'Phone'} width
                  </Button>
                </div>
                {metadataDefinition.safeParse(definition).success ? (
                  <div
                    className={
                      phone
                        ? 'mx-auto w-full max-w-[390px] rounded border border-slate-600 p-3'
                        : 'rounded border border-slate-600 p-3'
                    }
                  >
                    <MetadataFormPreview
                      key={`${categoryId}-${previewKind}-${previewVersion}`}
                      kind={previewKind}
                      definition={definition}
                      categoryId={categoryId}
                      categoryName={
                        active.find((category) => category.id === categoryId)
                          ?.name ?? 'Category'
                      }
                    />
                    <p className="mt-4 rounded border border-slate-700 p-2 text-xs text-slate-400">
                      Operational stock counts, locations, status, record
                      identity and permissions remain mandatory or separate from
                      this layout.
                    </p>
                  </div>
                ) : (
                  <p role="status">
                    Preview is unavailable until the document shape is valid.
                  </p>
                )}
              </div>
            </>
          )}
          {issues.length > 0 && !recovery && (
            <div
              className="break-words rounded border border-amber-700 p-3 text-sm"
              role="alert"
            >
              <p>Resolve before publishing:</p>
              <ul className="list-disc pl-5">
                {issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </div>
          )}
          {!recovery && (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={operationPending || pending || !definition}
                onClick={() =>
                  definition &&
                  submit('metadata_draft_save', {
                    expected_actor_id: memberId,
                    category_id: categoryId,
                    expected_draft_id: draftId,
                    expected_draft_version: draftVersion,
                    expected_published_revision_id: publishedBaseline,
                    definition,
                  })
                }
              >
                Save draft
              </Button>
              {draftVersion !== '0' && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={operationPending || pending}
                    onClick={() => {
                      if (
                        window.confirm(
                          'Discard the saved draft and unsaved edits?',
                        )
                      )
                        submit('metadata_draft_discard', {
                          expected_actor_id: memberId,
                          category_id: categoryId,
                          expected_draft_id: draftId,
                          expected_draft_version: draftVersion,
                          expected_published_revision_id: publishedBaseline,
                        });
                    }}
                  >
                    Discard saved draft
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={
                      operationPending ||
                      pending ||
                      dirty ||
                      issues.length > 0 ||
                      !draftId
                    }
                    onClick={() => {
                      if (!draftId) return;
                      if (busy.current) return;
                      busy.current = true;
                      setOperationPending(true);
                      const reviewedSession = categorySession.current;
                      const reviewedEpoch = editEpoch.current;
                      const reviewedBaseline = {
                        categoryId,
                        draftId,
                        draftVersion,
                        publishedBaseline,
                      };
                      startTransition(async () => {
                        try {
                          const result = await reviewMetadataPublish({
                            categoryId,
                            expectedActorId: memberId,
                            expectedDraftId: draftId,
                            expectedDraftVersion: draftVersion,
                            expectedPublishedRevisionId: publishedBaseline,
                          });
                          if (
                            reviewedSession !== categorySession.current ||
                            reviewedEpoch !== editEpoch.current
                          )
                            return;
                          if (result.ok) {
                            const checked = result.review;
                            if (
                              checked.category_id !==
                                reviewedBaseline.categoryId ||
                              checked.draft_id !== reviewedBaseline.draftId ||
                              checked.draft_version !==
                                reviewedBaseline.draftVersion ||
                              checked.published_revision_id !==
                                reviewedBaseline.publishedBaseline
                            ) {
                              setReview(null);
                              setMessage(
                                'The server draft changed during review. Your edits are preserved. Refresh from server, then review again.',
                              );
                            } else {
                              setReview(checked);
                              setMessage('');
                            }
                          } else {
                            if (result.code === 'P1001')
                              setIdentityStatus('blocked');
                            setMessage(result.message);
                            setReview(null);
                          }
                        } finally {
                          busy.current = false;
                          setOperationPending(false);
                        }
                      });
                    }}
                  >
                    Review publish impact
                  </Button>
                </>
              )}
            </div>
          )}
          {draftVersion !== '0' && dirty && (
            <p className="text-xs text-slate-400">
              Save edits before reviewing publication impact.
            </p>
          )}
          {review && !recovery && (
            <div
              role="region"
              aria-label="Form publication impact"
              className="space-y-3 break-words rounded border border-amber-700 p-3 text-sm"
            >
              <p>
                Revision {review.draft_version} will become current for{' '}
                {review.affected_quantity} quantity definitions and{' '}
                {review.affected_assets} assets. Existing values and historical
                revisions remain retained. Records with missing fields or
                tightened rules may need metadata review.
              </p>
              <p className="text-xs text-slate-400">
                Review expires at{' '}
                {new Date(review.expires_at).toLocaleTimeString()}.
              </p>
              <Button
                type="button"
                disabled={
                  operationPending || pending || dirty || issues.length > 0
                }
                onClick={() =>
                  submit('metadata_publish', {
                    expected_actor_id: memberId,
                    category_id: categoryId,
                    expected_draft_id: draftId,
                    expected_draft_version: draftVersion,
                    expected_published_revision_id: publishedBaseline,
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
              className="break-words rounded border border-cyan-700 p-3 text-sm"
            >
              {message}
            </p>
          )}
        </>
      )}
    </section>
  );
}
