import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase } from "./app-database.js";
import { LEGACY_USER_ID, UserStore } from "./user-store.js";

const openDatabases: AppDatabase[] = [];
const tempDirs: string[] = [];

function createStore(): UserStore {
  const dir = mkdtempSync(join(tmpdir(), "instory-user-store-"));
  tempDirs.push(dir);
  const database = new AppDatabase(join(dir, "users.sqlite"));
  openDatabases.push(database);
  return new UserStore(database);
}

afterEach(() => {
  while (openDatabases.length > 0) {
    openDatabases.pop()!.close();
  }
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("UserStore", () => {
  it("creates a user and finds it by id and email", () => {
    const store = createStore();
    const user = store.create({ email: "Reader@Example.com ", displayName: " 林向晚 ", password: "pw-12345678" });

    expect(user.email).toBe("Reader@Example.com");
    expect(user.displayName).toBe("林向晚");
    expect(user.role).toBe("reader");
    expect(store.findById(user.id)).toEqual(user);
    // Lookups are case-insensitive on the normalized email.
    expect(store.findByEmail("reader@example.com")?.id).toBe(user.id);
    expect(store.emailExists("READER@EXAMPLE.COM")).toBe(true);
    expect(store.findByEmail("nobody@example.com")).toBeNull();
  });

  it("rejects a duplicate email regardless of casing", () => {
    const store = createStore();
    store.create({ email: "reader@example.com", displayName: "读者", password: "pw-12345678" });

    expect(() =>
      store.create({ email: "READER@example.com", displayName: "冒名者", password: "pw-12345678" })
    ).toThrow();
  });

  it("never stores the password in a readable form", () => {
    const store = createStore();
    const user = store.create({ email: "reader@example.com", displayName: "读者", password: "pw-12345678" });

    const stored = store.findById(user.id);
    expect(JSON.stringify(stored)).not.toContain("pw-12345678");
  });

  it("verifies credentials and rejects wrong passwords and unknown accounts", () => {
    const store = createStore();
    const user = store.create({ email: "reader@example.com", displayName: "读者", password: "pw-12345678" });

    expect(store.verifyCredentials("reader@example.com", "pw-12345678")?.id).toBe(user.id);
    expect(store.verifyCredentials("reader@example.com", "wrong-password")).toBeNull();
    expect(store.verifyCredentials("nobody@example.com", "pw-12345678")).toBeNull();
  });

  it("cannot sign in as the seeded legacy user", () => {
    const store = createStore();

    expect(store.findById(LEGACY_USER_ID)?.displayName).toBe("本地读者");
    expect(store.verifyCredentials("legacy@instory.local", "disabled")).toBeNull();
    expect(store.verifyCredentials("legacy@instory.local", "")).toBeNull();
  });

  it("issues a session token that resolves back to the user", () => {
    const store = createStore();
    const user = store.create({ email: "reader@example.com", displayName: "读者", password: "pw-12345678" });

    const session = store.issueSession(user.id);

    expect(session.token).toBeTruthy();
    expect(store.findUserBySessionToken(session.token)?.id).toBe(user.id);
    expect(store.findUserBySessionToken("not-a-real-token")).toBeNull();
  });

  it("rejects and clears an expired session token", () => {
    const store = createStore();
    const user = store.create({ email: "reader@example.com", displayName: "读者", password: "pw-12345678" });
    const issuedAt = new Date("2026-05-20T00:00:00.000Z");

    const session = store.issueSession(user.id, 1000, issuedAt);

    expect(store.findUserBySessionToken(session.token, new Date("2026-05-20T00:00:00.500Z"))?.id).toBe(user.id);
    expect(store.findUserBySessionToken(session.token, new Date("2026-05-20T00:00:02.000Z"))).toBeNull();
    // The expired row is dropped on the failed lookup.
    expect(store.findUserBySessionToken(session.token, new Date("2026-05-20T00:00:00.500Z"))).toBeNull();
  });

  it("revokes one session while leaving the other sessions alone", () => {
    const store = createStore();
    const user = store.create({ email: "reader@example.com", displayName: "读者", password: "pw-12345678" });
    const first = store.issueSession(user.id);
    const second = store.issueSession(user.id);

    store.revokeSession(first.token);

    expect(store.findUserBySessionToken(first.token)).toBeNull();
    expect(store.findUserBySessionToken(second.token)?.id).toBe(user.id);

    store.revokeAllSessions(user.id);
    expect(store.findUserBySessionToken(second.token)).toBeNull();
  });

  it("prunes expired sessions in bulk", () => {
    const store = createStore();
    const user = store.create({ email: "reader@example.com", displayName: "读者", password: "pw-12345678" });
    const issuedAt = new Date("2026-05-20T00:00:00.000Z");

    store.issueSession(user.id, 1000, issuedAt);
    store.issueSession(user.id, 1000, issuedAt);
    const live = store.issueSession(user.id, 60_000, issuedAt);

    expect(store.deleteExpiredSessions(new Date("2026-05-20T00:00:05.000Z"))).toBe(2);
    expect(store.findUserBySessionToken(live.token, new Date("2026-05-20T00:00:05.000Z"))?.id).toBe(user.id);
  });

  it("supports admin accounts", () => {
    const store = createStore();
    const admin = store.create({
      email: "admin@example.com",
      displayName: "管理员",
      password: "pw-12345678",
      role: "admin"
    });

    expect(store.findById(admin.id)?.role).toBe("admin");
  });
});
