import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LocationPicker } from '@/features/locations/location-picker';
import type { CategoryRef, LocationRef } from '../contracts-ui';
import { field, panel } from './read-ui';
export function SearchForm({
  params,
  categories,
  locations,
  action = '/inventory',
}: {
  params: Record<string, string | undefined>;
  categories: CategoryRef[];
  locations: LocationRef[];
  action?: string;
}) {
  return (
    <form
      action={action}
      className={panel + ' mb-5 space-y-4'}
      aria-label="Search inventory"
    >
      <div className="space-y-2">
        <label htmlFor="inventory-query">Search inventory</label>
        <Input
          id="inventory-query"
          name="q"
          defaultValue={params.q}
          maxLength={200}
          placeholder="Name, model, serial, category or location"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label htmlFor="inventory-type" className="text-sm">
            Tracking type
          </label>
          <select
            className={field}
            id="inventory-type"
            name="type"
            defaultValue={params.type ?? ''}
          >
            <option value="">All types</option>
            <option value="quantity">Quantity</option>
            <option value="asset">Serialized assets</option>
          </select>
        </div>
        <div>
          <label htmlFor="inventory-status" className="text-sm">
            Status
          </label>
          <select
            className={field}
            id="inventory-status"
            name="status"
            defaultValue={params.status ?? 'active'}
          >
            <option value="active">Active</option>
            <option value="historical">Archived / retired</option>
            <option value="all">All statuses</option>
          </select>
        </div>
        <div>
          <label htmlFor="inventory-category" className="text-sm">
            Category
          </label>
          <select
            className={field}
            id="inventory-category"
            name="category"
            defaultValue={params.category ?? ''}
          >
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>
        <LocationPicker
          key={params.location ?? ''}
          id="inventory-location"
          label="Location"
          locations={locations}
          mode="browse"
          name="location"
          defaultValue={params.location ?? ''}
          allowAll
        />
      </div>
      <Button type="submit">Search</Button>
    </form>
  );
}
