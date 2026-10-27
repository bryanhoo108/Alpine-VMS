import { loadConfig } from '../config.js';
import { connect, runMigrations } from './client.js';

const database = connect(loadConfig().databaseUrl);
try {
  await runMigrations(database.db);
  console.log('Migrations applied.');
} finally {
  await database.close();
}
