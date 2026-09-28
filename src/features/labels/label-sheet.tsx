'use client';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';
import { barcodeCompatibleTag } from '@/features/scan/targets';

const qrCache = new Map<string, Promise<string>>();
function qrImage(url: string): Promise<string> {
  const cached = qrCache.get(url);
  if (cached) return cached;
  if (qrCache.size >= 500) qrCache.clear();
  const rendered = QRCode.toDataURL(url, {
    errorCorrectionLevel: 'M',
    margin: 4,
    width: 320,
    color: { dark: '#000000', light: '#ffffff' },
  }).catch((error: unknown) => {
    qrCache.delete(url);
    throw error;
  });
  qrCache.set(url, rendered);
  return rendered;
}

export type LabelRecord = {
  kind: 'location' | 'asset' | 'quantity';
  key: string;
  name: string;
  context: string;
  path: string;
  barcode?: string | null;
  humanId?: string | null;
  state: string;
};
export type LabelSize = '70x35' | '90x50';

export function barcodePayload(record: LabelRecord): string | null {
  if (record.kind === 'location') return 'LOC:' + record.key;
  if (record.kind === 'quantity') return null;
  return record.barcode && barcodeCompatibleTag(record.barcode)
    ? 'AST:' + record.barcode
    : null;
}

export function LabelSheet({
  records,
  origin,
  preview,
  size,
  page,
  format,
}: {
  records: LabelRecord[];
  origin: string;
  preview: boolean;
  size: LabelSize;
  page: 'A4' | 'letter';
  format: 'qr' | 'code128';
}) {
  const [width, height] = size.split('x').map(Number);
  return (
    <>
      <style>{`@page { size: ${page}; margin: 8mm; background: #fff; }
      @media print { :root { color-scheme: light !important; --background: #fff !important; --foreground: #000 !important; background: #fff !important; }
      html, body, body > * { background: #fff !important; }
      body { color: #000 !important; }
      body > * { visibility: hidden !important; }
      .label-print-root:not([data-print-authorized="true"]) { display: none !important; }
      .label-print-root[data-print-authorized="true"], .label-print-root[data-print-authorized="true"] * { visibility: visible !important; }
      .label-print-root { position: absolute !important; inset: 0 auto auto 0; width: 100%; margin: 0; padding: 0; border: 0; background: white; }
      .label-print-root .label-card { border: 0.2mm solid #222; }
      .label-print-root .label-card, .label-print-root .label-card * { color: black !important; background: white !important; }
      .label-print-root .label-card { break-inside: avoid; page-break-inside: avoid; }
      .label-print-root .label-card * { animation: none !important; transition: none !important; }
    }`}</style>
      <div
        className="label-print-root mt-6 flex flex-wrap content-start gap-[3mm] rounded-xl bg-white p-[3mm] text-black"
        aria-label="Print preview"
      >
        {records.map((record, index) => (
          <LabelCard
            key={[
              record.kind,
              record.key,
              index,
              size,
              record.name,
              record.context,
              record.humanId,
            ].join(':')}
            record={record}
            origin={origin}
            preview={preview}
            width={width}
            height={height}
            format={format}
          />
        ))}
      </div>
    </>
  );
}

