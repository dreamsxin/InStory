# InStory 项目进度

## 2026-05-20

### 已完成

- 建立 Node.js / TypeScript monorepo。
- 新增 `apps/server` Fastify 服务端骨架。
- 新增 `apps/web` Next.js Web 客户端骨架。
- 新增 `packages/shared` 共享领域类型与请求校验。
- 新增 `packages/story-engine` 叙事状态机基础能力。
- 新增 `packages/ai-orchestrator` Mock AI 叙事供应商。
- 实现 MVP API：
  - `GET /api/health`
  - `GET /api/stories`
  - `GET /api/stories/:storyId`
  - `POST /api/stories/:storyId/sessions`
  - `GET /api/sessions/:sessionId`
  - `POST /api/sessions/:sessionId/turns`
  - `POST /api/sessions/:sessionId/rewind`
- 实现 Web MVP：
  - 故事列表
  - 创建会话
  - 阅读器
  - 智能选项
  - 自由输入
  - 状态面板
  - 记忆书签展示
- README 增加开发启动说明。
- 新增 OpenAI-compatible `LLMProvider`。
- 服务端支持通过环境变量在 Mock AI 和 OpenAI-compatible 模型之间切换。
- 新增 `.env.example`。
- 为 `story-engine` 增加状态机单元测试，覆盖初始状态、状态差异合并、去重、时间线节点判定和摘要回退。
- 修正 workspace 测试脚本，允许暂未添加测试的应用包通过 `npm run test`。
- 接入 SQLite 会话存储，读者会话、回合、状态快照和时间线以 JSON payload 形式持久化到本地数据库。
- 新增 `SessionStore` 单元测试，覆盖保存、读取和更新。
- 将故事、世界、角色、剧情锚点从服务端入口硬编码迁移到 `stories.seed.json`。
- 新增 `StoryCatalog` 仓库层和测试，用 Zod 校验示例故事种子数据。
- `GET /api/stories/:storyId` 返回完整故事详情，包括 world、characters、anchors。
- 抽出服务端 `buildApp`，将路由注册与进程启动解耦，便于测试和后续部署。
- 新增服务端 API 测试，覆盖健康检查、故事详情、创建会话、推进回合、读取会话、回溯分支和错误响应。
- MVP 规划新增“极简管理后台 / AI 叙事系统控制台”，用于模型配置查看、运行状态、故事配置查看、会话审计和审核占位。
- 新增 Admin API：
  - `GET /api/admin/status`
  - `GET /api/admin/models`
  - `GET /api/admin/stories`
  - `GET /api/admin/sessions`
  - `GET /api/admin/sessions/:sessionId`
  - `GET /api/admin/moderation/events`
