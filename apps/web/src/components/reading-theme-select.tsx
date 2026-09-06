"use client";

import { Label, ListBox, Select } from "@heroui/react";
import type { ReadingTheme } from "@instory/shared";
import { READING_THEMES, READING_THEME_IDS } from "@/lib/reading-themes";

/**
 * Picks the frame a story is read in. Both story forms (the reader's own creator
 * and the admin console) post the same `readingTheme` field, so the option list
 * lives here and stays in step with READING_THEMES.
 */
export function ReadingThemeSelect({ selected }: { selected: ReadingTheme }) {
  return (
    <Select defaultSelectedKey={selected} name="readingTheme">
      <Label>阅读装帧</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {READING_THEME_IDS.map((id) => (
            <ListBox.Item id={id} key={id} textValue={READING_THEMES[id].label}>
              {READING_THEMES[id].label}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
