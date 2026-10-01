import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyDomainRelationship, detectLookalike } from "../src/security/domains.js";

describe("domain classification (spec 11/12)", () => {
  it("recognizes same domain and subdomain", () => {
    assert.equal(classifyDomainRelationship("iitb.ac.in", "iitb.ac.in").relationship, "SAME_DOMAIN");
    assert.equal(classifyDomainRelationship("hackathon.iitb.ac.in", "iitb.ac.in").relationship, "SUBDOMAIN");
  });
  it("allows legitimate external platforms without suspicion", () => {
    const c = classifyDomainRelationship("devfolio.co", "iitb.ac.in");
    assert.equal(c.relationship, "KNOWN_EVENT_PLATFORM");
    assert.equal(detectLookalike("devfolio.co", "iitb.ac.in").suspicious, false);
  });
  it("allows known form providers", () => {
    const c = classifyDomainRelationship("docs.google.com", "xyzcollege.edu.in");
    assert.equal(c.providerCategory, "KNOWN_FORM_PROVIDER");
  });
  it("flags lookalike: substitution, hyphenation, punycode", () => {
    assert.ok(detectLookalike("examp1e.com", "example.com").suspicious);
    assert.ok(detectLookalike("example-hackathon-registration.com", "example.com").suspicious);
    assert.ok(detectLookalike("xn--exmple-cua.com", "example.com").suspicious);
  });
  it("does not flag unrelated domains as lookalikes without evidence", () => {
    assert.equal(detectLookalike("unstop.com", "iitb.ac.in").suspicious, false);
  });
});
