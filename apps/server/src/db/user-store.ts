import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { AppDatabase } from "./app-database.js";

export type UserRole = "reader" | "admin";

/** The legacy placeholder owner id, seeded as a real user by migration 4. */
export const LEGACY_USER_ID = "local-reader";

export interface UserRecord {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  /** When the account was suspended, or null while it is in good standing. */
  disabledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserInput {
  email: string;
  displayName: string;
  password: string;
  role?: UserRole;
}

export interface IssuedSession {
  token: string;
  expiresAt: string;
}

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_COST = 16384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELISATION = 1;

const SELECT_USER = `
  SELECT id,
         email,
         display_name AS displayName,
         role,
         disabled_at AS disabledAt,
         created_at AS createdAt,
         updated_at AS updatedAt
    FROM users
`;

export class UserStore {
  private readonly database: AppDatabase;

  constructor(database: AppDatabase) {
    this.database = database;
  }

  /** Throws when the normalized email is already taken. */
  create(input: CreateUserInput): UserRecord {
    const now = new Date().toISOString();
    const user: UserRecord = {
      id: `user_${randomUUID()}`,
      email: input.email.trim(),
      displayName: input.displayName.trim(),
      role: input.role ?? "reader",
      disabledAt: null,
      createdAt: now,
      updatedAt: now
    };

    this.database.db
      .prepare(
        `INSERT INTO users (id, email, email_normalized, display_name, password_hash, role, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        user.id,
        user.email,
        normalizeEmail(user.email),
        user.displayName,
        hashPassword(input.password),
        user.role,
        now,
        now
      );

    return user;
  }

  findById(id: string): UserRecord | null {
    const row = this.database.db.prepare(`${SELECT_USER} WHERE id = ?`).get(id) as UserRecord | undefined;
    return row ?? null;
  }

  findByEmail(email: string): UserRecord | null {
    const row = this.database.db
      .prepare(`${SELECT_USER} WHERE email_normalized = ?`)
      .get(normalizeEmail(email)) as UserRecord | undefined;
    return row ?? null;
  }

  /**
   * Accounts for the console, newest first. Capped because the console shows a
   * page, not the whole table: an operator looking for someone who just signed up
   * needs the recent end, and pulling every row would only get slower with use.
   */
  listUsers(limit = 50): UserRecord[] {
    return this.database.db
      .prepare(`${SELECT_USER} ORDER BY created_at DESC LIMIT ?`)
      .all(Math.max(1, Math.min(200, Math.trunc(limit)))) as unknown as UserRecord[];
  }

  /** Promotes or demotes an account. Returns null when the id is unknown. */
  setRole(userId: string, role: UserRole, now = new Date()): UserRecord | null {
    const result = this.database.db
      .prepare("UPDATE users SET role = ?, updated_at = ? WHERE id = ?")
      .run(role, now.toISOString(), userId);
    return result.changes > 0 ? this.findById(userId) : null;
  }

  /**
   * Suspends or restores an account. Suspending does not touch sessions - the caller
   * revokes those - because the two are separate facts: one is "may not sign in", the
   * other is "is not signed in".
   */
  setDisabled(userId: string, disabled: boolean, now = new Date()): UserRecord | null {
    const result = this.database.db
      .prepare("UPDATE users SET disabled_at = ?, updated_at = ? WHERE id = ?")
      .run(disabled ? now.toISOString() : null, now.toISOString(), userId);
    return result.changes > 0 ? this.findById(userId) : null;
  }



  emailExists(email: string): boolean {
    const row = this.database.db
      .prepare("SELECT 1 AS found FROM users WHERE email_normalized = ?")
      .get(normalizeEmail(email)) as { found: number } | undefined;
    return Boolean(row);
  }

  /**
   * Verifies a password against the stored hash. Returns the user only on success,
   * and always runs a comparison so a missing account and a wrong password cost
   * roughly the same.
   */
  verifyCredentials(email: string, password: string): UserRecord | null {
    const row = this.database.db
      .prepare("SELECT id, password_hash AS passwordHash FROM users WHERE email_normalized = ?")
      .get(normalizeEmail(email)) as { id: string; passwordHash: string } | undefined;

    const storedHash = row?.passwordHash ?? "scrypt$16384$8$1$00$00";
    const matches = verifyPassword(password, storedHash);

    if (!row || !matches) {
      return null;
    }

    return this.findById(row.id);
  }

  /** Returns the raw token, which is never persisted; only its SHA-256 is stored. */
  issueSession(userId: string, ttlMs = SESSION_TTL_MS, now = new Date()): IssuedSession {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(now.getTime() + ttlMs).toISOString();

    this.database.db
      .prepare("INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .run(hashToken(token), userId, now.toISOString(), expiresAt);

    return { token, expiresAt };
  }

  findUserBySessionToken(token: string, now = new Date()): UserRecord | null {
    const row = this.database.db
      .prepare("SELECT user_id AS userId, expires_at AS expiresAt FROM auth_sessions WHERE token_hash = ?")
      .get(hashToken(token)) as { userId: string; expiresAt: string } | undefined;

    if (!row) {
      return null;
    }

    if (new Date(row.expiresAt).getTime() <= now.getTime()) {
      this.revokeSession(token);
      return null;
    }

    const user = this.findById(row.userId);

    // A suspended account resolves to nobody, whatever it is still holding. Sessions
    // are revoked when an account is suspended, so this is the belt to that braces:
    // a token issued a moment before, or restored from anywhere, still stops working.
    if (user?.disabledAt) {
      return null;
    }

    return user;
  }

  revokeSession(token: string): void {
    this.database.db.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").run(hashToken(token));
  }

  /**
   * Signs the account out everywhere. Returns how many sessions were ended, so an
   * operator gets told what happened instead of a silent success.
   */
  revokeAllSessions(userId: string): number {
    const result = this.database.db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(userId);
    return Number(result.changes);
  }

  deleteExpiredSessions(now = new Date()): number {
    const result = this.database.db
      .prepare("DELETE FROM auth_sessions WHERE expires_at <= ?")
      .run(now.toISOString());
    return Number(result.changes);
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Format: scrypt$cost$blockSize$parallelisation$saltHex$keyHex */
function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELISATION
  });

  return [
    "scrypt",
    SCRYPT_COST,
    SCRYPT_BLOCK_SIZE,
    SCRYPT_PARALLELISATION,
    salt.toString("hex"),
    key.toString("hex")
  ].join("$");
}

function verifyPassword(password: string, storedHash: string): boolean {
  const [scheme, cost, blockSize, parallelisation, saltHex, keyHex] = storedHash.split("$");

  if (scheme !== "scrypt" || !cost || !blockSize || !parallelisation || !saltHex || !keyHex) {
    return false;
  }

  const expected = Buffer.from(keyHex, "hex");
  let actual: Buffer;

  try {
    actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length, {
      N: Number(cost),
      r: Number(blockSize),
      p: Number(parallelisation)
    });
  } catch {
    return false;
  }

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
