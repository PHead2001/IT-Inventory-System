/** Screen vocabulary only; stored job/default keys and print payloads stay unchanged. */
export const labelSettingText = {
  size: 'Label size',
  page: 'Paper size',
  format: 'Barcode type',
} as const;

export const labelSizeOptions = [
  { value: '90x50', label: '90 × 50 mm' },
  { value: '70x35', label: '70 × 35 mm' },
] as const;
export const paperSizeOptions = [
  { value: 'letter', label: 'US Letter (8.5 × 11 in)' },
  { value: 'A4', label: 'A4 (210 × 297 mm)' },
] as const;
export const barcodeTypeOptions = [
  { value: 'qr', label: 'QR code' },
  { value: 'code128', label: 'Code 128 when it fits' },
] as const;
export const barcodeTypeHelp =
  'Scanning a QR code opens the linked inventory record or location. Code 128 is a preference; labels use QR when it is unavailable or does not fit.';
