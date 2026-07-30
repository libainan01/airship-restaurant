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

M2 经营稳定性验证分为加速模拟和真实常驻两层：

```powershell
# 8 小时加速模拟、经营守恒、不同 Tick 密度与存档恢复确定性
npm run test:stability

# 默认运行 2 小时；使用隔离的临时用户目录，不读写正式玩家存档
npm run stability:resident
```

常驻测试结束后会在终端打印 JSON 报告路径。报告记录 Electron 各进程的 CPU 与
工作集、渲染器数量、存档错误、窗口崩溃／恢复计数以及经营修订变化。需要短跑或
改变采样间隔时，可直接调用启动器：

```powershell
node scripts/run-resident-stability.mjs `
  --stability-duration-minutes=0.05 `
  --stability-sample-seconds=1
```

## 技术文档

- 正式技术设计：`Document/空艇餐厅-Phaser-Electron技术设计文档-v1.0.docx`
- 开发任务拆分：`Document/Phaser-Electron开发任务拆分-v0.1.md`
- 技术验证记录：`Document/Phaser-Electron桌面陪伴技术验证记录.md`
- M1 平台回归基线：`Document/M1平台回归基线-v0.1.md`
- M2 经营规则草案：`Document/M2最小经营闭环规则草案-v0.1.md`
- M3 食谱叙事系统基线：`Document/M3食谱叙事系统基线-v0.1.md`
- M3 剧情方向决策：`Document/M3剧情方向决策记录-v0.1.md`
- M3 普通客人日常对话 Demo：`Document/M3普通客人日常对话Demo-v0.1.md`
- M3 首次 15—30 分钟体验脚本：`Document/M3首次15-30分钟体验脚本-v0.1.md`

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
- 首次启动在普通管理窗口选择目标显示器、置顶策略和桌面表现模式；
- 设置使用版本化 JSON 信封持久化，置顶、缩放和表现模式实时同步；
- 管理窗口位置、目标显示器与缩放在重启后恢复，显示器丢失时安全回退主屏；
- 自动测试、生产构建和 Electron 烟雾测试。
- 响应式 Phaser 桌面世界首版：飞艇厨房、底部全宽餐厅，以及沿屏幕右缘连接空中装卸站与地面交换站的运输缆车；
- `BootScene`、`DesktopWorldScene`、`EnvironmentScene`、`DesktopUiScene` 多场景骨架，开发环境提供命中区域调试层；
- 港口预留位置；环境层可在安静模式整体休眠而不影响主进程状态；
- 正式 `SemanticHitMap`、主进程光标采样、局部点击穿透与输入锁；
- 飞艇和餐厅点击进入管理窗口，缆车、角色和空白区保持穿透。

M2 已开始：纯 TypeScript 核心层现已包含防系统时间回拨的 `GameTimeTracker`、
受校验的五种食材／三道食谱／基础补给内容注册表，以及支持预留、容量限制、
重复操作保护和原子转移的 `InventorySystem`。`CookingSystem` 已支持食谱选择、
食材预留、绝对完成时间、出餐台阻塞恢复、原子产出和自动续做。在线 M2 闭环已经
接通 `LogisticsSystem` 与 `RestaurantSystem`：缆车按真实运输阶段沿屏幕边缘移动，
餐厅会自动接待、售卖并记录销量和铜币；桌面世界和管理窗口读取同一份主进程快照。
版本化 `save.json` 已保存库存、进行中任务、在途运输、等待客人、随机状态和经营
统计，并通过临时文件替换、上一份有效备份和损坏回退保证恢复。启动时会按离散事件
边界结算无固定时长上限的离线经营，离线过程不接触叙事系统。
管理窗口现可切换三道菜单、控制自动续做，并查看实时销量、铜币、分项库存、UTC
事件时间、离线经营摘要和主／备存档状态；经营操作经类型化 IPC 交由主进程校验。

## 下一阶段

M2 的功能闭环与最小操作界面已经完成。8 小时加速稳定性基线已通过：一次性推进与
逐秒推进得到相同的玩家可见经营状态，每小时序列化重启和多菜单切换检查也保持
确定性；库存、运输、销量和铜币守恒成立。基线共完成 490 批烹饪、配送 968 份、
售出 950 份并获得 3800 铜币。

真实常驻监控入口也已完成 3 秒启动／采样／报告／退出短跑，期间两个渲染器数量
稳定，未发生存档错误、渲染器退出、主页面加载失败或桌面窗恢复。下一批继续完成：

M3 食谱叙事基础现已接入正式内容：ContentRegistry 能定义并校验角色、客人、地点、
对话说话人、普通闲聊、关键剧情对白、故事事件、本地化和食谱日志；NarrativeSystem
只接收在线经营增量，支持优先级、前置条件、去重、已读、完成、回看状态和旧存档
恢复。管理窗口提供默认折叠的“食谱故事”区。

白夜城、奥托、贝尔夫妇、《贝尔家的炉火炖菜》、21 组普通闲聊及 7 组关键剧情对白
已经进入内容层。AmbientDialogueSystem 已接入 GameRuntime，会按营业上下文、熟悉度、
故事前置、权重、冷却、安静模式和单次会话次数选取普通闲聊。桌面端会把当前对白
解析为说话人姓名与文本，绘制在对应餐厅客人头顶；气泡不注册新的点击热区。

下一批优先推进内容：

1. 接入首次 15—30 分钟体验脚本的关键对白编排、故事订单和食谱意义变化；
2. 完善重要对白的暂停、恢复与回看，普通闲聊保持非补发的会话状态；
3. 整理首批角色、食谱卡和界面美术需求；
4. 2 小时常驻与 Windows 平台矩阵保留到阶段验收时补做。
