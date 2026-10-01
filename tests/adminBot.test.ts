import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { migrate, openDatabase } from "../src/db/sqlite.js";
import { createSqliteStore } from "../src/db/sqliteStore.js";
import { handleAdminUpdate } from "../src/notify/adminBot.js";

const NOW = "2026-10-01T12:00:00.000Z";
const ADMINS = ["111"];

function seed(): { db: ReturnType<typeof openDatabase>; store: ReturnType<typeof createSqliteStore> } {
  const db = openDatabase(":memory:");
  migrate(db);
  const store = createSqliteStore(db);
  return { db, store };
}

async function seedReview(store: ReturnType<typeof createSqliteStore>): Promise<void> {
  await store.exec(
    "INSERT INTO events(event_id,title,normalized_title,format,status,verification_score,first_seen,last_seen) VALUES (?,?,?,'ONLINE','NEEDS_REVIEW',50,?,?)",
    "e1", "E1", "e1", NOW, NOW,
  );
  await store.exec("INSERT INTO review_queue(event_id,reason,score,created_at,resolved) VALUES (?,?,?, ?,0)", "e1", "R", 50, NOW);
}

const msg = (chatId: number | string, text: string) => ({ message: { chat: { id: chatId }, text } });

describe("telegram admin bot (spec 35)", () => {
  it("ignores unauthorized chats without a reply", async () => {
    const { db, store } = seed();
    assert.equal(await handleAdminUpdate(store, msg(999, "/review"), { adminChatIds: ADMINS, now: () => NOW }), null);
    assert.equal(await handleAdminUpdate(store, {}, { adminChatIds: ADMINS, now: () => NOW }), null);
    db.close();
  });
  it("answers /review, /approve, /stats for admins", async () => {
    const { db, store } = seed();
    await seedReview(store);
    const review = await handleAdminUpdate(store, msg(111, "/review"), { adminChatIds: ADMINS, now: () => NOW });
    assert.ok(review && review.includes("e1"));
    const approved = await handleAdminUpdate(store, msg("111", "/approve e1"), { adminChatIds: ADMINS, now: () => NOW });
    assert.ok(approved && approved.includes("Approved"));
    const again = await handleAdminUpdate(store, msg(111, "/review"), { adminChatIds: ADMINS, now: () => NOW });
    assert.ok(again && again.includes("empty"));
    const stats = await handleAdminUpdate(store, msg(111, "/stats"), { adminChatIds: ADMINS, now: () => NOW });
    assert.ok(stats && stats.includes("reviewOpen"));
    db.close();
  });
  it("validates arguments and labels, handles unknowns", async () => {
    const { db, store } = seed();
    assert.ok((await handleAdminUpdate(store, msg(111, "/approve"), { adminChatIds: ADMINS, now: () => NOW }))?.includes("Usage"));
    assert.ok((await handleAdminUpdate(store, msg(111, "/bogus"), { adminChatIds: ADMINS, now: () => NOW }))?.includes("/help"));
    assert.ok((await handleAdminUpdate(store, msg(111, "/feedback e1 BOGUS"), { adminChatIds: ADMINS, now: () => NOW }))?.includes("LABEL"));
    assert.ok((await handleAdminUpdate(store, msg(111, "/event nope"), { adminChatIds: ADMINS, now: () => NOW }))?.includes("Unknown"));
    db.close();
  });
});
