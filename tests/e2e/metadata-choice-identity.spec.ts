import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { expect, test } from '@playwright/test';
import type { MetadataDefinition } from '../../src/features/metadata/contracts';
import {
  auditCategory,
  auditLogin,
  auditReadback,
  auditSaveDesigner,
} from './audit-two-controls';

test('legacy choices remain readable on inventory and labels and editable without creating new ambiguity', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  await auditLogin(page);
  const category = await auditCategory(page),
    client = await auditReadback();
  const form = await client.rpc('metadata_form_get_v2', {
    p_category_id: category.id,
  });
  expect(form.error).toBeNull();
  const definition = structuredClone(
    (form.data as unknown as { published_definition: MetadataDefinition })
      .published_definition,
  );
  const field = randomUUID(),
    revision = randomUUID(),
    item = randomUUID();
  const name = 'Readable legacy choice ' + randomUUID();
  // A unique fixture prefix with deterministic UUID order keeps Same (4) bound
  // to the third duplicate regardless of authoring/navigation order.
  const optionId = (n: number) =>
    field.slice(0, 24) + String(n).padStart(12, '0');
  const options = [
    { id: optionId(1), label: 'Same', active: true },
    { id: optionId(2), label: 'same', active: false },
    { id: optionId(3), label: 'Same', active: true },
    { id: optionId(4), label: 'Same (2)', active: true },
    ...Array.from({ length: 65 }, (_, n) => ({
      id: optionId(n + 5),
      label: `Choice ${n + 1}`,
      active: true,
    })),
  ];
  definition.fields.push({
    id: field,
    label: 'Readable choice',
    type: 'single_select',
    applies_to: ['quantity', 'asset'],
    required: false,
    rules: {},
    options,
  });
  definition.layout[0].controls.push({
    id: randomUUID(),
    kind: 'field',
    field_id: field,
    width: 12,
  });
  // Local-only coherent pre-policy fixture, never a hosted mutation or rewrite.
  const target = new URL(process.env.LOCAL_DB_URL!);
  expect(['localhost', '127.0.0.1', '[::1]']).toContain(target.hostname);
  expect(target.port).toBe('54322');
  const owner = new Client({
    connectionString: target.href,
    application_name: 'choice-identity-browser-fixture',
  });
  await owner.connect();
  let originalBytes = '';
  try {
    await owner.query('begin');
    await owner.query(
      "insert into public.category_form_revisions(id,category_id,status,revision_number,draft_definition) values($1,$2,'draft',2,$3::jsonb)",
      [revision, category.id, JSON.stringify(definition)],
    );
    await owner.query(
      "insert into public.metadata_fields(id,category_id,field_type) values($1,$2,'single_select')",
      [field, category.id],
    );
    await owner.query(
      "insert into public.form_revision_fields(revision_id,field_id,label,applies_to,required,sort_order) values($1,$2,'Readable choice',array['quantity','asset'],false,0)",
      [revision, field],
    );
    await owner.query(
      "insert into public.metadata_options(id,field_id) select (value->>'id')::uuid,$1 from jsonb_array_elements($2::jsonb)",
      [field, JSON.stringify(options)],
    );
    await owner.query(
      "insert into public.form_revision_options(revision_id,field_id,option_id,label,active,sort_order) select $1,$2,(value->>'id')::uuid,value->>'label',(value->>'active')::boolean,ordinality-1 from jsonb_array_elements($3::jsonb) with ordinality",
      [revision, field, JSON.stringify(options)],
    );
    await owner.query(
      "update public.category_form_revisions set status='published',published_at=now() where id=$1",
      [revision],
    );
    await owner.query(
      'update public.categories set published_form_revision_id=$1 where id=$2',
      [revision, category.id],
    );
    await owner.query(
      'insert into public.quantity_items(id,name,category_id,custom_values,validated_form_revision_id) values($1,$2,$3,$4::jsonb,$5)',
      [
        item,
        name,
        category.id,
        JSON.stringify({
          [field]: { value: options[2].id, validated_revision_id: revision },
        }),
        revision,
      ],
    );
    originalBytes = (
      await owner.query(
        'select draft_definition::text bytes from public.category_form_revisions where id=$1',
        [revision],
      )
    ).rows[0].bytes;
    await owner.query('commit');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(category.url);
    const designer = page.getByRole('region', { name: 'Forms and fields' });
    await designer
      .getByTestId('designer-library')
      .getByRole('button')
      .filter({ hasText: 'Readable choice ·' })
      .click();
    const inspector = designer.getByTestId('designer-inspector');
    await expect(inspector.getByRole('alert')).toHaveCount(0);
    await inspector
      .getByLabel('Description shown below this field')
      .fill('Clearer instructions');
    await auditSaveDesigner(designer);
    await page.reload();
    await designer
      .getByTestId('designer-library')
      .getByRole('button')
      .filter({ hasText: 'Readable choice ·' })
      .click();
    await inspector
      .getByLabel('Option name: Same', { exact: true })
      .last()
      .fill(' SAME ');
    await expect(inspector.getByRole('alert')).toHaveCount(2);
    await expect(
      designer.getByRole('button', { name: 'Save changes', exact: true }),
    ).toBeDisabled();
    await inspector
      .getByLabel('Option name:  SAME ', { exact: true })
      .fill('Same');
    await expect(inspector.getByRole('alert')).toHaveCount(0);
    // Discard the reverted in-memory edit through a reload; no publish is needed.
    await page.reload();
    for (const width of [1440, 390])
      for (const reducedMotion of ['no-preference', 'reduce'] as const) {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ reducedMotion });
        await page.goto('/inventory?q=' + encodeURIComponent(name));
        const row = page
          .getByRole('link', { name, exact: true })
          .first()
          .locator('xpath=ancestor::li[1]');
        await expect(row).toContainText('Same (4)');
        await expect(row).not.toContainText('[choice');
        await expect(row).not.toContainText(options[2].id);
        await info.attach(`choice-inventory-${width}-${reducedMotion}.png`, {
          body: await row.screenshot(),
          contentType: 'image/png',
        });
        await page.goto('/labels');
        const search = page.getByRole('form', { name: 'Search label records' });
        await search.getByRole('textbox').fill(name);
        await search
          .getByRole('button', { name: 'Search', exact: true })
          .click();
        const results = page.getByRole('region', {
          name: 'Search result records',
        });
        await expect(results).toContainText('Same (4)');
        await expect(results).not.toContainText('[choice');
        await expect(results).not.toContainText(options[2].id);
        await info.attach(`choice-labels-${width}-${reducedMotion}.png`, {
          body: await results.screenshot(),
          contentType: 'image/png',
        });
      }
    expect(
      (
        await owner.query(
          'select draft_definition::text bytes from public.category_form_revisions where id=$1',
          [revision],
        )
      ).rows[0].bytes,
    ).toBe(originalBytes);
    const stored = (
      await owner.query(
        'select custom_values from public.quantity_items where id=$1',
        [item],
      )
    ).rows[0].custom_values;
    expect(stored[field]).toEqual({
      value: options[2].id,
      validated_revision_id: revision,
    });
  } finally {
    await owner.end();
  }
});
