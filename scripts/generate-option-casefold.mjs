import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { format, resolveConfig } from 'prettier';
const prettierConfig = await resolveConfig(
  'src/features/metadata/option-casefold.generated.ts',
);

// Unicode 15.1 DEFAULT full case folding: C and F, excluding Turkic T mappings.
const source = readFileSync('data/unicode/CaseFolding-15.1.0.txt', 'utf8');
const mapping = {};
for (const line of source.split('\n')) {
  const [code, status, points] = line
    .split('#')[0]
    .split(';')
    .map((part) => part.trim());
  if (status !== 'C' && status !== 'F') continue;
  mapping[String.fromCodePoint(parseInt(code, 16))] = points
    .split(' ')
    .map((point) => String.fromCodePoint(parseInt(point, 16)))
    .join('');
}
const hash = createHash('sha256').update(source).digest('hex');
const header = `Generated from Unicode 15.1.0 CaseFolding.txt (C/F, non-Turkic). SHA256 ${hash}`;
writeFileSync(
  'src/features/metadata/option-casefold.generated.ts',
  await format(
    `// ${header}\n// Regenerate with node scripts/generate-option-casefold.mjs.\nexport const optionCasefold: Readonly<Record<string, string>> = ${JSON.stringify(mapping, null, 2)};\n`,
    { ...prettierConfig, parser: 'typescript' },
  ),
);
const whitespace = [
  9,
  10,
  11,
  12,
  13,
  32,
  133,
  160,
  5760,
  ...Array.from({ length: 11 }, (_, i) => 8192 + i),
  8232,
  8233,
  8239,
  8287,
  12288,
  65279,
];
const sql = `-- ${header}
-- Regenerate with node scripts/generate-option-casefold.mjs.
create or replace function private.metadata_option_label_key(label text) returns text
language plpgsql immutable strict set search_path='' as $function$
declare mapping constant jsonb := $mapping$${JSON.stringify(mapping)}$mapping$::jsonb;
  folded text := ''; point text; normalized text := normalize(label, NFC);
  whitespace constant text := ${whitespace.map((n) => `chr(${n})`).join('||')};
begin
  for point in select regexp_split_to_table(normalized, '') loop
    folded := folded || coalesce(mapping->>point, point);
  end loop;
  return normalize(btrim(regexp_replace(folded, '['||whitespace||']+', ' ', 'g'), ' '), NFC);
end;
$function$;
revoke all on function private.metadata_option_label_key(text) from public,anon,authenticated,service_role;
`;
writeFileSync('data/unicode/option-casefold-15.1.sql', sql);
const explicit = [
  ['  USB\t\nC  ', 'usb c'],
  ['\u0085\u00a0USB\u2003C\ufeff', 'usb c'],
  ['Cafe\u0301', 'café'],
  ['CAFÉ', 'café'],
  ['Straße', 'strasse'],
  ['STRASSE', 'strasse'],
  ['Σςσ', 'σσσ'],
  ['İ', 'i\u0307'],
  ['I', 'i'],
  ['ı', 'ı'],
  ['ﬃ', 'ffi'],
  ['USB-C', 'usb-c'],
  ['USB C', 'usb c'],
  ['a\u200bb', 'a\u200bb'],
  ['\ufeff\u3000', ''],
  ['Ꭰ', 'Ꭰ'],
  ['ꭰ', 'Ꭰ'],
].map(([input, expected]) => ({ input, expected }));
const corpus = [
  ...explicit,
  ...Object.entries(mapping).map(([input, expected]) => ({
    input,
    expected: expected.normalize('NFC'),
  })),
];
writeFileSync(
  'data/unicode/option-label-corpus.json',
  JSON.stringify(corpus, null, 2) + '\n',
);
writeFileSync(
  'supabase/tests/metadata-option-corpus.test.sql',
  `-- ${header}\n-- Shared with option-label.test.ts; regenerate with node scripts/generate-option-casefold.mjs.\nbegin;\ncreate extension if not exists pgtap with schema extensions;\nset local search_path=public,extensions;\nselect plan(1);\nselect ok(bool_and(private.metadata_option_label_key(input) collate "C" = expected collate "C"), 'Pinned Unicode full-fold and explicit whitespace corpus parity (${corpus.length} cases)')\nfrom jsonb_to_recordset($corpus$${JSON.stringify(corpus)}$corpus$::jsonb) as cases(input text,expected text);\nselect * from finish();\nrollback;\n`,
);
