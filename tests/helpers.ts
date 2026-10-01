/**
 * Shared test helpers (network fakes). Import this — never another *.test.js
 * file (that would execute its suite twice in one process).
 */

/** Fake fetch serving canned pages + allow-all robots unless overridden. */
export function fakeWeb(
  pages: Record<string, { status?: number; body?: string }>,
  robotsOverrides: Record<string, string> = {},
): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    const u = new URL(url);
    if (u.pathname === "/robots.txt") {
      const body = robotsOverrides[u.host] ?? "User-agent: *\nDisallow:\n";
      return new Response(body, { status: 200, headers: { "Content-Type": "text/plain" } });
    }
    const hit = pages[`${u.host}${u.pathname}`] ?? pages[url];
    if (!hit) return new Response("missing", { status: 404 });
    return new Response(hit.body ?? "", {
      status: hit.status ?? 200,
      headers: { "Content-Type": "text/html" },
    });
  }) as unknown as typeof fetch;
}
