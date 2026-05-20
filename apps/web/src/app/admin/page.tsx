import { Card, Chip } from "@heroui/react";
import {
  getAdminModelConfig,
  getAdminModerationEvents,
  getAdminSessions,
  getAdminStatus,
  getAdminStories
} from "@/lib/api";
import { ModelConfigForm, StorySummaryForm } from "@/components/admin-console-forms";
import { BrandMark } from "@/components/brand-mark";
import Link from "next/link";

export default async function AdminPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const [status, modelConfig, stories, sessions, moderationEvents] = await Promise.all([
    getAdminStatus(),
    getAdminModelConfig(),
    getAdminStories(),
    getAdminSessions(),
    getAdminModerationEvents()
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
                storyId={item.story.id}
                tagline={item.story.tagline}
                title={item.story.title}
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

      <section className="panel">
        <h2>审核事件</h2>
        {moderationEvents.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>类型</th>
                  <th>状态</th>
                  <th>时间</th>
                </tr>
              </thead>
              <tbody>
                {moderationEvents.map((event) => (
                  <tr key={event.id}>
                    <td className="mono">{event.id}</td>
                    <td>{event.type}</td>
                    <td>{event.status}</td>
                    <td>{formatDate(event.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">暂无审核事件。MVP 阶段先保留接口和视图占位。</p>
        )}
      </section>
    </main>
  );
}

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
