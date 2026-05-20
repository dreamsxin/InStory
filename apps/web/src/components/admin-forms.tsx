"use client";

import { Button, Checkbox, Input, Label, ListBox, Select, TextField } from "@heroui/react";

import { updateModelConfigAction, updateStorySummaryAction, verifyModelConfigAction } from "@/app/admin/actions";

type ModelProvider = "mock" | "openai-compatible";
type AIFreedom = "low" | "medium" | "high";

export function ModelConfigForm({
  apiKeyConfigured,
  baseUrl,
  model,
  provider
}: {
  apiKeyConfigured: boolean;
  baseUrl: string | null;
  model: string | null;
  provider: ModelProvider;
}) {
  return (
    <>
      <form className="admin-form" action={updateModelConfigAction}>
        <Select name="provider" defaultSelectedKey={provider}>
          <Label>Provider</Label>
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              <ListBox.Item id="mock" textValue="Mock">Mock<ListBox.ItemIndicator /></ListBox.Item>
              <ListBox.Item id="openai-compatible" textValue="OpenAI-compatible">OpenAI-compatible<ListBox.ItemIndicator /></ListBox.Item>
            </ListBox>
          </Select.Popover>
        </Select>
        <TextField name="baseUrl" type="url" defaultValue={baseUrl ?? ""}>
          <Label>Base URL</Label>
          <Input placeholder="https://api.openai.com/v1" />
        </TextField>
        <TextField name="model" type="text" defaultValue={model ?? ""}>
          <Label>Model</Label>
          <Input placeholder="gpt-4.1-mini" />
        </TextField>
        <TextField name="apiKey" type="password">
          <Label>API Key</Label>
          <Input placeholder={apiKeyConfigured ? "保持现有 Key" : "输入 API Key"} />
        </TextField>
        <Checkbox name="clearApiKey">清除已保存 API Key</Checkbox>
        <Button type="submit">保存模型配置</Button>
      </form>
      <form className="admin-form compact" action={verifyModelConfigAction}>
        <Button type="submit" variant="outline">验证当前 Provider</Button>
      </form>
    </>
  );
}

export function StorySummaryForm({
  aiFreedom,
  anchorsCount,
  charactersCount,
  genre,
  locationsCount,
  storyId,
  tagline,
  title
}: {
  aiFreedom: AIFreedom;
  anchorsCount: number;
  charactersCount: number;
  genre: string;
  locationsCount: number;
  storyId: string;
  tagline: string;
  title: string;
}) {
  return (
    <form className="story-editor-row" action={updateStorySummaryAction}>
      <input name="storyId" type="hidden" value={storyId} />
      <TextField name="title" type="text" defaultValue={title} isRequired>
        <Label>标题</Label>
        <Input />
      </TextField>
      <TextField name="tagline" type="text" defaultValue={tagline} isRequired>
        <Label>标语</Label>
        <Input />
      </TextField>
      <TextField name="genre" type="text" defaultValue={genre} isRequired>
        <Label>类型</Label>
        <Input />
      </TextField>
      <Select name="aiFreedom" defaultSelectedKey={aiFreedom}>
        <Label>AI 自由度</Label>
        <Select.Trigger>
          <Select.Value />
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            <ListBox.Item id="low" textValue="low">low<ListBox.ItemIndicator /></ListBox.Item>
            <ListBox.Item id="medium" textValue="medium">medium<ListBox.ItemIndicator /></ListBox.Item>
            <ListBox.Item id="high" textValue="high">high<ListBox.ItemIndicator /></ListBox.Item>
          </ListBox>
        </Select.Popover>
      </Select>
      <div className="story-editor-meta">
        <span>{locationsCount} 地点</span>
        <span>{charactersCount} 角色</span>
        <span>{anchorsCount} 锚点</span>
      </div>
      <Button type="submit" variant="outline">保存故事</Button>
    </form>
  );
}