- Admin API 支持 `ADMIN_TOKEN` Bearer 鉴权，本地未设置 token 时允许访问。
- `SessionStore` 增加会话统计和最近会话列表能力。
- Admin API 测试覆盖状态、模型配置、故事配置、会话审计、审核占位和鉴权。
- 新增 Web `/admin` 极简只读控制台，展示运行状态、模型配置、存储路径、故事配置、最近会话和审核事件占位。
- 新增 InStory 图标资产，用作 Web favicon、客户端品牌 logo 和 512px 备用图标。
- 新增共享 `AppDatabase` SQLite 连接层。
- 新增 `StoryStore`，将 stories、worlds、characters、story_anchors 写入 SQLite 表。
- `StoryCatalog` 改为从 SQLite 读取故事配置，并在空库时从 `stories.seed.json` 自动导入。
- 新增 `StoryStore` 单元测试。
- 新增 `docs/PRODUCT_PLAN.md`，将 README 中的产品规划内容迁入独立文档。
- README 收敛为开源项目入口，仅保留项目概览、当前状态、技术栈、代码结构、文档导航和开发启动说明。
- 新增 `npm run verify:llm`，用于验证 Mock 或 OpenAI-compatible `LLMProvider` 的端到端叙事输出 schema。
- 管理后台支持保存正式 OpenAI-compatible Provider 配置，包含 Provider、Base URL、Model 和 API Key。
- 模型配置写入 SQLite，运行时立即重建 `LLMProvider`，API Key 不通过 Admin API 回显。
- 管理后台新增“验证当前 Provider”按钮，调用 `POST /api/admin/models/verify` 执行最小叙事生成并校验输出 schema。
- OpenAI-compatible Provider 支持根地址或完整 `/chat/completions` 地址，并兼容真实模型把 `memoryEvents` 返回为对象数组的情况。
- 作者工具 MVP 起步：管理后台支持编辑故事基础配置，新增 `PUT /api/admin/stories/:storyId`，可更新标题、标语、类型和 AI 自由度。
- 产品规划和架构调整为“连续阅读 + 随时入戏”的交互模型，新增我的角色、关键介入节点和阅读/入戏双模式。
- 新增 `docs/INTERACTION_DESIGN.md`，定义首页、我的角色、角色选择、阅读器、入戏按钮、关键介入节点和创作入口的 MVP 交互基线。
- 新增 `docs/ADR-UI-STACK.md`，确定 HeroUI 作为基础交互组件库，并明确阅读器等核心体验组件保持自定义。
- 新增“我的角色”服务端基础能力：`ReaderProfile` 共享类型、SQLite `reader_profiles` 存储、`GET/POST /api/reader/profiles`，创建会话时可通过 `readerProfileId` 注入用户角色上下文。
- Web 客户端完成 HeroUI 基础依赖接入，先引入样式与组件包，核心阅读体验仍保持自定义。
- 首页升级为“故事世界 + 我的角色”工作台，支持创建我的角色，并在进入故事前选择入戏身份。
- 参考 HeroUI demos 的 Card、Avatar、Chip、Drawer、Modal、Tabs、Table 等交互模式，统一客户端与管理后台为现代 App 工作台视觉：粘性导航、Hero 状态区、卡片阴影、圆角控件、输入焦点态和后台快捷导航。
- 客户端首页改为 App 式分区导航，移动端使用底部 Tab，平板/桌面使用顶部导航；角色创建从故事列表中拆出到独立“角色/创作”视图。
- 阅读器新增专注阅读交互，点击正文区域或悬浮按钮可切换顶部栏、侧栏和输入区显示，手机端保留恢复入口。
- 继续分析 HeroUI docs 组件布局，参考其桌面侧栏、移动抽屉、紧凑 header、横向 tabs 和单滚动容器模式，将客户端首页进一步改成移动端 App shell。
- 检索并评估开源阅读器库，结论是 MVP 不引入 EPUB 阅读器库，继续自定义互动小说阅读器，后续外部书籍导入阶段再评估 `epub.js`、`react-reader` 或 Readium Web。
- 手机端首页改为固定高度 App 布局，顶部显示当前主功能，底部导航显示主/副标签，故事、角色、继续、创作各自独立滚动。
- 手机端阅读器改为沉浸式正文滚动，状态侧栏在可见 chrome 下以底部浮层呈现，输入区固定在底部，隐藏 chrome 后保留悬浮恢复入口。
- 根据 `D:\work\heroui\skills` 和本地 demos 修正 HeroUI v3 用法：不使用 Provider，采用 `Card.Header/Card.Content`、`TextField + Label + Input/TextArea`、`Select + ListBox.Item` 等复合组件模式，并补齐 Tailwind v4 / `@heroui/styles` 样式管线。
- 移动端 UI 完成截图回归：手机竖屏首页、手机横屏首页、手机竖屏阅读器、手机横屏阅读器均已检查；阅读器手机端默认进入专注阅读，保留智能选项和“显示菜单”入口。
- 阅读器交互调整为“阅读推进优先”：默认显示 `继续阅读` 主按钮，智能选项和自由输入收进 `入戏行动` 面板，`状态` 与 `记忆` 改为工具坞按需展开，降低每回合强制选择带来的阅读打断。
- 明确产品与架构策略：HeroUI 只作为组件库，不承担阅读器 App Shell 自适应；阅读内容优先使用作者预设与已生成缓存，AI 只在个性化补写、分支缺失和入戏回写时介入；作者工具后续需要支持生成长度配置。
- 产品规划新增作品级“入戏体验模式”：`剧本入戏`、`共演入戏`、`即兴入戏`，用于控制作者预设、AI 补写和临场自由度的权重。
- MVP 范围重新收敛：完整验证 `共演入戏` 主路径，`剧本入戏` 和 `即兴入戏` 先作为配置字段与策略占位；优先实现 `SessionSegment`、`read_segment`、默认生成长度和会话隔离存储。
- 产品规划明确 UGC 是核心方向，但 MVP 不实现积分、审核和收益，优先验证用户创作与入戏体验。
- 文档补充故事创建字段：故事 ID、标题、标语、类型、封面图、世界前提、起点场景、世界规则、入戏体验模式、默认生成长度和 AI 自由度。
- 新增 `CreateStoryRequest` 共享契约和 `POST /api/stories`，支持通过客户端创作入口创建最小故事。
- `StoryStore` 支持在 SQLite 中创建故事摘要和世界起点配置，角色与锚点后续扩展。
- 客户端 `创作` 导航新增故事创建表单；管理台不再作为普通用户创作入口。
- 创作界面文案明确区分“入戏角色”和“故事世界”；故事新增封面图 URL，故事卡片展示封面或默认封面兜底。
- 客户端创作入口调整为用户控制台，分为 `角色库` 和 `故事工作台`；创建故事时可选择已有角色作为故事演员，服务端复制为故事内角色快照。
- 明确 `故事` 导航是公共探索入口，`创作` 导航是用户控制台，包含 `我的故事` 和 `我的角色`；管理员后台继续只承担模型、审计和治理能力。
- 故事新增 `ownerId` 归属字段和 `GET /api/me/stories`，用户侧可以查看自己创建的故事。
- 创建故事时服务端写入当前用户归属，并只允许选择当前用户自己的角色作为故事演员。

### 验证结果

- `npm install` 成功。
- `npm run typecheck` 通过。
- `npm run build` 通过。
- `npm run test` 通过。
- 服务端健康检查通过：`http://localhost:4000/api/health`。
- Web 首页返回 200：`http://localhost:3000`。

### 已知问题

- `npm audit` 报告 2 个 moderate，来源是 `next@16.2.6` 依赖的 `postcss`。当前 `npm audit fix --force` 会降级到破坏性旧版本，暂不执行。
- 故事、世界、角色和锚点已进入 SQLite 表，但仍以 JSON payload 存储，尚未拆成完全关系化字段。
- SQLite 当前使用 Node.js 内置 `node:sqlite`，在 Node 24 下可能出现实验性 API 提示。
- AI 叙事默认使用 Mock provider；真实模型可通过 `npm run verify:llm` 在配置 API Key 后手动验证。

### 下一步

1. 扩展 `我的故事` 管理，支持编辑、删除、草稿状态和试玩入口。
2. 扩展故事演员配置，支持故事内身份、关系、秘密、目标和行为约束。
3. 实现 `SessionSegment` 存储，生成内容按 `sessionId` 隔离，并预留 `userId`。
4. 拆分 `read_segment` 与 `intervention_turn`，让继续阅读返回完整小节。
5. 增加阅读设置：字号、行距、主题、滚动/分页偏好。
6. 增加 Web 阅读器交互测试和 `/admin` 页面级测试。
