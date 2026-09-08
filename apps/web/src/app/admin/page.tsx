import { Card, Chip } from "@heroui/react";
import { redirect } from "next/navigation";
import {
  getAdminModelConfig,
  getAdminModerationEvents,
  getAdminSessions,
  getAdminStatus,
  getAdminStories,
  getAdminUsage,
  getAdminUsers,
  getCurrentUser
} from "@/lib/api";
import { ModelConfigForm, StorySummaryForm } from "@/components/admin-console-forms";
import { resolveModerationEventAction, updateUserRoleAction } from "@/app/admin/actions";
import { BrandMark } from "@/components/brand-mark";
import Link from "next/link";

export default async function AdminPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  /**
   * The console's own fetches carry the server-held admin token, so without this
   * check anyone who typed the URL was served real model config, sessions and
   * moderation data. The account's role is the gate; the token stays the
   * bootstrap path for the first administrator.
   */
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  if (user.role !== "admin") {
    redirect("/");
  }

  const query = await searchParams;
  const [status, modelConfig, stories, sessions, moderation, usage, users] = await Promise.all([
    getAdminStatus(),
    getAdminModelConfig(),
    getAdminStories(),
    getAdminSessions(),
    getAdminModerationEvents(),
    getAdminUsage(),
    getAdminUsers()
  ]);

  return (
    <main className="admin-page admin-shell">
      <header className="admin-header app-topbar">
        <div className="brand-row">
          <BrandMark size={42} />
          <div className="brand">
            <h1>InStory 控制台</h1>
            <p className="muted">模型、内容、会话和审核的 MVP 工作台</p>
          </div>
        </div>
        <nav className="app-nav" aria-label="Admin navigation">
          <a href="#model">模型</a>
          <a href="#usage">用量</a>
          <a href="#users">账号</a>
          <a href="#moderation">审核</a>
          <a href="#stories">故事</a>
          <a href="#sessions">会话</a>
          <Link href="/">客户端</Link>
        </nav>
      </header>

      <section className="admin-command">
        <div>
          <span className="eyebrow">System Console</span>
          <h2>验证 Provider，管理故事基础配置，观察运行状态。</h2>
        </div>
        <div className="admin-command-actions">
          <Chip variant="soft">{modelConfig.provider}</Chip>
          <Chip color={modelConfig.apiKeyConfigured ? "success" : "warning"} variant="soft">
            {modelConfig.apiKeyConfigured ? "Key 已配置" : "Key 未配置"}
          </Chip>
        </div>
      </section>

      <section className="admin-kpis">
        <Metric label="服务" value={status.service} />
        <Metric label="存储" value={status.storage.type} />
        <Metric label="故事数" value={status.counts.stories.toString()} />
        <Metric label="会话数" value={status.counts.sessions.toString()} />
      </section>

      <section className="admin-usage" id="usage">
        <div className="admin-usage-head">
          <h2>今日生成用量</h2>
          <span className="muted">{usage.today.date}（UTC）</span>
        </div>
        <div className="admin-kpis">
          <Metric label="生成次数" value={usage.today.generations.toString()} />
          <Metric
            label="成功率"
            value={
              usage.today.generations > 0
                ? `${Math.round((usage.today.successes / usage.today.generations) * 100)}%`
                : "—"
            }
          />
          <Metric label="失败次数" value={usage.today.failures.toString()} />
          <Metric label="Token 合计" value={usage.today.totalTokens.toLocaleString()} />
          <Metric label="平均耗时" value={`${(usage.today.averageLatencyMs / 1000).toFixed(1)}s`} />
          <Metric
            label="预估成本"
            value={usage.estimatedCost === null ? "未配置单价" : `¥${usage.estimatedCost.toFixed(4)}`}
          />
        </div>
        <p className="muted admin-usage-note">
          输入 {usage.today.promptTokens.toLocaleString()} / 输出 {usage.today.completionTokens.toLocaleString()}{" "}
          token，每位读者每日限 {usage.dailyTurnQuota} 次推进。失败的尝试会被记录但不占用配额。
          {usage.estimatedCost === null
            ? " 配置 LLM_PRICE_INPUT_PER_MTOK 与 LLM_PRICE_OUTPUT_PER_MTOK 后可显示成本。"
            : null}
        </p>
        {usage.today.byModel.length > 0 ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>模型</th>
                  <th>次数</th>
                  <th>Token</th>
                </tr>
              </thead>
              <tbody>
                {usage.today.byModel.map((row) => (
                  <tr key={`${row.provider}_${row.model ?? "default"}`}>
                    <td>{row.provider}</td>
                    <td>{row.model ?? "—"}</td>
                    <td>{row.generations}</td>
                    <td>{row.totalTokens.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">今天还没有生成记录。</p>
        )}
      </section>


      <section className="admin-grid">
        <Card className="panel" id="model">
          <Card.Content>
            <h2>模型配置</h2>
            <ModelConfigForm
              apiKeyConfigured={modelConfig.apiKeyConfigured}
              baseUrl={modelConfig.baseUrl}
              model={modelConfig.model}
              provider={modelConfig.provider}
            />
            <VerificationNotice query={query} />
            <dl className="admin-list">
              <div>
                <dt>Provider</dt>
                <dd>{modelConfig.provider}</dd>
              </div>
              <div>
                <dt>Base URL</dt>
                <dd>{modelConfig.baseUrl ?? "未配置"}</dd>
              </div>
              <div>
                <dt>Model</dt>
                <dd>{modelConfig.model ?? "未配置"}</dd>
              </div>
              <div>
                <dt>API Key</dt>
                <dd>{modelConfig.apiKeyConfigured ? "已配置" : "未配置"}</dd>
              </div>
              <div>
                <dt>更新时间</dt>
                <dd>{modelConfig.updatedAt ? formatDate(modelConfig.updatedAt) : "未记录"}</dd>
              </div>
            </dl>
          </Card.Content>
        </Card>

        <Card className="panel">
          <Card.Content>
            <h2>存储状态</h2>
            <dl className="admin-list">
              <div>
                <dt>类型</dt>
                <dd>{status.storage.type}</dd>
              </div>
              <div>
                <dt>路径</dt>
                <dd className="breakable">{status.storage.databasePath}</dd>
              </div>
            </dl>
          </Card.Content>
        </Card>
      </section>

      <Card className="panel" id="stories">
        <Card.Content>
          <h2>故事配置</h2>
          <div className="story-editor-list">
            {stories.map((item) => (
              <StorySummaryForm
                aiFreedom={item.story.aiFreedom}
                anchorsCount={item.anchors.length}
                charactersCount={item.characters.length}
                defaultSegmentLength={item.story.defaultSegmentLength}
                experienceMode={item.story.experienceMode}
                coverUrl={item.story.coverUrl}
                genre={item.story.genre}
                key={item.story.id}
                locationsCount={item.world.locations.length}
                readingTheme={item.story.readingTheme}
                storyId={item.story.id}
                tagline={item.story.tagline}
                title={item.story.title}
                visibility={item.story.visibility}
              />
            ))}
          </div>
        </Card.Content>
      </Card>

      <section className="panel" id="sessions">
        <h2>最近会话</h2>
        {sessions.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>会话</th>
                  <th>故事</th>
                  <th>回合</th>
                  <th>更新时间</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr key={session.id}>
                    <td className="mono">{session.id}</td>
                    <td>{session.storyId}</td>
                    <td>{session.turnCount}</td>
                    <td>{formatDate(session.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">暂无会话。</p>
        )}
      </section>

      <section className="panel" id="users">
        <div className="admin-usage-head">
          <h2>账号</h2>
          <span className="muted">最近 {users.length} 个账号</span>
        </div>
        <p className="muted admin-usage-note">
          只读加一个动作：把角色发给别人，或收回来。这里不显示密码相关的任何数据，也不显示谁读了什么。
          `ADMIN_EMAILS` 里的地址注册即为管理员，收回后下次登录会再次被提权。
        </p>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>邮箱</th>
                <th>昵称</th>
                <th>角色</th>
                <th>注册时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((account) => (
                <tr key={account.id}>
                  <td>{account.email}</td>
                  <td>{account.displayName}</td>
                  <td>{account.role === "admin" ? "管理员" : "读者"}</td>
                  <td>{formatDate(account.createdAt)}</td>
                  <td>
                    {/* The signed-in operator cannot demote themselves here: doing it
                        would take away the page they are standing on, mid-request. */}
                    {account.id === user.id ? (
                      <span className="muted">当前登录</span>
                    ) : (
                      <form action={updateUserRoleAction}>
                        <input name="userId" type="hidden" value={account.id} />
                        <input
                          name="role"
                          type="hidden"
                          value={account.role === "admin" ? "reader" : "admin"}
                        />
                        <button className="admin-inline-button" type="submit">
                          {account.role === "admin" ? "收回管理员" : "设为管理员"}
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel" id="moderation">
        <div className="admin-usage-head">
          <h2>审核队列</h2>
          <span className="muted">
            待处理 {moderation.counts.open} · 今日拦截 {moderation.counts.blockedToday} · 今日标记{" "}
            {moderation.counts.flaggedToday}
          </span>
        </div>
        <p className="muted admin-usage-note">
          拦截已经生效，列在这里只作审计；待处理的是标记内容和读者举报，需要人工判断。
          流式生成的片段在判定完成前已经送达读者，复审时应假设读者已看到。
        </p>
        {moderation.events.length ? (
          <ul className="moderation-list">
            {moderation.events.map((event) => (
              <li className={`moderation-item is-${event.action}`} key={event.id}>
                <div className="moderation-meta">
                  <span className={`moderation-badge is-${event.action}`}>{ACTION_LABELS[event.action]}</span>
                  <span className="moderation-surface">{SURFACE_LABELS[event.surface]}</span>
                  {event.categories.map((category) => (
                    <span className="moderation-category" key={category}>
                      {CATEGORY_LABELS[category] ?? category}
                    </span>
                  ))}
                  <span className="muted">{formatDate(event.createdAt)}</span>
                  {event.status !== "open" ? (
                    <span className="muted">
                      已{event.status === "dismissed" ? "驳回" : "处置"}
                      {event.resolvedBy ? `（${event.resolvedBy}）` : null}
                      {event.resolution ? `：${event.resolution}` : null}
                    </span>
                  ) : null}
                </div>
                <blockquote className="moderation-excerpt">{event.excerpt}</blockquote>
                {event.detail ? <p className="moderation-detail">{event.detail}</p> : null}
                {event.sessionId ? <p className="mono moderation-ref">会话 {event.sessionId}</p> : null}
                {event.status === "open" ? (
                  <form action={resolveModerationEventAction} className="moderation-actions">
                    <input name="eventId" type="hidden" value={event.id} />
                    <input
                      aria-label="处置说明"
                      className="moderation-note"
                      name="resolution"
                      placeholder="处置说明（可选）"
                      type="text"
                    />
                    <button className="moderation-button" name="status" type="submit" value="resolved">
                      确认违规
                    </button>
                    <button className="moderation-button" name="status" type="submit" value="dismissed">
                      驳回
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">暂无审核事件。</p>
        )}
      </section>
    </main>
  );
}

const ACTION_LABELS: Record<string, string> = {
  blocked: "已拦截",
  flagged: "待复审",
  allowed: "通过"
};

const SURFACE_LABELS: Record<string, string> = {
  reader_input: "读者输入",
  model_output: "模型输出",
  story_config: "故事配置",
  report: "读者举报"
};

const CATEGORY_LABELS: Record<string, string> = {
  minor_safety: "未成年人保护",
  self_harm: "自我伤害",
  sexual_content: "性内容",
  violence: "暴力",
  hate: "仇恨言论",
  illicit: "违法内容"
};

function VerificationNotice({ query }: { query: Record<string, string | string[] | undefined> }) {
  const status = readQuery(query.verify);
  if (!status) {
    return null;
  }

  if (status === "ok") {
    return (
      <p className="notice success">
        验证通过：{readQuery(query.provider)}，耗时 {readQuery(query.latencyMs)}ms，返回 {readQuery(query.choices)} 个选项。
      </p>
    );
  }

  return <p className="notice error">验证失败：{readQuery(query.message) ?? "请检查 Provider 配置"}</p>;
}

function readQuery(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <article className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}
