/// <reference lib="webworker" />
/**
 * Decodes QR codes off the main thread, so the camera loop never delays
 * taps or a USB reader's keystrokes on slower tablets.
 */
import jsQR from 'jsqr';

self.onmessage = (e: MessageEvent<{ data: ArrayBuffer; width: number; height: number }>) => {
  const { data, width, height } = e.data;
  let text: string | null = null;
  try {
    text = jsQR(new Uint8ClampedArray(data), width, height)?.data ?? null;
  } catch {
    text = null;
  }
  (self as unknown as Worker).postMessage(text);
};
