/**
 * Run discovery across MVP sources. Honors DRY_RUN=true (default): discovers
 * and classifies without writing to the database or sending anything.
 */
import { migrate, openDatabase } from "../src/db/sqlite.js";
import { createSqliteStore } from "../src/db/sqliteStore.js";
import { runDiscovery } from "../src/discovery/runner.js";
import { MVP_SOURCES, buildConnector } from "../src/sources/seeds.js";

const dryRun = (process.env.DRY_RUN ?? "true").toLowerCase() !== "false";
const onlyArg = process.argv[2]; // optional single slug
const onlySlugs = onlyArg ? new Set([onlyArg]) : undefined;

const db = openDatabase();
migrate(db);
const store = createSqliteStore(db);
const connectors = MVP_SOURCES.filter((s) => s.enabled && (!onlySlugs || onlySlugs.has(s.slug))).map((s) =>
  buildConnector(s),
);
const summary = await runDiscovery(store, connectors, { dryRun, onlySlugs });
console.log(JSON.stringify({ dryRun, ...summary }, null, 2));
db.close();
