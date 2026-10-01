/** Apply schema.sql to the local SQLite dev database. */
import { migrate, openDatabase, tableCounts } from "../src/db/sqlite.js";

const db = openDatabase();
const version = migrate(db);
console.log(JSON.stringify({ ok: true, version, counts: tableCounts(db) }));
db.close();
