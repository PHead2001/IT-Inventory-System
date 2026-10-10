'use client';
import { useRouteTask } from '@/components/experience/route-pending';
import { useRouteRouter as useRouter } from '@/components/experience/route-pending';

import { useRouteActionResult } from '@/components/experience/route-pending';
import { OperationalTimestamp } from '@/components/operational-time';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { Button } from '@/components/ui/button';
import { useEffectiveReducedMotion } from '@/components/experience/motion-preference';
import { motion } from 'motion/react';
import {
  DragDropProvider,
  DragOverlay,
  useDroppable,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from '@dnd-kit/react';
import { isSortable, useSortable } from '@dnd-kit/react/sortable';
import { Accessibility } from '@dnd-kit/dom';
import {
  publicationReasonText,
  designerDragName,
  type PublicationReviewSnapshot,
} from './publication-review-display';
import { move as sortableMove } from '@dnd-kit/helpers';
import {
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
import { RecoveryLibrary } from './recovery-library';
import { controlKinds, kindLabel } from './effective-controls';
import styles from './designer.module.css';
import { controlLayoutStyle } from './control-layout';
import { FieldSettings, makeField } from './field-settings';
import { AddFieldDialog } from './add-field-dialog';
import { fetchCategoryForm } from './form-fetch.actions';
import { MetadataFieldInput } from './field-value-input';
import {
  fieldName,
  fieldTypeInfo,
  placementName,
  scopeRestriction,
} from './field-authoring-model';
import {
  clearDesignerRecovery,
  completeDesignerNavigation,
  readDesignerRecovery,
  writeDesignerRecovery,
  type DesignerRecovery,
  type PendingFieldAddition,
} from './designer-recovery';
import {
  addFieldToSection,
  hidePlacement,
  controlMoveBlockReason,
  designerIssues,
  initialDefinition,
  moveControl,
  removeSection,
  sectionHasProtectedControls,
  sectionEditBlockReason,
  newId,
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
function ControlShape({
  control,
  field,
  categoryName,
}: {
  control: Control;
  field?: Field;
  categoryName: string;
}) {
  if (field)
    return (
      <div
        data-testid="designer-control-preview"
        aria-hidden="true"
        className={styles.canvasField}
        inert
      >
        <MetadataFieldInput
          id={`canvas-${control.id}`}
          field={field}
          value={field.default}
          onChange={() => {}}
          readOnly
        />
      </div>
    );
  if (control.kind === 'help')
    return (
      <p
        data-testid="designer-control-preview"
        className="min-h-10 whitespace-pre-wrap text-sm text-slate-400"
      >
        {control.help || 'Add instructions·'}
      </p>
    );
  return (
    <div data-testid="designer-control-preview" aria-hidden="true" inert>
      {control.kind === 'field' ? (
        <p className="text-rose-300">Missing field reference</p>
      ) : control.builtin === 'category_id' ? (
        <select className={input} disabled aria-label="Category preview">
          <option>{categoryName}</option>
        </select>
      ) : control.builtin === 'description' ? (
        <textarea
          className={input}
          rows={3}
          disabled
          aria-label="Description preview"
          placeholder="Enter a description"
        />
      ) : (
        <input
          className={input}
          disabled
          aria-label={`${builtinLabel(control.builtin ?? '')} preview`}
          type={control.builtin === 'reorder_threshold' ? 'number' : 'text'}
          placeholder={
            control.builtin === 'reorder_threshold' ? '0' : 'Enter a value'
          }
        />
      )}
    </div>
  );
}

function ControlProperties({
  definition,
  section,
  control,
  updateControl,
  move,
  edit,
  appearanceOnly = false,
}: {
  definition: MetadataDefinition;
  section: MetadataDefinition['layout'][number];
  control: Control;
  updateControl: (id: string, patch: Partial<Control>) => void;
  move: (id: string, sectionId: string, index: number) => void;
  edit: (next: MetadataDefinition) => void;
  appearanceOnly?: boolean;
}) {
  const index = section.controls.indexOf(control);
  const field = definition.fields.find((item) => item.id === control.field_id);
  const name = placementName(control, definition.fields);
  const protectedField =
    control.kind === 'builtin' &&
    ['name', 'category_id', 'asset_tag'].includes(control.builtin ?? '');
  const contents = (
    <div className="space-y-3">
      {section.visible === false && (
        <p className="text-sm text-amber-200">
          Hidden by its section. Show the section in Hidden fields to restore
          this field.
        </p>
      )}
      {control.kind === 'help' && (
        <label className="block text-sm">
          Instructions
          <textarea
            rows={3}
            className={input}
            value={control.help ?? ''}
            onChange={(event) =>
              updateControl(control.id, { help: event.target.value })
            }
          />
        </label>
      )}
      {!appearanceOnly && (
        <p className="text-xs text-slate-400">
          Show on: {kindLabel(controlKinds(definition, section, control))}.
          Standard field and section restrictions apply.
        </p>
      )}
      <label className="block text-sm">
        Section
        <select
          className={input}
          value={section.id}
          onChange={(event) =>
            move(
              control.id,
              event.target.value,
              definition.layout.find((item) => item.id === event.target.value)
                ?.controls.length ?? 0,
            )
          }
        >
          {definition.layout.map((item) => {
            const reason = controlMoveBlockReason(
              definition,
              control.id,
              item.id,
            );
            return (
              <option key={item.id} value={item.id} disabled={Boolean(reason)}>
                {item.label || 'Untitled section'}
                {reason ? ` · ${reason}` : ''}
              </option>
            );
          })}
        </select>
      </label>
      <label className="block text-sm">
        Preferred width
        <select
          className={input}
          value={control.width}
          onChange={(event) =>
            updateControl(control.id, {
              width:
                event.target.value === 'Auto'
                  ? 'Auto'
                  : (Number(event.target.value) as Control['width']),
            })
          }
        >
          {widths.map((width) => (
            <option key={width} value={width}>
              {width === 'Auto'
                ? 'Automatic'
                : width === 12
                  ? 'Full width'
                  : width === 9
                    ? 'Three quarters'
                    : width === 8
                      ? 'Two thirds'
                      : width === 6
                        ? 'Half width'
                        : width === 4
                          ? 'One third'
                          : width === 3
                            ? 'One quarter'
                            : `${(width / 12) * 100}% width`}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-slate-400">
        Quarter, half and full describe a preferred share of the row. Each field
        keeps a minimum usable size, wraps when needed and grows to fill unused
        row space. Narrow forms stack fields. The canvas and Preview form use
        the same layout.
      </p>
      <div
        aria-label="Preferred width preview"
        className="flex flex-wrap gap-3 rounded border border-slate-700 p-2"
        aria-hidden="true"
      >
        {([control.width, 6] as Control['width'][]).map((width, index) => (
          <span
            key={index}
            style={controlLayoutStyle(width, field?.type === 'boolean')}
            className="min-h-10 rounded bg-cyan-950 p-2 text-xs"
          >
            {index === 0 ? 'Selected field' : 'Next field'}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={index === 0}
          onClick={() => move(control.id, section.id, index - 1)}
        >
          Move up
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={index === section.controls.length - 1}
          onClick={() => move(control.id, section.id, index + 2)}
        >
          Move down
        </Button>
      </div>
      {control.visible === false ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => updateControl(control.id, { visible: true })}
        >
          Show on form
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          disabled={protectedField}
          onClick={() => {
            if (
              field?.required &&
              !window.confirm(
                'Make this field optional before hiding it? Existing values are retained.',
              )
            )
              return;
            edit(
              hidePlacement(definition, control.id, Boolean(field?.required)),
            );
          }}
        >
          Hide from form
        </Button>
      )}
      <p className="text-xs text-slate-400">
        {protectedField
          ? 'This standard field must remain visible.'
          : field?.required
            ? 'Make this field optional before hiding it. Hiding retains stored values and can be reversed in Hidden fields.'
            : 'Hiding retains stored values. Restore this field in Hidden fields.'}
      </p>
      {control.kind === 'field' && !field && (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-rose-300">
            This placement refers to a missing field. Remove the broken
            placement to repair the form. Existing fields and stored answers are
            retained. Use Add field to place an existing field.
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              edit({
                ...definition,
                layout: definition.layout.map((item) =>
                  item.id === section.id
                    ? {
                        ...item,
                        controls: item.controls.filter(
                          (entry) => entry.id !== control.id,
                        ),
                      }
                    : item,
                ),
              })
            }
          >
            Remove broken placement
          </Button>
        </div>
      )}
    </div>
  );
  return appearanceOnly ? (
    contents
  ) : (
    <section
      aria-label={`${name} layout properties`}
      className="rounded border border-slate-700 p-3"
    >
      <h4 className="font-semibold">{name}</h4>
      {contents}
    </section>
  );
}

function FieldAdvanced({
  field,
  published,
  replace,
  retire,
}: {
  field: Field;
  published: boolean;
  replace: (type: FieldType) => void;
  retire: () => void;
}) {
  const [type, setType] = useState<FieldType>(field.type);
  return (
    <>
      <p className="text-xs text-slate-400">
        {published
          ? 'Published type and currency meaning stay fixed. A replacement is a new field; earlier values and revisions remain in history.'
          : 'This field has not been published. Change its type in Basics.'}
      </p>
      {published && (
        <>
          <label className="block text-sm">
            Replacement type
            <select
              className={input}
              value={type}
              onChange={(event) => setType(event.target.value as FieldType)}
            >
              {Object.entries(fieldTypeInfo).map(([value, info]) => (
                <option key={value} value={value}>
                  {info.name}
                </option>
              ))}
            </select>
          </label>
          <Button type="button" variant="outline" onClick={() => replace(type)}>
            Create replacement field
          </Button>
        </>
      )}
      <Button type="button" variant="outline" onClick={retire}>
        {published ? 'Retire field' : 'Discard unpublished field'}
      </Button>
      <p className="text-xs text-slate-400">
        {published
          ? 'Retirement removes the field from the new revision. Save reviews its impact and preserves historical values.'
          : 'Discard removes only this unpublished definition and its placement from your local edits.'}
      </p>
    </>
  );
}

type HandleRef = (element: Element | null) => void;
function SortableSection({
  id,
  index,
  selected,
  hidden,
  children,
}: {
  id: string;
  index: number;
  selected: boolean;
  hidden: boolean;
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
      data-hidden={hidden}
      className={`min-w-0 space-y-3 rounded border p-3 ${hidden ? 'border-dashed border-amber-600/70 bg-amber-500/5' : selected ? 'border-cyan-400' : 'border-slate-700'} ${isDragging ? 'opacity-40' : ''}`}
    >
      {children(handleRef)}
    </div>
  );
}
function SortableControl({
  id,
  name,
  index,
  sectionId,
  style,
  selected,
  hidden,
  children,
  onClick,
  canReceive,
}: {
  id: string;
  index: number;
  name: string;
  sectionId: string;
  style: React.CSSProperties;
  selected: boolean;
  hidden: boolean;
  children: (handleRef: HandleRef) => ReactNode;
  onClick: () => void;
  canReceive: (controlId: string) => boolean;
}) {
  const { ref, handleRef, isDragging } = useSortable({
    id: `control:${id}`,
    index,
    group: sectionId,
    type: 'control',
    accept: (source) =>
      String(source.id).startsWith('control:') &&
      canReceive(String(source.id).slice(8)),
  });
  return (
    <div
      ref={ref}
      data-control-id={id}
      data-dragging={isDragging}
      data-selected={selected}
      data-hidden={hidden}
      tabIndex={0}
      style={style}
      onClick={onClick}
      onFocus={onClick}
      aria-label={`Select ${name} control`}
      onKeyDown={(event) => {
        if (
          event.target === event.currentTarget &&
          ['Enter', ' '].includes(event.key)
        ) {
          event.preventDefault();
          onClick();
        }
      }}
      className={`${styles.control} relative min-w-0 rounded border p-2 text-sm ${selected ? 'border-cyan-400' : 'border-transparent'} ${isDragging ? 'opacity-40' : ''}`}
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
  definition,
  draggingControlId,
  children,
}: {
  id: string;
  definition: MetadataDefinition;
  draggingControlId: string | null;
  children: ReactNode;
}) {
  const blockReason = draggingControlId
    ? controlMoveBlockReason(definition, draggingControlId, id)
    : null;
  const { ref, isDropTarget } = useDroppable({
    id: `empty:${id}`,
    type: 'control',
    accept: (source) =>
      String(source.id).startsWith('control:') &&
      controlMoveBlockReason(definition, String(source.id).slice(8), id) ===
        null,
    data: { sectionId: id },
  });
  return (
    <div
      ref={ref}
      data-drop-target={isDropTarget}
      data-drop-compatible={draggingControlId ? !blockReason : undefined}
      title={blockReason ?? undefined}
      className={`${styles.dropArea} flex min-h-20 flex-wrap gap-3 rounded border border-dashed p-2 ${blockReason ? 'border-amber-700/60 bg-amber-500/5' : isDropTarget ? 'border-cyan-400 bg-cyan-400/10' : 'border-slate-700'}`}
    >
      {children}
    </div>
  );
}

export function MetadataSettings({
  categories,
  forms,
  memberId,
  selectedCategoryId,
}: {
  categories: Category[];
  forms: Record<string, MetadataForm>;
  memberId: string;
  selectedCategoryId?: string;
}) {
  const observeRouteActionResult = useRouteActionResult();
  const router = useRouter();
  const reducedMotion = useEffectiveReducedMotion();
  const pendingDesignerFocus = useRef<number | null>(null);
  const focusIntent = useRef(0);
  const cancelDesignerFocus = useCallback(() => {
    focusIntent.current++;
    if (pendingDesignerFocus.current !== null)
      cancelAnimationFrame(pendingDesignerFocus.current);
    pendingDesignerFocus.current = null;
  }, []);
  useEffect(() => cancelDesignerFocus, [cancelDesignerFocus]);
  const scheduleDesignerFocus = useCallback(
    (focus: () => void) => {
      cancelDesignerFocus();
      const intent = focusIntent.current;
      pendingDesignerFocus.current = requestAnimationFrame(() => {
        pendingDesignerFocus.current = null;
        if (intent === focusIntent.current) focus();
      });
    },
    [cancelDesignerFocus],
  );

  const active = categories.filter((category) => category.active);
  const [categoryId] = useState(selectedCategoryId ?? active[0]?.id ?? '');
  const selected = forms[categoryId];
  const [definition, setDefinition] = useState<MetadataDefinition | null>(() =>
    initialDefinition(source(forms[categoryId])),
  );
  const [saved, setSaved] = useState(() =>
    JSON.stringify(
      initialDefinition(source(forms[categoryId])) ?? source(forms[categoryId]),
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
  const publishedSnapshot = useRef({
    id: selected?.published_revision_id ?? '',
    definition: copy(
      selected?.published_definition ?? { fields: [], layout: [] },
    ),
  });
  const [reviewSnapshot, setReviewSnapshot] =
    useState<PublicationReviewSnapshot | null>(null);
  const previewDetails = useRef<HTMLDetailsElement>(null);
  const lastEditingFocus = useRef<HTMLElement | null>(null);
  const previewReturn = useRef<{
    focus: HTMLElement | null;
    x: number;
    y: number;
    section: string | null;
    control: string | null;
    field: string | null;
    panel: 'library' | 'canvas' | 'inspector';
  } | null>(null);
  const [saveReview, setSaveReview] = useState<Record<string, unknown> | null>(
    null,
  );
  const [savePayload, setSavePayload] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [message, setMessage] = useState('');
  const [saveFailed, setSaveFailed] = useState(false);
  const [recoveryToolsOpen, setRecoveryToolsOpen] = useState(false);
  const recoveryToolsRef = useRef<HTMLDialogElement>(null);
  const recoveryToolsTrigger = useRef<HTMLButtonElement>(null);
  const [receipt, setReceipt] = useState<{ key: string; id: string } | null>(
    null,
  );
  const [uncertainSave, setUncertainSave] = useState(false);
  const unresolvedCommand = useRef<DesignerRecovery | null>(null);
  const [blockedRecovery, setBlockedRecovery] = useState<
    'none' | 'durable' | 'memory'
  >('none');
  const [blockedAccessMessage, setBlockedAccessMessage] = useState('');
  const [pending, startTask] = useRouteTask();
  const [operationPending, setOperationPending] = useState(false);
  const [recovery, setRecovery] = useState<DesignerRecovery | null>(null);
  const [recoveryLoadedScope, setRecoveryLoadedScope] = useState<string | null>(
    null,
  );
  const [storageWarning, setStorageWarning] = useState('');
  const [identityStatus, setIdentityStatus] = useState<
    'verified' | 'checking' | 'blocked' | 'retry'
  >('verified');
  useEffect(() => {
    const dialog = recoveryToolsRef.current;
    if (!dialog) return;
    if (recoveryToolsOpen && identityStatus !== 'blocked') {
      if (dialog.showModal) dialog.showModal();
      else dialog.setAttribute('open', '');
    } else if (dialog.open) {
      if (dialog.close) dialog.close();
      else dialog.removeAttribute('open');
      recoveryToolsTrigger.current?.focus();
    }
  }, [recoveryToolsOpen, identityStatus]);
  const identityCheck = useRef(0);
  const identityInFlight = useRef(false);
  const terminalDenied = useRef(false);
  const busy = useRef(false);
  const categorySession = useRef(0);
  const editEpoch = useRef(0);
  const [history, setHistory] = useState<MetadataDefinition[]>([]);
  const [advancedJson, setAdvancedJson] = useState('');
  const [advancedError, setAdvancedError] = useState('');
  const [addition, setAddition] = useState<PendingFieldAddition | null>(null);
  const [navigationTarget, setNavigationTarget] = useState<string | null>(null);
  const navigationEpoch = useRef(0);
  const [navigationCommitted, setNavigationCommitted] = useState(false);
  const committedNavigation = useRef(false);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const [discardAfterCategoryId, setDiscardAfterCategoryId] = useState<
    string | undefined
  >();
  useEffect(
    () => () => {
      navigationEpoch.current += 1;
      categorySession.current += 1;
      clearTimeout(commitTimer.current);
    },
    [memberId, categoryId],
  );
  const stageAddition = useCallback((draft: PendingFieldAddition) => {
    if (committedNavigation.current) return;
    setAddition((prior) =>
      prior && JSON.stringify(prior) !== JSON.stringify(draft) ? draft : prior,
    );
  }, []);
  const [configErrors, setConfigErrors] = useState<Record<string, string>>({});
  const [inspectorRevision, setInspectorRevision] = useState(0);
  const [scopeMessage, setScopeMessage] = useState('');
  // Restored documents replace local drafts even when field IDs match.
  // Ordinary edits retain drafts so incomplete typing stays editable.
  const resetInspector = () => {
    setInspectorRevision((revision) => revision + 1);
    setConfigErrors({});
    setScopeMessage('');
  };
  const [previewKind, setPreviewKind] = useState<'quantity' | 'asset'>(
    'quantity',
  );
  const [phone, setPhone] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<
    'library' | 'canvas' | 'inspector'
  >('canvas');
  const restoreAdditionFocus = useCallback(() => {
    setMobilePanel('library');
    scheduleDesignerFocus(() =>
      document.querySelector<HTMLElement>('[data-designer-add-field]')?.focus(),
    );
  }, [scheduleDesignerFocus]);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(
    null,
  );
  const [selectedControlId, setSelectedControlId] = useState<string | null>(
    null,
  );
  const [removeSectionId, setRemoveSectionId] = useState<string | null>(null);
  const [removeDestinationId, setRemoveDestinationId] = useState('');
  const removeDialogRef = useRef<HTMLDialogElement>(null);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const dndBaseline = useRef<MetadataDefinition | null>(null);
  const [draggingControlId, setDraggingControlId] = useState<string | null>(
    null,
  );
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
  const dragAccessibility = useMemo(
    () => ({
      announcements: {
        dragstart: ({ operation }: DragStartEvent) =>
          `Picked up ${designerDragName(definitionRef.current ?? { fields: [], layout: [] }, operation.source?.id)}.`,
        dragover: ({ operation }: DragOverEvent) =>
          `Moving ${designerDragName(dndBaseline.current ?? definitionRef.current ?? { fields: [], layout: [] }, operation.source?.id)} to ${designerDragName(definitionRef.current ?? { fields: [], layout: [] }, operation.target?.id)}.`,
        dragend: ({ operation, canceled }: DragEndEvent) =>
          canceled
            ? `Canceled move of ${designerDragName(dndBaseline.current ?? definitionRef.current ?? { fields: [], layout: [] }, operation.source?.id)}.`
            : `Placed ${designerDragName(definitionRef.current ?? { fields: [], layout: [] }, operation.source?.id)}.`,
      },
    }),
    [],
  );
  const denyIdentity = useCallback(() => {
    if (terminalDenied.current) return;
    terminalDenied.current = true;
    identityCheck.current += 1;
    // An authorization check runs before RPC replay and cannot settle an
    // earlier command. Capture it before masking the privileged draft.
    const pendingCommand =
      unresolvedCommand.current ??
      readDesignerRecovery(memberId, categoryId).item;
    const unresolved = pendingCommand?.uncertainSave ? pendingCommand : null;
    unresolvedCommand.current = unresolved;
    setBlockedRecovery(
      unresolved
        ? writeDesignerRecovery(unresolved)
          ? 'durable'
          : 'memory'
        : 'none',
    );
    gesture.current = null;
    dndBaseline.current = null;
    setDraggingControlId(null);
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
    setRemoveSectionId(null);
    setAddition(null);
    setUncertainSave(unresolved !== null);
    setConfigErrors({});
    setScopeMessage('');
    if (!unresolved) clearDesignerRecovery(memberId, categoryId);
    setIdentityStatus('blocked');
  }, [memberId, categoryId]);
  const retryDeniedAccess = async () => {
    if (!terminalDenied.current || busy.current || identityInFlight.current)
      return;
    busy.current = true;
    identityInFlight.current = true;
    setOperationPending(true);
    setBlockedAccessMessage('Verifying the original actor’s access…');
    const check = ++identityCheck.current;
    try {
      const result = await observeRouteActionResult(
        verifyMetadataDesignerIdentity(memberId),
      );
      if (check !== identityCheck.current) return;
      if (!result.ok) {
        setBlockedAccessMessage(
          'The original actor’s configuration access could not be verified. Keep this page open and retry after access is restored.',
        );
        return;
      }
      const command = unresolvedCommand.current;
      if (!command) return;
      // Only this fresh server verification may release the terminal mask.
      // The original command stays locked until explicitly recovered/replayed.
      terminalDenied.current = false;
      setDefinition(command.definition);
      definitionRef.current = command.definition;
      setRecovery(command);
      setUncertainSave(true);
      setIdentityStatus('verified');
      setBlockedAccessMessage('');
      setMessage('Access restored. Recover edits and retry the original save.');
    } catch {
      if (check === identityCheck.current)
        setBlockedAccessMessage(
          'Access verification was interrupted. Keep this page open and retry.',
        );
    } finally {
      identityInFlight.current = false;
      busy.current = false;
      setOperationPending(false);
    }
  };
  useEffect(() => {
    definitionRef.current = definition;
  }, [definition]);
  useEffect(() => {
    const dialog = removeDialogRef.current;
    if (!dialog) return;
    if (removeSectionId && !dialog.open) {
      if (dialog.showModal) dialog.showModal();
      else dialog.setAttribute('open', ''); // jsdom lacks native dialog methods.
    }
    if (!removeSectionId && dialog.open) {
      if (dialog.close) dialog.close();
      else dialog.removeAttribute('open');
    }
  }, [removeSectionId]);
  const [previewVersion, setPreviewVersion] = useState(0);
  const refreshRequested = useRef(false);
  const dirty = definition !== null && JSON.stringify(definition) !== saved;
  const unsaved = dirty || addition !== null;
  const unresolvedSave = uncertainSave || recovery?.uncertainSave === true;
  const editorLocked =
    operationPending || unresolvedSave || navigationCommitted;
  const recoveryScope = `${memberId}:${categoryId}`;
  const issues = definition
    ? [
        ...designerIssues(definition),
        ...Object.entries(configErrors)
          .filter(([id]) => definition.fields.some((field) => field.id === id))
          .map(([, message]) => message)
          .filter(Boolean),
      ]
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
        const result = await observeRouteActionResult(
          verifyMetadataDesignerIdentity(memberId),
        );
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
  }, [denyIdentity, memberId, observeRouteActionResult]);
  useEffect(() => {
    let active = true;
    completeDesignerNavigation(memberId, categoryId);
    const result = readDesignerRecovery(memberId, categoryId);
    if (result.item?.uncertainSave) unresolvedCommand.current = result.item;
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
    // The command is captured synchronously before dispatch. Do not reconstruct
    // it from passive state effects that may still contain an older receipt.
    if (unresolvedCommand.current) return;
    // A pending original request belongs to recovery until it is explicitly adopted.
    if (recovery?.uncertainSave) return;
    if (!unsaved || !definition) {
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
      ...(addition ? { addition } : {}),
      ...(receipt ? { receipt } : {}),
      uncertainSave,
      ...(discardAfterCategoryId ? { discardAfterCategoryId } : {}),
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
    unsaved,
    addition,
    receipt,
    uncertainSave,
    discardAfterCategoryId,
    saved,
    draftVersion,
    draftId,
    publishedBaseline,
    recovery,
    recoveryLoadedScope,
    recoveryScope,
  ]);
  // Install navigation protection in the same commit that exposes locked
  // recovery controls; a passive effect leaves an observable navigation gap.
  useLayoutEffect(() => {
    if (!unsaved && !operationPending && !unresolvedSave && !navigationTarget)
      return;
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
        event.metaKey ||
        anchor.hasAttribute('download') ||
        anchor.getAttribute('target') === '_blank'
      )
        return;
      if (
        busy.current ||
        unresolvedSave ||
        navigationTarget ||
        !window.confirm(
          storageWarning
            ? 'Recovery is unavailable in this browser. Leave and lose these unsaved edits?'
            : 'Leave this page? Unsaved form edits and field additions will be available to recover when you return.',
        )
      ) {
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
  }, [
    unsaved,
    operationPending,
    navigationTarget,
    storageWarning,
    unresolvedSave,
  ]);
  const edit = (next: MetadataDefinition) => {
    if (unresolvedSave || busy.current || committedNavigation.current) return;
    editEpoch.current += 1;
    setPreviewVersion((version) => version + 1);
    if (definition)
      setHistory((prior) => [...prior.slice(-19), copy(definition)]);
    setDefinition(next);
    setSaveFailed(false);
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
    setSaveFailed(false);
    setSaved(JSON.stringify(parsed ?? value));
    setDraftVersion(version);
    setDraftId(nextDraftId);
    setPublishedBaseline(publishedId);
    if (selected?.published_revision_id === publishedId)
      publishedSnapshot.current = {
        id: publishedId,
        definition: copy(selected.published_definition),
      };
    setReceipt(null);
    setSaveReview(null);
    setSavePayload(null);
    setHistory([]);
    setAdvancedJson('');
    setAdvancedError('');
    setRemoveSectionId(null);
    setAddition(null);
    resetInspector();
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
  const switchCategory = async (id: string) => {
    if (
      busy.current ||
      unresolvedSave ||
      readDesignerRecovery(memberId, categoryId).item?.uncertainSave ||
      committedNavigation.current ||
      terminalDenied.current ||
      !active.some((entry) => entry.id === id)
    )
      return;
    if (id === categoryId) {
      navigationEpoch.current += 1;
      setNavigationTarget(null);
      setMessage('');
      return;
    }
    if (
      unsaved &&
      !window.confirm('Discard unsaved edits and switch category?')
    )
      return;
    // Cancelling a newer choice must leave the earlier load valid.
    const epoch = ++navigationEpoch.current;
    const original = JSON.stringify([definition, addition]);
    setNavigationTarget(id);
    setMessage(
      'Loading selected category… Your current edits remain here until it opens.',
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const { result, identity } = await Promise.race([
        (async () => {
          const result = await fetchCategoryForm(id);
          return {
            result,
            identity: result.ok
              ? await observeRouteActionResult(
                  verifyMetadataDesignerIdentity(memberId),
                )
              : null,
          };
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), 15000);
        }),
      ]);
      if (epoch !== navigationEpoch.current || terminalDenied.current) return;
      if (!result.ok) {
        setMessage(result.message);
        setNavigationTarget(null);
        return;
      }
      if (!identity || !identity.ok) {
        if (!identity) {
          setNavigationTarget(null);
          return;
        }
        if (identity.code === 'P1001') denyIdentity();
        else setMessage(identity.message);
        setNavigationTarget(null);
        return;
      }
      if (
        original !==
          JSON.stringify([definitionRef.current, additionRef.current]) ||
        busy.current ||
        unresolvedSave ||
        readDesignerRecovery(memberId, categoryId).item?.uncertainSave
      ) {
        setMessage(
          'Your form changed while loading. Keep editing or choose the category again.',
        );
        setNavigationTarget(null);
        return;
      }
      const path = `/settings/forms/${encodeURIComponent(id)}`;
      if (unsaved) {
        if (
          !definition ||
          !writeDesignerRecovery({
            memberId,
            categoryId,
            definition,
            savedDefinition: saved,
            expectedDraftId: draftId,
            expectedDraftVersion: draftVersion,
            expectedPublishedRevisionId: publishedBaseline,
            ...(addition ? { addition } : {}),
            ...(receipt ? { receipt } : {}),
            uncertainSave: false,
            discardAfterCategoryId: id,
          })
        ) {
          setNavigationTarget(null);
          setMessage(
            'The category switch could not preserve your recovery. Keep this page open and save your edits before switching.',
          );
          return;
        }
      }
      setDiscardAfterCategoryId(unsaved ? id : undefined);
      // App Router push returns before the new keyed designer mounts. The
      // reviewed outgoing draft must stay frozen through that actual commit.
      committedNavigation.current = true;
      gesture.current = null;
      dndBaseline.current = null;
      setDraggingControlId(null);
      setNavigationCommitted(true);
      setMessage(
        'Opening selected category… Your current editor is paused until it opens.',
      );
      commitTimer.current = setTimeout(() => {
        if (epoch !== navigationEpoch.current || terminalDenied.current) return;
        releaseNavigation();
      }, 15000);
      router.push(path);
    } catch {
      if (epoch === navigationEpoch.current) {
        releaseNavigation();
      }
    } finally {
      clearTimeout(timer);
    }
  };
  const releaseNavigation = () => {
    clearTimeout(commitTimer.current);
    const stored = readDesignerRecovery(memberId, categoryId);
    if (
      committedNavigation.current &&
      (!stored.available ||
        (stored.item?.discardAfterCategoryId &&
          !writeDesignerRecovery({
            ...stored.item,
            discardAfterCategoryId: undefined,
          })))
    ) {
      setMessage(
        'The category has not opened and recovery storage is unavailable. Keep this editor open; editing is paused to protect the reviewed draft.',
      );
      return;
    }
    setDiscardAfterCategoryId(undefined);
    committedNavigation.current = false;
    setNavigationCommitted(false);
    setNavigationTarget(null);
    setMessage(
      'The selected category could not be opened. Your edits remain here. Choose it again to retry.',
    );
  };
  const additionRef = useRef(addition);
  useEffect(() => {
    additionRef.current = addition;
  }, [addition]);
  const submit = (
    operation:
      'metadata_draft_save' | 'metadata_draft_discard' | 'metadata_publish',
    payload: Record<string, unknown>,
  ) => {
    if (busy.current || unresolvedSave || committedNavigation.current) return;
    busy.current = true;
    setOperationPending(true);
    const submittedCategory = categoryId;
    const submittedSession = categorySession.current;
    const key = JSON.stringify([operation, payload]);
    const requestId = receipt?.key === key ? receipt.id : newId();
    setReceipt({ key, id: requestId });
    setMessage('');
    startTask(async () => {
      try {
        const response = await observeRouteActionResult(
          submitMetadataDraft({
            operation,
            requestId,
            expectedActorId: memberId,
            payload,
          }),
        );
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
      committedNavigation.current ||
      recovery?.uncertainSave ||
      (!uncertainSave &&
        readDesignerRecovery(memberId, categoryId).item?.uncertainSave) ||
      !definition ||
      issues.length ||
      identityStatus !== 'verified'
    )
      return;
    if (
      confirmed &&
      (!saveReview ||
        !savePayload ||
        JSON.stringify(savePayload.definition) !== JSON.stringify(definition))
    ) {
      setSaveReview(null);
      setSavePayload(null);
      setMessage(
        'The form changed. Save changes to review its current impact.',
      );
      return;
    }
    let payload =
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
    if (uncertainSave && receipt) {
      try {
        const original = JSON.parse(receipt.key);
        if (
          original[0] !== 'metadata_form_save' ||
          original[1]?.category_id !== categoryId ||
          original[1]?.expected_actor_id !== memberId
        )
          throw new Error('context');
        payload = original[1];
      } catch {
        setMessage(
          'The original save request could not be recovered. Keep this page open and contact the application owner.',
        );
        return;
      }
    }
    const key = JSON.stringify(['metadata_form_save', payload]);
    const requestId = receipt?.key === key ? receipt.id : newId();
    const wasUncertain = uncertainSave;
    const command: DesignerRecovery = JSON.parse(
      JSON.stringify({
        memberId,
        categoryId,
        definition,
        savedDefinition: saved,
        expectedDraftId: draftId,
        expectedDraftVersion: draftVersion,
        expectedPublishedRevisionId: publishedBaseline,
        receipt: { key, id: requestId },
        uncertainSave: true,
      }),
    );
    unresolvedCommand.current = command;
    if (!writeDesignerRecovery(command))
      setStorageWarning(
        'The original save is retained only while this page stays open. Browser recovery is unavailable; do not reload until its outcome is resolved.',
      );
    setReceipt({ key, id: requestId });
    setUncertainSave(true);
    busy.current = true;
    setOperationPending(true);
    setSaveFailed(false);
    setMessage('Saving…');
    const submittedSession = categorySession.current;
    const submittedEpoch = editEpoch.current;
    const submittedReview: PublicationReviewSnapshot = {
      proposal: copy(payload.definition as MetadataDefinition),
      baseline:
        publishedSnapshot.current.id ===
        String(payload.expected_published_revision_id ?? '')
          ? copy(publishedSnapshot.current.definition)
          : null,
      expectedPublishedRevisionId: String(
        payload.expected_published_revision_id ?? '',
      ),
    };
    startTask(async () => {
      try {
        const result = await observeRouteActionResult(
          saveMetadataForm({
            requestId,
            expectedActorId: memberId,
            payload,
          }),
        );
        if (
          terminalDenied.current ||
          submittedSession !== categorySession.current ||
          submittedEpoch !== editEpoch.current
        )
          return;
        if (!result.ok) {
          // P1001 is returned before replay by the action's actor check. It
          // definitively denies a first attempt, but says nothing about an
          // earlier attempt whose response was lost.
          const unresolved =
            (wasUncertain && result.code === 'P1001') ||
            (!/^P\d{4}$/.test(result.code) &&
              !/^[2345]\d{4}$/.test(result.code));
          setUncertainSave(unresolved);
          if (!unresolved) {
            unresolvedCommand.current = null;
            clearDesignerRecovery(memberId, categoryId);
          }
          if (result.code === 'P1001') denyIdentity();
          else if (result.code === 'identity_unverified')
            setIdentityStatus('retry');
          setSaveFailed(true);
          setMessage(result.message);
          if (['P1002', 'P1017'].includes(result.code)) {
            setSaveReview(null);
            setSavePayload(null);
          }
          return;
        }
        setUncertainSave(false);
        setSaveFailed(false);
        unresolvedCommand.current = null;
        clearDesignerRecovery(memberId, categoryId);
        if (result.data.status === 'confirmation_required') {
          setSaveReview(copy(result.data));
          setSavePayload(copy(payload));
          setReviewSnapshot(submittedReview);
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
        publishedSnapshot.current = {
          id: String(result.data.published_revision_id),
          definition: copy(payload.definition as MetadataDefinition),
        };
        setSaved(JSON.stringify(definition));
        setHistory([]);
        setMessage(
          `Saved active form revision ${String(result.data.version)}.`,
        );
        router.refresh();
      } catch {
        if (
          !terminalDenied.current &&
          submittedSession === categorySession.current
        )
          setMessage(
            'The save outcome could not be confirmed. Your edits remain here. Retry the same save to check its original request.',
          );
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
  const openAddition = (sectionId?: string, field?: Field) => {
    if (!definition || unresolvedSave || committedNavigation.current) return;
    setAddition({
      sectionId:
        sectionId ??
        definition.layout.find(
          (section) =>
            section.id === selectedSectionId && section.visible !== false,
        )?.id ??
        definition.layout.find((section) => section.visible !== false)?.id ??
        newId(),
      field,
    });
  };
  const selectPlacement = (controlId: string, next = definition) => {
    const section = next?.layout.find((item) =>
      item.controls.some((control) => control.id === controlId),
    );
    const control = section?.controls.find((item) => item.id === controlId);
    setSelectedControlId(controlId);
    setSelectedSectionId(section?.id ?? null);
    setSelectedFieldId(control?.field_id ?? null);
    setMobilePanel('inspector');
    scheduleDesignerFocus(() => {
      const control = document.querySelector<HTMLElement>(
        `[data-control-id="${controlId}"]`,
      );
      const canvas = control?.closest<HTMLElement>(
        '[data-testid="designer-canvas"]',
      );
      // Responsive CSS decides which destination is visible; do not duplicate its breakpoint.
      const element =
        canvas && getComputedStyle(canvas).display === 'none'
          ? document.querySelector<HTMLElement>(
              '[data-designer-inspector-heading]',
            )
          : control;
      element?.scrollIntoView?.({
        block: 'nearest',
        behavior: reducedMotion ? 'instant' : 'smooth',
      });
      element?.focus();
    });
  };
  const addField = (field: Field, sectionId: string) => {
    if (!definition || unresolvedSave || committedNavigation.current) return;
    const next = addFieldToSection(definition, field, sectionId);
    if (next === definition) return;
    edit(next);
    setAddition(null);
    const control = next.layout
      .flatMap((section) => section.controls)
      .find((item) => item.field_id === field.id)!;
    selectPlacement(control.id, next);
    setMessage(
      `Added ${fieldName(field)} to ${next.layout.find((section) => section.id === sectionId)?.label || 'Details'}.`,
    );
  };
  const removeField = (id: string) => {
    if (
      definition &&
      window.confirm(
        selected?.published_definition.fields.some((field) => field.id === id)
          ? 'Retire this field from the new revision? Earlier revisions and stored values are preserved. Save changes will review the impact.'
          : 'Discard this unpublished field and its placement from your local edits?',
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
    selectPlacement(
      control.id,
      definition
        ? {
            ...definition,
            layout: definition.layout.map((section) =>
              section.id === sectionId
                ? { ...section, controls: [...section.controls, control] }
                : section,
            ),
          }
        : definition,
    );
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
    if (
      terminalDenied.current ||
      unresolvedSave ||
      busy.current ||
      committedNavigation.current ||
      !definitionRef.current ||
      gesture.current
    )
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
    if (
      terminalDenied.current ||
      unresolvedSave ||
      busy.current ||
      committedNavigation.current ||
      !current ||
      !now
    )
      return;
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
    if (
      terminalDenied.current ||
      unresolvedSave ||
      busy.current ||
      committedNavigation.current ||
      !current
    )
      return;
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
    setDraggingControlId(null);
    const baseline = dndBaseline.current;
    dndBaseline.current = null;
    if (
      terminalDenied.current ||
      unresolvedSave ||
      busy.current ||
      committedNavigation.current ||
      !baseline
    )
      return;
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
  const selectedControlSection = definition?.layout.find((section) =>
    section.controls.some((control) => control.id === selectedControlId),
  );
  const selectedControl = selectedControlSection?.controls.find(
    (control) => control.id === selectedControlId,
  );
  const confirmSectionRemoval = () => {
    if (!definition || !removeSectionId) return;
    const next = removeSection(
      definition,
      removeSectionId,
      removeDestinationId || null,
    );
    if (next === definition) return;
    edit(next);
    setSelectedSectionId(removeDestinationId || null);
    setSelectedControlId(null);
    setSelectedFieldId(null);
    setRemoveSectionId(null);
  };
  return (
    <section
      className="min-w-0 space-y-3 rounded-lg border border-slate-700 p-3"
      onPointerDownCapture={cancelDesignerFocus}
      onKeyDownCapture={cancelDesignerFocus}
      onFocusCapture={cancelDesignerFocus}
      aria-labelledby="metadata-settings-heading"
    >
      <h2 id="metadata-settings-heading" className="sr-only">
        Forms and fields
      </h2>
      {identityStatus === 'blocked' ? (
        <div
          role="status"
          className="rounded border border-amber-700 p-3 text-sm"
        >
          Configuration access changed.{' '}
          {blockedRecovery === 'memory'
            ? 'The save outcome is still unknown and its original request is retained only in this open page. Do not reload or close it; restore the original actor’s access before retrying.'
            : blockedRecovery === 'durable'
              ? 'The save outcome is still unknown. The original request is retained for recovery and exact replay when the same actor has configuration access again.'
              : 'Refresh this page to continue.'}
          {blockedRecovery !== 'memory' && (
            <Button
              type="button"
              variant="outline"
              onClick={() => window.location.reload()}
            >
              Refresh access
            </Button>
          )}
          {blockedRecovery !== 'none' && (
            <Button
              type="button"
              variant="outline"
              disabled={operationPending}
              onClick={() => void retryDeniedAccess()}
            >
              Retry access
            </Button>
          )}
          {blockedAccessMessage && <p>{blockedAccessMessage}</p>}
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
          <div
            role="toolbar"
            aria-label="Form designer"
            className="flex flex-wrap items-center gap-2 rounded-lg border border-cyan-500/30 bg-slate-950 p-2 min-[1024px]:sticky min-[1024px]:top-20 min-[1024px]:z-10"
          >
            <label className="min-w-0 flex-1 basis-44 text-xs text-slate-400">
              Category form
              <select
                aria-label="Designer category"
                className={input}
                value={categoryId}
                disabled={editorLocked}
                onChange={(event) => switchCategory(event.target.value)}
              >
                {active.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            <span
              role="status"
              aria-label="Form save state"
              className="text-sm text-slate-300"
            >
              {operationPending
                ? 'Saving…'
                : unresolvedSave
                  ? 'Save outcome unconfirmed'
                  : saveFailed
                    ? 'Save failed · edits retained'
                    : recovery
                      ? 'Recovery available'
                      : saveReview
                        ? 'Review required'
                        : unsaved
                          ? 'Unsaved changes'
                          : draftVersion !== '0'
                            ? 'Draft awaiting publication'
                            : selected?.published_revision_id
                              ? 'Active form saved'
                              : 'Not published'}
            </span>
            {!recovery && (
              <>
                <Button
                  type="button"
                  disabled={
                    operationPending ||
                    navigationCommitted ||
                    pending ||
                    !definition ||
                    issues.length > 0 ||
                    identityStatus !== 'verified' ||
                    (!dirty && !uncertainSave && draftVersion === '0')
                  }
                  onClick={() => saveChanges()}
                >
                  {operationPending
                    ? 'Saving…'
                    : uncertainSave
                      ? 'Retry original save'
                      : 'Save changes'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={editorLocked || !definition}
                  onClick={() => {
                    previewReturn.current = {
                      focus:
                        lastEditingFocus.current ??
                        (document.activeElement as HTMLElement | null),
                      x: window.scrollX,
                      y: window.scrollY,
                      section: selectedSectionId,
                      control: selectedControlId,
                      field: selectedFieldId,
                      panel: mobilePanel,
                    };
                    if (previewDetails.current) {
                      previewDetails.current.open = true;
                      previewDetails.current.scrollIntoView?.({
                        block: 'start',
                      });
                      previewDetails.current
                        .querySelector<HTMLElement>('summary')
                        ?.focus({ preventScroll: true });
                    }
                  }}
                >
                  Preview form
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={history.length === 0 || pending || editorLocked}
                  onClick={() => {
                    if (
                      busy.current ||
                      committedNavigation.current ||
                      unresolvedSave
                    )
                      return;
                    const prior = history.at(-1);
                    if (prior) {
                      editEpoch.current += 1;
                      setDefinition(prior);
                      resetInspector();
                      setSaveReview(null);
                      setSavePayload(null);
                      setMessage('');
                      setSaveFailed(false);
                      setPreviewVersion((version) => version + 1);
                      setHistory(history.slice(0, -1));
                    }
                  }}
                >
                  Undo edit
                </Button>
              </>
            )}
            <Button
              type="button"
              variant="outline"
              ref={recoveryToolsTrigger}
              aria-haspopup="dialog"
              onClick={(event) => {
                recoveryToolsTrigger.current = event.currentTarget;
                setRecoveryToolsOpen(true);
              }}
            >
              Recovery & advanced
            </Button>
          </div>
          {message && !operationPending && (
            <p
              role="status"
              className="break-words rounded border border-slate-700 p-2 text-sm text-slate-300"
            >
              {message}
              {saveFailed && (
                <Button
                  type="button"
                  variant="outline"
                  className="ml-2"
                  onClick={(event) => {
                    recoveryToolsTrigger.current = event.currentTarget;
                    setRecoveryToolsOpen(true);
                  }}
                >
                  Review recovery options
                </Button>
              )}
            </p>
          )}
          <dialog
            ref={recoveryToolsRef}
            aria-labelledby="designer-recovery-title"
            onCancel={() => setRecoveryToolsOpen(false)}
            onClose={() => {
              setRecoveryToolsOpen(false);
              recoveryToolsTrigger.current?.focus();
            }}
            className="m-auto max-h-[calc(100dvh-2rem)] w-[min(92vw,42rem)] space-y-4 overflow-y-auto rounded-xl border border-slate-600 bg-slate-950 p-4 text-slate-100 backdrop:bg-slate-950/80"
          >
            <div className="flex items-center justify-between gap-2">
              <h3 id="designer-recovery-title" className="font-semibold">
                Recovery & advanced
              </h3>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRecoveryToolsOpen(false)}
              >
                Close recovery tools
              </Button>
            </div>
            <p className="text-sm text-slate-400">
              Published revision {selected?.published_number ?? 'unknown'}
              {draftVersion !== '0' ? ' · Legacy draft available' : ''}
            </p>
            {!recovery && (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={!dirty || pending || editorLocked}
                  onClick={() => {
                    if (committedNavigation.current || unresolvedSave) return;
                    if (window.confirm('Discard unsaved edits?')) {
                      clearDesignerRecovery(memberId, categoryId);
                      setRecovery(null);
                      setRecoveryToolsOpen(false);
                      setSaveFailed(false);
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
                  disabled={pending || editorLocked}
                  onClick={() => {
                    if (committedNavigation.current || unresolvedSave) return;
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
                    setRecoveryToolsOpen(false);
                    setSaveFailed(false);
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
              <div className="flex flex-wrap gap-2">
                {draftVersion !== '0' && (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={editorLocked || pending}
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
            {!recovery && (
              <details className="rounded border border-slate-700 p-3 text-sm">
                <summary className="cursor-pointer font-medium">
                  Advanced JSON recovery
                </summary>
                <p className="my-2 text-slate-400">
                  The visual editor is the normal way to change forms. Load the
                  current document to inspect or copy it. Pasted JSON changes
                  your local editor only after you apply it. Use Save changes to
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
                    disabled={navigationCommitted}
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
                  disabled={
                    operationPending ||
                    pending ||
                    unresolvedSave ||
                    navigationCommitted ||
                    !advancedJson.trim()
                  }
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
                    setRecoveryToolsOpen(false);
                    resetInspector();
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
          </dialog>
          {recovery && (
            <div
              role="region"
              aria-label="Recover unsaved form edits"
              className="space-y-2 rounded border border-amber-700 p-3 text-sm"
            >
              <p>
                Unsaved edits for this category were kept in this browser tab.
                {recovery.uncertainSave
                  ? 'Recover them and retry the original save to confirm its outcome. Discard and category navigation are paused until that request is resolved.'
                  : 'Choose whether to recover them. Recovery keeps the original draft version and still requires a new save and impact review.'}
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
                  disabled={navigationCommitted}
                  onClick={() => {
                    if (committedNavigation.current) return;
                    setDefinition(recovery.definition);
                    resetInspector();
                    setSaveReview(null);
                    setSavePayload(null);
                    setSelectedFieldId(
                      recovery.definition.fields[0]?.id ?? null,
                    );
                    editEpoch.current += 1;
                    setPreviewVersion((version) => version + 1);
                    setSaved(recovery.savedDefinition);
                    setDraftVersion(recovery.expectedDraftVersion);
                    setDraftId(recovery.expectedDraftId);
                    setPublishedBaseline(recovery.expectedPublishedRevisionId);
                    setReceipt(recovery.receipt ?? null);
                    unresolvedCommand.current = recovery.uncertainSave
                      ? recovery
                      : null;
                    setUncertainSave(recovery.uncertainSave ?? false);
                    setHistory([]);
                    setAddition(recovery.addition ?? null);
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
                  disabled={unresolvedSave}
                  onClick={() => {
                    if (
                      unresolvedSave ||
                      readDesignerRecovery(memberId, categoryId).item
                        ?.uncertainSave
                    )
                      return;
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
          {saveReview && !recovery && (
            <div
              role="region"
              aria-label="Form save impact"
              className="space-y-3 break-words rounded border border-amber-700 p-3 text-sm"
            >
              <p>
                Records in affected form types:{' '}
                {String(saveReview.affected_quantity)} quantity records and{' '}
                {String(saveReview.affected_assets)} individual assets.{' '}
                {String(saveReview.newly_needs_quantity)} quantity records and{' '}
                {String(saveReview.newly_needs_assets)} assets will newly need
                metadata review. Existing values are retained.
              </p>
              <ul className="list-disc pl-5">
                {Array.isArray(saveReview.reasons) &&
                  saveReview.reasons.map((reason, index) => {
                    return (
                      <li key={index}>
                        {reviewSnapshot
                          ? publicationReasonText(reason, reviewSnapshot)
                          : 'Review names are unavailable. Cancel and review again.'}
                      </li>
                    );
                  })}
              </ul>
              <p className="text-xs text-slate-400">
                Review expires at{' '}
                <OperationalTimestamp value={saveReview.expires_at} />.
              </p>
              <Button
                type="button"
                disabled={
                  operationPending ||
                  navigationCommitted ||
                  unresolvedSave ||
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
                disabled={editorLocked}
                onClick={() => {
                  if (committedNavigation.current || unresolvedSave) return;
                  setSaveReview(null);
                  setSavePayload(null);
                  setMessage('Save canceled. Your edits remain here.');
                }}
              >
                Cancel
              </Button>
            </div>
          )}
          {definition && !recovery && (
            <fieldset
              onFocusCapture={(event) => {
                if (!previewDetails.current?.contains(event.target))
                  lastEditingFocus.current = event.target as HTMLElement;
              }}
              disabled={editorLocked}
              className="min-w-0 space-y-4 lg:[&_input]:scroll-mt-56 lg:[&_button]:scroll-mt-56 lg:[&_select]:scroll-mt-56 lg:[&_textarea]:scroll-mt-56 lg:[&_[data-control-id]]:scroll-mt-56"
            >
              <nav
                className="flex flex-wrap gap-2 min-[1152px]:hidden"
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
                plugins={(defaults) =>
                  defaults.map((plugin) =>
                    plugin === Accessibility
                      ? Accessibility.configure(dragAccessibility)
                      : plugin,
                  )
                }
                onDragStart={(event) => {
                  if (
                    terminalDenied.current ||
                    unresolvedSave ||
                    busy.current ||
                    committedNavigation.current
                  )
                    return;
                  const sourceId = String(event.operation.source?.id ?? '');
                  setDraggingControlId(
                    sourceId.startsWith('control:') ? sourceId.slice(8) : null,
                  );
                  if (definitionRef.current)
                    dndBaseline.current = copy(definitionRef.current);
                }}
                onDragOver={(event) => {
                  if (
                    terminalDenied.current ||
                    unresolvedSave ||
                    busy.current ||
                    committedNavigation.current
                  )
                    return;
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
                  className="grid min-w-0 gap-4 min-[1152px]:grid-cols-[minmax(10rem,1fr)_minmax(0,2.5fr)_minmax(13rem,1fr)]"
                >
                  <div
                    data-testid="designer-library"
                    className={`${mobilePanel === 'library' ? '' : 'hidden'} min-w-0 space-y-3 min-[1152px]:block`}
                  >
                    <h3 className="font-semibold">Field library</h3>
                    <Button
                      type="button"
                      variant="outline"
                      data-designer-add-field
                      onClick={() => openAddition()}
                    >
                      Add field
                    </Button>
                    <div className="grid gap-2">
                      {definition.fields.map((field) => {
                        const parent = definition.layout.find((section) =>
                          section.controls.some(
                            (control) => control.field_id === field.id,
                          ),
                        );
                        const placed = parent?.controls.find(
                          (control) => control.field_id === field.id,
                        );
                        return (
                          <button
                            type="button"
                            key={field.id}
                            className="min-h-11 rounded border border-slate-600 p-2 text-left"
                            onClick={() => {
                              if (placed) selectPlacement(placed.id);
                              else {
                                setSelectedFieldId(field.id);
                                setSelectedControlId(null);
                                setSelectedSectionId(null);
                                setMobilePanel('inspector');
                              }
                            }}
                          >
                            {fieldName(field)} ·{' '}
                            {fieldTypeInfo[field.type].name}
                            <span className="block text-xs text-slate-400">
                              {placed
                                ? `${parent?.visible === false || placed.visible === false ? 'Hidden' : 'Shown'} in ${parent?.label || 'Untitled section'}`
                                : 'Not yet placed'}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    <RecoveryLibrary
                      definition={definition}
                      previewKind={previewKind}
                      change={edit}
                    />
                  </div>
                  <div
                    data-testid="designer-canvas"
                    className={`${mobilePanel === 'canvas' ? '' : 'hidden'} min-w-0 space-y-3 min-[1152px]:block`}
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
                        setSelectedControlId(null);
                        setSelectedFieldId(null);
                        scheduleDesignerFocus(() =>
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
                        hidden={section.visible === false}
                      >
                        {(sectionHandleRef) => (
                          <>
                            <div
                              className="flex flex-wrap gap-2"
                              onFocusCapture={() => {
                                setSelectedSectionId(section.id);
                                setSelectedControlId(null);
                                setSelectedFieldId(null);
                              }}
                            >
                              <button
                                type="button"
                                aria-label={`Drag section ${section.label}`}
                                ref={sectionHandleRef}
                                className="min-h-11 min-w-11 cursor-grab touch-none rounded border"
                              >
                                ⋮⋮
                              </button>
                              <label
                                className="min-w-40 flex-1 text-sm"
                                onFocus={() => {
                                  setSelectedSectionId(section.id);
                                  setSelectedControlId(null);
                                  setSelectedFieldId(null);
                                }}
                              >
                                Section heading
                                {section.visible === false ? ' · Hidden' : ''}
                                <input
                                  aria-label="Section heading"
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
                                      disabled={
                                        sectionHasProtectedControls(section) ||
                                        Boolean(
                                          sectionEditBlockReason(
                                            definition,
                                            section.id,
                                            { visible: false },
                                          ),
                                        )
                                      }
                                      onChange={(event) => {
                                        const reason = sectionEditBlockReason(
                                          definition,
                                          section.id,
                                          { visible: event.target.checked },
                                        );
                                        if (reason) {
                                          setMessage(reason);
                                          return;
                                        }
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
                                        });
                                      }}
                                    />{' '}
                                    Show section
                                  </label>
                                  {sectionEditBlockReason(
                                    definition,
                                    section.id,
                                    { visible: false },
                                  ) && (
                                    <p className="text-xs text-amber-200">
                                      {sectionEditBlockReason(
                                        definition,
                                        section.id,
                                        { visible: false },
                                      )}
                                    </p>
                                  )}
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
                                    onChange={(event) => {
                                      const kinds = event.target.value.split(
                                        ',',
                                      ) as Field['applies_to'];
                                      const reason = sectionEditBlockReason(
                                        definition,
                                        section.id,
                                        { applies_to: kinds },
                                      );
                                      if (reason) {
                                        setMessage(reason);
                                        return;
                                      }
                                      edit({
                                        ...definition,
                                        layout: definition.layout.map((item) =>
                                          item.id === section.id
                                            ? { ...item, applies_to: kinds }
                                            : item,
                                        ),
                                      });
                                    }}
                                  >
                                    <option value="quantity,asset">Both</option>
                                    <option value="quantity">
                                      Quantity items
                                    </option>
                                    <option value="asset">
                                      Individual assets
                                    </option>
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
                                    disabled={definition.layout.length === 1}
                                    onClick={() => {
                                      setRemoveSectionId(section.id);
                                      setRemoveDestinationId(
                                        definition.layout.find(
                                          (item) =>
                                            item.id !== section.id &&
                                            removeSection(
                                              definition,
                                              section.id,
                                              item.id,
                                            ) !== definition,
                                        )?.id ?? '',
                                      );
                                    }}
                                  >
                                    Remove section
                                  </Button>
                                </div>
                              </details>
                            </div>
                            <SectionDropArea
                              id={section.id}
                              definition={definition}
                              draggingControlId={draggingControlId}
                            >
                              {section.controls.map((control, index) => {
                                const field = definition.fields.find(
                                  (item) => item.id === control.field_id,
                                );
                                const name =
                                  control.kind === 'field'
                                    ? fieldName(field)
                                    : control.kind === 'builtin'
                                      ? builtinLabel(control.builtin ?? '')
                                      : 'Instructions';
                                return (
                                  <SortableControl
                                    key={control.id}
                                    id={control.id}
                                    name={name}
                                    index={index}
                                    sectionId={section.id}
                                    selected={selectedControlId === control.id}
                                    hidden={
                                      section.visible === false ||
                                      control.visible === false
                                    }
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
                                    canReceive={(sourceId) =>
                                      controlMoveBlockReason(
                                        definition,
                                        sourceId,
                                        section.id,
                                      ) === null
                                    }
                                  >
                                    {(controlHandleRef) => (
                                      <>
                                        <div className="min-w-0 space-y-2">
                                          <div className="flex min-w-0 items-start justify-between gap-2">
                                            <span
                                              data-testid="designer-control-name"
                                              aria-hidden={Boolean(field)}
                                              className={`${field ? 'sr-only' : ''} block min-w-0 break-words font-medium [overflow-wrap:anywhere]`}
                                            >
                                              {field ? null : name}
                                              {!field &&
                                              ['name', 'category_id'].includes(
                                                control.builtin ?? '',
                                              )
                                                ? ' *'
                                                : ''}
                                              {section.visible === false ||
                                              control.visible === false
                                                ? ' · Hidden'
                                                : ''}
                                            </span>
                                            <span
                                              title="Form types using this field"
                                              className="shrink-0 text-xs text-slate-400"
                                            >
                                              {kindLabel(
                                                controlKinds(
                                                  definition,
                                                  section,
                                                  control,
                                                ),
                                              )}
                                            </span>
                                          </div>
                                          <ControlShape
                                            control={control}
                                            field={field}
                                            categoryName={
                                              categories.find(
                                                (item) =>
                                                  item.id === categoryId,
                                              )?.name ?? 'Choose category'
                                            }
                                          />
                                          <div
                                            className={styles.controlActions}
                                          >
                                            <button
                                              type="button"
                                              aria-label={`Drag ${name}`}
                                              ref={controlHandleRef}
                                              title="Drag to reorder"
                                              className={`${styles.controlAction} min-h-11 min-w-11 cursor-grab touch-none select-none rounded border px-2 py-1`}
                                            >
                                              ⋮⋮
                                            </button>
                                            <button
                                              type="button"
                                              aria-label={`Resize ${name}`}
                                              title="Drag to snap width; width selector is also available"
                                              className={`${styles.controlAction} min-h-11 min-w-11 cursor-ew-resize touch-none select-none rounded border border-slate-600 px-2 text-xs text-cyan-200`}
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
                                onClick={() => openAddition(section.id)}
                              >
                                Add field to {section.label || 'section'}
                              </Button>
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
                                Add instructions
                              </Button>
                            </div>
                          </>
                        )}
                      </SortableSection>
                    ))}
                  </div>
                  <aside
                    data-testid="designer-inspector"
                    className={`${mobilePanel === 'inspector' ? '' : 'hidden'} min-w-0 space-y-3 min-[1152px]:block`}
                    aria-label="Designer inspector"
                  >
                    <h3
                      data-designer-inspector-heading
                      tabIndex={-1}
                      className="font-semibold"
                    >
                      Inspector
                    </h3>
                    {selectedField ? (
                      <section
                        aria-label={`${fieldName(selectedField)} field settings`}
                        className="rounded-lg border border-cyan-800 p-3"
                      >
                        <h3 className="mb-3 min-w-0 font-semibold [overflow-wrap:anywhere]">
                          {fieldName(selectedField)} ·{' '}
                          {fieldTypeInfo[selectedField.type].name}
                        </h3>
                        <FieldSettings
                          key={`${selectedField.id}:${inspectorRevision}`}
                          field={selectedField}
                          autoFocus={false}
                          revisionOptionCount={definition.fields.reduce(
                            (total, field) => total + field.options.length,
                            0,
                          )}
                          change={updateField}
                          published={Boolean(
                            selected?.published_definition.fields.some(
                              (item) => item.id === selectedField.id,
                            ),
                          )}
                          onValidityChange={(message) =>
                            setConfigErrors((prior) => ({
                              ...prior,
                              [selectedField.id]: message,
                            }))
                          }
                          basics={
                            <>
                              <label className="block text-sm">
                                Show on
                                <select
                                  className={input}
                                  value={(selectedControl &&
                                  selectedControlSection
                                    ? controlKinds(
                                        definition,
                                        selectedControlSection,
                                        selectedControl,
                                      )
                                    : selectedField.applies_to
                                  ).join(',')}
                                  onChange={(event) => {
                                    const kinds = event.target.value.split(
                                      ',',
                                    ) as Field['applies_to'];
                                    const reason = scopeRestriction(
                                      definition,
                                      selectedField,
                                      kinds,
                                    );
                                    setScopeMessage(reason ?? '');
                                    if (!reason)
                                      updateField({
                                        ...selectedField,
                                        applies_to: kinds,
                                      });
                                  }}
                                >
                                  <option value="quantity,asset">Both</option>
                                  <option value="quantity">
                                    Quantity items
                                  </option>
                                  <option value="asset">
                                    Individual assets
                                  </option>
                                  {selectedControl &&
                                    selectedControlSection &&
                                    !controlKinds(
                                      definition,
                                      selectedControlSection,
                                      selectedControl,
                                    ).length && (
                                      <option value="" disabled>
                                        No form type
                                      </option>
                                    )}
                                </select>
                              </label>
                              {scopeMessage && (
                                <p
                                  role="status"
                                  className="text-sm text-amber-200"
                                >
                                  {scopeMessage}
                                </p>
                              )}
                            </>
                          }
                          appearance={
                            selectedControl && selectedControlSection ? (
                              <ControlProperties
                                definition={definition}
                                section={selectedControlSection}
                                control={selectedControl}
                                updateControl={updateControl}
                                move={move}
                                edit={edit}
                                appearanceOnly
                              />
                            ) : (
                              <>
                                <p className="text-sm">
                                  This field is not yet placed. Add it through
                                  Use existing field.
                                </p>
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={() => openAddition()}
                                >
                                  Add existing field to form
                                </Button>
                              </>
                            )
                          }
                          advanced={
                            <>
                              <FieldAdvanced
                                field={selectedField}
                                published={Boolean(
                                  selected?.published_definition.fields.some(
                                    (item) => item.id === selectedField.id,
                                  ),
                                )}
                                replace={(type) =>
                                  openAddition(
                                    selectedControlSection?.id,
                                    makeField(
                                      type,
                                      `${fieldName(selectedField)} replacement`,
                                    ),
                                  )
                                }
                                retire={() => removeField(selectedField.id)}
                              />
                              {selectedControl && (
                                <p className="break-all text-xs text-slate-400">
                                  Placement ID: {selectedControl.id}. Placement
                                  scope:{' '}
                                  {selectedControl.applies_to?.join(', ') ||
                                    'Both'}
                                  .
                                </p>
                              )}
                            </>
                          }
                        />
                      </section>
                    ) : selectedControl && selectedControlSection ? (
                      <ControlProperties
                        definition={definition}
                        section={selectedControlSection}
                        control={selectedControl}
                        updateControl={updateControl}
                        move={move}
                        edit={edit}
                      />
                    ) : (
                      <p className="text-sm text-slate-400">
                        {selectedSectionId
                          ? `Section ${definition.layout.find((section) => section.id === selectedSectionId)?.label}. Choose a field to inspect its settings.`
                          : 'Select a field to inspect its settings. Section settings are on the canvas.'}
                      </p>
                    )}
                  </aside>
                </div>
                <DragOverlay dropAnimation={null}>
                  {(source) => (
                    <motion.div
                      initial={
                        reducedMotion ? false : { opacity: 0.88, scale: 0.96 }
                      }
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: reducedMotion ? 0 : 0.14 }}
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
                                : 'Instructions';
                          })()}
                    </motion.div>
                  )}
                </DragOverlay>
              </DragDropProvider>
              <dialog
                ref={removeDialogRef}
                aria-labelledby="remove-section-title"
                onCancel={() => setRemoveSectionId(null)}
                className="w-[min(92vw,34rem)] rounded-xl border border-cyan-500/40 bg-slate-950 p-5 text-slate-100 shadow-2xl backdrop:bg-slate-950/80"
              >
                {removeSectionId &&
                  (() => {
                    const section = definition.layout.find(
                      (item) => item.id === removeSectionId,
                    );
                    if (!section) return null;
                    const destinations = definition.layout.filter(
                      (item) => item.id !== section.id,
                    );
                    const valid = destinations.filter(
                      (item) =>
                        removeSection(definition, section.id, item.id) !==
                        definition,
                    );
                    const canUnplace =
                      removeSection(definition, section.id, null) !==
                      definition;
                    return (
                      <div className="space-y-4">
                        <h3
                          id="remove-section-title"
                          className="min-w-0 text-lg font-semibold [overflow-wrap:anywhere]"
                        >
                          Remove {section.label || 'Untitled section'}?
                        </h3>
                        <p className="text-sm text-slate-300">
                          Choose where its {section.controls.length} fields go.
                          Duplicate section names are distinguished by ID.
                          Definitions and stored values stay intact. You can
                          undo this edit.
                        </p>
                        {section.controls.some(
                          (control) =>
                            control.kind === 'builtin' &&
                            ['name', 'category_id', 'asset_tag'].includes(
                              control.builtin ?? '',
                            ),
                        ) && (
                          <p className="text-sm text-amber-200">
                            Protected standard fields must move to a visible
                            section that keeps them available to the correct
                            form type.
                          </p>
                        )}
                        <label className="block space-y-2 text-sm">
                          Destination
                          <select
                            className={input}
                            value={removeDestinationId}
                            onChange={(event) =>
                              setRemoveDestinationId(event.target.value)
                            }
                          >
                            {valid.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.label || 'Untitled section'} ·{' '}
                                {item.id.slice(-8)}
                              </option>
                            ))}
                            {canUnplace && (
                              <option value="">
                                Unplace fields; keep definitions and values
                              </option>
                            )}
                          </select>
                        </label>
                        {!valid.length && !canUnplace && (
                          <p role="alert" className="text-sm text-amber-200">
                            No valid destination preserves required and
                            protected standard fields. Add or restore a
                            compatible section first.
                          </p>
                        )}
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            disabled={
                              !(
                                valid.some(
                                  (item) => item.id === removeDestinationId,
                                ) ||
                                (canUnplace && removeDestinationId === '')
                              )
                            }
                            onClick={confirmSectionRemoval}
                          >
                            Remove section
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setRemoveSectionId(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    );
                  })()}
              </dialog>
              {addition && (
                <AddFieldDialog
                  definition={
                    definition.layout.length
                      ? definition
                      : {
                          ...definition,
                          layout: [
                            {
                              id: addition.sectionId,
                              label: 'Details',
                              controls: [],
                            },
                          ],
                        }
                  }
                  sectionId={addition.sectionId}
                  initialField={addition.field}
                  initialTab={addition.tab}
                  onDraftChange={stageAddition}
                  initialDateTimeDraft={addition.datetimeDraft}
                  onRestoreFocus={restoreAdditionFocus}
                  onCancel={() => {
                    if (!committedNavigation.current) setAddition(null);
                  }}
                  onAdd={addField}
                  onChange={edit}
                  onGo={(id, next) => selectPlacement(id, next ?? definition)}
                />
              )}
              <details
                ref={previewDetails}
                className="rounded-xl border border-slate-700 bg-slate-950/30"
              >
                <summary className="min-h-11 cursor-pointer px-3 py-2 font-semibold text-cyan-100">
                  Try form · quantity items or individual assets
                </summary>
                <div className="space-y-3 pt-3">
                  <p className="px-3 text-sm text-slate-400">
                    Temporary preview answers test this draft only. They do not
                    change Starts with defaults or save inventory.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const prior = previewReturn.current;
                      if (previewDetails.current)
                        previewDetails.current.open = false;
                      if (!prior) {
                        previewDetails.current
                          ?.querySelector<HTMLElement>('summary')
                          ?.focus();
                        return;
                      }
                      setSelectedSectionId(prior.section);
                      setSelectedControlId(prior.control);
                      setSelectedFieldId(prior.field);
                      setMobilePanel(prior.panel);
                      requestAnimationFrame(() => {
                        window.scrollTo(prior.x, prior.y);
                        if (prior.focus?.isConnected)
                          prior.focus.focus({ preventScroll: true });
                      });
                      previewReturn.current = null;
                    }}
                  >
                    Back to editing
                  </Button>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant={
                        previewKind === 'quantity' ? 'default' : 'outline'
                      }
                      onClick={() => setPreviewKind('quantity')}
                    >
                      Quantity item
                    </Button>
                    <Button
                      type="button"
                      variant={previewKind === 'asset' ? 'default' : 'outline'}
                      onClick={() => setPreviewKind('asset')}
                    >
                      Individual asset
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
            </fieldset>
          )}
        </>
      )}
    </section>
  );
}
