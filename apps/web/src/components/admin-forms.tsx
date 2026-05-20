"use client";

import { Button, Checkbox, Input, Label, ListBox, Select, TextArea, TextField } from "@heroui/react";
import type { ExperienceMode, SegmentLengthPreset } from "@instory/shared";

import { createStoryAction, updateModelConfigAction, updateStorySummaryAction, verifyModelConfigAction } from "@/app/admin/actions";

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
        <Select defaultSelectedKey={provider} name="provider">
          <Label>Provider</Label>
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              <ListBox.Item id="mock" textValue="Mock">
                Mock
                <ListBox.ItemIndicator />
              </ListBox.Item>
              <ListBox.Item id="openai-compatible" textValue="OpenAI-compatible">
                OpenAI-compatible
                <ListBox.ItemIndicator />
              </ListBox.Item>
            </ListBox>
          </Select.Popover>
        </Select>
        <TextField defaultValue={baseUrl ?? ""} name="baseUrl" type="url">
          <Label>Base URL</Label>
          <Input placeholder="https://api.openai.com/v1" />
        </TextField>
        <TextField defaultValue={model ?? ""} name="model" type="text">
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
  defaultSegmentLength,
  experienceMode,
  genre,
  locationsCount,
  storyId,
  tagline,
  title
}: {
  aiFreedom: AIFreedom;
  anchorsCount: number;
  charactersCount: number;
  defaultSegmentLength: SegmentLengthPreset;
  experienceMode: ExperienceMode;
  genre: string;
  locationsCount: number;
  storyId: string;
  tagline: string;
  title: string;
}) {
  return (
    <form className="story-editor-row" action={updateStorySummaryAction}>
      <input name="storyId" type="hidden" value={storyId} />
      <TextField defaultValue={title} isRequired name="title" type="text">
        <Label>标题</Label>
        <Input />
      </TextField>
      <TextField defaultValue={tagline} isRequired name="tagline" type="text">
        <Label>标语</Label>
        <Input />
      </TextField>
      <TextField defaultValue={genre} isRequired name="genre" type="text">
        <Label>类型</Label>
        <Input />
      </TextField>
      <Select defaultSelectedKey={aiFreedom} name="aiFreedom">
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
      <Select defaultSelectedKey={experienceMode} name="experienceMode">
        <Label>入戏体验</Label>
        <Select.Trigger>
          <Select.Value />
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            <ListBox.Item id="scripted" textValue="剧本入戏">剧本入戏<ListBox.ItemIndicator /></ListBox.Item>
            <ListBox.Item id="coauthored" textValue="共演入戏">共演入戏<ListBox.ItemIndicator /></ListBox.Item>
            <ListBox.Item id="improvised" textValue="即兴入戏">即兴入戏<ListBox.ItemIndicator /></ListBox.Item>
          </ListBox>
        </Select.Popover>
      </Select>
      <Select defaultSelectedKey={defaultSegmentLength} name="defaultSegmentLength">
        <Label>生成长度</Label>
        <Select.Trigger>
          <Select.Value />
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            <ListBox.Item id="short" textValue="短段">短段<ListBox.ItemIndicator /></ListBox.Item>
            <ListBox.Item id="standard" textValue="标准小节">标准小节<ListBox.ItemIndicator /></ListBox.Item>
            <ListBox.Item id="long" textValue="长小节">长小节<ListBox.ItemIndicator /></ListBox.Item>
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

export function CreateStoryForm() {
  return (
    <form className="admin-form create-story-form" action={createStoryAction}>
      <div className="admin-form-grid">
        <TextField isRequired name="id" type="text">
          <Label>故事 ID</Label>
          <Input placeholder="moon-market" />
        </TextField>
        <TextField isRequired name="title" type="text">
          <Label>标题</Label>
          <Input placeholder="月下市集" />
        </TextField>
        <TextField isRequired name="genre" type="text">
          <Label>类型</Label>
          <Input placeholder="奇幻悬疑" />
        </TextField>
        <TextField isRequired name="tagline" type="text">
          <Label>标语</Label>
          <Input placeholder="你在午夜市集里寻找被偷走的名字。" />
        </TextField>
      </div>

      <TextField isRequired name="premise">
        <Label>世界前提</Label>
        <TextArea rows={4} placeholder="说明故事世界、核心冲突、读者进入后的初始处境。" />
      </TextField>

      <div className="admin-form-grid">
        <TextField isRequired name="openingLocationName" type="text">
          <Label>起点地点</Label>
          <Input placeholder="午夜市集入口" />
        </TextField>
        <TextField isRequired name="openingLocationDescription">
          <Label>起点场景</Label>
          <TextArea rows={3} placeholder="读者醒来或进入故事时看到的第一幕。" />
        </TextField>
      </div>

      <TextField name="worldRules">
        <Label>世界规则</Label>
        <TextArea rows={4} placeholder={"每行一条规则\n例如：市集里不能直接说出真名。"} />
      </TextField>

      <div className="admin-form-grid">
        <Select defaultSelectedKey="medium" name="aiFreedom">
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
        <Select defaultSelectedKey="coauthored" name="experienceMode">
          <Label>入戏体验</Label>
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              <ListBox.Item id="scripted" textValue="剧本入戏">剧本入戏<ListBox.ItemIndicator /></ListBox.Item>
              <ListBox.Item id="coauthored" textValue="共演入戏">共演入戏<ListBox.ItemIndicator /></ListBox.Item>
              <ListBox.Item id="improvised" textValue="即兴入戏">即兴入戏<ListBox.ItemIndicator /></ListBox.Item>
            </ListBox>
          </Select.Popover>
        </Select>
        <Select defaultSelectedKey="standard" name="defaultSegmentLength">
          <Label>生成长度</Label>
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              <ListBox.Item id="short" textValue="短段">短段<ListBox.ItemIndicator /></ListBox.Item>
              <ListBox.Item id="standard" textValue="标准小节">标准小节<ListBox.ItemIndicator /></ListBox.Item>
              <ListBox.Item id="long" textValue="长小节">长小节<ListBox.ItemIndicator /></ListBox.Item>
            </ListBox>
          </Select.Popover>
        </Select>
      </div>
      <Button type="submit">创建故事草稿</Button>
    </form>
  );
}
