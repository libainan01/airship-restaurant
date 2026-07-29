const sections = ["科技树", "设置", "角色档案", "故事图鉴"];

export function App(): React.JSX.Element {
  const workspaceInfo = window.airshipManagement?.getWorkspaceInfo();

  return (
    <main className="management-shell">
      <header>
        <p className="eyebrow">AIRSHIP RESTAURANT · MANAGEMENT</p>
        <h1>正式管理界面工作区</h1>
        <p>
          React 多页面入口已经建立。路由、科技树和状态同步将在后续 M1
          任务中接入。
        </p>
      </header>

      <section
        className="status-card"
        aria-label="工作区状态"
      >
        <span>Preload 通道</span>
        <strong>{workspaceInfo?.channel ?? "浏览器预览"}</strong>
        <span>骨架版本</span>
        <strong>{workspaceInfo?.version ?? "0.1.0"}</strong>
      </section>

      <nav aria-label="计划中的管理页面">
        {sections.map((section) => (
          <button
            key={section}
            type="button"
            disabled
          >
            {section}
          </button>
        ))}
      </nav>
    </main>
  );
}
