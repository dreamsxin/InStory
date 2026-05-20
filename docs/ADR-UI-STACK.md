# ADR: Web UI 技术栈与 HeroUI 使用边界

日期：2026-05-20  
状态：Accepted for MVP  
决策范围：`apps/web`

## 1. 背景

InStory Web 客户端当前使用 Next.js、React、TypeScript 和手写 CSS。随着 MVP 交互从“每回合选择”调整为“连续阅读 + 随时入戏”，客户端将新增更多交互组件：

- 我的角色表单
- 进入故事前角色选择
- 入戏面板
- 关键介入节点提示
- 创作入口弹层
- 管理后台表单和验证反馈

这些组件需要稳定的可访问性、键盘交互、弹层行为、表单控件和响应式状态。完全手写会增加维护成本。

## 2. 决策

MVP 阶段选择 HeroUI 作为 Web 客户端的基础交互组件库，但不把 InStory 的核心阅读体验全量交给 HeroUI。

采用方式：

- HeroUI 用于通用交互组件。
- InStory 自定义实现阅读器、故事卡、入戏按钮、介入节点、角色状态等核心体验组件。
- 引入 HeroUI 和 Tailwind 相关基础设施时单独提交，避免和业务功能混合。

## 3. 选择 HeroUI 的理由

- 与 Next.js / React / TypeScript 技术栈匹配。
- 提供常用组件：Button、Input、Textarea、Select、Modal、Drawer、Tabs、Avatar、Chip、Tooltip、Dropdown。
- 基于可访问性组件体系，能减少弹窗、选择器、表单的交互缺陷。
- 适合快速构建“我的角色”“角色选择”“入戏面板”“后台配置”等表单和弹层。
- 视觉风格可通过主题和 className 调整，不强制绑定单一应用风格。

## 4. 不全量使用 HeroUI 的理由

InStory 的核心体验是互动小说阅读，不是普通后台，也不是普通聊天工具。以下部分需要自定义设计：

- 小说正文排版
- 段落、对话、心理描写样式
- 阅读模式和入戏模式的转换
- 常驻“入戏”按钮
- 关键介入节点卡片
- 当前身份胶囊
- 世界状态、线索、记忆时间线
- 故事世界卡片的氛围表达

如果这些部分完全用通用 UI 组件堆叠，产品会失去“阅读”和“入戏”的辨识度。

## 5. HeroUI 使用范围

优先使用 HeroUI：

- 表单控件：`Input`、`Textarea`、`Select`、`Checkbox`
- 操作按钮：`Button`
- 弹层：`Modal`、`Drawer`
- 信息提示：`Tooltip`、`Popover`
- 选择器：`RadioGroup`、`Tabs`
- 角色头像：`Avatar`
- 标签：`Chip`
- 菜单：`Dropdown`
- 后台基础表格和控制项

优先自定义：

- `StoryReader`
- `ReadingSegment`
- `InterventionButton`
- `InterventionPanel` 的叙事结构和内容布局
- `InterventionNodeCard`
- `StoryWorldCard`
- `ReaderProfileCard`
- `MemoryTimeline`
- `CharacterStatePanel`

说明：自定义组件内部可以使用 HeroUI 的基础按钮、输入框、弹层，但组件结构、排版和状态设计由 InStory 自己控制。

## 6. 与参考项目的关系

参考项目 `D:\work\openclaw-workspace\ai-chat\01` 是 AI 角色聊天类产品，可借鉴以下模式：

- 内容 Feed 承载发现。
- 底部弹层承载创建入口。
- 当前身份在聊天/互动页中以胶囊或头像入口展示。
- 角色创建以头像、名称、性别、身份、关系、描述等表单组织。

InStory 不照搬以下部分：

- 纯聊天为中心的信息架构。
- 图片生成、群聊、直播等非 MVP 模块。
- 每一步都要求用户输入或选择的强打断体验。

InStory 的差异化交互是：

```text
连续阅读 -> 关键节点提示 -> 用户选择是否入戏 -> AI 写回正文 -> 继续阅读
```

## 7. 实施约束

- HeroUI 引入必须是独立提交。
- 引入后先改造局部功能，不重写整个站点。
- 不一次性重构阅读器视觉。
- 不把管理后台样式直接套给客户端阅读体验。
- 移动端布局必须优先验证。
- 核心阅读区域的字号、行距、段落宽度和滚动体验必须单独设计。

## 8. 初始落地范围

第一阶段：

1. 接入 HeroUI 基础配置。
2. 用 HeroUI 实现“我的角色”创建表单。
3. 用 HeroUI 实现进入故事前角色选择弹窗。
4. 用 HeroUI 实现入戏面板的基础弹层和输入控件。

第二阶段：

1. 管理后台表单逐步迁移到 HeroUI。
2. 创作入口弹层使用 HeroUI。
3. 统一 Button、Input、Select、Modal 的基础视觉规则。

暂不迁移：

- 阅读正文样式。
- 故事世界卡片主视觉。
- 状态面板和时间线的叙事展示。

## 9. 风险与应对

风险：引入组件库后视觉变得通用化。  
应对：核心阅读组件保持自定义，只使用基础交互控件。

风险：Tailwind / HeroUI 配置影响现有手写 CSS。  
应对：单独提交基础设施改动，先验证构建和现有页面。

风险：组件库增加包体积。  
应对：按需引入组件，避免一次性引入大量复杂组件。

风险：移动端弹层和输入法冲突。  
应对：入戏面板优先做移动端验证，保证安全区和键盘行为。

## 10. 后续评估标准

- 是否减少表单和弹层实现成本。
- 是否保持阅读器的产品辨识度。
- 是否改善移动端角色选择和入戏交互。
- 是否没有明显增加维护复杂度。
- 是否通过 `npm run typecheck`、`npm run test`、`npm run build`。
