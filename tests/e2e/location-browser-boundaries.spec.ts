import { expect, test } from '@playwright/test';
import {
  acceptanceFixtures,
  acceptanceLogin,
} from './audit-three-acceptance-fixtures';

// Not parallel-allowlisted: the canonical scheduler runs this local topology
// fixture exclusively. acceptanceFixtures rejects non-loopback backends.
test('owned local groups retain the 32-expansion boundary and distinguish duplicate-name Details and child returns', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const owned = await acceptanceFixtures();
  const seedCodes = [
    'ITC',
    'ITC-L',
    'ITC-S1',
    'ITC-S2',
    'ITC-R',
    'ITC-S3',
    'ITC-S4',
    'ITO',
  ];
  const groups: Array<{ id: string; code: string; name: string }> = [];
  const children: Array<{ id: string; code: string; name: string }> = [];
  const duplicateName = `Fictional shared storage ${owned.suffix}`;
  let canonicalSnapshot: unknown = null;
  let setupComplete = false;
  try {
    const canonical = await owned.caller
      .from('locations')
      .select('id,code,name,parent_id,active,can_hold_inventory,version')
      .in('code', seedCodes)
      .order('code');
    expect(canonical.error).toBeNull();
    expect(canonical.data).toHaveLength(8);
    canonicalSnapshot = canonical.data;
    // Eight existing groups + 25 owned parent/child pairs = 33 expandable
    // groups. No canonical name, code, ancestry, geometry or stock changes.
    for (let index = 0; index < 25; index++) {
      const group = await owned.ownedLocation(
        `Fictional browser group ${owned.suffix} ${index + 1}`,
        'ITO',
        'storage_group',
      );
      groups.push(group);
      children.push(
        await owned.ownedLocation(
          index < 2
            ? duplicateName
            : `Fictional browser child ${owned.suffix} ${index + 1}`,
          group.code,
        ),
      );
    }
    expect(owned.locations.size).toBe(50);
    setupComplete = true;
    expect(canonical.data!.some((row) => owned.locations.has(row.id))).toBe(
      false,
    );
    const topology = await owned.caller
      .from('locations')
      .select('id,code,parent_id,kind,active,can_hold_inventory')
      .in('id', [...owned.locations]);
    expect(topology.error).toBeNull();
    expect(topology.data).toHaveLength(50);
    const officeId = canonical.data!.find((row) => row.code === 'ITO')!.id;
    for (const [index, group] of groups.entries()) {
      expect(topology.data!.find((row) => row.id === group.id)).toMatchObject({
        parent_id: officeId,
        kind: 'storage_group',
        active: true,
        can_hold_inventory: false,
      });
      expect(
        topology.data!.find((row) => row.id === children[index].id),
      ).toMatchObject({
        parent_id: group.id,
        kind: 'storage_area',
        active: true,
        can_hold_inventory: true,
      });
    }
    await info.attach('owned-local-location-setup', {
      body: JSON.stringify({
        categoryId: owned.categoryId,
        plannedLocationIds: [...owned.locations],
        locations: topology.data,
        cleanup: 'Exact owned IDs retained inactive and non-holding',
      }),
      contentType: 'application/json',
    });
    const duplicateRows = await owned.caller
      .from('inventory_locations')
      .select('id,code,name,breadcrumb,parent_id')
      .in(
        'id',
        children.slice(0, 2).map((child) => child.id),
      )
      .order('code');
    expect(duplicateRows.error).toBeNull();
    expect(duplicateRows.data).toHaveLength(2);
    expect(duplicateRows.data!.map((row) => row.name)).toEqual([
      duplicateName,
      duplicateName,
    ]);
    expect(new Set(duplicateRows.data!.map((row) => row.parent_id)).size).toBe(
      2,
    );
    expect(new Set(duplicateRows.data!.map((row) => row.breadcrumb)).size).toBe(
      2,
    );

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await acceptanceLogin(page);
    await page.goto('/locations');
    const browser = page.getByRole('navigation', {
      name: 'Location browser',
      exact: true,
    });
    const selected = page.getByRole('region', {
      name: 'Selected location',
      exact: true,
    });
    const acceptedGroups = [
      ...seedCodes.map((code) =>
        canonical.data!.find((row) => row.code === code)!,
      ),
      ...groups.slice(0, 24),
    ];
    for (const [index, group] of acceptedGroups.entries()) {
      await browser
        .getByRole('button', { name: `Expand ${group.name}`, exact: true })
        .click();
      await expect
        .poll(() => new URL(page.url()).searchParams.getAll('expanded').length)
        .toBe(index + 1);
      await expect(
        browser.getByRole('button', {
          name: `Collapse ${group.name}`,
          exact: true,
        }),
      ).toHaveAttribute('aria-expanded', 'true');
    }
    await browser
      .getByRole('button', {
        name: `${children[0].name} ${children[0].code}`,
        exact: true,
      })
      .click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get('selected'))
      .toBe(children[0].code);
    await expect(selected).toContainText(children[0].code);
    const acceptedURL = page.url();
    await browser
      .getByRole('button', {
        name: `Expand ${groups[24].name}`,
        exact: true,
      })
      .click();
    const notice = page.getByRole('status').filter({
      hasText: 'This view has reached its saved-state limit.',
    });
    await expect(notice).toBeVisible();
    await expect(page).toHaveURL(acceptedURL);
    await expect(selected).toContainText(children[0].code);
    await expect(
      browser.getByRole('button', {
        name: `Expand ${groups[24].name}`,
        exact: true,
      }),
    ).toHaveAttribute('aria-expanded', 'false');
    expect(
      await notice.evaluate((element) => {
        const nav = document.querySelector(
          'nav[aria-label="Location browser"]',
        )!;
        const column = nav.parentElement!;
        const panel = document.querySelector(
          'section[aria-label="Selected location"]',
        );
        return {
          sameColumn: element.parentElement === column,
          selectedNext: column.nextElementSibling === panel,
          columns: column.parentElement!.children.length,
        };
      }),
    ).toEqual({ sameColumn: true, selectedNext: true, columns: 2 });
    await page.screenshot({
      path: info.outputPath('expansion-33-rejected.png'),
    });

    const search = browser.getByRole('searchbox', {
      name: 'Browse locations',
      exact: true,
    });
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({
        reducedMotion: width === 390 ? 'reduce' : 'no-preference',
      });
      await search.fill(duplicateName);
      await expect
        .poll(() => new URL(page.url()).searchParams.get('q'))
        .toBe(duplicateName);
      for (const row of duplicateRows.data!) {
        const choice = browser.getByRole('button', {
          name: `${row.breadcrumb} ${row.code}`,
          exact: true,
        });
        await expect(choice).toBeVisible();
        await expect(
          choice.getByText(row.breadcrumb, { exact: true }),
        ).toBeVisible();
        await choice.click();
        await expect
          .poll(() => new URL(page.url()).searchParams.get('selected'))
          .toBe(row.code);
        await expect(selected).toContainText(row.code);
        await expect(choice).toHaveAttribute('aria-current', 'location');
        await expect(
          selected.getByText(row.breadcrumb, { exact: true }),
        ).toBeVisible();
      }
      const selection = new URL(page.url()).searchParams.get('selected');
      const returnPaths: string[] = [];
      for (const row of duplicateRows.data!) {
        const details = browser.getByRole('link', {
          name: `View ${row.breadcrumb} location details`,
          exact: true,
        });
        await expect(details).toBeVisible();
        const destination = new URL(
          (await details.getAttribute('href'))!,
          page.url(),
        );
        expect(destination.pathname).toBe('/locations/' + row.code);
        const returnTo = destination.searchParams.get('returnTo')!;
        const browserReturn = new URL(returnTo, page.url());
        expect(browserReturn.pathname).toBe('/locations');
        expect(browserReturn.searchParams.get('q')).toBe(duplicateName);
        expect(browserReturn.searchParams.get('selected')).toBe(selection);
        expect(browserReturn.searchParams.getAll('expanded')).toHaveLength(32);
        expect(browserReturn.hash).toBe(
          `#location-row-${width === 390 ? 'mobile-level' : 'desktop-tree'}-${row.id}`,
        );
        returnPaths.push(returnTo);
        await details.click();
        await expect(page).toHaveURL(destination.href);
        await expect(
          page.getByRole('heading', { name: duplicateName, exact: true }),
        ).toBeVisible();
        const back = page.getByRole('link', {
          name: 'All locations',
          exact: true,
        });
        await expect(back).toHaveAttribute('href', returnTo);
        await back.click();
        await expect(page).toHaveURL(browserReturn.href);
        await expect(search).toHaveValue(duplicateName);
        await expect(selected).toContainText(selection!);
      }
      expect(new Set(returnPaths).size).toBe(2);
      await page.screenshot({
        path: info.outputPath(`duplicate-paths-${width}.png`),
      });
    }

    // Traverse a real parent's child Details link, retaining the original
    // browser selection/search/expansion return scope rather than a new default.
    await search.fill(groups[0].name);
    await expect
      .poll(() => new URL(page.url()).searchParams.get('q'))
      .toBe(groups[0].name);
    const parentRow = await owned.caller
      .from('inventory_locations')
      .select('breadcrumb')
      .eq('id', groups[0].id)
      .single();
    expect(parentRow.error).toBeNull();
    const parentDetails = browser.getByRole('link', {
      name: `View ${parentRow.data!.breadcrumb} location details`,
      exact: true,
    });
    const parentURL = new URL(
      (await parentDetails.getAttribute('href'))!,
      page.url(),
    );
    const returnTo = parentURL.searchParams.get('returnTo')!;
    const retainedSelection = new URL(page.url()).searchParams.get('selected');
    await parentDetails.click();
    await expect(page).toHaveURL(parentURL.href);
    const child = duplicateRows.data!.find(
      (row) => row.parent_id === groups[0].id,
    )!;
    const childLink = page.getByRole('link', {
      name: `${child.breadcrumb} (${child.code})`,
      exact: true,
    });
    const childURL = new URL(
      (await childLink.getAttribute('href'))!,
      page.url(),
    );
    expect(childURL.pathname).toBe('/locations/' + child.code);
    expect(childURL.searchParams.get('returnTo')).toBe(returnTo);
    await childLink.click();
    await expect(page).toHaveURL(childURL.href);
    const back = page.getByRole('link', { name: 'All locations', exact: true });
    await expect(back).toHaveAttribute('href', returnTo);
    await back.click();
    await expect(page).toHaveURL(new URL(returnTo, parentURL).href);
    await expect(search).toHaveValue(groups[0].name);
    await expect(selected).toContainText(retainedSelection!);
    expect(new URL(page.url()).searchParams.getAll('expanded')).toHaveLength(
      32,
    );

    const unchanged = await owned.caller
      .from('locations')
      .select('id,code,name,parent_id,active,can_hold_inventory,version')
      .in('code', seedCodes)
      .order('code');
    expect(unchanged.error).toBeNull();
    expect(unchanged.data).toEqual(canonical.data);
    await info.attach('owned-location-boundary-proof', {
      body: JSON.stringify({
        ownedLocationCount: 50,
        acceptedExpansions: 32,
        rejectedExpansion: 33,
        sameColumn: true,
        duplicateLocationIds: duplicateRows.data!.map((row) => row.id),
        distinctParentIds: duplicateRows.data!.map((row) => row.parent_id),
        childReturnPreserved: true,
        canonicalNodesUnchanged: true,
      }),
      contentType: 'application/json',
    });
  } finally {
    let cleanupSucceeded = false;
    try {
      await owned.cleanup();
      cleanupSucceeded = true;
    } finally {
      await info.attach('owned-local-location-cleanup', {
        body: JSON.stringify({
          plannedLocationIds: [...owned.locations],
          cleanupSucceeded,
          retained: 'Inactive/non-holding; no hard delete or canonical rename',
        }),
        contentType: 'application/json',
      });
    }
    if (owned.locations.size) {
      const retained = await owned.admin
        .from('locations')
        .select('id,active,can_hold_inventory')
        .in('id', [...owned.locations]);
      expect(retained.error).toBeNull();
      if (setupComplete) expect(retained.data).toHaveLength(50);
      expect(
        retained.data!.every((row) => !row.active && !row.can_hold_inventory),
      ).toBe(true);
    }
    if (canonicalSnapshot !== null) {
      const unchanged = await owned.admin
        .from('locations')
        .select('id,code,name,parent_id,active,can_hold_inventory,version')
        .in('code', seedCodes)
        .order('code');
      expect(unchanged.error).toBeNull();
      expect(unchanged.data).toEqual(canonicalSnapshot);
    }
  }
});
