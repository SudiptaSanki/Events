/** DEV ONLY: wipe discovery-derived rows, keep registry + schema. Never run in prod. */
import { openDatabase } from "../src/db/sqlite.js";

if ((process.env.NODE_ENV ?? "") === "production") {
  console.error("refusing to reset in production");
  process.exit(1);
}
const db = openDatabase();
db.exec("DELETE FROM events; DELETE FROM source_runs; DELETE FROM dead_letter_queue;");
db.exec("UPDATE source_registry SET last_run = NULL, last_status = NULL;");
console.log(JSON.stringify({ ok: true, note: "events, runs and DLQ cleared; registry kept" }));
db.close();
