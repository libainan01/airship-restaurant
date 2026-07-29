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

首次执行 `npm start` 会同时打开透明 DesktopWindow 和普通、不透明的
ManagementWindow 完成引导；确认设置后，后续启动默认只显示 DesktopWindow。
`npm run start:management` 可随时强制打开管理窗口。

已接入：

- M1-01：正式工作区和构建边界；
- M1-02～04：生命周期、单实例、DesktopWindow、ManagementWindow和显示器恢复；
- M1-05：双preload、白名单API、sender校验、IPC载荷校验和订阅清理；
- M1-06：主进程权威GameRuntime、命令结果和双窗口状态同步。
- M1-07：矩形、圆形和多边形 `SemanticHitMap`、主进程光标采样、穿透切换和输入锁；
- M1-08：响应式桌面世界首版与多场景骨架；`BootScene` 组合世界、环境、UI和开发调试层，包含飞艇厨房、全宽餐厅、港口预留位和永远穿透的运输缆车；空中/地面交换站、屏幕边缘线路、完整往返路径和货箱对位均按工作区动态重算；
- M1-09：首次启动设置页、目标显示器、置顶、正常/安静/低动态、管理界面缩放、管理窗口位置持久化；设置实时广播，环境层可独立休眠，显示器丢失时回退主屏并要求重新确认。

正式代码不从 `spikes/phaser-electron` 导入任何实现。主进程每 50 ms 将窗口内
DIP 光标位置发送给桌面 preload，Phaser 使用语义热区决定是否调用
`setIgnoreMouseEvents`。该路径不依赖点击穿透状态下不稳定的 DOM `mousemove`，
因此光标首次移入飞艇或餐厅时也能可靠恢复交互。

应用设置保存在 Electron 专用 `userData/settings.json` 中，采用带版本号的存档信封和
临时文件替换写入。设置只能由 ManagementWindow 通过校验后的白名单 IPC 修改；
DesktopWindow 只拥有读取与订阅权限。
