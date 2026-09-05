import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// next/headers must never be reachable from the browser bundle, so this stub throws
// to prove the browser branch does not touch it.
vi.mock("next/headers", () => ({
  cookies: async () => {
    throw new Error("next/headers must not be used in the browser");
  }
}));

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function lastRequest(): { url: string; init: RequestInit & { headers: Headers } } {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit & { headers: Headers }];
  return { url, init };
}

describe("apiFetch in the browser", () => {
  it("stays on this origin so the host-only session cookie is attached", async () => {
    const { apiFetch } = await import("./api.js");

    await apiFetch("/api/me/sessions");

    const { url, init } = lastRequest();
    // Relative on purpose: next.config.ts rewrites /api/* to the API. Aiming at the
    // API host directly would drop the cookie, since it belongs to the web origin.
    expect(url).toBe("/api/me/sessions");
    expect(init.credentials).toBe("include");
    // The cookie is never set by hand here; document.cookie is HttpOnly.
    expect(init.headers.has("cookie")).toBe(false);
  });

  it("still applies the JSON content type and no-store cache", async () => {
    const { apiFetch } = await import("./api.js");

    await apiFetch("/api/sessions/s1/turns", { method: "POST", body: JSON.stringify({}) });

    const { init } = lastRequest();
    expect(init.headers.get("content-type")).toBe("application/json");
    expect(init.cache).toBe("no-store");
  });
});
