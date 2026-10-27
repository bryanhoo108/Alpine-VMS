import type { Adapters } from '@vms/adapters';
import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import type { EventBus } from '../events.js';

/** What services need. AppContext satisfies it. */
export interface ServiceDeps {
  db: Db;
  adapters: Adapters;
  events: EventBus;
  config: Config;
  now: () => Date;
}
