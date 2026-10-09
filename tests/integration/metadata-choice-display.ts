import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import {
  buildOptionIndex,
  type Option,
} from '../../src/features/metadata/designer-model';

/** Called by the existing local-only form-save gate; fixtures are rolled back. */
export async function verifyChoiceRevisionDisplay(owner: Client) {
  const category = randomUUID(),
    revision = randomUUID(),
    field = randomUUID();
  const options: Option[] = [
    { id: randomUUID(), label: ' Same ', active: true },
    { id: randomUUID(), label: 'same', active: false },
    { id: randomUUID(), label: 'Same (2)', active: true },
    { id: randomUUID(), label: 'Same', active: true },
    { id: randomUUID(), label: 'A', active: true },
    { id: randomUUID(), label: 'B', active: true },
    { id: randomUUID(), label: 'A / B', active: true },
    { id: randomUUID(), label: '"A / B"', active: true },
    { id: randomUUID(), label: 'Straße', active: true },
    { id: randomUUID(), label: 'STRASSE', active: true },
    { id: randomUUID(), label: 'Café', active: true },
    { id: randomUUID(), label: 'Café', active: true },
    { id: randomUUID(), label: '\ufeff spaced\u00a0label ', active: true },
    { id: randomUUID(), label: 'spaced label', active: true },
    { id: randomUUID(), label: 'Back\\slash', active: true },
    { id: randomUUID(), label: '\u00a0', active: true },
    { id: randomUUID(), label: '\ufeff', active: false },
    { id: randomUUID(), label: '(2)', active: true },
  ];
  options[5].parent_id = options[4].id;
  await owner.query('begin');
  try {
    await owner.query(
      'insert into public.categories(id,code,name) values($1,$2,$3)',
      [category, `PARITY-${category}`, 'Choice path parity'],
    );
    await owner.query(
      "insert into public.metadata_fields(id,category_id,field_type) values($1,$2,'hierarchical_select')",
      [field, category],
    );
    const addRevision = async (
      id: string,
      ordered: Option[],
      number: number,
      tiedOrder = false,
    ) => {
      await owner.query(
        "insert into public.category_form_revisions(id,category_id,status,revision_number,draft_definition) values($1,$2,'draft',$3,$4::jsonb)",
        [
          id,
          category,
          number,
          JSON.stringify({
            fields: [{ id: field, options: ordered }],
            layout: [],
          }),
        ],
      );
      await owner.query(
        "insert into public.form_revision_fields(revision_id,field_id,label,applies_to,required,sort_order) values($1,$2,'Choice path parity',array['quantity'],false,0)",
        [id, field],
      );
      await owner.query(
        "insert into public.metadata_options(id,field_id) select (value->>'id')::uuid,$1 from jsonb_array_elements($2::jsonb) on conflict(id) do nothing",
        [field, JSON.stringify(ordered)],
      );
      await owner.query(
        "insert into public.form_revision_options(revision_id,field_id,option_id,parent_option_id,label,active,sort_order) select $1,$2,(value->>'id')::uuid,(value->>'parent_id')::uuid,btrim(value->>'label'),(value->>'active')::boolean,case when $4::boolean then 0 else ordinality-1 end from jsonb_array_elements($3::jsonb) with ordinality",
        [id, field, JSON.stringify(ordered), tiedOrder],
      );
      await owner.query(
        "update public.category_form_revisions set status='published',published_at=now() where id=$1",
        [id],
      );
    };
    await addRevision(revision, options, 2);
    const readPaths = async (id: string, selected: string[]) =>
      (
        await owner.query(
          'select private.metadata_option_paths($1,$2,$3::uuid[]) paths',
          [id, field, selected],
        )
      ).rows[0].paths as string[][];
    const expected = (ordered: Option[], selected: string[]) => {
      const index = buildOptionIndex(ordered);
      const segments = new Map<string, string[]>();
      for (const option of ordered) {
        const path: string[] = [];
        let current: Option | undefined = option;
        while (current) {
          path.unshift(index.displayLabels.get(current.id)!);
          current = current.parent_id
            ? index.byId.get(current.parent_id)
            : undefined;
        }
        segments.set(option.id, path);
      }
      return selected.map((id) => segments.get(id));
    };
    const selected = options.map((option) => option.id);
    const originalPaths = await readPaths(revision, selected);
    assert.deepEqual(
      originalPaths,
      expected(options, selected),
      'SQL and TS use identical complete revision labels, including inactive, NFC and literal suffix choices',
    );
    assert.equal(
      new Set(originalPaths.map((path) => path.join(' / '))).size,
      options.length,
      'literal root path and nested path stay distinguishable',
    );
    for (const selection of [
      selected.slice(1, 4),
      [...selected].reverse(),
      [selected[3]],
    ])
      assert.deepEqual(
        await readPaths(revision, selection),
        expected(options, selection),
        'pagination/selection order does not allocate new display identities',
      );
    const originalBytes = (
      await owner.query(
        'select draft_definition::text bytes from public.category_form_revisions where id=$1',
        [revision],
      )
    ).rows[0].bytes;
    const later = randomUUID(),
      reordered = [...options].reverse();
    await addRevision(later, reordered, 3);
    await owner.query(
      'update public.categories set published_form_revision_id=$1 where id=$2',
      [later, category],
    );
    assert.deepEqual(
      await readPaths(later, selected),
      expected(reordered, selected),
      'a later revision uses its own persisted order',
    );
    assert.deepEqual(
      await readPaths(revision, selected),
      originalPaths,
      'historical display remains on its referenced revision after a pointer change',
    );
    const tied = randomUUID(),
      byId = [...options].sort((a, b) =>
        a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
      );
    await addRevision(tied, byId, 4, true);
    assert.deepEqual(
      await readPaths(tied, selected),
      expected(byId, selected),
      'persisted sort-order ties use the stable choice UUID tiebreaker',
    );
    assert.equal(
      (
        await owner.query(
          'select draft_definition::text bytes from public.category_form_revisions where id=$1',
          [revision],
        )
      ).rows[0].bytes,
      originalBytes,
      'historical revision bytes remain identical',
    );
  } finally {
    await owner.query('rollback');
  }
}
