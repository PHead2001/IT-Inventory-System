'use client';
import { useLayoutEffect, useRef, useState } from 'react';

export type FieldIssue = { id: string; label: string; message: string };

export function RequiredMark() {
  return (
    <span aria-hidden="true" className="text-cyan-200">
      {' '}
      *
    </span>
  );
}

function focusField(id: string) {
  const target = document.getElementById(id);
  const control = target?.matches('input, select, textarea, button, [tabindex]')
    ? target
    : target?.querySelector<HTMLElement>(
        'input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled)',
      );
  (control as HTMLElement | null)?.focus();
}

/** Retain native constraints, add domain/schema issues, and never change values. */
export function useFormValidation(additionalIssues?: () => FieldIssue[]) {
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const [attempted, setAttempted] = useState(false);
  const activeForm = useRef<HTMLFormElement | null>(null);
  const collect = (form: HTMLFormElement, additional: FieldIssue[] = []) => {
    const next = new Map<string, FieldIssue>();
    for (const element of Array.from(form.elements)) {
      if (
        !(
          element instanceof HTMLInputElement ||
          element instanceof HTMLSelectElement ||
          element instanceof HTMLTextAreaElement
        ) ||
        !element.willValidate ||
        !element.id
      )
        continue;
      const label = (
        element.getAttribute('aria-label') ||
        element.labels?.[0]?.textContent?.replace(/\s*\*\s*$/, '').trim() ||
        element.name ||
        'This field'
      )
        .replace(/\s*\((?:required|optional)\)\s*$/i, '')
        .trim();
      const missing =
        element.required &&
        element.type !== 'checkbox' &&
        !element.value.trim();
      if (element.validity.valid && !missing) continue;
      const validity = element.validity;
      const message =
        missing || validity.valueMissing
          ? `Enter a value for ${label}.`
          : validity.rangeUnderflow
            ? `Enter at least ${element.getAttribute('min')}.`
            : validity.rangeOverflow
              ? `Enter no more than ${element.getAttribute('max')}.`
              : validity.stepMismatch
                ? 'Enter a whole number of units.'
                : validity.patternMismatch
                  ? `Use the required format for ${label}.`
                  : validity.typeMismatch || validity.badInput
                    ? `Enter a valid value for ${label}.`
                    : element.validationMessage;
      next.set(element.id, { id: element.id, label, message });
    }
    for (const issue of additional)
      if (issue.message) next.set(issue.id, issue);
    const ordered = [...next.values()].sort((a, b) => {
      const left = document.getElementById(a.id);
      const right = document.getElementById(b.id);
      if (!left || !right) return 0;
      return left.compareDocumentPosition(right) &
        Node.DOCUMENT_POSITION_FOLLOWING
        ? -1
        : 1;
    });
    return ordered;
  };
  const revalidate = (form = activeForm.current) => {
    if (!attempted || !form) return;
    const next = collect(form, additionalIssues?.() ?? []);
    if (JSON.stringify(next) !== JSON.stringify(issues)) setIssues(next);
  };
  // Controlled domain values and native validity must describe the same render.
  useLayoutEffect(() => revalidate());
  const validate = (form: HTMLFormElement, additional?: FieldIssue[]) => {
    activeForm.current = form;
    const ordered = collect(form, additional ?? additionalIssues?.() ?? []);
    setAttempted(true);
    setIssues(ordered);
    if (ordered[0]) focusField(ordered[0].id);
    return ordered.length === 0;
  };
  const props = (id: string, describedBy?: string) => ({
    'aria-invalid': issues.some((issue) => issue.id === id) || undefined,
    'aria-describedby':
      [
        describedBy,
        issues.some((issue) => issue.id === id) ? id + '-validation-error' : '',
      ]
        .filter(Boolean)
        .join(' ') || undefined,
  });
  const error = (id: string) => {
    const issue = issues.find((value) => value.id === id);
    return issue ? (
      <p
        id={id + '-validation-error'}
        className="break-words text-sm text-amber-200"
      >
        {issue.message}
      </p>
    ) : null;
  };
  return {
    validate,
    props,
    error,
    issues,
    attempted,
    formProps: {
      onChange: (event: React.FormEvent<HTMLFormElement>) =>
        revalidate(event.currentTarget),
      onBlur: (event: React.FocusEvent<HTMLFormElement>) =>
        revalidate(event.currentTarget),
    },
    clear: () => {
      setIssues([]);
      setAttempted(false);
      activeForm.current = null;
    },
  };
}

export function ValidationSummary({ issues }: { issues: FieldIssue[] }) {
  if (!issues.length) return null;
  return (
    <div
      role="alert"
      aria-live="polite"
      className="space-y-2 rounded border border-amber-700 p-3 text-sm text-amber-100"
    >
      <p>
        {issues.length === 1
          ? 'Correct the highlighted field before continuing.'
          : 'Correct the highlighted fields before continuing.'}
      </p>
      {issues.length > 0 && (
        <ul>
          {issues.map((issue) => (
            <li key={issue.id}>
              <a
                className="underline"
                href={'#' + issue.id}
                onClick={(event) => {
                  event.preventDefault();
                  focusField(issue.id);
                }}
              >
                {issue.label}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