function LabelCard({
  record,
  origin,
  preview,
  width,
  height,
  format,
}: {
  record: LabelRecord;
  origin: string;
  preview: boolean;
  width: number;
  height: number;
  format: 'qr' | 'code128';
}) {
  const [qr, setQr] = useState<string | null>(null);
  const [qrFailed, setQrFailed] = useState(false);
  const [barcodeWidthMm, setBarcodeWidthMm] = useState<number | null>(null);
  const [textOverflow, setTextOverflow] = useState(false);
  const [compact, setCompact] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  const textBox = useRef<HTMLDivElement>(null);
  const payload = barcodePayload(record);
  const url = origin + record.path;
  useEffect(() => {
    let current = true;
    qrImage(url)
      .then((image) => {
        if (current) {
          setQr(image);
          setQrFailed(false);
        }
      })
      .catch(() => {
        if (current) {
          setQr(null);
          setQrFailed(true);
        }
      });
    return () => {
      current = false;
    };
  }, [url]);
  useEffect(() => {
    const element = svg.current;
    if (!element || !payload || format !== 'code128') return;
    try {
      JsBarcode(element, payload, {
        format: 'CODE128',
        displayValue: false,
        width: 1,
        height: 80,
        margin: 0,
        marginLeft: 10,
        marginRight: 10,
        lineColor: '#000000',
        background: '#ffffff',
      });
      // JsBarcode creates pixel-sized paths without a viewBox. Scale those paths,
      // including the ten-module quiet zones, to the declared physical size.
      const modules = Number.parseFloat(element.getAttribute('width') ?? '');
      const svgHeight = Number.parseFloat(element.getAttribute('height') ?? '');
      if (!Number.isFinite(modules) || !Number.isFinite(svgHeight))
        throw new Error('Invalid barcode dimensions');
      element.setAttribute('viewBox', `0 0 ${modules} ${svgHeight}`);
      element.setAttribute('preserveAspectRatio', 'none');
      // Each horizontal SVG unit renders at 0.3 mm; never shrink modules to fit.
      const physicalWidth = modules * 0.3;
      setBarcodeWidthMm(physicalWidth <= width - 8 ? physicalWidth : null);
    } catch {
      setBarcodeWidthMm(null);
    }
  }, [payload, format, width]);
  const useBarcode = format === 'code128' && payload && barcodeWidthMm !== null;
  const codeMm = Math.min(height - 10, width >= 90 ? 30 : 22);
  const identifier =
    record.humanId ||
    (record.kind === 'asset' ? record.barcode : null) ||
    (record.kind === 'location' ? record.key : null);
  const displayIdentifier =
    identifier ||
    (record.kind === 'quantity' ? 'Quantity item' : 'Untagged asset');
  const shortContext = record.context
    .split(/\s*\/\s*/)
    .filter(Boolean)
    .slice(-2)
    .join(' / ');
  useEffect(() => {
    const box = textBox.current;
    if (!box) return;
    const measure = () => {
      const over =
        box.scrollHeight > box.clientHeight + 1 ||
        Array.from(box.querySelectorAll<HTMLElement>('[data-fit-text]')).some(
          (line) =>
            line.scrollHeight > line.clientHeight + 1 ||
            line.scrollWidth > line.clientWidth + 1,
        );
      if (over && !compact) setCompact(true);
      else setTextOverflow(over);
    };
    measure();
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(measure);
    observer?.observe(box);
    void document.fonts?.ready.then(measure);
    return () => observer?.disconnect();
  }, [
    record.name,
    identifier,
    shortContext,
    width,
    height,
    useBarcode,
    compact,
  ]);
  return (
    <article
      className="label-card flex shrink-0 flex-col border border-slate-700 bg-white p-[2mm] text-black"
      style={{ width: `${width}mm`, height: `${height}mm` }}
      data-code-ready={Boolean(!textOverflow && (qr || useBarcode))}
      data-code-fallback={format === 'code128' && !useBarcode}
      data-text-overflow={textOverflow}
    >
      {preview && (
        <strong className="mb-[1mm] text-[8pt] uppercase tracking-wide">
          Preview label
        </strong>
      )}
      <div className="flex min-h-0 flex-1 items-center gap-[2mm]">
        {!useBarcode && qr && (
          <Image
            src={qr}
            alt={`QR code for ${record.name}`}
            width={320}
            height={320}
            unoptimized
            className="shrink-0 bg-white"
            style={{ width: `${codeMm}mm`, height: `${codeMm}mm` }}
          />
        )}
        {!useBarcode && !qr && (
          <span className="text-[8pt]">
            {qrFailed ? 'Code unavailable. Do not print.' : 'Generating code…'}
          </span>
        )}
        <div
          ref={textBox}
          className="max-h-full min-w-0 flex-1 overflow-hidden"
        >
          <strong
            data-fit-text
            className={`line-clamp-3 block break-words leading-tight ${compact ? 'text-[8pt]' : 'text-[9pt]'}`}
          >
            {record.name}
          </strong>
          <span
            data-fit-text
            className={`mt-[0.5mm] line-clamp-2 block break-words font-mono leading-tight ${compact ? 'text-[7pt]' : 'text-[8pt]'}`}
            title={identifier || undefined}
          >
            {displayIdentifier}
          </span>
          <span
            data-fit-text
            className="mt-[0.5mm] line-clamp-2 block break-words text-[7pt] leading-tight"
            title={record.context}
          >
            {shortContext}
          </span>
          {record.state !== 'active' && (
            <span className="block font-bold uppercase text-[8pt]">
              {record.state}
            </span>
          )}
        </div>
      </div>
      {textOverflow && (
        <strong className="text-[7pt]">
          Text does not fit this label. Choose a larger size.
        </strong>
      )}
      {format === 'code128' && (
        <svg
          ref={svg}
          role="img"
          aria-label={payload ? `Code 128 ${payload}` : 'Code 128 unavailable'}
          className={useBarcode ? 'mx-[2mm] max-w-full shrink-0' : 'hidden'}
          style={
            useBarcode
              ? {
                  width: `${barcodeWidthMm}mm`,
                  height: '12mm',
                }
              : undefined
          }
        />
      )}
      {format === 'code128' && !useBarcode && (
        <span className="text-[7pt]">
          QR used: no compatible tag or Code 128 would exceed label width.
        </span>
      )}
    </article>
  );
}
