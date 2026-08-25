# 飞艇餐厅 G0 Godot 可视化样板实现记录 v0.1

> 日期：2026-08-24。
>
> 阶段状态：G0-01～G0-06、G0-08 已完成；G0-07 等待用户实际查看与审核。未经用户明确通过，不进入 G1。

## 1. 本轮目标

G0 不接入正式经营规则，只验证新的制作流程是否解决以下问题：

- 场景元素必须可以在编辑器中直接移动和缩放；
- 可视图片、点击区域、工作锚点和 UI 不能继续绑在代码坐标中；
- 一个物体可以拥有不规则且互不连续的点击区域；
- 黎明、正午和傍晚可以即时切换，但不能向透明桌面铺满屏色块；
- 场景热点和统一 UI 入口可以打开同一功能；
- 默认窗口作为桌面伴宠保持大量透明，空白位置的鼠标事件落到下层桌面或窗口；
- 管理窗口不再使用浏览器边框、HTML 或 CSS。

## 2. 环境

- Godot：4.7.2 stable .NET，官方 Mono Windows x86_64 便携版；
- Godot 运行标识：4.7.2.stable.mono.official.ed1daf0bf；
- .NET SDK：9.0.311；
- 渲染验收：OpenGL 3.3 Compatibility，NVIDIA GeForce RTX 4060；
- 便携编辑器保存在仓库忽略的 .tools 目录，不进入版本库；
- 下载归档 SHA-256：A2A48473A7414C5F19FAB690518CAEBB738C09EF9601F6BD2388676A7F53B3C0。

## 3. 工程边界

新工程位于 apps/godot，与 apps/desktop 并存：

~~~text
apps/godot/
├─ project.godot
├─ AirshipRestaurant.Godot.csproj
├─ assets/world/
├─ scenes/g0_showcase.tscn
├─ scripts/
│  ├─ G0Showcase.cs
│  ├─ DesktopCompanionWindow.cs
│  ├─ AtmosphereController.cs
│  ├─ InteractiveHotspot.cs
│  └─ InteractionDebugOverlay.cs
└─ themes/steampunk_theme.tres
~~~

G0 不启动 Electron 或 Node 后台，不导入 TypeScript 业务包，不创建存档，也没有访问旧玩家正式存档的代码。

## 4. 可编辑透明场景

g0_showcase.tscn 明确保存：

- 飞艇餐厅的位置与缩放；
- 地面风铃交换站的位置与缩放；
- 人员电梯和贴屏幕右侧的垂直路径；
- 世界层、局部氛围层、UI 层和弹层；
- 地面交换站的两个 CollisionPolygon2D 点击岛；
- WorkAnchor、ItemAnchor、DialogueAnchor、StatusAnchor；
- 右下角折叠入口、局部时段预览和仓库窗口。

旧天空图片只作为资源参考保留，运行场景中的 Backdrop 默认隐藏。项目同时启用透明窗口、逐像素透明和透明 Viewport；默认清屏色 Alpha 为 0。C# 脚本不保存飞艇、建筑、货梯或 UI 的像素位置。

## 5. 不连续点击区与桌面穿透

GroundExchangeStation 使用以下结构：

~~~text
GroundExchangeStation
├─ VisualRoot
├─ InteractionRoot
│  ├─ LeftServiceIsland
│  └─ RightExchangeIsland
├─ StationAnchors
│  ├─ WorkAnchor
│  ├─ ItemAnchor
│  ├─ DialogueAnchor
│  └─ StatusAnchor
└─ DebugRoot
~~~

两个点击岛共同触发仓库，但中间空隙不会响应。Area2D 只用于输入检测，不是角色移动障碍。

DesktopCompanionWindow 每帧读取全局鼠标位置，只把以下当前可见节点视为输入目标：

- 地面交换站的真实 CollisionPolygon2D；
- 右下角 LauncherButton；
- 展开后的 QuickMenu；
- 展开后的 WarehouseWindow。

