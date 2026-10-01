import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { filterSitemapUrls, parseSitemap } from "../src/discovery/sitemap.js";

const INDEX = `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<sitemap><loc>https://x.example/sitemap-events.xml</loc></sitemap>
<sitemap><loc>https://x.example/sitemap-blog.xml</loc></sitemap></sitemapindex>`;

const URLSET = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>https://x.example/hackathon-2026</loc><lastmod>2026-09-01</lastmod></url>
<url><loc>https://x.example/about</loc></url>
<url><loc>https://x.example/logo.png</loc></url>
<url><loc>not a url</loc></url></urlset>`;

describe("sitemap parser (spec 4)", () => {
  it("parses index and urlset, drops invalid locs", () => {
    const idx = parseSitemap(INDEX);
    assert.equal(idx.kind, "index");
    assert.equal(idx.urls.length, 2);
    const set = parseSitemap(URLSET);
    assert.equal(set.kind, "urlset");
    assert.equal(set.urls.length, 3); // invalid loc dropped
  });
  it("filters to event-like URLs, excludes assets", () => {
    const set = parseSitemap(URLSET);
    const kept = filterSitemapUrls(set.urls, [/hackathon/i, /event/i]);
    assert.deepEqual(kept.map((u) => u.loc), ["https://x.example/hackathon-2026"]);
  });
  it("rejects non-sitemap content", () => {
    assert.equal(parseSitemap("<html></html>").ok, false);
  });
});
