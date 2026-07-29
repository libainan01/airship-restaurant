# 正式开发工作区

正式客户端使用根级 npm workspaces 和单一锁文件。

```text
apps/desktop/             Electron 主进程、双 preload、Phaser 与 React 渲染入口
packages/contracts/       跨进程命令、事件、运行时校验器和只读 DTO
packages/core/            不依赖平台的 GameRuntime 与玩法逻辑
packages/content/         静态内容定义、索引和校验
packages/persistence/     存档信封、迁移和持久化边界
packages/test-support/    手动时钟、固定随机数和测试夹具
```

安装、检查、启动和烟雾测试：

```powershell
npm install
npm run check
npm start
npm run start:management
npm run smoke
npm run smoke:transparency
```

`npm start` 只启动透明 DesktopWindow；`npm run start:management` 才会同时打开普通、
不透明的 ManagementWindow。

已接入：

- M1-01：正式工作区和构建边界；
- M1-02～04：生命周期、单实例、DesktopWindow、ManagementWindow和显示器恢复；
- M1-05：双preload、白名单API、sender校验、IPC载荷校验和订阅清理；
- M1-06：主进程权威GameRuntime、命令结果和双窗口状态同步。
- M1-07：矩形、圆形和多边形 `SemanticHitMap`、主进程光标采样、穿透切换和输入锁；
- M1-08：响应式桌面世界首版，包含飞艇厨房、全宽餐厅和永远穿透的运输缆车；
- M1-09：空中装卸站与地面交换站提供线路锚点，轨道经屏幕右缘转向，缆车沿完整分段路线在两个站点间往返，所有位置按锚点与工作区尺寸动态重算。
- M1-10：上方轨道固定贴近工作区顶边；轨道端点与空中装卸站解耦，按货物箱相对轮组的偏移反算端点，保证到站时货箱对准装卸口。

正式代码不从 `spikes/phaser-electron` 导入任何实现。主进程每 50 ms 将窗口内
DIP 光标位置发送给桌面 preload，Phaser 使用语义热区决定是否调用
`setIgnoreMouseEvents`。该路径不依赖点击穿透状态下不稳定的 DOM `mousemove`，
因此光标首次移入飞艇或餐厅时也能可靠恢复交互。
