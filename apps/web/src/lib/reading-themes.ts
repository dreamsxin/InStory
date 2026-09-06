import type { ReadingTheme } from "@instory/shared";

/**
 * Labels and frames are the web app's business, so they live here rather than in
 * the shared package: only this app has styles.css. The Record is keyed by
 * ReadingTheme, so adding an id to the shared union without adding it here fails
 * to typecheck — which is the whole point.
 *
 * These values must not be imported from @instory/shared at runtime: that package
 * ships raw TypeScript whose internal ./x.js specifiers the bundler cannot
 * resolve, so only type imports work from the web side.
 */
export const READING_THEMES: Record<ReadingTheme, { label: string; hint: string }> = {
  classic: { label: "经典书页", hint: "米白纸面，克制的细边，适合任何题材" },
  "western-fantasy": { label: "西方幻想", hint: "烫金花纹与四角卷草，剑与魔法的华丽装帧" },
  "eastern-ink": { label: "东方水墨", hint: "宣纸与朱红细框，仙侠、武侠、志怪" },
  "gothic-mystery": { label: "哥特悬疑", hint: "暗夜深色纸面与铁艺尖角，悬疑、恐怖" },
  "cyber-frontier": { label: "赛博未来", hint: "冷蓝面板与切角描边，科幻、废土" }
};

export const DEFAULT_READING_THEME: ReadingTheme = "classic";

export const READING_THEME_IDS = Object.keys(READING_THEMES) as ReadingTheme[];

export function readingThemeLabel(theme: ReadingTheme): string {
  return READING_THEMES[theme]?.label ?? theme;
}

/** Form posts arrive as loose strings; anything unknown falls back to the plain page. */
export function parseReadingTheme(value: unknown): ReadingTheme {
  return typeof value === "string" && value in READING_THEMES
    ? (value as ReadingTheme)
    : DEFAULT_READING_THEME;
}
