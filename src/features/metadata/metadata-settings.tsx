'use client';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { motion } from 'motion/react';
import { DragDropProvider, DragOverlay, useDroppable } from '@dnd-kit/react';
import { isSortable, useSortable } from '@dnd-kit/react/sortable';
import { move as sortableMove } from '@dnd-kit/helpers';
import {
  fieldTypes,
  metadataDefinition,
  type FieldType,
  type MetadataDefinition,
  type MetadataForm,
} from './contracts';
import {
  saveMetadataForm,
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
  removeSection,
  sectionHasProtectedControls,
  newId,
  selectTypes,
  widths,
  type Control,
  type Field,
} from './designer-model';

type Category = { id: string; name: string; active: boolean };
const input =
  'min-h-10 w-full min-w-0 rounded border border-slate-600 bg-slate-950 px-2 py-1 text-sm';
const label = (value: string) =>
  value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const builtinLabel = (value: string) =>
  value === 'category_id' ? 'Category' : label(value);
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
      <h4 className="min-w-0 break-words font-semibold [overflow-wrap:anywhere]">
        {field.label || 'Untitled field'} · {label(field.type)}
      </h4>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
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

type HandleRef = (element: Element | null) => void;
function SortableSection({
  id,
  index,
  selected,
  children,
}: {
  id: string;
  index: number;
  selected: boolean;
  children: (handleRef: HandleRef) => ReactNode;
}) {
  const { ref, handleRef, isDragging } = useSortable({
    id: `section:${id}`,
    index,
    group: 'sections',
    type: 'section',
    accept: 'section',
  });
  return (
    <div
      ref={ref}
      data-section-id={id}
      className={`min-w-0 space-y-3 rounded border p-3 ${selected ? 'border-cyan-400' : 'border-slate-700'} ${isDragging ? 'opacity-40' : ''}`}
    >
      {children(handleRef)}
    </div>
  );
}
function SortableControl({
  id,
  index,
  sectionId,
  style,
  selected,
  children,
  onClick,
}: {
  id: string;
  index: number;
  sectionId: string;
  style: React.CSSProperties;
  selected: boolean;
  children: (handleRef: HandleRef) => ReactNode;
  onClick: () => void;
}) {
  const { ref, handleRef, isDragging } = useSortable({
    id: `control:${id}`,
    index,
    group: sectionId,
    type: 'control',
    accept: 'control',
  });
  return (
    <div
      ref={ref}
      data-control-id={id}
      data-dragging={isDragging}
      style={style}
      onClick={onClick}
      className={`min-w-0 rounded border p-2 text-sm ${selected ? 'border-cyan-400' : 'border-slate-600'} ${isDragging ? 'opacity-40' : ''}`}
    >
      <div
        className={`min-w-0 space-y-2 rounded ${selected ? 'bg-cyan-400/[0.04] shadow-[0_8px_22px_-12px_rgba(34,211,238,0.9)]' : ''}`}
      >
        {children(handleRef)}
      </div>
    </div>
  );
}
function SectionDropArea({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  const { ref, isDropTarget } = useDroppable({
    id: `empty:${id}`,
    type: 'control',
    accept: 'control',
    data: { sectionId: id },
  });
  return (
    <div
      ref={ref}
      data-drop-target={isDropTarget}
      className={`flex min-h-20 flex-wrap gap-3 rounded border border-dashed p-2 ${isDropTarget ? 'border-cyan-400 bg-cyan-400/10' : 'border-slate-700'}`}
    >
      {children}
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
  const [saveReview, setSaveReview] = useState<Record<string, unknown> | null>(
    null,
  );
  const [savePayload, setSavePayload] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [message, setMessage] = useState('');
  const [receipt, setReceipt] = useState<{ key: string; id: string } | null>(
    null,
  );
  const [pending, startTransition] = useTransition();
  const [operationPending, setOperationPending] = useState(false);
  const [recovery, setRecovery] = useState<DesignerRecovery | null>(null);
  const [recoveryLoadedScope, setRecoveryLoadedScope] = useState<string | null>(
    null,
  );
  const [storageWarning, setStorageWarning] = useState('');
  const [identityStatus, setIdentityStatus] = useState<
    'verified' | 'checking' | 'blocked' | 'retry'
  >('verified');
  const identityCheck = useRef(0);
  const identityInFlight = useRef(false);
  const terminalDenied = useRef(false);
  const busy = useRef(false);
  const categorySession = useRef(0);
  const editEpoch = useRef(0);
  const [history, setHistory] = useState<MetadataDefinition[]>([]);
  const [advancedJson, setAdvancedJson] = useState('');
  const [advancedError, setAdvancedError] = useState('');
  const [fieldType, setFieldType] = useState<FieldType>('short_text');
  const [previewKind, setPreviewKind] = useState<'quantity' | 'asset'>(
    'quantity',
  );
  const [phone, setPhone] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<
    'library' | 'canvas' | 'inspector'
  >('canvas');
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(
    null,
  );
  const [selectedControlId, setSelectedControlId] = useState<string | null>(
    null,
  );
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(
    selected?.published_definition.fields[0]?.id ?? null,
  );
  const dndBaseline = useRef<MetadataDefinition | null>(null);
  const gesture = useRef<{
    kind: 'resize';
    id: string;
    baseline: MetadataDefinition;
    changed: boolean;
    x: number;
    span?: number;
    container?: number;
  } | null>(null);
  const definitionRef = useRef(definition);
  const denyIdentity = useCallback(() => {
    if (terminalDenied.current) return;
    terminalDenied.current = true;
    identityCheck.current += 1;
    gesture.current = null;
    dndBaseline.current = null;
    definitionRef.current = null;
    editEpoch.current += 1;
    setDefinition(null);
    setSaved('');
    setRecovery(null);
    setHistory([]);
    setSaveReview(null);
    setSavePayload(null);
    setAdvancedJson('');
    setSelectedFieldId(null);
    setSelectedControlId(null);
    setSelectedSectionId(null);
    clearDesignerRecovery(memberId, categoryId);
    setIdentityStatus('blocked');
  }, [memberId, categoryId]);
  useEffect(() => {
    definitionRef.current = definition;
  }, [definition]);
  const [previewVersion, setPreviewVersion] = useState(0);
  const refreshRequested = useRef(false);
  const dirty = definition !== null && JSON.stringify(definition) !== saved;
  const recoveryScope = `${memberId}:${categoryId}`;
  const issues = definition
    ? designerIssues(definition)
    : [
        'This draft has an unsupported structure. Discard it to return to the published form.',
      ];
  useEffect(() => {
    let mounted = true;
    const verify = async () => {
      if (identityInFlight.current || terminalDenied.current) return;
      identityInFlight.current = true;
      const check = ++identityCheck.current;
      try {
        const result = await verifyMetadataDesignerIdentity(memberId);
        if (
          !mounted ||
          terminalDenied.current ||
          check !== identityCheck.current
        )
          return;
        if (result.ok) setIdentityStatus('verified');
        else if (result.code === 'P1001') denyIdentity();
        else setIdentityStatus('retry');
      } catch {
        if (
          mounted &&
          !terminalDenied.current &&
          check === identityCheck.current
        )
          setIdentityStatus('retry');
      } finally {
        identityInFlight.current = false;
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
  }, [denyIdentity, memberId]);
  useEffect(() => {
    let active = true;
    const result = readDesignerRecovery(memberId, categoryId);
    queueMicrotask(() => {
      if (!active || terminalDenied.current) return;
      setRecovery(result.item);
      setRecoveryLoadedScope(recoveryScope);
      setStorageWarning(
        result.available
          ? ''
          : 'Unsaved recovery is unavailable in this browser. Keep this page open until the draft is saved.',
      );
    });
    return () => {
      active = false;
    };
  }, [memberId, categoryId, recoveryScope]);
  useEffect(() => {
    // Wait for the entry read before clearing anything: an older unsaved draft
    // must remain available for explicit recovery on a fresh mount.
    if (recoveryLoadedScope !== recoveryScope || terminalDenied.current) return;
    if (!dirty || !definition) {
      if (!recovery) clearDesignerRecovery(memberId, categoryId);
      return;
    }
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
    recovery,
    recoveryLoadedScope,
    recoveryScope,
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
    setSaveReview(null);
    setSavePayload(null);
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
    setReceipt(null);
    setSaveReview(null);
    setSavePayload(null);
    setHistory([]);
    setAdvancedJson('');
    setAdvancedError('');
    setMessage('');
  };
  useEffect(() => {
    if (!refreshRequested.current || terminalDenied.current) return;
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
          terminalDenied.current ||
          categorySession.current !== submittedSession ||
          categoryId !== submittedCategory
        )
          return;
        if (!response.ok) {
          if (response.code === 'P1001') denyIdentity();
          else if (response.code === 'identity_unverified')
            setIdentityStatus('retry');
          setMessage(
            response.message +
              (response.code === 'P1002'
                ? ' Refresh from server after reviewing your unsaved edits.'
                : ''),
          );
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
  const saveChanges = (confirmed = false) => {
    if (
      busy.current ||
      !definition ||
      issues.length ||
      identityStatus !== 'verified'
    )
      return;
    const payload =
      confirmed && savePayload
        ? { ...savePayload, review_token: saveReview?.token }
        : {
            expected_actor_id: memberId,
            category_id: categoryId,
            expected_draft_id: draftId,
            expected_draft_version: draftVersion,
            expected_published_revision_id: publishedBaseline,
            definition,
          };
    const key = JSON.stringify(['metadata_form_save', payload]);
    const requestId = receipt?.key === key ? receipt.id : newId();
    setReceipt({ key, id: requestId });
    busy.current = true;
    setOperationPending(true);
    setMessage('Saving…');
    const submittedSession = categorySession.current;
    const submittedEpoch = editEpoch.current;
    startTransition(async () => {
      try {
        const result = await saveMetadataForm({
          requestId,
          expectedActorId: memberId,
          payload,
        });
        if (
          terminalDenied.current ||
          submittedSession !== categorySession.current ||
          submittedEpoch !== editEpoch.current
        )
          return;
        if (!result.ok) {
          if (result.code === 'P1001') denyIdentity();
          else if (result.code === 'identity_unverified')
            setIdentityStatus('retry');
          setMessage(result.message);
          if (['P1002', 'P1017'].includes(result.code)) {
            setSaveReview(null);
            setSavePayload(null);
          }
          return;
        }
        if (result.data.status === 'confirmation_required') {
          setSaveReview(result.data);
          setSavePayload(payload);
          setMessage('Review the effect on existing inventory before saving.');
          return;
        }
        setReceipt(null);
        setSaveReview(null);
        setSavePayload(null);
        clearDesignerRecovery(memberId, categoryId);
        setRecovery(null);
        setDraftId(null);
        setDraftVersion('0');
        setPublishedBaseline(String(result.data.published_revision_id));
        setSaved(JSON.stringify(definition));
        setHistory([]);
        setMessage(
          `Saved active form revision ${String(result.data.version)}.`,
        );
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
    const first =
      definition.layout.find((section) => section.id === selectedSectionId) ??
      definition.layout[0];
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
    setSelectedFieldId(field.id);
    setSelectedSectionId(first?.id ?? null);
    setMobilePanel('inspector');
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
  const beginResize = (
    id: string,
    event: React.PointerEvent<HTMLElement>,
    span: number,
    container: number,
  ) => {
    if (terminalDenied.current || !definitionRef.current || gesture.current)
      return;
    event.preventDefault();
    gesture.current = {
      kind: 'resize',
      id,
      baseline: copy(definitionRef.current),
      changed: false,
      x: event.clientX,
      span,
      container,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const updateResize = (event: { clientX: number }) => {
    const current = gesture.current;
    const now = definitionRef.current;
    if (terminalDenied.current || !current || !now) return;
    const desired =
      (current.span ?? 4) +
      ((event.clientX - current.x) / Math.max(1, current.container ?? 1)) * 12;
    const snapped = ([3, 4, 6, 8, 9, 12] as const).reduce((best, candidate) =>
      Math.abs(candidate - desired) < Math.abs(best - desired)
        ? candidate
        : best,
    );
    const next = {
      ...now,
      layout: now.layout.map((section) => ({
        ...section,
        controls: section.controls.map((control) =>
          control.id === current.id ? { ...control, width: snapped } : control,
        ),
      })),
    };
    if (JSON.stringify(next) !== JSON.stringify(now)) {
      current.changed = true;
      definitionRef.current = next;
      setDefinition(next);
    }
  };
  const endResize = (cancel = false) => {
    const current = gesture.current;
    if (terminalDenied.current || !current) return;
    gesture.current = null;
    if (cancel) {
      definitionRef.current = current.baseline;
      setDefinition(current.baseline);
      return;
    }
    if (
      current.changed &&
      JSON.stringify(definitionRef.current) !== JSON.stringify(current.baseline)
    ) {
      setHistory((prior) => [...prior.slice(-19), current.baseline]);
      editEpoch.current += 1;
      setSaveReview(null);
      setSavePayload(null);
      setMessage('');
    }
  };
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && gesture.current) endResize(true);
    };
    const move = (event: PointerEvent) => updateResize(event);
    const end = () => endResize();
    const cancel = () => endResize(true);
    window.addEventListener('keydown', escape);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', cancel);
    return () => {
      window.removeEventListener('keydown', escape);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', cancel);
    };
  });
  const finishDnd = (canceled: boolean) => {
    const baseline = dndBaseline.current;
    dndBaseline.current = null;
    if (terminalDenied.current || !baseline) return;
    if (canceled) {
      definitionRef.current = baseline;
      setDefinition(baseline);
      return;
    }
    if (JSON.stringify(definitionRef.current) !== JSON.stringify(baseline)) {
      setHistory((prior) => [...prior.slice(-19), baseline]);
      editEpoch.current += 1;
      setSaveReview(null);
      setSavePayload(null);
      setMessage('');
    }
  };
  const selectedField = definition?.fields.find(
    (field) => field.id === selectedFieldId,
  );
  const selectedFieldIndex =
    selectedField && definition ? definition.fields.indexOf(selectedField) : -1;
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
          Arrange fields and sections, preview the result, then save the active
          form.
        </p>
      </div>
      {identityStatus === 'blocked' ? (
        <div
          role="status"
          className="rounded border border-amber-700 p-3 text-sm"
        >
          Configuration access changed. Refresh this page to continue.
          {identityStatus === 'blocked' && (
            <Button
              type="button"
              variant="outline"
              onClick={() => window.location.reload()}
            >
              Refresh access
            </Button>
          )}
        </div>
      ) : active.length === 0 ? (
        <p>No active category is available.</p>
      ) : (
        <>
          {identityStatus === 'retry' && (
            <div role="alert" className="rounded border border-amber-700 p-3">
              Identity verification was interrupted. Your edits remain here.
              Saving is paused until access is verified.{' '}
              <Button
                type="button"
                variant="outline"
                onClick={() => window.dispatchEvent(new Event('focus'))}
              >
                Retry access check
              </Button>
            </div>
          )}
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
            Published revision {selected?.published_number ?? 'unknown'}
            {draftVersion !== '0' ? ' · Legacy draft available' : ''}
            {dirty ? ' · Unsaved changes' : ' · Saved'}
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
                    setSelectedFieldId(
                      recovery.definition.fields[0]?.id ?? null,
                    );
                    editEpoch.current += 1;
                    setPreviewVersion((version) => version + 1);
                    setSaved(recovery.savedDefinition);
                    setDraftVersion(recovery.expectedDraftVersion);
                    setDraftId(recovery.expectedDraftId);
                    setPublishedBaseline(recovery.expectedPublishedRevisionId);
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
                  clearDesignerRecovery(memberId, categoryId);
                  setRecovery(null);
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
          {!recovery && (
            <details className="rounded border border-slate-700 p-3 text-sm">
              <summary className="cursor-pointer font-medium">
                Advanced JSON recovery
              </summary>
              <p className="my-2 text-slate-400">
                The visual editor is the normal way to change forms. Load the
                current document to inspect or copy it. Pasted JSON changes your
                local editor only after you apply it. Use Save changes to
                publish those edits.
              </p>
              <Button
                type="button"
                variant="outline"
                disabled={operationPending || pending}
                onClick={() => {
                  setAdvancedJson(
                    JSON.stringify(definition ?? source(selected), null, 2),
                  );
                  setAdvancedError('');
                }}
              >
                Load current document JSON
              </Button>
              <label className="mt-3 block space-y-1">
                <span>Form definition JSON</span>
                <textarea
                  className="min-h-44 w-full rounded border border-slate-600 bg-slate-950 p-3 font-mono text-xs"
                  value={advancedJson}
                  onChange={(event) => {
                    setAdvancedJson(event.target.value);
                    setAdvancedError('');
                  }}
                />
              </label>
              {advancedError && (
                <p role="alert" className="mt-2 text-amber-200">
                  {advancedError}
                </p>
              )}
              <Button
                type="button"
                variant="outline"
                disabled={operationPending || pending || !advancedJson.trim()}
                onClick={() => {
                  let parsed: unknown;
                  try {
                    parsed = JSON.parse(advancedJson);
                  } catch {
                    setAdvancedError(
                      'JSON syntax is invalid. No form changes were applied.',
                    );
                    return;
                  }
                  const result = metadataDefinition.safeParse(parsed);
                  if (!result.success) {
                    setAdvancedError(
                      'This JSON is not a supported form document. No form changes were applied.',
                    );
                    return;
                  }
                  edit(result.data);
                  setAdvancedError('');
                  setMessage(
                    'JSON applied to the local editor. Save changes to publish it.',
                  );
                }}
              >
                Apply JSON to visual editor
              </Button>
            </details>
          )}
          {definition && !recovery && (
            <>
              <nav
                className="flex flex-wrap gap-2 xl:hidden"
                aria-label="Designer panels"
              >
                {(['library', 'canvas', 'inspector'] as const).map((panel) => (
                  <Button
                    key={panel}
                    type="button"
                    variant={mobilePanel === panel ? 'default' : 'outline'}
                    onClick={() => setMobilePanel(panel)}
                  >
                    {label(panel)}
                  </Button>
                ))}
              </nav>
              <DragDropProvider
                onDragStart={() => {
                  if (terminalDenied.current) return;
                  if (definitionRef.current)
                    dndBaseline.current = copy(definitionRef.current);
                }}
                onDragOver={(event) => {
                  if (terminalDenied.current) return;
                  const { operation } = event;
                  const source = operation.source;
                  if (
                    isSortable(source) &&
                    String(source.id).startsWith('section:') &&
                    isSortable(operation.target) &&
                    String(operation.target.id).startsWith('section:')
                  ) {
                    const now = definitionRef.current;
                    if (!now) return;
                    const ids = now.layout.map(
                      (section) => `section:${section.id}`,
                    );
                    const order = sortableMove(ids, event);
                    const byId = new Map(
                      now.layout.map((section) => [
                        `section:${section.id}`,
                        section,
                      ]),
                    );
                    const next = {
                      ...now,
                      layout: order.map((id) => byId.get(id)!).filter(Boolean),
                    };
                    if (JSON.stringify(next) !== JSON.stringify(now)) {
                      definitionRef.current = next;
                      setDefinition(next);
                    }
                    return;
                  }
                  if (
                    !isSortable(source) ||
                    !String(source.id).startsWith('control:')
                  )
                    return;
                  const now = definitionRef.current;
                  if (!now) return;
                  const id = String(source.id).slice(8);
                  const target = operation.target;
                  const sectionId = String(target?.id).startsWith('empty:')
                    ? String(target?.id).slice(6)
                    : isSortable(target) &&
                        String(target.id).startsWith('control:')
                      ? String(target.group)
                      : String(source.group);
                  const section = now.layout.find(
                    (item) => item.id === sectionId,
                  );
                  if (!section) return;
                  const original = section.controls.findIndex(
                    (item) => item.id === id,
                  );
                  const index = String(target?.id).startsWith('empty:')
                    ? section.controls.length
                    : isSortable(target)
                      ? target.index
                      : source.index;
                  const next = moveControl(
                    now,
                    id,
                    sectionId,
                    original >= 0 && index > original ? index + 1 : index,
                  );
                  if (JSON.stringify(next) !== JSON.stringify(now)) {
                    definitionRef.current = next;
                    setDefinition(next);
                  }
                }}
                onDragEnd={(event) => {
                  finishDnd(event.canceled);
                }}
              >
                <div
                  data-testid="designer-panes"
                  className="grid min-w-0 gap-4 xl:grid-cols-[minmax(12rem,1fr)_minmax(28rem,2.5fr)_minmax(15rem,1fr)]"
                >
                  <div
                    data-testid="designer-library"
                    className={`${mobilePanel === 'library' ? '' : 'hidden'} min-w-0 space-y-3 xl:block`}
                  >
                    <h3 className="font-semibold">Field library</h3>
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
                    <div className="grid gap-2">
                      {definition.fields.map((field) => (
                        <button
                          type="button"
                          key={field.id}
                          className="min-h-11 rounded border border-slate-600 p-2 text-left"
                          onClick={() => {
                            setSelectedFieldId(field.id);
                            setSelectedControlId(null);
                            setMobilePanel('inspector');
                          }}
                        >
                          {field.label || 'Untitled field'} ·{' '}
                          {label(field.type)}{' '}
                          <span className="block text-xs text-slate-400">
                            {definition.layout.some((section) =>
                              section.controls.some(
                                (control) => control.field_id === field.id,
                              ),
                            )
                              ? 'Placed'
                              : 'Unplaced'}
                          </span>
                        </button>
                      ))}
                    </div>
                    <div className="rounded-lg border border-slate-700 p-3 text-sm">
                      <h4 className="font-semibold">Hidden controls</h4>
                      {definition.layout
                        .flatMap((section) => section.controls)
                        .filter((control) => control.visible === false)
                        .map((control) => (
                          <button
                            className="block min-h-10 break-words text-left text-cyan-200 underline"
                            type="button"
                            key={control.id}
                            onClick={() =>
                              updateControl(control.id, { visible: true })
                            }
                          >
                            Restore{' '}
                            {control.kind === 'builtin'
                              ? builtinLabel(control.builtin ?? '')
                              : control.kind === 'field'
                                ? definition.fields.find(
                                    (field) => field.id === control.field_id,
                                  )?.label
                                : 'help text'}
                          </button>
                        ))}
                    </div>
                  </div>
                  <div
                    data-testid="designer-canvas"
                    className={`${mobilePanel === 'canvas' ? '' : 'hidden'} min-w-0 space-y-3 xl:block`}
                  >
                    <h3 className="font-semibold">Form canvas</h3>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        const id = newId();
                        edit({
                          ...definition,
                          layout: [
                            ...definition.layout,
                            { id, label: 'New section', controls: [] },
                          ],
                        });
                        setSelectedSectionId(id);
                        requestAnimationFrame(() =>
                          document
                            .querySelector<HTMLElement>(
                              `[data-section-id="${id}"] input`,
                            )
                            ?.focus(),
                        );
                      }}
                    >
                      Add section
                    </Button>
                    {definition.layout.map((section, sectionIndex) => (
                      <SortableSection
                        key={section.id}
                        id={section.id}
                        index={sectionIndex}
                        selected={selectedSectionId === section.id}
                      >
                        {(sectionHandleRef) => (
                          <>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                aria-label={`Drag section ${section.label}`}
                                ref={sectionHandleRef}
                                className="min-h-11 min-w-11 cursor-grab touch-none rounded border"
                              >
                                ⋮⋮
                              </button>
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => {
                                  setSelectedSectionId(section.id);
                                  setSelectedControlId(null);
                                  setMobilePanel('inspector');
                                }}
                              >
                                Inspect section
                              </Button>
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
                                          ? {
                                              ...item,
                                              label: event.target.value,
                                            }
                                          : item,
                                      ),
                                    })
                                  }
                                />
                              </label>
                              <details className="w-full rounded-md border border-slate-700/70 bg-slate-950/30 px-3 py-2 text-xs">
                                <summary className="cursor-pointer font-medium text-cyan-200">
                                  Section options
                                </summary>
                                <div className="flex flex-wrap gap-2 pt-3">
                                  <label className="text-xs">
                                    <input
                                      type="checkbox"
                                      checked={section.visible !== false}
                                      disabled={sectionHasProtectedControls(
                                        section,
                                      )}
                                      onChange={(event) =>
                                        edit({
                                          ...definition,
                                          layout: definition.layout.map(
                                            (item) =>
                                              item.id === section.id
                                                ? {
                                                    ...item,
                                                    visible:
                                                      event.target.checked,
                                                  }
                                                : item,
                                          ),
                                        })
                                      }
                                    />{' '}
                                    Show section
                                  </label>
                                  <select
                                    aria-label={`Applies to ${section.label}`}
                                    className={input + ' max-w-36'}
                                    value={(
                                      section.applies_to ?? [
                                        'quantity',
                                        'asset',
                                      ]
                                    ).join(',')}
                                    disabled={sectionHasProtectedControls(
                                      section,
                                    )}
                                    onChange={(event) =>
                                      edit({
                                        ...definition,
                                        layout: definition.layout.map((item) =>
                                          item.id === section.id
                                            ? {
                                                ...item,
                                                applies_to:
                                                  event.target.value.split(
                                                    ',',
                                                  ) as ('quantity' | 'asset')[],
                                              }
                                            : item,
                                        ),
                                      })
                                    }
                                  >
                                    <option value="quantity,asset">Both</option>
                                    <option value="quantity">Quantity</option>
                                    <option value="asset">Serialized</option>
                                  </select>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    disabled={sectionIndex === 0}
                                    onClick={() => {
                                      const layout = [...definition.layout];
                                      [
                                        layout[sectionIndex - 1],
                                        layout[sectionIndex],
                                      ] = [
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
                                    disabled={
                                      sectionIndex ===
                                      definition.layout.length - 1
                                    }
                                    onClick={() => {
                                      const layout = [...definition.layout];
                                      [
                                        layout[sectionIndex + 1],
                                        layout[sectionIndex],
                                      ] = [
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
                                    disabled={
                                      sectionHasProtectedControls(section) ||
                                      section.id ===
                                        selected?.published_definition.layout[0]
                                          ?.id ||
                                      definition.layout.length === 1
                                    }
                                    onClick={() => {
                                      const destinations =
                                        definition.layout.filter(
                                          (item) => item.id !== section.id,
                                        );
                                      const destination = section.controls
                                        .length
                                        ? window.prompt(
                                            `Move ${section.controls.length} controls to which section? Enter a section name, or leave blank to remove custom field placements. Definitions and stored values remain.`,
                                            destinations[0]?.label ?? '',
                                          )
                                        : '';
                                      if (destination === null) return;
                                      const target = destination.trim()
                                        ? destinations.find(
                                            (item) =>
                                              item.label.toLowerCase() ===
                                              destination.trim().toLowerCase(),
                                          )
                                        : null;
                                      if (destination.trim() && !target) {
                                        setMessage(
                                          'Choose an existing section name.',
                                        );
                                        return;
                                      }
                                      const next = removeSection(
                                        definition,
                                        section.id,
                                        target?.id ?? null,
                                      );
                                      if (next === definition) {
                                        setMessage(
                                          'This section contains protected or standard controls. Move or show those controls before removing it.',
                                        );
                                        return;
                                      }
                                      edit(next);
                                      setSelectedSectionId(
                                        target?.id ??
                                          destinations[0]?.id ??
                                          null,
                                      );
                                    }}
                                  >
                                    Remove section
                                  </Button>
                                </div>
                              </details>
                            </div>
                            <SectionDropArea id={section.id}>
                              {section.controls.map((control, index) => {
                                const field = definition.fields.find(
                                  (item) => item.id === control.field_id,
                                );
                                const name =
                                  control.kind === 'field'
                                    ? field?.label || 'Missing field'
                                    : control.kind === 'builtin'
                                      ? builtinLabel(control.builtin ?? '')
                                      : 'Help text';
                                return (
                                  <SortableControl
                                    key={control.id}
                                    id={control.id}
                                    index={index}
                                    sectionId={section.id}
                                    selected={selectedControlId === control.id}
                                    onClick={() => {
                                      setSelectedControlId(control.id);
                                      setSelectedSectionId(section.id);
                                      setSelectedFieldId(
                                        control.field_id ?? null,
                                      );
                                    }}
                                    style={controlLayoutStyle(
                                      control.width,
                                      field?.type === 'boolean',
                                    )}
                                  >
                                    {(controlHandleRef) => (
                                      <>
                                        <div className="min-w-0 space-y-2">
                                          <span
                                            data-testid="designer-control-name"
                                            className="block min-w-0 break-words font-medium [overflow-wrap:anywhere]"
                                          >
                                            {name}
                                          </span>
                                          <div className="flex flex-wrap items-center gap-2">
                                            <button
                                              type="button"
                                              aria-label={`Drag ${name}`}
                                              ref={controlHandleRef}
                                              title="Drag to reorder"
                                              className="min-h-11 min-w-11 cursor-grab touch-none select-none rounded border px-2 py-1"
                                            >
                                              ⋮⋮
                                            </button>
                                            <span className="shrink-0 rounded-full border border-slate-600 px-2 py-1 text-[10px] text-slate-300">
                                              {control.width === 'Auto'
                                                ? 'Auto'
                                                : `${control.width}/12`}
                                            </span>
                                            <span
                                              title="Form types using this control"
                                              className="shrink-0 rounded-full border border-slate-600 px-2 py-1 text-[10px] text-slate-300"
                                            >
                                              {(control.applies_to?.length ??
                                                2) > 1
                                                ? 'Q + A'
                                                : control.applies_to?.[0] ===
                                                    'quantity'
                                                  ? 'Q'
                                                  : 'A'}
                                            </span>
                                            <button
                                              type="button"
                                              aria-label={`Resize ${name}`}
                                              title="Drag to snap width; width selector is also available"
                                              className="min-h-11 min-w-11 cursor-ew-resize touch-none select-none rounded border border-slate-600 px-2 text-xs text-cyan-200"
                                              onPointerDown={(event) =>
                                                beginResize(
                                                  control.id,
                                                  event,
                                                  control.width === 'Auto'
                                                    ? field?.type === 'boolean'
                                                      ? 3
                                                      : 4
                                                    : control.width,
                                                  event.currentTarget
                                                    .closest(
                                                      '[data-section-id]',
                                                    )
                                                    ?.getBoundingClientRect()
                                                    .width ?? 1,
                                                )
                                              }
                                              onPointerMove={updateResize}
                                              onPointerUp={() => endResize()}
                                              onPointerCancel={() =>
                                                endResize(true)
                                              }
                                            >
                                              ↔
                                            </button>
                                          </div>
                                        </div>
                                        <details className="rounded border border-slate-700/70 px-2 py-1">
                                          <summary className="min-h-9 cursor-pointer py-2 text-xs font-medium text-cyan-200">
                                            Layout options
                                          </summary>
                                          <div className="space-y-2 pb-2 pt-1">
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
                                                <input
                                                  type="checkbox"
                                                  checked={
                                                    control.visible !== false
                                                  }
                                                  disabled={
                                                    control.kind ===
                                                      'builtin' &&
                                                    [
                                                      'name',
                                                      'category_id',
                                                      'asset_tag',
                                                    ].includes(
                                                      control.builtin ?? '',
                                                    )
                                                  }
                                                  onChange={(event) =>
                                                    updateControl(control.id, {
                                                      visible:
                                                        event.target.checked,
                                                    })
                                                  }
                                                />{' '}
                                                Show control
                                              </label>
                                              <select
                                                aria-label={`Applies to ${name}`}
                                                className={input}
                                                value={(
                                                  control.applies_to ?? [
                                                    'quantity',
                                                    'asset',
                                                  ]
                                                ).join(',')}
                                                disabled={
                                                  control.kind === 'builtin' &&
                                                  [
                                                    'name',
                                                    'category_id',
                                                    'asset_tag',
                                                  ].includes(
                                                    control.builtin ?? '',
                                                  )
                                                }
                                                onChange={(event) =>
                                                  updateControl(control.id, {
                                                    applies_to:
                                                      event.target.value.split(
                                                        ',',
                                                      ) as (
                                                        'quantity' | 'asset'
                                                      )[],
                                                  })
                                                }
                                              >
                                                <option value="quantity,asset">
                                                  Both
                                                </option>
                                                <option value="quantity">
                                                  Quantity
                                                </option>
                                                <option value="asset">
                                                  Serialized
                                                </option>
                                              </select>
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
                                                          item.id ===
                                                          event.target.value,
                                                      )?.controls.length ?? 0,
                                                    )
                                                  }
                                                >
                                                  {definition.layout.map(
                                                    (item) => (
                                                      <option
                                                        key={item.id}
                                                        value={item.id}
                                                      >
                                                        {item.label ||
                                                          'Untitled'}
                                                      </option>
                                                    ),
                                                  )}
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
                                                        event.target.value ===
                                                        'Auto'
                                                          ? 'Auto'
                                                          : (Number(
                                                              event.target
                                                                .value,
                                                            ) as Control['width']),
                                                    })
                                                  }
                                                >
                                                  {widths.map((width) => (
                                                    <option
                                                      key={width}
                                                      value={width}
                                                    >
                                                      {width === 'Auto'
                                                        ? 'Auto'
                                                        : `${width}/12`}
                                                    </option>
                                                  ))}
                                                </select>
                                              </label>
                                            </div>
                                            <div className="flex flex-wrap gap-2 text-xs">
                                              <button
                                                type="button"
                                                className="min-h-11 px-2 underline"
                                                disabled={index === 0}
                                                onClick={() =>
                                                  move(
                                                    control.id,
                                                    section.id,
                                                    index - 1,
                                                  )
                                                }
                                              >
                                                Move up
                                              </button>
                                              <button
                                                type="button"
                                                className="min-h-11 px-2 underline"
                                                disabled={
                                                  index ===
                                                  section.controls.length - 1
                                                }
                                                onClick={() =>
                                                  move(
                                                    control.id,
                                                    section.id,
                                                    index + 2,
                                                  )
                                                }
                                              >
                                                Move down
                                              </button>
                                              <button
                                                type="button"
                                                className="min-h-11 px-2 text-rose-300 underline"
                                                disabled={
                                                  control.kind === 'builtin'
                                                }
                                                onClick={() =>
                                                  edit({
                                                    ...definition,
                                                    layout:
                                                      definition.layout.map(
                                                        (item) => ({
                                                          ...item,
                                                          controls:
                                                            item.controls.filter(
                                                              (candidate) =>
                                                                candidate.id !==
                                                                control.id,
                                                            ),
                                                        }),
                                                      ),
                                                  })
                                                }
                                              >
                                                Remove control
                                              </button>
                                            </div>
                                          </div>
                                        </details>
                                      </>
                                    )}
                                  </SortableControl>
                                );
                              })}
                            </SectionDropArea>
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
                                          (control) =>
                                            control.field_id === field.id,
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
                          </>
                        )}
                      </SortableSection>
                    ))}
                  </div>
                  <aside
                    data-testid="designer-inspector"
                    className={`${mobilePanel === 'inspector' ? '' : 'hidden'} min-w-0 space-y-3 xl:block`}
                    aria-label="Designer inspector"
                  >
                    <h3 className="font-semibold">Inspector</h3>
                    {selectedField ? (
                      <FieldPanel
                        key={selectedField.id}
                        field={selectedField}
                        change={updateField}
                        remove={() => removeField(selectedField.id)}
                        replace={(type) =>
                          addField(
                            type,
                            (selectedField.label || 'Untitled field') +
                              ' replacement',
                          )
                        }
                        lockedCurrency={
                          selectedField.type === 'currency' &&
                          !!selected?.published_definition.fields.some(
                            (published) => published.id === selectedField.id,
                          )
                        }
                        moveUp={() => {
                          if (selectedFieldIndex < 1) return;
                          const fields = [...definition.fields];
                          [
                            fields[selectedFieldIndex - 1],
                            fields[selectedFieldIndex],
                          ] = [
                            fields[selectedFieldIndex],
                            fields[selectedFieldIndex - 1],
                          ];
                          edit({ ...definition, fields });
                        }}
                        moveDown={() => {
                          if (
                            selectedFieldIndex >=
                            definition.fields.length - 1
                          )
                            return;
                          const fields = [...definition.fields];
                          [
                            fields[selectedFieldIndex + 1],
                            fields[selectedFieldIndex],
                          ] = [
                            fields[selectedFieldIndex],
                            fields[selectedFieldIndex + 1],
                          ];
                          edit({ ...definition, fields });
                        }}
                      />
                    ) : selectedSectionId ? (
                      <p className="text-sm text-slate-400">
                        Section{' '}
                        {
                          definition.layout.find(
                            (section) => section.id === selectedSectionId,
                          )?.label
                        }
                        . Choose a control or field to inspect its settings.
                      </p>
                    ) : (
                      <p className="text-sm text-slate-400">
                        Select a section, control, or field to inspect it.
                      </p>
                    )}
                  </aside>
                </div>
                <DragOverlay dropAnimation={null}>
                  {(source) => (
                    <motion.div
                      initial={false}
                      animate={{ opacity: 1, scale: 1 }}
                      className="rounded-lg border border-cyan-400 bg-slate-900 px-4 py-3 text-sm font-semibold shadow-2xl"
                    >
                      {String(source.id).startsWith('section:')
                        ? definition.layout.find(
                            (item) => item.id === String(source.id).slice(8),
                          )?.label
                        : (() => {
                            const control = definition.layout
                              .flatMap((section) => section.controls)
                              .find(
                                (item) =>
                                  item.id === String(source.id).slice(8),
                              );
                            return control?.kind === 'builtin'
                              ? builtinLabel(control.builtin ?? '')
                              : control?.kind === 'field'
                                ? definition.fields.find(
                                    (field) => field.id === control.field_id,
                                  )?.label
                                : 'Help text';
                          })()}
                    </motion.div>
                  )}
                </DragOverlay>
              </DragDropProvider>
              <details className="rounded-xl border border-slate-700 bg-slate-950/30">
                <summary className="min-h-11 cursor-pointer px-3 py-2 font-semibold text-cyan-100">
                  Live preview · open quantity or asset form
                </summary>
                <div className="space-y-3 pt-3">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant={
                        previewKind === 'quantity' ? 'default' : 'outline'
                      }
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
                        identity and permissions remain mandatory or separate
                        from this layout.
                      </p>
                    </div>
                  ) : (
                    <p role="status">
                      Preview is unavailable until the document shape is valid.
                    </p>
                  )}
                </div>
              </details>
            </>
          )}
          {issues.length > 0 && !recovery && (
            <div
              className="break-words rounded border border-amber-700 p-3 text-sm"
              role="alert"
            >
              <p>Resolve before saving:</p>
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
                disabled={
                  operationPending ||
                  pending ||
                  !definition ||
                  issues.length > 0 ||
                  identityStatus !== 'verified' ||
                  (!dirty && draftVersion === '0')
                }
                onClick={() => saveChanges()}
              >
                {operationPending ? 'Saving…' : 'Save changes'}
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
                </>
              )}
            </div>
          )}
          {saveReview && !recovery && (
            <div
              role="region"
              aria-label="Form save impact"
              className="space-y-3 break-words rounded border border-amber-700 p-3 text-sm"
            >
              <p>
                Records in affected form types:{' '}
                {String(saveReview.affected_quantity)} quantity records and{' '}
                {String(saveReview.affected_assets)} serialized assets.{' '}
                {String(saveReview.newly_needs_quantity)} quantity records and{' '}
                {String(saveReview.newly_needs_assets)} assets will newly need
                metadata review. Existing values are retained.
              </p>
              <ul className="list-disc pl-5">
                {Array.isArray(saveReview.reasons) &&
                  saveReview.reasons.map((reason, index) => {
                    const entry = reason as {
                      kind?: string;
                      id?: string;
                      affected_kinds?: string[];
                    };
                    return (
                      <li key={index}>
                        {label(entry.kind ?? 'Change')}{' '}
                        {entry.id ? `(${entry.id})` : ''}:{' '}
                        {(entry.affected_kinds ?? []).map(label).join(', ')}
                      </li>
                    );
                  })}
              </ul>
              <p className="text-xs text-slate-400">
                Review expires at{' '}
                {new Date(String(saveReview.expires_at)).toLocaleTimeString()}.
              </p>
              <Button
                type="button"
                disabled={
                  operationPending ||
                  pending ||
                  issues.length > 0 ||
                  identityStatus !== 'verified'
                }
                onClick={() => saveChanges(true)}
              >
                Confirm and save changes
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setSaveReview(null);
                  setSavePayload(null);
                  setMessage('Save canceled. Your edits remain here.');
                }}
              >
                Cancel
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
