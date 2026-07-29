# Desktop application

正式桌面客户端包含两个窗口：

- `DesktopWindow`：透明、无边框、默认不可聚焦并完全点击穿透。
- `ManagementWindow`：普通、可聚焦、可调整大小，按需创建并复用。

主进程职责分布：

```text
src/main/app-lifecycle.ts    单实例、启动、退出和恢复
src/main/display-service.ts  工作区边界、居中和显示器变化
src/main/window-manager.ts   桌面窗口与管理窗口的创建、复用和崩溃隔离
src/main/launch-options.ts   启动参数与开发渲染地址校验
```

构建并启动管理界面：

```powershell
npm start
```

执行会在两秒后自动退出的 Electron 烟雾测试：

```powershell
npm run smoke
```

不带 `--show-management` 启动时，只创建桌面陪伴窗口。再次启动同一应用不会
创建第二个实例，而会让已有实例打开并聚焦管理窗口。

正式 `SemanticHitMap` 接入前，DesktopWindow 始终调用
`setIgnoreMouseEvents(true, { forward: true })`，因此不会阻挡桌面操作。
