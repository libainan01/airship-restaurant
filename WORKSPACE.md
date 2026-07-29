# 正式开发工作区

正式客户端使用根级 npm workspaces 和单一锁文件。

```text
apps/desktop/             Electron 主进程、双 preload、Phaser 与 React 渲染入口
packages/contracts/       跨进程命令、事件和只读 DTO
packages/core/            不依赖平台的游戏运行时与玩法逻辑
packages/content/         静态内容定义、索引和校验
packages/persistence/     存档信封、迁移和持久化边界
packages/test-support/    手动时钟、固定随机数和测试夹具
```

安装和检查：

```powershell
npm install
npm run check
```

当前只建立 M1-01 的编译边界和桌面／管理渲染入口。Electron 窗口生命周期、
类型化 IPC、正式命中地图和设置引导将在后续 M1 任务中接入。

`spikes/phaser-electron` 是已经完成的技术验证，不被正式工作区引用。
