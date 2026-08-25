# 飞艇餐厅 R12 UI 入口与统一壳层实现记录 v0.1

日期：2026-08-24

## 1. 本轮范围

本轮完成 R12 的主结构迁移，不改变库存、订单、采购、科技、员工、剧情或存档业务规则：

- `ManagementSection` 补齐 `finance`、`roster`，八个核心入口与经营总览使用同一稳定深链协议。
- 桌面左上角“总览”入口替换为右下角 52×52 折叠启动器。
- 展开菜单包含可点击经营摘要和 4×2 功能格；再次点击、点击菜单外和 Escape 均可收起。
- 场景内仓库、交换站、员工中心等原有热点继续存在，并深链到同一管理窗口路由。
- 管理窗口改为顶栏、左侧分组导航、唯一主工作区和底部状态栏。
- 删除仓库、食谱、采购、科技树、场景布置、员工、成长图鉴各自独立的 `open` 状态，统一为 `activePage`。
- 仓库、食谱、采购、员工、场景布置和科技树复用既有业务组件，并通过主工作区样式嵌入统一壳层。
- 经营账本与故事花名册提升为一级路由；解锁图鉴归入科技树二级页签。
- 系统设置与存档诊断移到顶栏“设置”页面，不再和经营首页混排。
- 管理窗口使用 Electron 隐藏标题栏覆盖：系统窗口按钮融入 58 px 深色顶栏；壳层铺满客户区，移除 14 px 外边距、圆角描边和外层阴影。

## 2. 关键实现

### 2.1 桌面入口

`desktop-management-menu.ts` 统一定义启动器、摘要、4×2 功能格几何和 hit ID。1000×700 基准视口下：

- 启动器：`x=932, y=632, width=52, height=52`。
- 展开面板固定从启动器左上方展开，右边缘和底边均保留 16 px。
- 菜单项优先级高于场景热点；展开时面板捕获自身区域，避免点击穿透。

`WorkspaceScene.ts` 使用单一菜单开关与单一按压目标，点击功能后先收起菜单，再发出既有 `openManagement(section)` 请求。

### 2.2 管理窗口

`App.tsx` 使用：

- `activePage: ManagementSection | "settings"`
- `technologyView: "tree" | "compendium"`

同一时刻只渲染一个主路由。完整财务明细通过 `OperationsPanel view="finance"` 独立呈现，经营总览不再复制账本明细。

### 2.3 Smoke 迁移

原 smoke 依赖 `.management-shortcut--*` 的旧按钮与“打开/关闭弹窗”流程。本轮改为通过 `data-management-section` 驱动统一侧栏路由，并保留对仓库物流、现实食谱、采购权威来源、场景布置、员工、图鉴和账本内容的业务断言。

## 3. 验收证据

- Contracts typecheck：通过。
- Desktop typecheck：通过。
- Desktop 测试：48 个测试文件、179 项测试全部通过。
- 导航与布局定向测试：3 个测试文件、16 项测试全部通过。
- Desktop production build：通过。
- `npm run smoke`：通过；desktop/management 两个 renderer bridge 均 ready，业务 revision 一致。
- `npm run smoke:transparency`：通过；透明区 alpha=0，飞艇与餐厅实体区 alpha=255。

视觉记录：

- `r12-desktop-launcher.png`
- `r12-overview-management.png`
- `r12-warehouse-management.png`
- `r12-recipe-book-management.png`
- `r12-building-management.png`
- `r12-staff-management.png`
- `r12-progression-management.png`
- `r12-finance-management.png`

所有 Electron 验收均使用隔离 smoke 目录；未读取或修改玩家正式存档。

## 4. 后续收口

R12-06 与 R12-07 尚未关闭：

- 将现有 Dialog 组件的 DOM 语义从模态弹窗进一步收敛为显式 embedded 模式，而不只依赖统一工作区样式覆盖。
- 为剧情锁定、局部详情、确认层、编辑工具和管理窗口关闭建立完整 Escape 栈测试，保证一次 Escape 只退出一层。
- 增加 760 px 以下真实窗口视觉记录与键盘导航验收。

当前不存在多个主功能同时打开的状态；上述事项属于输入层级和可访问性收口，不影响本轮统一入口与统一壳层投入体验。
