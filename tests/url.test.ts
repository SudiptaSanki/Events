import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeUrl } from "../src/normalize/url.js";

describe("url normalization (spec 54/55)", () => {
  it("strips tracking params, fragments, trailing slash; keeps required params", () => {
    const r = normalizeUrl("https://Devfolio.co/HackFest/?utm_source=x&fbclid=1&team=abc#section");
    assert.equal(r.valid, true);
    assert.equal(r.canonical, "https://devfolio.co/HackFest?team=abc");
    assert.equal(r.isHttps, true);
    assert.equal(r.isShortUrl, false);
  });
  it("flags short URLs for resolution", () => {
    const r = normalizeUrl("https://bit.ly/abc123?utm_medium=social");
    assert.equal(r.isShortUrl, true);
    assert.equal(r.canonical, "https://bit.ly/abc123");
  });
  it("rejects non-http schemes and unparsable input", () => {
    assert.equal(normalizeUrl("ftp://evil.example/x").valid, false);
    assert.equal(normalizeUrl("").valid, false);
    assert.equal(normalizeUrl("::::").valid, false);
  });
  it("marks insecure http without rejecting parse (pipeline decides)", () => {
    const r = normalizeUrl("http://example.com/register");
    assert.equal(r.valid, true);
    assert.equal(r.isHttps, false);
  });
});
