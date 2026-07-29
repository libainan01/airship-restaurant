# 空艇餐厅

一款面向 Windows 10／11 的桌面陪伴型挂机游戏。

## 当前技术方向

正式客户端采用 **Phaser + Electron + React + TypeScript**：

- Electron 负责透明桌面窗口、普通管理窗口、原生系统能力、IPC 和应用生命周期。
- Phaser 负责飞艇厨房、底部餐厅、港口、角色、缆车和环境特效等桌面世界表现。
- React 负责设置、档案、图鉴和科技树等复杂界面。
- React Flow 作为科技树节点图的首选实现。
- 纯 TypeScript 业务核心负责库存、烹饪、运输、经营、剧情条件、成长与存档。

桌面世界的视觉和输入相互独立：角色、缆车和环境效果可以持续显示，但点击穿透到后方应用；
只有飞艇船体、港口本体、底部餐厅和临时操作面板接收点击。

Godot 技术设计文档、工程文件和 M0 原型代码已经从当前工作区移除。相关历史仍可通过
Git 记录追溯，但不再参与正式开发。

## 正式工作区

```text
apps/desktop/             Electron 主进程、双 preload、Phaser 与 React 渲染入口
packages/contracts/       跨进程命令、事件和只读 DTO
packages/core/            不依赖平台的游戏运行时与玩法逻辑
packages/content/         静态内容定义、索引和校验
packages/persistence/     存档信封、迁移和持久化边界
packages/test-support/    手动时钟、固定随机数和测试夹具
```

根目录使用 npm workspaces 和单一锁文件。安装和检查：

```powershell
npm install
npm run check
```

详细目录边界见 `WORKSPACE.md`。

## 技术文档

- 正式技术设计：`Document/空艇餐厅-Phaser-Electron技术设计文档-v1.0.docx`
- 开发任务拆分：`Document/Phaser-Electron开发任务拆分-v0.1.md`
- 技术验证记录：`Document/Phaser-Electron桌面陪伴技术验证记录.md`

## 技术验证工程

Phaser + Electron 技术验证位于：

`spikes/phaser-electron`

已验证：

- 单个覆盖显示器工作区的透明 Electron 窗口；
- 不连续视觉内容；
- 中央角色和特效可见但鼠标穿透；
- 固定与动态语义交互区域；
- 按下期间输入锁，避免 `pointerup` 落到后方应用；
- 点击游戏内容不抢走当前工作软件的键盘焦点；
- TypeScript 检查、命中地图测试与生产构建。

验证工程只用于证明关键桌面能力，不继续承载正式玩法。正式代码只进入 `apps/` 和
`packages/`。

## 已完成的正式基础

- 根级 npm workspace 和严格 TypeScript 构建；
- Electron 应用生命周期与单实例锁；
- 透明 DesktopWindow 和普通 ManagementWindow；
- 主显示器工作区适配、显示器变化响应和窗口越界恢复；
- 渲染器崩溃隔离与桌面窗口恢复；
- Electron 自动烟雾测试。

## 下一阶段

M1 正式桌面壳将继续完成：

1. 类型化 IPC 与权威 GameRuntime；
2. 首次启动、目标显示器和设置保存；
3. 多DPI、任务栏和动态命中地图平台验证；
4. 最小 React Flow 科技树页面，用于验证多窗口状态同步。
