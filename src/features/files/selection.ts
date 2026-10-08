/** Selection is only local feedback; authoritative inspection still gates publication. */
export function validateSelectedFile(
  file: Pick<File, 'size' | 'type' | 'name'>,
  parentType: 'asset' | 'quantity',
) {
  if (file.size < 1 || file.size > 20971520)
    throw new Error('Choose a file up to 20 MiB.');
  if (
    ![
      'image/jpeg',
      'image/png',
      'image/webp',
      ...(parentType === 'asset' ? ['application/pdf'] : []),
    ].includes(file.type)
  )
    throw new Error(
      parentType === 'quantity'
        ? 'Choose a JPEG, PNG, or still WebP photo. HEIC needs conversion first.'
        : 'Choose a JPEG, PNG, still WebP, or PDF file. HEIC needs conversion first.',
    );
  const safeName = file.name
    .trim()
    .replace(/[\x00-\x1f\x7f/\\]/g, '_')
    .slice(0, 200);
  if (!safeName) throw new Error('Choose a file with a name.');
  return safeName;
}
