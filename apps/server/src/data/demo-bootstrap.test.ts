import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../db/app-database.js";
import { ReaderProfileStore } from "../db/reader-profile-store.js";
import { UserStore } from "../db/user-store.js";
import { bootstrapDemoData, DEMO_ACCOUNTS } from "./demo-bootstrap.js";
import { StoryCatalog } from "./story-catalog.js";

const PASSWORD = "demo-password-123";

let database: AppDatabase;
let tempDir: string;
let userStore: UserStore;
let storyCatalog: StoryCatalog;
let readerProfileStore: ReaderProfileStore;

function bootstrap() {
  return bootstrapDemoData({ userStore, storyCatalog, readerProfileStore, password: PASSWORD });
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "instory-demo-bootstrap-"));
  database = new AppDatabase(join(tempDir, "demo.sqlite"));
  userStore = new UserStore(database);
  storyCatalog = new StoryCatalog(database);
  readerProfileStore = new ReaderProfileStore(database);
});

afterEach(() => {
  database.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("bootstrapDemoData", () => {
  it("gives a fresh install one account of each kind, and they can sign in", () => {
    const result = bootstrap();

    expect(result.createdAccounts).toEqual(DEMO_ACCOUNTS.map((account) => account.email));

    const admin = userStore.findByEmail("admin@instory.local");
    expect(admin?.role).toBe("admin");
    // An admin account nobody can sign into is no better than no account: the console
    // is gated on the role, and the role is only reachable through a session.
    expect(userStore.verifyCredentials("admin@instory.local", PASSWORD)?.id).toBe(admin?.id);
    expect(userStore.findByEmail("author@instory.local")?.role).toBe("reader");
    expect(userStore.findByEmail("reader@instory.local")?.role).toBe("reader");
  });

  it("leaves the shelf with something to read, owned by the demo author", () => {
    const result = bootstrap();
    const authorId = userStore.findByEmail("author@instory.local")?.id ?? "";

    expect(result.createdStories).toEqual(["moon-market", "void-postman"]);
    expect(storyCatalog.listStoriesByOwner(authorId).map((story) => story.id)).toEqual([
      "moon-market",
      "void-postman"
    ]);
    // Public, or the shelf would still look empty to everyone but the author.
    expect(storyCatalog.listPublicStories().map((story) => story.id)).toEqual([
      "moon-market",
      "rain-mansion",
      "void-postman"
    ]);

    // One story with planned beats and one without: the two shapes a card's length
    // line has to handle.
    expect(storyCatalog.countPlannedBeats().get("moon-market")).toBe(3);
    expect(storyCatalog.countPlannedBeats().has("void-postman")).toBe(false);
    expect(storyCatalog.findStory("moon-market")?.characters).toHaveLength(2);

    // And the demo reader has a role to enter with, so 入戏身份 is not just 默认角色.
    const readerId = userStore.findByEmail("reader@instory.local")?.id ?? "";
    expect(readerProfileStore.listByOwner(readerId).map((profile) => profile.name)).toEqual(["江照"]);
  });

  it("does nothing on a second run, so a restart cannot duplicate or overwrite", () => {
    bootstrap();
    const again = bootstrap();

    expect(again).toEqual({ createdAccounts: [], createdStories: [] });
    // Only the three demo addresses: migration 4 seeds the legacy local reader at the
    // same domain, and it is not ours to count.
    const demoEmails = DEMO_ACCOUNTS.map((account) => account.email);
    expect(userStore.listUsers().filter((user) => demoEmails.includes(user.email))).toHaveLength(3);
    expect(storyCatalog.listStories()).toHaveLength(3);
    expect(readerProfileStore.listByOwner(userStore.findByEmail("reader@instory.local")?.id ?? "")).toHaveLength(1);
  });

  it("leaves an address that is already registered exactly as it is", () => {
    // Someone registered this one themselves - possibly with a different password and
    // no intention of being an administrator. Handing it the demo password, or the
    // admin role, on the next boot would be a back door.
    const mine = userStore.create({
      email: "admin@instory.local",
      displayName: "真人管理员",
      password: "my-own-password-1",
      role: "reader"
    });

    const result = bootstrap();

    expect(result.createdAccounts).toEqual(["author@instory.local", "reader@instory.local"]);
    const after = userStore.findByEmail("admin@instory.local");
    expect(after?.id).toBe(mine.id);
    expect(after?.displayName).toBe("真人管理员");
    expect(after?.role).toBe("reader");
    expect(userStore.verifyCredentials("admin@instory.local", PASSWORD)).toBeNull();
    // And the rest of the set still lands: a half-set install gets its missing half.
    expect(result.createdStories).toEqual(["moon-market", "void-postman"]);
  });
});

