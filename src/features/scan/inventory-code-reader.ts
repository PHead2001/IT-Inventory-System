import { BrowserMultiFormatReader } from '@zxing/browser';
import { decodeInventoryFrame } from './decode-frame';

export class InventoryCodeReader extends BrowserMultiFormatReader {
  override decodeFromCanvas(canvas: HTMLCanvasElement) {
    return decodeInventoryFrame(canvas, () => super.decodeFromCanvas(canvas));
  }
}
