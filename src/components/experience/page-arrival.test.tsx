import { fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { PageArrival } from './page-arrival';

const route = vi.hoisted(() => ({
  pathname: '/dashboard',
  enabled: true,
  boundaries: [] as Array<{
    enter: string;
    exit: string;
    update?: string;
    default: string;
  }>,
}));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));
vi.mock('./route-motion', () => ({
  useRouteMotion: () => ({ enabled: route.enabled, cancelIfInvalid: vi.fn() }),
}));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    ViewTransition: (props: import('react').ViewTransitionProps) => {
      route.boundaries.push(props as (typeof route.boundaries)[number]);
      return props.children;
    },
  };
});
let mounts = 0;
function PersistentForm() {
  useEffect(() => {
    mounts += 1;
  }, []);
  return <input aria-label="Unsaved note" defaultValue="retain me" />;
}
beforeEach(() => {
  mounts = 0;
  route.pathname = '/dashboard';
  route.enabled = true;
  route.boundaries = [];
});

it('leaves the commit to React and preserves drafts on query/refresh updates', () => {
  const animate = vi.fn();
  Element.prototype.animate = animate;
  const { rerender } = render(
    <PageArrival>
      <PersistentForm />
    </PageArrival>,
  );
  const input = screen.getByRole('textbox', { name: 'Unsaved note' });
  fireEvent.change(input, { target: { value: 'draft' } });
  rerender(
    <PageArrival>
      <PersistentForm />
    </PageArrival>,
  );
  expect(input).toHaveValue('draft');
  expect(mounts).toBe(1);
  expect(animate).not.toHaveBeenCalled();
  expect(route.boundaries.at(-1)).toMatchObject({
    default: 'none',
    enter: 'route-content',
    exit: 'route-content',
  });
  expect(route.boundaries.at(-1)?.update).toBeUndefined();
  delete (Element.prototype as Partial<Element>).animate;
});

it.each([
  ['/room', true],
  ['/inventory', false],
] as const)(
  'omits the whole snapshot on %s when enabled=%s',
  (pathname, enabled) => {
    route.pathname = pathname;
    route.enabled = enabled;
    render(
      <PageArrival>
        <p>Live content</p>
      </PageArrival>,
    );
    expect(route.boundaries.at(-1)).toMatchObject({
      default: 'none',
      enter: 'none',
      exit: 'none',
    });
    expect(screen.getByText('Live content')).toBeVisible();
  },
);
