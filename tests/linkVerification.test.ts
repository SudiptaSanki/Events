import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createStaticResolver, verifyLink } from "../src/verification/linkVerification.js";

describe("link verification pipeline (spec 45/10)", () => {
  it("approves officially-referenced subdomain registration", async () => {
    const r = await verifyLink(
      { rawUrl: "https://hackathon.iitb.ac.in/register?utm_source=x", officialDomain: "iitb.ac.in", officialPageLinksToUrl: true, eventIdentityMatches: true, threatReputationHit: false },
      createStaticResolver({}),
    );
    assert.equal(r.outcome, "APPROVE");
    assert.equal(r.domainRelationship, "SUBDOMAIN");
    assert.equal(r.canonicalUrl, "https://hackathon.iitb.ac.in/register");
  });
  it("resolves redirect chains and flags excessive hops", async () => {
    const r = await verifyLink(
      { rawUrl: "https://bit.ly/abc", officialDomain: "example.com", officialPageLinksToUrl: false, eventIdentityMatches: null, threatReputationHit: false },
      createStaticResolver({
        "https://bit.ly/abc": {
          finalUrl: "https://evil.example/x", redirectCount: 4,
          chain: [{ url: "https://bit.ly/abc", status: 301 }, { url: "https://evil.example/x", status: 200 }],
          error: null,
        },
      }),
    );
    assert.ok(r.securityFlags.includes("SHORT_URL") || r.redirectCount >= 4);
    assert.notEqual(r.outcome, "APPROVE");
  });
  it("rejects threat-reputation hits", async () => {
    const r = await verifyLink(
      { rawUrl: "https://evil.example/register", officialDomain: "example.com", officialPageLinksToUrl: false, eventIdentityMatches: false, threatReputationHit: true },
      createStaticResolver({}),
    );
    assert.equal(r.outcome, "REJECT");
  });
  it("rejects insecure unknown-domain registration", async () => {
    const r = await verifyLink(
      { rawUrl: "http://free-prizes.example/register", officialDomain: null, officialPageLinksToUrl: false, eventIdentityMatches: false, threatReputationHit: false },
      createStaticResolver({}),
    );
    assert.equal(r.outcome, "REJECT");
  });
});
