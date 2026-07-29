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
packages/contracts/       跨进程命令、事件、校验器和只读 DTO
packages/core/            不依赖平台的权威 GameRuntime 与玩法逻辑
packages/content/         静态内容定义、索引和校验
packages/persistence/     存档信封、迁移和持久化边界
packages/test-support/    手动时钟、固定随机数和测试夹具
```

安装、检查和启动透明桌面层：

```powershell
npm install
npm run check
npm start
```

需要同时检查普通管理窗口时：

```powershell
npm run start:management
```

详细目录边界见 `WORKSPACE.md`。

## 技术文档

- 正式技术设计：`Document/空艇餐厅-Phaser-Electron技术设计文档-v1.0.docx`
- 开发任务拆分：`Document/Phaser-Electron开发任务拆分-v0.1.md`
- 技术验证记录：`Document/Phaser-Electron桌面陪伴技术验证记录.md`

## 技术验证工程

Phaser + Electron 技术验证位于 `spikes/phaser-electron`。它已经验证透明窗口、不连续
视觉、动态热区、输入锁和非抢焦点行为，只用于提供技术依据，不继续承载正式玩法。

## 已完成的正式基础

- 根级 npm workspace 和严格 TypeScript 构建；
- Electron 应用生命周期与单实例锁；
- 透明 DesktopWindow 和普通 ManagementWindow；
- 主显示器工作区适配、显示器变化响应和窗口越界恢复；
- 渲染器崩溃隔离与桌面窗口恢复；
- 双 preload、白名单 IPC 和 sender／载荷校验；
- 主进程权威 GameRuntime、类型化命令和双窗口状态广播；
- 管理窗口切换安静模式，Phaser桌面状态同步；
- 自动测试、生产构建和 Electron 烟雾测试。
- 响应式 Phaser 桌面世界首版：飞艇厨房、底部全宽餐厅，以及沿屏幕右缘连接空中装卸站与地面交换站的运输缆车；
- 正式 `SemanticHitMap`、主进程光标采样、局部点击穿透与输入锁；
- 飞艇和餐厅点击进入管理窗口，缆车、角色和空白区保持穿透。

## 下一阶段

M1 正式桌面壳接下来继续完成：

1. 首次启动、目标显示器、置顶选择和设置保存；
2. 多 DPI、任务栏和动态命中地图平台验证；
3. 将当前桌面世界拆分为 Boot、World、Environment 和 UI 场景；
4. 最小 React Flow 科技树页面，用于验证复杂管理界面。