Windows 下通过原生窗口扩展样式动态切换 WS_EX_TRANSPARENT：指针不在上述目标上时整个 Godot 窗口点击穿透；进入真实目标时恢复输入；按下鼠标期间保持输入，避免按下与释放落到不同窗口。没有使用 Godot 的 WindowSetMousePassthrough 多边形，因为该接口在 Windows 会同时裁掉多边形外画面，且无法表达多个分离视觉岛。

DebugRoot 从真实 CollisionPolygon2D 和 Marker2D 动态生成青色轮廓与金色十字，不维护第二份点击坐标。运行时可以通过菜单或 D 键开关。

## 6. 动态氛围

AtmosphereController 提供黎明、正午和傍晚三套 WorldModulate 颜色与 0.65 秒平滑过渡。三种时段只调制已绘制的游戏对象；全屏 Overlay 的 Alpha 固定为 0，不会污染透明像素。时段按钮放在右下角折叠菜单中，默认不常驻桌面。

## 7. UI 样板

steampunk_theme.tres 统一管理黄铜边框、深色木质面板、青色主操作、按钮状态和文字层级。

默认只保留右下角 74×74 功能入口；顶部调试栏和底部状态条不再常驻。展开菜单后才显示时段预览、仓库入口和交互区开关。

仓库窗口：

- 不使用全屏暗幕；
- 外围 WarehouseOverlay 和 Dim 均忽略输入且保持透明；
- 只有 WarehouseWindow 自身接收输入；
- G0 压缩为 580 像素宽的单栏物资格样板，约占 1440 像素视口的 40.3%；
- 两种入口调用同一个 OpenWarehouse 状态，不创建重复窗口。

## 8. 验收结果

已通过：

- Debug 与 Release 构建：0 警告、0 错误；
- Godot headless 场景结构验收；
- 两个点击多边形、四个场景锚点；
- Viewport 透明、旧 Backdrop 隐藏、全屏 Overlay Alpha 为 0；
- WarehouseOverlay 为 Ignore，WarehouseWindow 为 Stop；
- 默认折叠入口属于输入目标，左上透明点不属于输入目标；
- Windows OpenGL 真机窗口启用动态点击穿透并正常退出；
- 调试层从源区域生成 12 个节点；
- 默认、菜单和仓库三种真实窗口截图；
- 无 Godot 运行错误或 C# 异常。

结构与 Windows 运行日志：

~~~text
G0_VALIDATION_OK polygons=2 anchors=4 transparent=true desktop_input_targets=2
G0_CLICK_THROUGH active=True input_targets=2
G0_DESKTOP_WINDOW transparent=true click_through=dynamic
~~~

Alpha 统计（1440×900）：

| 状态 | 完全透明 | 半透明 | 完全不透明 |
|---|---:|---:|---:|
| 默认黎明 | 69.64% | 0.47% | 29.90% |
| 菜单展开 | 65.27% | 4.11% | 30.63% |
| 紧凑仓库展开 | 46.79% | 5.64% | 47.57% |

视觉记录：

- [默认透明黎明](./g0-godot-transparent-dawn.png)
- [默认透明傍晚](./g0-godot-transparent-evening.png)
- [右下角菜单展开](./g0-godot-transparent-menu.png)
- [紧凑仓库展开](./g0-godot-transparent-warehouse.png)

## 9. 用户审核项

请重点判断：

1. 默认透明量是否合适；
2. 飞艇、地面交换站和人员电梯的整体比例是否合适；
3. 地面交换站放在最右侧的构图是否符合预期；
4. 黎明、正午、傍晚的实体调色方向是否正确；
5. 右下角入口与紧凑仓库的遮挡量是否可接受；
6. 在真实桌面上，透明空白点击是否稳定落到下层窗口；
7. Godot 场景树与 Inspector 是否达到“方便查看和修改效果”的目标。

审核通过前，G0-07 保持进行中，G1 不开始。

## 10. 已知边界

- 当前角色、任务、库存数量和仓库数据都是展示占位，不是业务状态；
- G0 已建立 Windows 透明与点击穿透基线，多显示器、DPI、窗口吸附和打包稳定性仍在 G9 完整验收；
- 未实现建筑拖拽编辑、真实存档、正式 UI 路由和输入栈；
- 这些内容分别属于 G1、G2 和 G9，不应在 G0 提前固化。