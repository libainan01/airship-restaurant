# 空艇餐厅

一款面向 Windows 10／11 的 2D 桌面陪伴型挂机餐厅游戏。玩家经营地面餐厅与飞艇厨房，安排角色工作，通过交换站和小型货梯调度餐点、餐盘与食材，并逐步解锁采购、舰队、科技、剧情和角色成长。

## 当前实现

正式客户端采用 Electron、Phaser、React 和 TypeScript：

- Electron 管理透明桌面窗口、普通管理窗口、IPC、存档和应用生命周期；
- Phaser 只负责桌面世界的 2D 表现、动画、插值、特效与语义热区；
- React 负责设置、经营、采购、招募、成长、财务和存档诊断等管理界面；
- 已迁移领域由各 core 模块拥有事实；正式日常经营闭环仍由 `GameplayRuntime` 推进，R9 正在将 R4—R6 新模块接入唯一生产主循环；
- renderer 通过带 revision 的分片读模型恢复和更新画面，不读取全量业务快照，也不创建业务任务；
- v2 存档按模块保存，支持旧档内存迁移、主档备份、损坏恢复和明确的迁移报告。

当前权威架构、模块所有权和边界见 [飞艇餐厅当前技术架构 v0.1](./Document/飞艇餐厅当前技术架构-v0.1.md)。

## 工作区

```text
apps/desktop/             Electron 主进程、双 preload、Phaser 与 React 渲染入口
packages/contracts/       跨进程命令、分片读模型、校验器和只读 DTO
packages/core/            Kernel、领域模块、运行时编排和读模型投影
packages/content/         静态内容定义、索引、生成物和校验
packages/persistence/     存档信封、迁移和持久化边界
packages/test-support/    手动时钟、固定随机数和测试夹具
```

更细的目录依赖规则见 [WORKSPACE.md](./WORKSPACE.md)。正式代码不从 `spikes/phaser-electron` 导入实现。

## 安装、检查与运行

```powershell
npm install
npm run check
npm start
```

常用入口：

```powershell
npm run start:management
npm run smoke
npm run smoke:transparency
npm run test:stability
npm run stability:resident
```

`npm run check` 会依次执行旧写路径冻结、包依赖边界、文档状态、内容同步、类型检查、自动测试和生产构建。

## 内容工具

对白以 `packages/content/data/dialogues/chapters/*.json` 为内容来源：

```powershell
npm run dialogue:new
npm run dialogue:new-chapter
npm run dialogue:new-speaker
npm run dialogue:new-location
npm run dialogue:check
```

章节 JSON 修改后运行 `npm run dialogue:generate`。生成文件 `packages/content/src/m3-dialogue/generated-dialogue-source.ts` 不应手动编辑。

## 文档入口

- [功能模块需求确认清单](./Document/飞艇餐厅功能模块需求确认清单-v0.1.md)：已逐项确认的业务规则；
- [当前技术架构](./Document/飞艇餐厅当前技术架构-v0.1.md)：当前代码边界、数据所有权、读模型和存档结构；
- [重构开发任务清单](./Document/飞艇餐厅重构开发任务清单-v0.1.md)：R0—R9 任务状态和验收顺序；
- [R9 生产经营链路收敛审计](./Document/飞艇餐厅R9生产经营链路收敛审计-v0.1.md)：正式 GameplayRuntime 与固定 R6 Demo 的接线缺口和替换顺序；
- [R8 兼容清理记录](./Document/飞艇餐厅R8兼容清理阶段实现记录-v0.1.md)：旧聚合、旧总快照和 renderer 业务逻辑的清理结果；
- [重构架构设计](./Document/飞艇餐厅重构架构设计-v0.1.md)：重构前的问题与目标设计，属于历史设计依据。

其他 R0—R7 实现记录保存各阶段当时的过渡状态；判断当前实现时，以当前技术架构、代码和自动检查为准。
