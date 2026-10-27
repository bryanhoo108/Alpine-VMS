/**
 * Fictional sample data for the SAP mock. No real customers or transporters.
 * Dates are relative to "now" so the demo always looks current.
 */
import type { SapBusinessPartner, SapDo, SapSdo, SapSdoLine } from './SapAdapter.js';

export const SAMPLE_PARTNERS: SapBusinessPartner[] = [
  { code: 'C0001', name: 'Customer Alpha Sdn Bhd', type: 'customer' },
  { code: 'C0002', name: 'Customer Bravo Trading', type: 'customer' },
  { code: 'C0003', name: 'Customer Charlie Engineering', type: 'customer' },
  { code: 'C0004', name: 'Customer Delta Hardware', type: 'customer' },
  { code: 'C0005', name: 'Customer Echo Construction', type: 'customer' },
  { code: 'T0001', name: 'Transporter One Logistics', type: 'transporter' },
  { code: 'T0002', name: 'Transporter Two Haulage', type: 'transporter' },
  { code: 'T0003', name: 'Transporter Three Lorry Services', type: 'transporter' },
  { code: 'T0004', name: 'Transporter Four Freight', type: 'transporter' },
];

type Item = Omit<SapSdoLine, 'lineNo' | 'pieces'>;

const ITEMS = {
  gi25: {
    itemCode: 'GI-025-M-6',
    description: 'GI pipe 25mm medium',
    size: '25mm (1")',
    spec: 'BS EN 10255 Medium',
    length: '6m',
  },
  gi50: {
    itemCode: 'GI-050-M-6',
    description: 'GI pipe 50mm medium',
    size: '50mm (2")',
    spec: 'BS EN 10255 Medium',
    length: '6m',
  },
  gi80h: {
    itemCode: 'GI-080-H-6',
    description: 'GI pipe 80mm heavy',
    size: '80mm (3")',
    spec: 'BS EN 10255 Heavy',
    length: '6m',
  },
  ms100: {
    itemCode: 'MS-100-L-6',
    description: 'Steel pipe 100mm light',
    size: '100mm (4")',
    spec: 'MS 863',
    length: '6m',
  },
  bk150: {
    itemCode: 'BK-150-6',
    description: 'Black steel pipe 150mm',
    size: '150mm (6")',
    spec: 'API 5L Gr B',
    length: '6m',
  },
  hs40: {
    itemCode: 'HS-40X40-2.0-6',
    description: 'Hollow section 40x40x2.0',
    size: '40x40x2.0mm',
    spec: 'JIS G3466',
    length: '6m',
  },
} satisfies Record<string, Item>;

const lines = (...items: [Item, number][]): SapSdoLine[] =>
  items.map(([item, pieces], i) => ({ lineNo: i, ...item, pieces }));

const DAY = 86_400_000;

export interface SapSampleData {
  partners: SapBusinessPartner[];
  sdos: SapSdo[];
  dos: SapDo[];
}

/**
 * Scenarios built in:
 * - 5001 split: delivered partly by DOs 8001 and 8002 yesterday, still open
 * - 5002 + 5003 combined: both copied into DO 8003 yesterday, still open
 * - 5014 closed (must not show as open)
 * - the rest open with no DO yet
 */
export function sapSampleData(now: Date): SapSampleData {
  /** That many days ago at `hour`, but never later than an hour before now. */
  const daysAgo = (d: number, hour = 9) => {
    const t = new Date(now.getTime() - d * DAY);
    t.setHours(hour, 0, 0, 0);
    const latest = now.getTime() - 3_600_000;
    return t.getTime() > latest ? new Date(latest) : t;
  };
  const sdo = (
    sdoNo: string,
    customerCode: string,
    age: number,
    l: SapSdoLine[],
    status: SapSdo['status'] = 'open',
  ): SapSdo => {
    const customer = SAMPLE_PARTNERS.find((p) => p.code === customerCode);
    if (!customer) throw new Error(`unknown customer ${customerCode}`);
    return {
      sdoNo,
      customerCode,
      customerName: customer.name,
      status,
      docDate: daysAgo(age),
      updatedAt: daysAgo(age),
      lines: l,
    };
  };

  const sdos: SapSdo[] = [
    sdo('5001', 'C0001', 3, lines([ITEMS.gi50, 400], [ITEMS.gi25, 600])),
    sdo('5002', 'C0002', 2, lines([ITEMS.gi80h, 120])),
    sdo('5003', 'C0002', 2, lines([ITEMS.ms100, 80], [ITEMS.hs40, 200])),
    sdo('5004', 'C0003', 2, lines([ITEMS.bk150, 40])),
    sdo('5005', 'C0004', 1, lines([ITEMS.gi25, 300], [ITEMS.gi50, 150])),
    sdo('5006', 'C0005', 1, lines([ITEMS.hs40, 500])),
    sdo('5007', 'C0001', 1, lines([ITEMS.gi80h, 60], [ITEMS.ms100, 60])),
    sdo('5008', 'C0003', 1, lines([ITEMS.gi50, 250])),
    sdo('5009', 'C0004', 0, lines([ITEMS.bk150, 24], [ITEMS.gi80h, 30])),
    sdo('5010', 'C0005', 0, lines([ITEMS.gi25, 800])),
    sdo('5011', 'C0002', 0, lines([ITEMS.ms100, 100])),
    sdo('5012', 'C0001', 0, lines([ITEMS.hs40, 150], [ITEMS.gi50, 100], [ITEMS.gi25, 100])),
    sdo('5013', 'C0003', 0, lines([ITEMS.gi80h, 90])),
    sdo('5014', 'C0004', 5, lines([ITEMS.gi50, 50]), 'closed'),
    sdo('5015', 'C0005', 0, lines([ITEMS.bk150, 36])),
  ];

  const dos: SapDo[] = [
    {
      doNo: '8001',
      customerCode: 'C0001',
      createdAt: daysAgo(1, 10),
      lines: [
        { lineNo: 0, itemCode: ITEMS.gi50.itemCode, pieces: 200, baseSdoNo: '5001', baseLineNo: 0 },
      ],
    },
    {
      doNo: '8002',
      customerCode: 'C0001',
      createdAt: daysAgo(1, 15),
      lines: [
        { lineNo: 0, itemCode: ITEMS.gi25.itemCode, pieces: 300, baseSdoNo: '5001', baseLineNo: 1 },
      ],
    },
    {
      doNo: '8003',
      customerCode: 'C0002',
      createdAt: daysAgo(1, 11),
      lines: [
        { lineNo: 0, itemCode: ITEMS.gi80h.itemCode, pieces: 60, baseSdoNo: '5002', baseLineNo: 0 },
        { lineNo: 1, itemCode: ITEMS.ms100.itemCode, pieces: 40, baseSdoNo: '5003', baseLineNo: 0 },
      ],
    },
  ];

  return { partners: SAMPLE_PARTNERS, sdos, dos };
}
