# 正式开发工作区

正式客户端使用根级 npm workspaces、单一锁文件和严格 TypeScript 配置。

```text
apps/desktop/             平台宿主、双窗口、preload、Phaser 和 React
packages/contracts/       跨进程公开协议与只读 DTO
packages/core/            Kernel、领域模块、运行时编排与投影
packages/content/         经过校验的静态内容
packages/persistence/     版本化存档与迁移
packages/test-support/    确定性测试工具
```

## 依赖方向

- `contracts` 不依赖业务实现；
- `core` 依赖 contracts，但领域模块之间通过命令、事件或显式端口协作；
- `content` 提供定义，不拥有运行时进度；
- `persistence` 负责信封、原子落盘与迁移，不决定业务规则；
- `apps/desktop` 是组合根和表现层，不拥有订单、任务、库存、角色或剧情事实；
- 跨包只能使用公开出口，禁止引用其他包的内部文件；运行时依赖图必须无环。

`packages/core/src/runtime/runtime-read-model-facade.ts` 是窗口读取业务状态的正式门面，只提供按 key 的读取、订阅和命令路由。renderer 使用 `layout`、`inventory`、`characters`、`instance-upgrades`、`recruitment`、`progression`、`desktop-world`、`operations`、`procurement`、`finance` 分片，不接收全量状态广播。

Phaser 中的 `RestaurantNpcProjector` 和 `DesktopWorldPresentationModel` 都是纯表现对象：可以缓存切片、计算 Actor 帧和播放动画，但不能创建、领取、完成或中断业务任务。

## 2D 场景约束

- 游戏是单一 2D 平面，不建立物理楼层系统；
- 普通桌椅、设备和装饰不作为角色移动障碍；
- 跨越地面、飞艇和港口等区域时，角色使用人员电梯，物资使用交换站小型货梯；
- 建筑尺寸、占地、可摆放区域和能力由布局及建筑组件管理；编辑模式暂停业务推进。

## 常用命令

```powershell
npm install
npm run check
npm start
npm run start:management
npm run smoke
npm run smoke:transparency
```

`npm run check` 包含：

1. `r0:freeze-check`：禁止恢复旧聚合写入和 renderer 业务协调器；
2. `architecture:check`：检查跨包深层导入、公开出口和运行时循环依赖；
3. `documentation:check`：检查当前文档术语与历史文档标记；
4. 内容生成同步、类型检查、测试与生产构建。

当前架构详见 [Document/飞艇餐厅当前技术架构-v0.1.md](./Document/飞艇餐厅当前技术架构-v0.1.md)。
