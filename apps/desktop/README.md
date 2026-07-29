# Desktop application

正式桌面客户端包含两个窗口：

- `DesktopWindow`：透明、无边框、默认不可聚焦并完全点击穿透。
- `ManagementWindow`：普通、不透明、可聚焦、可调整大小，按需创建并复用。

主进程职责分布：

```text
src/main/app-lifecycle.ts          单实例、启动、退出、运行时组合和恢复
src/main/display-service.ts        工作区边界、居中和显示器变化
src/main/window-manager.ts         双窗口创建、复用、sender识别和崩溃隔离
src/main/ipc-router.ts             白名单IPC、载荷校验、命令派发和状态广播
src/main/settings-store.ts         版本化设置读取、串行原子写入和订阅
src/main/renderer-bridge-smoke.ts  真实Electron bridge和IPC烟雾断言
src/main/system-clock.ts           GameRuntime的现实UTC时钟适配器
src/main/launch-options.ts         启动参数与开发渲染地址校验
scripts/build-preloads.mjs         沙箱兼容的双preload单文件构建
```

状态流：

```text
Phaser／React
  → preload白名单API
  → IpcRouter校验sender与unknown载荷
  → GameRuntime执行类型化命令
  → 生成只读GameSnapshot
  → 广播给DesktopWindow和ManagementWindow
```

DesktopWindow 和 ManagementWindow 都保持 `sandbox: true` 与
`contextIsolation: true`。构建时，两个 preload 分别打包成只依赖 Electron 官方模块的
单文件，避免沙箱 preload 加载本地 CommonJS 模块失败。

## Windows 透明合成约束

在当前 Windows 11 与硬件加速环境中，透明 BrowserWindow 如果宽度恰好等于整个
`workArea`，Windows 会选择不保留逐像素 Alpha 的全屏合成路径，空白区最终显示为白色。
正式 DesktopWindow 因此在工作区右侧保留 1 DIP；该差异肉眼不可见，但可以避免全屏
表面提升，同时保留 GPU 加速和玩家选择的置顶策略。

透明窗口第一次绘制后调用 `setBounds` 也会重新触发白底。初次显示不再重复设置边界；
显示器、任务栏或 DPI 导致目标边界真正变化时，窗口管理器销毁并按新边界重建
DesktopWindow，而不是原地调整透明窗口。

开发态 Electron 的默认 Chromium profile 可能被其他 Electron 工程或旧 GPU 缓存复用。
只调用 `app.setPath("userData", ...)` 不足以保证 GPU 子进程使用新 profile。生命周期
会在 `ready` 和单实例锁之前，同时通过 Chromium `user-data-dir` 开关与 Electron
`userData` 路径指定 `airship-restaurant-desktop` 专用目录，并尊重测试或打包器显式
传入的命令行路径。

构建并只启动透明桌面层：

```powershell
npm start
```

同时启动普通管理窗口：

```powershell
npm run start:management
```

执行真实 Electron bridge 与 IPC 烟雾测试：

```powershell
npm run smoke
```

测试必须在两个窗口中分别找到 preload bridge，并成功读取处于 `ready` 状态的
`GameSnapshot`。烟雾测试使用独立用户数据目录，不会被已经运行的玩家实例拦截。

检查 Phaser 输出的空白区 Alpha：

```powershell
npm run smoke:transparency
```

首次启动或显示器回退待确认时，应用会自动打开管理窗口；完成引导后，不带
`--show-management` 启动时只创建桌面陪伴窗口。再次启动同一应用不会创建第二个
实例，而会让已有实例打开并聚焦管理窗口。

## 场景骨架与设置持久化

Phaser 由 `BootScene` 启动 `EnvironmentScene`、`DesktopWorldScene` 和
`DesktopUiScene`；开发构建额外启动 `InteractionDebugScene`，显示命中轮廓、鼠标
DIP 坐标与穿透状态。`EnvironmentScene` 在安静模式独立休眠，世界逻辑仍由主进程
继续运行。桌面世界当前还包含一个不参与点击的港口预留占位。

ManagementWindow 提供目标显示器、置顶、正常/安静/低动态和 UI 缩放设置。主进程
将设置保存在专用用户数据目录的 `settings.json`，同时记录管理窗口位置。显示器热
插拔后若原目标不存在，会回退主显示器、打开管理窗口并要求重新确认。

## 桌面世界与语义交互

Phaser 桌面世界当前使用程序图形绘制三个正式占位组件：

- 顶部飞艇厨房使用不规则多边形热区，轮廓之外保持透明和穿透；
- 底部餐厅使用贯穿目标显示器宽度的稳定矩形热区；
- 空中装卸站和地面交换站分别提供运输线路的起止锚点；
- 轨道从空中装卸站接入屏幕右缘，再接入地面交换站；缆车依次走完上方接驳段、右缘竖直段和底部接驳段；
- 上方轨道中心距工作区顶边 10 DIP，轨道端点与装卸站目标点分离；缆车抵达端点时，由货箱偏移计算保证货箱中心对准装卸口；
- 调整交换站位置、分辨率或工作区尺寸后，所有分段、转向滑轮和缆车位置都会自动重算；
- 缆车、交换站外伸部分、厨师、客人和蒸汽只负责表现，不加入命中地图。

主进程以 50 ms 周期读取 Windows 光标的屏幕 DIP 坐标，换算成 DesktopWindow
局部坐标后通过桌面 preload 发送给 Phaser。`SemanticHitMap` 支持矩形、圆形和
多边形，并按优先级决定当前语义对象。进入热区时窗口恢复交互，离开时重新调用
`setIgnoreMouseEvents(true, { forward: true })`。

`pointerdown` 到 `pointerup` 之间使用输入锁，避免对象状态变化时把同一次点击的
后半段落到桌面应用。点击飞艇或餐厅会打开现有 ManagementWindow。
