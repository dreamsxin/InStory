// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookieStore = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieStore.get(name);
      return value === undefined ? undefined : { name, value };
    }
  })
}));

const fetchMock = vi.fn();

beforeEach(() => {
  cookieStore.clear();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function callApiFetch(path: string, init?: RequestInit): Promise<void> {
  const { apiFetch } = await import("./api.js");
  await apiFetch(path, init);
}

function lastRequest(): { url: string; init: RequestInit & { headers: Headers } } {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit & { headers: Headers }];
  return { url, init };
}

describe("apiFetch on the server", () => {
  it("forwards the caller's session cookie", async () => {
    cookieStore.set("instory_session", "token-abc");

    await callApiFetch("/api/me/stories");

    const { url, init } = lastRequest();
    expect(url).toBe("http://localhost:4000/api/me/stories");
    expect(init.headers.get("cookie")).toBe("instory_session=token-abc");
  });

  it("percent-encodes the token so odd characters cannot break the header", async () => {
    cookieStore.set("instory_session", "a b;c");

    await callApiFetch("/api/me/stories");

    expect(lastRequest().init.headers.get("cookie")).toBe("instory_session=a%20b%3Bc");
  });

  it("sends no cookie header when nobody is signed in", async () => {
    await callApiFetch("/api/me/stories");

    expect(lastRequest().init.headers.has("cookie")).toBe(false);
  });

  it("does not rely on browser credentials, which server fetch would ignore", async () => {
    cookieStore.set("instory_session", "token-abc");

    await callApiFetch("/api/me/stories");

    expect(lastRequest().init.credentials).toBeUndefined();
  });

  it("defaults to a JSON content type only when there is a body", async () => {
    await callApiFetch("/api/auth/login", { method: "POST", body: JSON.stringify({}) });
    expect(lastRequest().init.headers.get("content-type")).toBe("application/json");

    await callApiFetch("/api/auth/logout", { method: "POST" });
    expect(lastRequest().init.headers.has("content-type")).toBe(false);
  });

  it("keeps an explicit content type set by the caller", async () => {
    await callApiFetch("/api/anything", {
      method: "POST",
      body: "raw",
      headers: { "Content-Type": "text/plain" }
    });

    expect(lastRequest().init.headers.get("content-type")).toBe("text/plain");
  });

  it("never serves a cached response", async () => {
    await callApiFetch("/api/stories");

    expect(lastRequest().init.cache).toBe("no-store");
  });
});
