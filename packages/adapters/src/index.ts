import { systemClock, type Clock } from './clock.js';
import type { CwisAdapter } from './cwis/CwisAdapter.js';
import { MockCwisAdapter } from './cwis/MockCwisAdapter.js';
import type { LprAdapter } from './lpr/LprAdapter.js';
import { MockLprAdapter } from './lpr/MockLprAdapter.js';
import { LogNotifier } from './notify/LogNotifier.js';
import type { Notifier } from './notify/Notifier.js';
import { MockSapAdapter } from './sap/MockSapAdapter.js';
import type { SapAdapter } from './sap/SapAdapter.js';

export * from './clock.js';
export * from './sap/SapAdapter.js';
export * from './sap/MockSapAdapter.js';
export * from './sap/sample-data.js';
export * from './cwis/CwisAdapter.js';
export * from './cwis/MockCwisAdapter.js';
export * from './lpr/LprAdapter.js';
export * from './lpr/MockLprAdapter.js';
export * from './lpr/sample-plates.js';
export * from './notify/Notifier.js';
export * from './notify/LogNotifier.js';

export type AdapterMode = 'mock';

export interface AdapterConfig {
  sap: AdapterMode;
  cwis: AdapterMode;
  lpr: AdapterMode;
  notifier: 'log';
  now?: Clock;
  log?: (line: string) => void;
}

export interface Adapters {
  sap: SapAdapter;
  cwis: CwisAdapter;
  lpr: LprAdapter;
  notifier: Notifier;
  /** Mock controls, present only for adapters running as mocks (dev panel, tests). */
  mocks: { sap?: MockSapAdapter; cwis?: MockCwisAdapter; lpr?: MockLprAdapter };
}

/** Read adapter modes from environment variables (SAP_ADAPTER, CWIS_ADAPTER, LPR_ADAPTER). */
export function adapterConfigFromEnv(env: NodeJS.ProcessEnv): AdapterConfig {
  const mode = (name: string): AdapterMode => {
    const value = env[name] ?? 'mock';
    if (value !== 'mock') {
      throw new Error(
        `${name}=${value}: only "mock" is available until the real integration is agreed`,
      );
    }
    return value;
  };
  return {
    sap: mode('SAP_ADAPTER'),
    cwis: mode('CWIS_ADAPTER'),
    lpr: mode('LPR_ADAPTER'),
    notifier: 'log',
  };
}

/** The one place that decides mock or real. Screens and services see only the interfaces. */
export function createAdapters(config: AdapterConfig): Adapters {
  const now = config.now ?? systemClock;
  const sap = new MockSapAdapter({ now });
  const cwis = new MockCwisAdapter({ now });
  const lpr = new MockLprAdapter({ now });
  return {
    sap,
    cwis,
    lpr,
    notifier: new LogNotifier(config.log),
    mocks: { sap, cwis, lpr },
  };
}
