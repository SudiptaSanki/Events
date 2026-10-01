import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { clearRobotsCache } from "../src/discovery/robots.js";
import { createStaticResolver } from "../src/verification/linkVerification.js";
import { resolveOfficialContext } from "../src/verification/resolve.js";
import { fakeWeb } from "./helpers.js";

const EVENT_PAGE = `<html><head><title>Example AI Hack 2026</title></head><body>
<h1>Example AI Hack 2026</h1><p>Organized by Example University.</p>
<a href="https://register.example.edu.in/form">Register here</a></body></html>`;

const REG_PAGE = `<html><head><title>Registration — Example AI Hack</title></head><body>
<h1>Example AI Hack 2026 Registration</h1><p>Example University invites students.</p></body></html>`;

const UNRELATED_PAGE = `<html><head><title>Cheap Prizes</title></head><body><p>Win prizes now.</p></body></html>`;

describe("official-source resolution (spec 8/10)", () => {
  beforeEach(() => clearRobotsCache());

  it("L3 first-party: domain claimed, cross-reference + identity confirmed", async () => {
    const fetchFn = fakeWeb({
      "example.edu.in/ai-hack": { body: EVENT_PAGE },
      "register.example.edu.in/form": { body: REG_PAGE },
    });
    const ctx = await resolveOfficialContext({
      eventUrl: "https://example.edu.in/ai-hack",
      registrationUrl: "https://register.example.edu.in/form",
      title: "Example AI Hack 2026",
      organizer: "Example University",
      sourceLevel: 3,
      fetchFn,
      redirectResolver: createStaticResolver({}),
    });
    assert.equal(ctx.officialDomain, "example.edu.in");
    assert.equal(ctx.officialPageExists, true);
    assert.equal(ctx.officialPageLinksToRegistration, true);
    assert.equal(ctx.eventIdentityMatches, true);
  });

  it("L5 platform listing: domain never promoted to official", async () => {
    const fetchFn = fakeWeb({
      "platform.example/hack": { body: EVENT_PAGE },
      "register.example.edu.in/form": { body: REG_PAGE },
    });
    const ctx = await resolveOfficialContext({
      eventUrl: "https://platform.example/hack",
      registrationUrl: "https://register.example.edu.in/form",
      title: "Example AI Hack 2026",
      organizer: "Example University",
      sourceLevel: 5,
      fetchFn,
      redirectResolver: createStaticResolver({}),
    });
    assert.equal(ctx.officialDomain, null);
    assert.equal(ctx.officialPageExists, false);
    assert.equal(ctx.officialPageLinksToRegistration, false); // listing links don't count
    assert.equal(ctx.eventIdentityMatches, true); // identity still checkable
  });

  it("identity mismatch and unlinking registration are detected", async () => {
    const fetchFn = fakeWeb({
      "example.edu.in/ai-hack": { body: `<html><body><h1>Example AI Hack</h1></body></html>` },
      "evil.example/reg": { body: UNRELATED_PAGE },
    });
    const ctx = await resolveOfficialContext({
      eventUrl: "https://example.edu.in/ai-hack",
      registrationUrl: "https://evil.example/reg",
      title: "Example AI Hack 2026",
      organizer: "Example University",
      sourceLevel: 3,
      fetchFn,
      redirectResolver: createStaticResolver({}),
    });
    assert.equal(ctx.officialPageLinksToRegistration, false);
    assert.equal(ctx.eventIdentityMatches, false);
  });

  it("robots-blocked pages degrade to unknown, never to assumed-truth", async () => {
    const fetchFn = fakeWeb(
      { "closed.example/e": { body: EVENT_PAGE } },
      { "closed.example": "User-agent: *\nDisallow: /\n" },
    );
    const ctx = await resolveOfficialContext({
      eventUrl: "https://closed.example/e",
      registrationUrl: "https://closed.example/e/reg",
      title: "Something",
      organizer: "Someone",
      sourceLevel: 3,
      fetchFn,
      redirectResolver: createStaticResolver({}),
    });
    assert.equal(ctx.officialPageExists, false);
    assert.equal(ctx.eventIdentityMatches, null);
    assert.ok(ctx.fetchErrors.length > 0);
  });
});
