/**
 * Local admin CLI (spec 35). Usage:
 *   npm run admin -- review
 *   npm run admin -- approve EVENT_ID | reject EVENT_ID | recheck EVENT_ID
 *   npm run admin -- disable-source SLUG | enable-source SLUG
 *   npm run admin -- source-status | event EVENT_ID | feedback EVENT_ID LABEL | stats
 */
import { openDatabase } from "../src/db/sqlite.js";
import { createSqliteStore } from "../src/db/sqliteStore.js";
import {
  approveEvent, eventDetail, listReview, recheckEvent, recordFeedback, rejectEvent,
  setSourceEnabled, sourceStatus, stats, type FeedbackLabel,
} from "../src/admin/ops.js";

const [cmd, ...rest] = process.argv.slice(2);
const now = new Date().toISOString();
const db = openDatabase();
const store = createSqliteStore(db);

const out = (v: unknown): void => console.log(JSON.stringify(v, null, 2));
let ok = true;

switch (cmd) {
  case "review": out(await listReview(store)); break;
  case "approve": ok = await approveEvent(store, rest[0] ?? "", now); out({ ok }); break;
  case "reject": ok = await rejectEvent(store, rest[0] ?? "", now); out({ ok }); break;
  case "recheck": ok = await recheckEvent(store, rest[0] ?? "", now); out({ ok }); break;
  case "disable-source": ok = await setSourceEnabled(store, rest[0] ?? "", false); out({ ok }); break;
  case "enable-source": ok = await setSourceEnabled(store, rest[0] ?? "", true); out({ ok }); break;
  case "source-status": out(await sourceStatus(store)); break;
  case "event": out(await eventDetail(store, rest[0] ?? "")); break;
  case "feedback": ok = await recordFeedback(store, rest[0] ?? "", (rest[1] ?? "FALSE_POSITIVE") as FeedbackLabel, now); out({ ok }); break;
  case "stats": out(await stats(store)); break;
  default:
    console.error("unknown command (review|approve|reject|recheck|disable-source|enable-source|source-status|event|feedback|stats)");
    process.exitCode = 1;
}
db.close();
if (!ok) process.exitCode = 1;
