'use client';
import { InventoryCaptureGroup } from '@/components/experience/inventory-capture-region';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
  AssetItem,
  CategoryRef,
  LocationRef,
  QuantityItem,
} from '../contracts-ui';
import type { QuantityArchiveReview } from '../queries.server';
import type { Site, SiteHolding } from '@/features/custody/queries.server';
import type { AssetReturnSuggestion } from '@/features/custody/return-suggestion';
import type { MetadataForm as Form } from '@/features/metadata/contracts';
import { MetadataForm } from '@/features/metadata/metadata-form';
import { CustodyChangeForm } from '@/features/custody/custody-change-form';
import { MutationForm } from './mutation-form';
import { ArchiveQuantityForm } from './archive-quantity-form';
import { TaskWorkspace, type TaskChoice } from './task-workspace';
export function DetailTasks(props: {
  actorId: string;
  backendScope?: string;
  canManageConfiguration: boolean;
  item?: QuantityItem;
  asset?: AssetItem;
  currentLocation?: LocationRef | null;
  currentSite?: Site | null;
  balances?: { location: LocationRef; quantity: number }[];
  siteHoldings?: SiteHolding[];
  categories: CategoryRef[];
  locations: LocationRef[];
  sites: Site[];
  forms: Record<string, Form>;
  archiveReview?: QuantityArchiveReview | null;
  returnSuggestion?: AssetReturnSuggestion;
  returnSuggestionError?: boolean;
}) {
  const router = useRouter();
  const [lastArchiveReview, setLastArchiveReview] = useState(
    props.archiveReview,
  );
  if (props.archiveReview && props.archiveReview !== lastArchiveReview)
    setLastArchiveReview(props.archiveReview);
  const { item, asset, balances = [], siteHoldings = [] } = props;
  const entity = item ?? asset!;
  const quantity = Boolean(item);
  const choices: TaskChoice[] = [];
  const add = (
    id: string,
    label: string,
    group?: TaskChoice['group'],
    description?: string,
  ) => choices.push({ id, label, group, description });
  if (!item?.archived) add('metadata', 'Edit details');
  if (item) {
    if (item.archived)
      add('quantity_restore', 'Restore quantity item', 'consequential');
    else {
      add('quantity_receive', 'Receive stock');
      if (balances.some((balance) => balance.quantity > 0)) {
        add('quantity_move', 'Move stock');
        add('custody:issue', 'Issue stock to a site');
      }
      add(
        'quantity_adjust',
        'Correct physical count',
        'secondary',
        'Correct the recorded storage quantity to the count you observed, without moving stock between locations.',
      );
      if (siteHoldings.length) {
        add('custody:return', 'Return to storage');
        add('custody:transfer', 'Transfer between sites');
        add(
          'custody:correct',
          'Correct recorded site holding',
          'secondary',
          'Correct the recorded quantity already at a site, without issuing, returning or transferring stock.',
        );
        add('custody:write_off', 'Write off at site', 'consequential');
      }
      add(
        'custody:opening',
        'Record existing site holding',
        'secondary',
        'Use for equipment already at a site, without inventing an earlier closet issue.',
      );
      if (props.archiveReview && !siteHoldings.length)
        add(
          'archive',
          'Archive quantity item and clear stock',
          'consequential',
          'Clears all recorded storage stock; restore does not recreate cleared stock.',
        );
    }
  } else if (asset!.status === 'retired')
    add('asset_restore', 'Restore individual asset', 'consequential');
  else if (props.currentSite) {
    add('custody:return', 'Return to storage');
    add('custody:transfer', 'Transfer between sites');
    add(
      'custody:correct',
      'Correct recorded site custody',
      'secondary',
      'Correct which site is recorded for this asset, without physically transferring equipment.',
    );
    add(
      'custody:write_off',
      'Write off at site',
      'consequential',
      'Record loss or write-off and close this asset’s active site custody. A reason is required.',
    );
    add(
      'custody:retire',
      'Retire asset at site',
      'consequential',
      'Record the end of this asset’s service and close its active site custody. A reason is required.',
    );
  } else {
    add(
      'asset_move',
      'Move asset',
      undefined,
      'Physically relocate this asset to another storage location.',
    );
    add('custody:assign', 'Assign asset to a site');
    add(
      'asset_correct_location',
      'Correct recorded location',
      'secondary',
      'Update the recorded location without physically moving equipment.',
    );
    add('asset_retire', 'Retire asset', 'consequential');
  }
  return (
    <TaskWorkspace
      choices={choices}
      recordVersion={entity.version}
      onRefresh={() => router.refresh()}
      context={
        <div className="text-sm">
          <p className="font-semibold break-words">
            This item · {quantity ? 'Quantity item' : 'Individual asset'}
          </p>
          {item ? (
            <p>
              Storage holdings:{' '}
              {balances
                .filter((row) => row.quantity > 0)
                .map((row) => `${row.location.breadcrumb}: ${row.quantity}`)
                .join('; ') || 'No positive stock'}
            </p>
          ) : (
            <p>
              {asset!.status === 'retired'
                ? 'Last recorded custody'
                : 'Current custody'}
              :{' '}
              {props.currentSite?.name ??
                props.currentLocation?.breadcrumb ??
                'No recorded assignment'}
            </p>
          )}
          {item && siteHoldings.length > 0 && (
            <p className="mt-2 text-amber-100">
              Archive is blocked while site holdings remain. Return, transfer,
              or write off outstanding assignments first.
            </p>
          )}
        </div>
      }
    >
      {(selected) => {
        if (selected === 'metadata')
          return (
            <InventoryCaptureGroup region="task-metadata">
              <MetadataForm
                actorId={props.actorId}
                recoveryBackend={props.backendScope}
                kind={quantity ? 'quantity' : 'asset'}
                item={item}
                asset={asset}
                categories={props.categories}
                locations={props.locations}
                forms={props.forms}
              />
            </InventoryCaptureGroup>
          );
        if (selected === 'archive')
          return (
            <InventoryCaptureGroup region="task-archive">
              <ArchiveQuantityForm
                itemName={entity.name}
                actorId={props.actorId}
                latestReview={props.archiveReview ?? lastArchiveReview!}
              />
            </InventoryCaptureGroup>
          );
        if (selected.startsWith('custody:'))
          return (
            <CustodyChangeForm
              onRecordPage
              actorId={props.actorId}
              kind={quantity ? 'quantity' : 'asset'}
              action={
                selected.slice(8) as Parameters<
                  typeof CustodyChangeForm
                >[0]['action']
              }
              entityId={entity.id}
              entityName={entity.name}
              version={String(entity.version)}
              locations={props.locations}
              sites={props.sites}
              canManageConfiguration={props.canManageConfiguration}
              storageBalances={balances}
              siteHoldings={siteHoldings}
              currentLocation={props.currentLocation}
              currentSite={props.currentSite}
              returnSuggestion={props.returnSuggestion}
              returnSuggestionError={props.returnSuggestionError}
            />
          );
        return (
          <MutationForm
            onRecordPage
            actorId={props.actorId}
            backendScope={props.backendScope}
            operation={
              selected as Parameters<typeof MutationForm>[0]['operation']
            }
            item={item}
            asset={asset}
            balances={balances}
            currentLocation={props.currentLocation ?? undefined}
            categories={props.categories}
            locations={props.locations}
          />
        );
      }}
    </TaskWorkspace>
  );
}
