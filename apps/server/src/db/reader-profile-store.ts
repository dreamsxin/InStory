import type { ReaderProfile } from "@instory/shared";
import type { AppDatabase } from "./app-database.js";

export interface CreateReaderProfileInput {
  ownerId: string;
  name: string;
  gender?: string | null;
  personality: string;
  avatarUrl?: string | null;
  description: string;
}

export type UpdateReaderProfileInput = Omit<CreateReaderProfileInput, "ownerId">;

export class ReaderProfileStore {
  private readonly database: AppDatabase;

  constructor(database: AppDatabase) {
    this.database = database;
    this.database.db.exec(`
      CREATE TABLE IF NOT EXISTS reader_profiles (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_reader_profiles_owner_id
      ON reader_profiles(owner_id, updated_at DESC);
    `);
  }

  create(input: CreateReaderProfileInput): ReaderProfile {
    const now = new Date().toISOString();
    const profile: ReaderProfile = {
      id: `profile_${crypto.randomUUID()}`,
      ownerId: input.ownerId,
      name: input.name,
      gender: input.gender?.trim() || null,
      personality: input.personality,
      avatarUrl: input.avatarUrl?.trim() || null,
      description: input.description,
      createdAt: now,
      updatedAt: now
    };

    this.database.db
      .prepare(
        "INSERT INTO reader_profiles (id, owner_id, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(profile.id, profile.ownerId, JSON.stringify(profile), now, now);

    return profile;
  }

  listByOwner(ownerId: string): ReaderProfile[] {
    const rows = this.database.db
      .prepare("SELECT payload FROM reader_profiles WHERE owner_id = ? ORDER BY updated_at DESC")
      .all(ownerId) as Array<{ payload: string }>;

    return rows.map((row) => JSON.parse(row.payload) as ReaderProfile);
  }

  findById(profileId: string): ReaderProfile | null {
    const row = this.database.db.prepare("SELECT payload FROM reader_profiles WHERE id = ?").get(profileId) as
      | { payload: string }
      | undefined;

    return row ? (JSON.parse(row.payload) as ReaderProfile) : null;
  }

  update(profileId: string, ownerId: string, input: UpdateReaderProfileInput): ReaderProfile | null {
    const current = this.findById(profileId);
    if (!current || current.ownerId !== ownerId) {
      return null;
    }

    const now = new Date().toISOString();
    const updated: ReaderProfile = {
      ...current,
      name: input.name,
      gender: input.gender?.trim() || null,
      personality: input.personality,
      avatarUrl: input.avatarUrl?.trim() || null,
      description: input.description,
      updatedAt: now
    };

    this.database.db
      .prepare("UPDATE reader_profiles SET payload = ?, updated_at = ? WHERE id = ? AND owner_id = ?")
      .run(JSON.stringify(updated), now, profileId, ownerId);

    return updated;
  }

  delete(profileId: string, ownerId: string): boolean {
    const result = this.database.db
      .prepare("DELETE FROM reader_profiles WHERE id = ? AND owner_id = ?")
      .run(profileId, ownerId);

    return result.changes > 0;
  }
}
