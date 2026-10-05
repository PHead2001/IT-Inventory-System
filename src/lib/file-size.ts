/** Binary units match upload limits; missing metadata is distinct from zero bytes. */
export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isSafeInteger(bytes) || bytes < 0)
    return 'Size unavailable';
  if (bytes < 1024) return `${bytes} B`;
  const divisor = bytes < 1048576 ? 1024 : 1048576;
  const value = bytes / divisor;
  const precision = value < 10 ? 2 : value < 100 ? 1 : 0;
  return `${Number(value.toFixed(precision))} ${divisor === 1024 ? 'KiB' : 'MiB'}`;
}
