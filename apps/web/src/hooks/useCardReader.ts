import { useEffect, useRef, useState } from 'react';

/** Card numbers are compared as uppercase hex without separators. */
export const normalizeCardNo = (raw: string) => raw.toUpperCase().replace(/[^0-9A-F]/g, '');

interface NdefReader {
  scan(opts?: { signal?: AbortSignal }): Promise<void>;
  onreading: ((e: { serialNumber: string }) => void) | null;
}
declare global {
  interface Window {
    NDEFReader?: new () => NdefReader;
  }
}

/**
 * Listens for an RFID card while `active`:
 * - Web NFC on Android Chrome (the card's serial number), and
 * - a USB keyboard-wedge reader (fast keystrokes ending in Enter).
 */
export function useCardReader(active: boolean, onCard: (cardNo: string) => void) {
  const ref = useRef(onCard);
  ref.current = onCard;
  const [nfc, setNfc] = useState<'off' | 'on' | 'unsupported' | 'blocked'>('off');

  useEffect(() => {
    if (!active) return;
    const abort = new AbortController();
    if (window.NDEFReader) {
      const reader = new window.NDEFReader();
      reader.onreading = (e) => ref.current(normalizeCardNo(e.serialNumber));
      reader
        .scan({ signal: abort.signal })
        .then(() => setNfc('on'))
        .catch(() => setNfc('blocked'));
    } else {
      setNfc('unsupported');
    }

    let buffer = '';
    let last = 0;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.tagName === 'INPUT') return;
      const now = performance.now();
      if (now - last > 80) buffer = '';
      last = now;
      if (e.key === 'Enter') {
        if (buffer.length >= 6) ref.current(normalizeCardNo(buffer));
        buffer = '';
      } else if (e.key.length === 1) {
        buffer += e.key;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      abort.abort();
      window.removeEventListener('keydown', onKey);
    };
  }, [active]);

  return nfc;
}
