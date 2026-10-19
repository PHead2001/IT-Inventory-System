import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { DetailTasks } from './detail-tasks';
import { createAuxiliaryRouteCapture } from '@/components/experience/auxiliary-route-capture';
import { AuxiliaryRouteCaptureContext } from '@/components/experience/auxiliary-route-context';
import { InventoryCaptureRegionsContext } from '@/components/experience/inventory-capture-region';
import { RouteContentIdentityContext } from '@/components/experience/route-content-identity';
import { RoutePresentationSourceContext } from '@/components/experience/route-presentation-source';
import type { MetadataForm } from '@/features/metadata/contracts';

const actions = vi.hoisted(() => ({ submit: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('../actions', () => ({
  submitInventory: actions.submit,
  findDuplicateSerials: vi.fn(),
}));
vi.mock('../asset-tag.actions', () => ({
  checkAssetTag: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/features/custody/actions', () => ({ submitCustody: vi.fn() }));
vi.mock('@/features/metadata/form-fetch.actions', () => ({
  fetchCategoryForm: vi.fn(),
}));
vi.mock('@/features/metadata/record-refresh.actions', () => ({
  refreshMetadataRecord: vi.fn(),
}));
vi.mock('@/features/custody/custody-change-form', () => ({
  CustodyChangeForm: () => null,
}));
vi.mock('@/components/experience/route-motion', () => ({
  useRouteMotion: () => ({ validNow: () => true, captureAvailable: true }),
}));

const categoryId = '00000000-0000-4000-8000-000000000002';
const item = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Cable',
  description: null,
  categoryId,
  categoryName: 'Cables',
  manufacturer: null,
  model: null,
  version: 1,
  archived: false,
  itemCode: null,
  reorderThreshold: null,
};
const form: MetadataForm = {
  category_id: categoryId,
  published_revision_id: '00000000-0000-4000-8000-000000000003',
  published_number: '1',
  draft_id: null,
  draft_version: null,
  draft_definition: null,
  published_definition: {
    fields: [],
    layout: [
      {
        id: '00000000-0000-4000-8000-000000000004',
        label: 'Details',
        controls: [
          {
            id: '00000000-0000-4000-8000-000000000005',
            kind: 'builtin',
            builtin: 'name',
            width: 12,
          },
        ],
      },
    ],
  },
};
const path = '/inventory/quantity/' + item.id;

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

it.each([
  {
    region: 'task-metadata',
    launch: 'Edit details',
    formName: 'Edit quantity metadata',
  },
  {
    region: 'task-archive',
    launch: 'Archive quantity item and clear stock',
    formName: 'Archive quantity item and clear stock',
  },
] as const)(
  'registers the real nested $region form inside a stable DOM capture root',
  ({ region, launch, formName }) => {
    const registry = createAuxiliaryRouteCapture();
    const register = vi.spyOn(registry, 'register');
    const source = Symbol();
    const fixture = (enabled: boolean) => (
      <AuxiliaryRouteCaptureContext value={registry}>
        <InventoryCaptureRegionsContext
          value={{ enabled, pairedInventory: true, conventionalPrimary: true }}
        >
          <RoutePresentationSourceContext value={source}>
            <RouteContentIdentityContext
              value={{ pathname: path, listHref: path, rawRouteKey: path }}
            >
              <DetailTasks
                actorId="actor"
                canManageConfiguration={false}
                item={item}
                categories={[{ id: categoryId, name: 'Cables', active: true }]}
                locations={[]}
                sites={[]}
                forms={{ [categoryId]: form }}
                archiveReview={{
                  item_id: item.id,
                  version: '1',
                  archived: false,
                  removed_total: '0',
                  locations: [],
                }}
              />
            </RouteContentIdentityContext>
          </RoutePresentationSourceContext>
        </InventoryCaptureRegionsContext>
      </AuxiliaryRouteCaptureContext>
    );
    const page = render(fixture(true));
    if (region === 'task-archive')
      fireEvent.click(screen.getByText('Retire or archive'));
    fireEvent.click(screen.getByRole('button', { name: launch }));
    const actualForm = screen.getByRole('form', { name: formName });
    expect(actualForm).toBeVisible();
    const participant = register.mock.calls.findLast(
      ([entry]) => entry.region === region,
    )?.[0];
    expect(participant).toBeDefined();
    const root = participant!.root;
    expect(root.tagName).toBe('DIV');
    expect(actualForm.parentElement).toBe(root);
    expect(root).toContainElement(actualForm);
    expect(root.querySelector('canvas')).toBeNull();
    expect(participant!.routeKey).toBe(path);
    expect(participant!.source).toBe(source);
    expect(participant!.current()).toBe(true);
    expect(
      register.mock.calls.some(
        ([entry]) =>
          entry.region === 'task-close' && entry.root.tagName === 'BUTTON',
      ),
    ).toBe(true);

    // Capture capability changes must withdraw eligibility without replacing a
    // real form or losing its draft; neither task submits just by being captured.
    const input =
      region === 'task-metadata'
        ? screen.getByRole('textbox', { name: 'Name' })
        : screen.getByRole('textbox', { name: 'Reason (required)' });
    fireEvent.change(input, { target: { value: 'Retained task draft' } });
    page.rerender(fixture(false));
    expect(participant!.current()).toBe(false);
    expect(screen.getByRole('form', { name: formName })).toBe(actualForm);
    expect(input).toHaveValue('Retained task draft');
    expect(actions.submit).not.toHaveBeenCalled();
  },
);
