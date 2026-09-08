import { randomUUID } from "node:crypto";
import type { GenerationUsage } from "@instory/shared";
import type { AppDatabase } from "./app-database.js";

export type GenerationStatus = "success" | "error";

export interface RecordUsageInput {
  userId: string;
  sessionId?: string | null;
  storyId?: string | null;
  provider: string;
  model?: string | null;
  intent: string;
  status: GenerationStatus;
  usage?: GenerationUsage | null;
  latencyMs: number;
  at?: Date;
}

export interface ModelUsageBreakdown {
  provider: string;
  model: string | null;
  generations: number;
  totalTokens: number;
}

export interface DailyUsageSummary {
  date: string;
  generations: number;
  successes: number;
  failures: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  averageLatencyMs: number;
  byModel: ModelUsageBreakdown[];
}

/** UTC day key, matching the created_date column. */
export function usageDateKey(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10);
}

/**
 * Start of the next UTC day - the instant the per-day counters start over. Derived
 * from the same day key the counting queries use, so the number a reader is shown
 * and the moment it changes can never disagree.
 */
export function usageDayResetsAt(at: Date = new Date()): string {
  const next = new Date(`${usageDateKey(at)}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);

  return next.toISOString();
}


/**
 * Records what each generation cost. Failures are recorded too: a retry storm that
 * burns tokens without producing a turn is exactly the thing that stays invisible
 * otherwise.
 */
export class UsageStore {
  private readonly database: AppDatabase;

  constructor(database: AppDatabase) {
    this.database = database;
  }

  record(input: RecordUsageInput): void {
    const at = input.at ?? new Date();

    this.database.db
      .prepare(
        `INSERT INTO generation_usage
           (id, user_id, session_id, story_id, provider, model, intent, status,
            prompt_tokens, completion_tokens, total_tokens, latency_ms, created_at, created_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        `usage_${randomUUID()}`,
        input.userId,
        input.sessionId ?? null,
        input.storyId ?? null,
        input.provider,
        input.model ?? null,
        input.intent,
        input.status,
        input.usage?.promptTokens ?? 0,
        input.usage?.completionTokens ?? 0,
        input.usage?.totalTokens ?? 0,
        Math.max(0, Math.round(input.latencyMs)),
        at.toISOString(),
        usageDateKey(at)
      );
  }

  /** Successful generations only, so a failed attempt does not consume quota. */
  countSuccessfulToday(userId: string, at: Date = new Date()): number {
    const row = this.database.db
      .prepare(
        `SELECT COUNT(*) AS count FROM generation_usage
         WHERE user_id = ? AND created_date = ? AND status = 'success'`
      )
      .get(userId, usageDateKey(at)) as { count: number };

    return row.count;
  }

  summarizeDay(at: Date = new Date()): DailyUsageSummary {
    const date = usageDateKey(at);

    const totals = this.database.db
      .prepare(
        `SELECT COUNT(*) AS generations,
                SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS successes,
                SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS failures,
                COALESCE(SUM(prompt_tokens), 0) AS promptTokens,
                COALESCE(SUM(completion_tokens), 0) AS completionTokens,
                COALESCE(SUM(total_tokens), 0) AS totalTokens,
                COALESCE(AVG(latency_ms), 0) AS averageLatencyMs
         FROM generation_usage WHERE created_date = ?`
      )
      .get(date) as {
      generations: number;
      successes: number | null;
      failures: number | null;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      averageLatencyMs: number;
    };

    const byModel = this.database.db
      .prepare(
        `SELECT provider, model, COUNT(*) AS generations, COALESCE(SUM(total_tokens), 0) AS totalTokens
         FROM generation_usage WHERE created_date = ?
         GROUP BY provider, model
         ORDER BY totalTokens DESC`
      )
      .all(date) as unknown as ModelUsageBreakdown[];

    return {
      date,
      generations: totals.generations,
      successes: totals.successes ?? 0,
      failures: totals.failures ?? 0,
      promptTokens: totals.promptTokens,
      completionTokens: totals.completionTokens,
      totalTokens: totals.totalTokens,
      averageLatencyMs: Math.round(totals.averageLatencyMs),
      byModel
    };
  }
}

export interface TokenPricing {
  /** Currency cost per one million prompt tokens. */
  inputPerMillion: number;
  /** Currency cost per one million completion tokens. */
  outputPerMillion: number;
}

/**
 * Cost is derived from configured prices rather than baked in, because per-model
 * pricing differs between providers and changes over time. Returns null when no
 * price is configured, so the UI can say "unknown" instead of showing a wrong zero.
 */
export function estimateCost(
  summary: Pick<DailyUsageSummary, "promptTokens" | "completionTokens">,
  pricing: TokenPricing
): number | null {
  if (pricing.inputPerMillion <= 0 && pricing.outputPerMillion <= 0) {
    return null;
  }

  const input = (summary.promptTokens / 1_000_000) * pricing.inputPerMillion;
  const output = (summary.completionTokens / 1_000_000) * pricing.outputPerMillion;

  return Number((input + output).toFixed(6));
}

export function readPricingFromEnv(env: NodeJS.ProcessEnv): TokenPricing {
  return {
    inputPerMillion: Number(env.LLM_PRICE_INPUT_PER_MTOK ?? 0) || 0,
    outputPerMillion: Number(env.LLM_PRICE_OUTPUT_PER_MTOK ?? 0) || 0
  };
}
