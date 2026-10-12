'use client';

import { useRef, type ComponentProps } from 'react';
import { useRouteRouter } from './route-pending';

/** Progressive GET only. Unsupported/overridden native submissions stay native. */
export default function RouteGetForm({
  action,
  onSubmit,
  onClickCapture,
  children,
  ...props
}: Omit<ComponentProps<'form'>, 'action' | 'method'> & { action: string }) {
  const router = useRouteRouter();
  const modified = useRef(false);
  return (
    <form
      {...props}
      action={action}
      method="get"
      onClickCapture={(event) => {
        onClickCapture?.(event);
        modified.current =
          event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
        queueMicrotask(() => {
          modified.current = false;
        });
      }}
      onSubmit={(event) => {
        onSubmit?.(event);
        if (event.defaultPrevented || modified.current) return;
        const form = event.currentTarget;
        const submitter = (event.nativeEvent as SubmitEvent).submitter;
        if (form.target && form.target !== '_self') return;
        if (
          submitter &&
          ['formaction', 'formmethod', 'formenctype', 'formtarget'].some(
            (attribute) => submitter.hasAttribute(attribute),
          )
        )
          return;
        const destination = new URL(action, location.href);
        if (
          destination.origin !== location.origin ||
          !['http:', 'https:'].includes(destination.protocol)
        )
          return;
        let data: FormData;
        try {
          data = new FormData(form, submitter);
        } catch {
          return;
        }
        destination.search = '';
        for (const [name, value] of data)
          destination.searchParams.append(
            name,
            typeof value === 'string' ? value : value.name,
          );
        event.preventDefault();
        router.push(
          destination.pathname + destination.search + destination.hash,
        );
      }}
    >
      {children}
    </form>
  );
}
