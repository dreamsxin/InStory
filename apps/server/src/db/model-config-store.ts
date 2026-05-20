import type { AppDatabase } from "./app-database.js";

export type ModelProviderName = "mock" | "openai-compatible";

export interface StoredModelConfig {
  provider: ModelProviderName;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  updatedAt: string;
}

export interface PublicModelConfig {
  provider: ModelProviderName;
  baseUrl: string | null;
  model: string | null;
  apiKeyConfigured: boolean;
  updatedAt: string | null;
}

export interface UpdateModelConfigInput {
  provider: ModelProviderName;
  baseUrl?: string | null;
  model?: string | null;
  apiKey?: string | null;
  clearApiKey?: boolean;
}

export class ModelConfigStore {
  private readonly database: AppDatabase;

  constructor(database: AppDatabase) {
    this.database = database;
    this.database.db.exec(`
      CREATE TABLE IF NOT EXISTS model_config (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  get(): StoredModelConfig | null {
    const row = this.database.db.prepare("SELECT payload FROM model_config WHERE id = 'active'").get() as
      | { payload: string }
      | undefined;
    return row ? (JSON.parse(row.payload) as StoredModelConfig) : null;
  }

  save(config: StoredModelConfig): void {
    this.database.db
      .prepare(
        `
        INSERT INTO model_config (id, payload, updated_at)
        VALUES ('active', ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          payload = excluded.payload,
          updated_at = excluded.updated_at;
      `
      )
      .run(JSON.stringify(config), config.updatedAt);
  }
}
