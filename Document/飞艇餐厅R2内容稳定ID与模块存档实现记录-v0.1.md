# 飞艇餐厅 R2 内容、稳定 ID 与模块存档实现记录 v0.1

> 完成日期：2026-08-17  
> 对应任务：R2-01 ～ R2-08

## 1. 阶段结论

R2 已完成。当前项目已建立三类稳定 ID、构建期内容数据管线和模块化 `save.json` v2；现有运行时仍通过兼容投影读取原来的 `GameSavePayload`，没有在本阶段扩大玩法迁移范围。

## 2. 稳定 ID

- `ContentId`：静态内容定义 ID，采用带类别前缀的小写稳定字符串。
- `InstanceId`：运行实例 ID，由可注入生成器产生，不依赖显示名称、数组位置或 UI。
- `SubresourceId`：由所属实例 ID 与稳定槽位 ID 派生，用于工作位、仓位等子资源。
- `SequentialInstanceIdGenerator` 可导出/恢复命名空间与下一个序号，读档后不会从头复用 ID。

主要实现：`packages/core/src/kernel/stable-id.ts`。

## 3. 内容数据管线

`packages/content/data` 现在按模块保存唯一 JSON 内容源：

- `items`：食材定义；
- `gameplay`：游戏食谱、补给与初始数量规则；
- `characters`：统一角色、五项基础技能、天赋库及最多三天赋引用；
- `buildings`：2D 占地、能力标签、组件槽位和放置区域；
- `technology`：科技节点、前置与语义效果键；
- `routes`：采购地区、运力、耗时和物品引用；
- `dialogues`：既有对白目录和章节；
- `stories`：故事事件、花名册条目与故事序列。

`scripts/content-tool.mjs` 负责跨引用、唯一 ID、食谱 DAG、科技前置 DAG、技能天赋、建筑组件槽位和故事阶段引用校验，并生成 `packages/content/src/generated/content-data.ts`。生成文件带禁止手改标记；`content:check` 已接入构建、类型检查、测试前置和根 `check`。

### 3.1 双层食谱

每道 canonical 食谱同时包含：

1. 游戏层：简化食材个数、并行/线性步骤 DAG、设备标签、耗时和是否需要人员在场；
2. 现实层：现实菜名、份数、真实配料用量、顺序步骤和备注。

盐、黑胡椒、油等调味品只作为现实层文字出现，不具备游戏物品 ID，也不会进入库存和采购引用。

### 3.2 主进程内容收缩

灰羽港故事阶段、触发条件、订单和花名册关联已迁入 `stories/catalog.json`。`story-runtime.ts` 只负责把数据定义组合成运行时系统，不再保存具体阶段数组。

## 4. 模块化存档 v2

磁盘仍只有一个原子 `save.json`，顶层 schema 升级为 v2，payload 结构为：

- 单一 `runtimeRevision`；
- `module.simulation`；
- 可选 `module.narrative`；
- 可选 `module.story`；
- 其他未知模块原样保留。

每个模块拥有独立 `schemaVersion`。`GameSaveService` 对 AppLifecycle 仍投影为旧的组合 payload，避免 R2 同时迁移所有调用方。

### 4.1 原子写入与恢复

`JsonSaveStore` 的保存序列为：

1. 校验待保存 payload；
2. 生成 SHA-256 校验和；
3. 写临时文件并 `fsync`；
4. 回读临时文件验证 schema 与校验和；
5. 备份上一份正式档；
6. 原子替换正式档；
7. 再次回读正式档验证。

正式档损坏时仍回退到有效备份；校验和不匹配会被视为损坏。

### 4.2 v1 迁移

- v1 只在内存中迁移为 v2，单纯加载不会改写原文件；
- 迁移失败不会写正式档或备份；
- 成功加载后的下一次正常保存会写 v2，并把原 v1 留作 `save.json.bak`；
- R0 的 `new-progress`、`operating`、`transporting`、`story-active`、`backup-recovery` 五个有效场景已逐一验证 payload 等价和源文件不变；缺失、双损坏场景继续走原有安全路径。

## 5. 验收结果

- `npm run content:check`：通过；
- 全 workspace TypeScript：通过；
- R2 定向测试：8 个文件、21 个测试通过；
- `npm run check`：80 个 Vitest 文件、346 个测试与 4 个 Node 测试全部通过，生产构建通过；
- `npm run smoke`：Desktop 与 Management 两个 renderer 均进入 `ready`，Runtime revision 为 2；
- R0 冻结护栏与依赖边界检查继续通过。

构建仍报告桌面 bundle 大于 500 kB 的既有 Vite 警告，不影响本阶段退出；代码拆包属于后续表现层优化，不与 R2 存档/内容基线混做。