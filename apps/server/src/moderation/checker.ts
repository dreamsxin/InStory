/**
 * Moderation surfaces. Reader input and model output are checked separately because
 * they fail differently: a reader can be told to rephrase, while a bad generation is
 * the system's own fault and must not be persisted.
 */
export type ModerationSurface = "reader_input" | "model_output" | "story_config" | "report";

export type ModerationAction = "allowed" | "flagged" | "blocked";

/**
 * Categories worth separating because they carry different obligations. Anything
 * touching minors is always blocked, never merely flagged.
 */
export type ModerationCategory =
  | "minor_safety"
  | "self_harm"
  | "sexual_content"
  | "violence"
  | "hate"
  | "illicit";

export interface ModerationVerdict {
  action: ModerationAction;
  categories: ModerationCategory[];
  /** Human-readable reason, safe to show a reader when the action is `blocked`. */
  detail: string | null;
}

export interface ModerationRequest {
  surface: ModerationSurface;
  text: string;
}

/**
 * Pluggable so the rule-based default can be swapped for a real service without
 * touching the pipeline. Production deployments are expected to do exactly that:
 * keyword rules cannot carry a compliance obligation on their own, and operating in
 * mainland China additionally requires a licensed provider.
 */
export interface ModerationChecker {
  readonly name: string;
  check(request: ModerationRequest): Promise<ModerationVerdict>;
}

interface CategoryRule {
  category: ModerationCategory;
  /** `blocked` refuses the content outright; `flagged` lets it through for review. */
  action: Exclude<ModerationAction, "allowed">;
  patterns: RegExp[];
  detail: string;
}

/**
 * Deliberately small and illustrative, not an attempt at coverage. It exists so the
 * pipeline, the review queue and the block paths are real and testable; replace it
 * with a moderation provider before launch. Extend via `extraRules` rather than
 * editing this list, so upgrades stay mergeable.
 */
const DEFAULT_RULES: CategoryRule[] = [
  {
    category: "minor_safety",
    action: "blocked",
    // Sexualised content involving minors is refused regardless of framing.
    patterns: [/(未成年|幼女|幼童|小学生|儿童)[^。！？\n]{0,12}(性|裸|情色|发生关系)/u, /\bchild\s+(porn|sexual)/iu],
    detail: "涉及未成年人的性化内容，无法生成或提交。"
  },
  {
    category: "self_harm",
    action: "flagged",
    patterns: [/(自杀|自残|割腕)[^。！？\n]{0,12}(方法|教程|怎么做|如何)/u, /how\s+to\s+(kill\s+myself|self\s*-?harm)/iu],
    detail: "涉及自我伤害的具体方法，已转入人工复审。"
  },
  {
    category: "illicit",
    action: "flagged",
    patterns: [/(制造|合成|自制)[^。！？\n]{0,8}(炸药|爆炸物|毒品|冰毒)/u, /how\s+to\s+(make|build)\s+(a\s+)?(bomb|explosive)/iu],
    detail: "涉及危险物品制造，已转入人工复审。"
  }
];

export interface RuleBasedCheckerOptions {
  /** Appended to the defaults, so deployments can add their own terms. */
  extraRules?: CategoryRule[];
}

export class RuleBasedModerationChecker implements ModerationChecker {
  readonly name = "rule-based";
  private readonly rules: CategoryRule[];

  constructor(options: RuleBasedCheckerOptions = {}) {
    this.rules = [...DEFAULT_RULES, ...(options.extraRules ?? [])];
  }

  async check(request: ModerationRequest): Promise<ModerationVerdict> {
    const matched = this.rules.filter((rule) => rule.patterns.some((pattern) => pattern.test(request.text)));

    if (matched.length === 0) {
      return { action: "allowed", categories: [], detail: null };
    }

    // A single blocking match outweighs any number of flags.
    const blocking = matched.filter((rule) => rule.action === "blocked");
    const decisive = blocking.length > 0 ? blocking : matched;

    return {
      action: blocking.length > 0 ? "blocked" : "flagged",
      categories: [...new Set(decisive.map((rule) => rule.category))],
      detail: decisive.map((rule) => rule.detail).join(" ")
    };
  }
}

/** Never records more than this much text, so the queue is reviewable and not a copy of the corpus. */
const EXCERPT_LIMIT = 280;

export function buildExcerpt(text: string, limit = EXCERPT_LIMIT): string {
  const collapsed = text.replace(/\s+/gu, " ").trim();
  return collapsed.length <= limit ? collapsed : `${collapsed.slice(0, limit)}…`;
}
