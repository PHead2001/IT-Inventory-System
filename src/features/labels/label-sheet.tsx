'use client';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { useEffectiveReducedMotion } from '@/components/experience/motion-preference';
import { barcodeCompatibleTag } from '@/features/scan/targets';
import { sheetGeometry, type PrintLayout } from './print-layout';

const qrCache = new Map<string, Promise<string>>();
function qrImage(url: string): Promise<string> {
  const cached = qrCache.get(url);
  if (cached) return cached;
  if (qrCache.size >= 500) qrCache.clear();
  const rendered = import('qrcode')
    .then(({ default: QRCode }) =>
      QRCode.toDataURL(url, {
        errorCorrectionLevel: 'M',
        margin: 4,
        width: 320,
        color: { dark: '#000000', light: '#ffffff' },
      }),
    )
    .catch((error: unknown) => {
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
  path: string;
  barcode?: string | null;
  humanId?: string | null;
  categoryName?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  locationHierarchy?: string | null;
};
export type LabelSize = '70x35' | '90x50';

export function printableLabelLines(record: LabelRecord): {
  identifier: string;
  details: string;
  serial: string | null;
} {
  const identifier =
    record.kind === 'location'
      ? record.key
      : record.kind === 'quantity'
        ? record.humanId
          ? `Item code: ${record.humanId}`
          : 'Quantity item'
        : record.barcode
          ? `Asset tag: ${record.barcode}`
          : record.serialNumber
            ? `Serial: ${record.serialNumber}`
            : 'Untagged asset';
  const details =
    record.kind === 'location'
      ? (record.locationHierarchy ?? '')
          .split(/\s*\/\s*/)
          .filter(Boolean)
          .slice(-2)
          .join(' / ')
      : [record.categoryName, record.manufacturer, record.model]
          .filter((value): value is string => Boolean(value?.trim()))
          .join(' · ');
  return {
    identifier,
    details,
    serial:
      record.kind === 'asset' && record.barcode && record.serialNumber
        ? `Serial: ${record.serialNumber}`
        : null,
  };
}

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
  generation,
  layout,
}: {
  records: LabelRecord[];
  origin: string;
  preview: boolean;
  size: LabelSize;
  page: 'A4' | 'letter';
  format: 'qr' | 'code128';
  generation: string;
  layout?: PrintLayout | null;
}) {
  const geometry = sheetGeometry(size, page, layout);
  const width = geometry.labelWidth / 10;
  const height = geometry.labelHeight / 10;
  const pages = Array.from(
    { length: Math.ceil(records.length / geometry.capacity) },
    (_, index) =>
      records.slice(index * geometry.capacity, (index + 1) * geometry.capacity),
  );
  const reducedMotion = useEffectiveReducedMotion();
  const copyOrdinals = new Map<string, number>();
  return (
    <>
      <style>{`@page { size: ${geometry.sheetWidth / 10}mm ${geometry.sheetHeight / 10}mm; margin: 0; background: #fff; }
      @media print { :root { color-scheme: light !important; --background: #fff !important; --foreground: #000 !important; background: #fff !important; }
      html, body, body > * { background: #fff !important; }
      html, body { margin: 0 !important; padding: 0 !important; }
      body { color: #000 !important; }
      .experience-app { min-height: 0 !important; }
      body > * { visibility: hidden !important; }
      .label-print-root:not([data-print-authorized="true"]) { display: none !important; }
      .label-print-root[data-print-authorized="true"], .label-print-root[data-print-authorized="true"] * { visibility: visible !important; }
      .label-print-root { display: block !important; position: static !important; width: auto; min-height: 0 !important; margin: 0; padding: 0; border: 0; background: white; }
      .label-page { break-after: page; page-break-after: always; overflow: hidden; }
      .label-page:last-child { break-after: auto; page-break-after: auto; }
      .label-print-root .label-card { border: 0.2mm solid #222; }
      .label-print-root .label-card, .label-print-root .label-card * { color: black !important; background: white !important; }
      .label-print-root .label-card { break-inside: avoid; page-break-inside: avoid; }
      .label-print-root .label-preview-item { transform: none !important; opacity: 1 !important; break-inside: avoid; page-break-inside: avoid; }
      .label-print-root .label-card * { animation: none !important; transition: none !important; }
    }`}</style>
      <div
        className="label-print-root mt-6 grid gap-6 text-black"
        aria-label="Print preview"
        data-sheet-generation={generation}
      >
        {pages.map((recordsOnPage, pageIndex) => (
          <div
            key={pageIndex}
            className="label-page bg-white"
            data-page-number={pageIndex + 1}
            style={{
              boxSizing: 'border-box',
              width: `${geometry.sheetWidth / 10}mm`,
              height: `${geometry.sheetHeight / 10}mm`,
              padding: `${geometry.marginTop / 10}mm ${geometry.marginRight / 10}mm ${geometry.marginBottom / 10}mm ${geometry.marginLeft / 10}mm`,
              display: 'grid',
              gridTemplateColumns: `repeat(${geometry.columns}, ${width}mm)`,
              gridTemplateRows: `repeat(${geometry.rows}, ${height}mm)`,
              columnGap: `${geometry.gapX / 10}mm`,
              rowGap: `${geometry.gapY / 10}mm`,
              alignContent: 'start',
              justifyContent: 'start',
            }}
          >
            {recordsOnPage.map((record) => {
              const identity = JSON.stringify([record.kind, record.key]);
              const ordinal = copyOrdinals.get(identity) ?? 0;
              copyOrdinals.set(identity, ordinal + 1);
              return (
                <motion.div
                  key={JSON.stringify([identity, ordinal])}
                  className="label-preview-item"
                  layout={reducedMotion ? false : 'position'}
                  initial={reducedMotion ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: reducedMotion ? 0 : 0.2 }}
                >
                  <LabelCard
                    record={record}
                    origin={origin}
                    preview={preview}
                    width={width}
                    height={height}
                    format={format}
                    generation={generation}
                  />
                </motion.div>
              );
            })}
          </div>
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
  generation,
}: {
  record: LabelRecord;
  origin: string;
  preview: boolean;
  width: number;
  height: number;
  format: 'qr' | 'code128';
  generation: string;
}) {
  const [qrResult, setQrResult] = useState<{
    url: string;
    image: string | null;
  } | null>(null);
  const [barcodeResult, setBarcodeResult] = useState<{
    key: string;
    width: number | null;
  } | null>(null);
  const [textOverflow, setTextOverflow] = useState(false);
  const [measuredGeneration, setMeasuredGeneration] = useState<string | null>(
    null,
  );
  const [compactKey, setCompactKey] = useState<string | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const textBox = useRef<HTMLDivElement>(null);
  const payload = barcodePayload(record);
  const url = origin + record.path;
  const qr = qrResult?.url === url ? qrResult.image : null;
  const qrFailed = qrResult?.url === url && qrResult.image === null;
  const barcodeKey = `${format}:${payload ?? ''}:${width}`;
  const barcodeWidthMm =
    barcodeResult?.key === barcodeKey ? barcodeResult.width : null;
  const barcodeResolved =
    format !== 'code128' || !payload || barcodeResult?.key === barcodeKey;
  useEffect(() => {
    let current = true;
    qrImage(url)
      .then((image) => {
        if (current) {
          setQrResult({ url, image });
        }
      })
      .catch(() => {
        if (current) {
          setQrResult({ url, image: null });
        }
      });
    return () => {
      current = false;
    };
  }, [url]);
  useEffect(() => {
    const element = svg.current;
    if (!element || !payload || format !== 'code128') return;
    let current = true;
    void import('jsbarcode')
      .then(({ default: JsBarcode }) => {
        if (!current) return;
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
        const svgHeight = Number.parseFloat(
          element.getAttribute('height') ?? '',
        );
        if (!Number.isFinite(modules) || !Number.isFinite(svgHeight))
          throw new Error('Invalid barcode dimensions');
        element.setAttribute('viewBox', `0 0 ${modules} ${svgHeight}`);
        element.setAttribute('preserveAspectRatio', 'none');
        // Each horizontal SVG unit renders at 0.3 mm; never shrink modules to fit.
        const physicalWidth = modules * 0.3;
        setBarcodeResult({
          key: barcodeKey,
          width: physicalWidth <= width - 8 ? physicalWidth : null,
        });
      })
      .catch(() => {
        if (current) setBarcodeResult({ key: barcodeKey, width: null });
      });
    return () => {
      current = false;
    };
  }, [payload, format, width, barcodeKey]);
  const useBarcode = format === 'code128' && payload && barcodeWidthMm !== null;
  // Keep the complete QR and its quiet zone at one of the supported sizes.
  const codeMm = width >= 90 && height >= (preview ? 39 : 34) ? 30 : 22;
  const printable = printableLabelLines(record);
  // Fitting belongs to the current content/layout, independently of QR identity.
  const fittingKey = JSON.stringify([
    record.name,
    printable.identifier,
    printable.details,
    printable.serial,
    width,
    height,
    useBarcode,
    Boolean(qr),
    preview,
  ]);
  const compact = compactKey === fittingKey;
  const measurementKey = JSON.stringify([generation, fittingKey]);
  useEffect(() => {
    let current = true;
    const box = textBox.current;
    if (!box) return;
    const fonts = document.fonts;
    let waitingForFonts: Promise<FontFaceSet> | null = null;
    const measure = () => {
      if (!current) return;
      if (fonts && fonts.status !== 'loaded') {
        setMeasuredGeneration(null);
        // FontFaceSet.ready belongs to one loading cycle. A later load must
        // subscribe to its new promise even when the clamped box does not resize.
        const ready = fonts.ready;
        if (waitingForFonts !== ready) {
          waitingForFonts = ready;
          void ready.then(() => {
            if (!current || waitingForFonts !== ready) return;
            waitingForFonts = null;
            measure();
          });
        }
        return;
      }
      // Unauthorized print media hides the sheet. Zero geometry proves neither
      // fit nor overflow and must not change the current compact sizing choice.
      if (box.clientWidth <= 0 || box.clientHeight <= 0) {
        setMeasuredGeneration(null);
        return;
      }
      const over =
        box.scrollHeight > box.clientHeight + 1 ||
        Array.from(box.querySelectorAll<HTMLElement>('[data-fit-text]')).some(
          (line) =>
            line.scrollHeight > line.clientHeight + 1 ||
            line.scrollWidth > line.clientWidth + 1,
        );
      if (over && !compact) {
        setMeasuredGeneration(null);
        setCompactKey(fittingKey);
      } else {
        if (!compact) setCompactKey(null);
        setTextOverflow(over);
        setMeasuredGeneration(measurementKey);
      }
    };
    measure();
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(measure);
    observer?.observe(box);
    const printMedia = window.matchMedia?.('print');
    printMedia?.addEventListener('change', measure);
    window.addEventListener('afterprint', measure);
    fonts?.addEventListener?.('loading', measure);
    fonts?.addEventListener?.('loadingdone', measure);
    fonts?.addEventListener?.('loadingerror', measure);
    void fonts?.ready.then(measure);
    return () => {
      current = false;
      observer?.disconnect();
      printMedia?.removeEventListener('change', measure);
      window.removeEventListener('afterprint', measure);
      fonts?.removeEventListener?.('loading', measure);
      fonts?.removeEventListener?.('loadingdone', measure);
      fonts?.removeEventListener?.('loadingerror', measure);
    };
  }, [
    record.name,
    printable.identifier,
    printable.details,
    printable.serial,
    width,
    height,
    useBarcode,
    compact,
    generation,
    fittingKey,
    measurementKey,
  ]);
  return (
    <article
      className="label-card flex shrink-0 flex-col border border-slate-700 bg-white p-[2mm] text-black"
      style={{ width: `${width}mm`, height: `${height}mm` }}
      data-sheet-generation={generation}
      data-text-measured={measuredGeneration === measurementKey}
      data-code-ready={Boolean(
        measuredGeneration === measurementKey &&
        barcodeResolved &&
        !textOverflow &&
        (qr || useBarcode),
      )}
      data-code-failed={qrFailed && barcodeResolved && !useBarcode}
      data-code-fallback={
        format === 'code128' && barcodeResolved && !useBarcode
      }
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
            className={`mt-[0.5mm] line-clamp-2 block break-words leading-tight ${compact ? 'text-[7pt]' : 'text-[8pt]'}`}
            title={printable.identifier}
          >
            {record.kind === 'location' ? (
              <span className="experience-code">{record.key}</span>
            ) : record.kind === 'quantity' && record.humanId ? (
              <>
                Item code:{' '}
                <span className="experience-code">{record.humanId}</span>
              </>
            ) : record.kind === 'asset' && record.barcode ? (
              <>
                Asset tag:{' '}
                <span className="experience-code">{record.barcode}</span>
              </>
            ) : record.kind === 'asset' && record.serialNumber ? (
              <>
                Serial:{' '}
                <span className="experience-code">{record.serialNumber}</span>
              </>
            ) : (
              printable.identifier
            )}
          </span>
          {printable.serial && (
            <span
              data-fit-text
              className="mt-[0.5mm] line-clamp-1 block break-words text-[7pt] leading-tight"
            >
              Serial:{' '}
              <span className="experience-code">{record.serialNumber}</span>
            </span>
          )}
          {printable.details && (
            <span
              data-fit-text
              className="mt-[0.5mm] line-clamp-2 block break-words text-[7pt] leading-tight"
              title={printable.details}
            >
              {printable.details}
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
    </article>
  );
}
