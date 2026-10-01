import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getRobotsRules, isAllowed, parseRobotsTxt, clearRobotsCache } from "../src/discovery/robots.js";

function fakeFetch(text: string, status = 200): typeof fetch {
  return (async () =>
    new Response(text, { status, headers: { "Content-Type": "text/plain" } })) as unknown as typeof fetch;
}

describe("robots.txt (spec 30)", () => {
  it("parses groups and applies longest-match with Allow winning ties", () => {
    const r = parseRobotsTxt("User-agent: *\nDisallow: /private\nAllow: /private/public\nSitemap: https://x.example/sitemap.xml");
    assert.equal(isAllowed(r, "https://x.example/private/secret"), false);
    assert.equal(isAllowed(r, "https://x.example/private/public/page"), true);
    assert.equal(isAllowed(r, "https://x.example/open"), true);
    assert.deepEqual(r.sitemaps, ["https://x.example/sitemap.xml"]);
  });
  it("prefers the most specific user-agent group", () => {
    const text = "User-agent: *\nDisallow: /\nUser-agent: IndiaHackathonIntel\nDisallow:";
    const r = parseRobotsTxt(text, "IndiaHackathonIntel/0.1 (+event-discovery)");
    assert.equal(isAllowed(r, "https://x.example/a"), true);
    const generic = parseRobotsTxt(text, "SomeOtherBot/1.0");
    assert.equal(isAllowed(generic, "https://x.example/a"), false);
  });
  it("404 means no restrictions; 500 fails closed", async () => {
    clearRobotsCache();
    const open = await getRobotsRules("https://a.example/x", fakeFetch("", 404));
    assert.equal(isAllowed(open, "https://a.example/x"), true);
    clearRobotsCache();
    const closed = await getRobotsRules("https://b.example/x", fakeFetch("", 500));
    assert.equal(isAllowed(closed, "https://b.example/x"), false);
  });
  it("network failure fails closed (never crawl blind)", async () => {
    clearRobotsCache();
    const boom = (async () => {
      throw new Error("down");
    }) as unknown as typeof fetch;
    const rules = await getRobotsRules("https://c.example/x", boom);
    assert.equal(isAllowed(rules, "https://c.example/x"), false);
  });
});
