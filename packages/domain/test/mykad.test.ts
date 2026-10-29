import { describe, expect, it } from 'vitest';
import { formatIc, maskIc, readMyKad, validIcNumber } from '../src/mykad.js';

// Fictional sample card text, as Tesseract returns it.
const CLEAN = `KAD PENGENALAN MALAYSIA
IDENTITY CARD
900101-14-5678
SAMPLE DRIVER
BIN DEMO
12 JALAN CONTOH 3
40000 SHAH ALAM WARGANEGARA
SELANGOR LELAKI`;

describe('reading a MyKad', () => {
  it('finds the number and the two-line name', () => {
    expect(readMyKad(CLEAN)).toEqual({ icNumber: '900101145678', name: 'SAMPLE DRIVER BIN DEMO' });
  });

  it('repairs look-alike letters where a digit must be', () => {
    const text = 'MyKad\n9OO1O1 - I4 - S678\nSAMPLE PERSON\n7 LORONG SATU';
    expect(readMyKad(text)).toEqual({ icNumber: '900101145678', name: 'SAMPLE PERSON' });
  });

  it('reads a one-line name and stops at the address', () => {
    const text = `IDENTITY CARD\n850615-10-1234\nSAMPLE A/L DEMO\nNO 5 TAMAN CONTOH\n40150 SHAH ALAM`;
    expect(readMyKad(text)).toEqual({ icNumber: '850615101234', name: 'SAMPLE A/L DEMO' });
  });

  it('keeps name words that are also place or religion words', () => {
    const text = `900101-14-5678\nNURUL ISLAM BINTI\nSHAH ALAM\n3 JALAN CONTOH`;
    expect(readMyKad(text).name).toBe('NURUL ISLAM BINTI SHAH ALAM');
  });

  it('skips junk lines from the photo box and stray marks at line ends', () => {
    // As Tesseract read a glary sample photo.
    const text = `KAD PENGENALAN MALAYSIA\nIDENTITY CARD\n880212-10-5521 |\n|\n|\nli |\nSAMPLE PERSON ONE\nBIN CONTOH _ el\n12 JALAN CONTOH 3`;
    expect(readMyKad(text)).toEqual({
      icNumber: '880212105521',
      name: 'SAMPLE PERSON ONE BIN CONTOH',
    });
  });

  it('keeps a mixed-case word of a real name, and repairs A/L read as AIL', () => {
    const small = `910707-14-6632 | |\n| |\ni\n| Ny\nDEMO Woman I |\nBINT SAMPEL ee\n12 JALAN`;
    expect(readMyKad(small).name).toBe('DEMO WOMAN BINT SAMPEL');
    expect(readMyKad(`750430-08-1189\n1\n|\nTEST AIL RAMAN\n12 JALAN`).name).toBe('TEST A/L RAMAN');
  });

  it('drops a one- or two-letter bit of card pattern at the end of a line', () => {
    expect(readMyKad(`900101-14-5678\nSAMPLE DRIVER\nBIN DEMO LS\n12 JALAN`).name).toBe(
      'SAMPLE DRIVER BIN DEMO',
    );
  });

  it('keeps short name words in capitals (AH, NG) and @', () => {
    expect(readMyKad(`690923-05-3016\nNG AH KOW @ SAMPLE\n3 JALAN`).name).toBe(
      'NG AH KOW @ SAMPLE',
    );
  });

  it('gives the number without a name when the name is unreadable', () => {
    const text = `900101-14-5678\n12 JALAN CONTOH`;
    expect(readMyKad(text)).toEqual({ icNumber: '900101145678', name: null });
  });

  it('ignores numbers that cannot be an IC', () => {
    expect(readMyKad('Phone 012-345 6789\n991332-14-5678\n900101-00-5678')).toEqual({
      icNumber: null,
      name: null,
    });
    expect(readMyKad('')).toEqual({ icNumber: null, name: null });
  });

  it('checks real dates, including 29 February', () => {
    expect(validIcNumber('000229140001')).toBe(true);
    expect(validIcNumber('010229140001')).toBe(false);
    expect(validIcNumber('900431140001')).toBe(false);
  });

  it('formats and masks for screens', () => {
    expect(formatIc('900101145678')).toBe('900101-14-5678');
    expect(maskIc('900101145678')).toBe('••••••-••-5678');
  });
});
