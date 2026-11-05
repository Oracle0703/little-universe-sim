# 当前架构与模拟规则

Vite + TypeScript + React。模拟不读取 React、DOM、网络、系统时钟或 Math.random；每日变化来自 variation.seed 的稳定哈希。公开转换先 structuredClone；相同配置（含种子）与操作序列得到相同结果，不修改输入。

## 模块与数据流

| 模块                                                | 职责                                                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| src/data/\*.json                                    | agents / places / relations / simulation 定义                                                    |
| sim/types.ts、validation.ts、data.ts                | 类型、unknown 结构校验、范围与引用语义校验                                                       |
| sim/engine.ts                                       | 决策、移动、资源、活动效果、纸条和日志；createWorld / tick / advanceWorld / advanceTo / giveNote |
| sim/social.ts                                       | 关系账本、衰减、约定、传闻来源和传播                                                             |
| sim/configuration.ts、session.ts                    | 热改 rehydrate；原子 data/world/revision/runId/feedback/review                                   |
| useSimulation.ts、WorldDataContext.tsx              | 时间调度、动态数据索引与回放投影                                                                 |
| components/PlannerPanel.tsx、ReviewPanel.tsx        | 草稿编辑与评审独立面板                                                                           |
| review/{recorder,replay,file,state,report,types}.ts | 记录、游标、文件验证、模式锁、统计选样、版本                                                     |
| scripts/audit-simulation.mjs、generate-review.mjs   | 四天健康审计、真实模拟样例生成                                                                   |
| components/ErrorBoundary.tsx                        | 意外渲染错误的可见兜底                                                                           |

JSON → validateData → createWorld → advanceWorld → session → context → 地图/详情/时间线。日常快进、Demo、长跑、回放补算共用完整 tick。

## 每分钟 tick

1. 时间前进；衰减关系（降到 initialValue × decayFloorRatio 为止）、清过期传闻/约定。
2. 更新三需求，处理纸条到期，走完已有路段后再决策。
3. 比较作息、精力、社交、偏好；当前行动/地点有 continuationBonus，非作息活动遇满座减 crowdedResourcePenalty。聊天只选有醒着伙伴的位置，偏好聊天无人时回家休息。下一段作息前，路程 + 一半活动时长放不下的差事被剔除（目标地就是当前地点或下一段作息地点除外），全部剔除时就近休息。
4. 自愿切换等实际 activityMinutes 达到配置时长；移动/等位不积累。纸条、紧急补觉、作息切换、伙伴离开、排队超时允许重选。同活动仅动机改变时不重置进度。
5. 资源现有占用者优先，其余按到达时间、稳定 id 排队；拿到资源才执行。完成有限活动释放资源，继续同一活动不重复写“决定”。
6. 睡眠/休息/吃饭恢复精力；休息和休闲恢复心情；实际偏好行动额外恢复心情，覆盖聊天与休息偏好；三者合计乘以（1 − 心情/100）。有伴聊天增加社交。独处的纸条聊天无收益。
7. 地点间隔与配对冷却控制互动，更新关系/约定；实际夸稿、夜间相遇可生成传闻，再沿关系边传播。

behavior / activityMinutes 已入 simulation.json 和热改面板：恢复速率、持续评分、满座扣分、活动时长、排队/偶遇冷却。76/120/160 等部分评分、需求衰减、写生/散步/逛店的 0.14 心情收益仍是代码常量，未全量参数化。默认四天测试不代表任意极端内容都平衡。

**每日变化（variation）：** dayShift(seed, 居民, 天) 用稳定哈希给每人每天一个 [−scheduleJitterMinutes, +scheduleJitterMinutes] 的整体偏移，作用于该天开始的全部作息段（跨午夜段归属开始那天）。第 1 天偏移为 0；第 2 天 00:00 起的段若提前，可能落在第 1 天深夜。重叠仍按 JSON 顺序，同一段取较早的开始日。

目标事件携带 decision.action/source，按行动/地点去重；到站后用 startTravel 接续纸条改道，不再重复 setGoal。encounterTopic 标记 praise/night，选样不再搜索中文文案。电话标签与内置 Demo ID 依赖尚未迁移。

## 社交与热改

| 状态          | 规则                                                                                                                  |
| ------------- | --------------------------------------------------------------------------------------------------------------------- |
| RelationState | 0–100 双向熟悉度；value = initialValue + interactionDelta + rumorDelta + manualDelta − decayTotal，按实际夹值变化记账 |
| JointPlan     | 默认 8 分钟同地二人约定，每人最多一个；纸条/紧急补觉确实改行动或地点才记失约，自然结束不算                            |
| Rumor         | 真实源事件、主题/模板、目击者、TTL 与路径；同地醒着且关系达门槛，最多两跳，每人每条一次                               |

新相识默认起点 40、传播门槛 35，初识即可传播，这是简化设定。来源/个人/全局冷却、听众数和存活上限限制刷屏。关系衰减不逐 tick 写日志，由账本解释。

草稿/JSON → validateData → sessionReducer(apply) → applyConfiguration/reconcileConfiguration → 同时发布 data/world。计时器只 dispatch 分钟，所有动作读取当前 session.data。

| 应用对象                     | 保留/重算                                                |
| ---------------------------- | -------------------------------------------------------- |
| 时间、速度、暂停、选择、筛选 | 保留                                                     |
| 位置、已有路段               | 保留；新路段读新坐标，不瞬移                             |
| 需求                         | 仅配置初值变更的字段覆盖当前值                           |
| 作息/性格/偏好               | 受影响者下一 tick 重选；未变作息完成记录按内容映射       |
| 纸条                         | 保留额度与到期；禁止删除其仍有效的目标能力               |
| 容量                         | 立即重分配，缩容可等位，不超占                           |
| 关系                         | 仅配置值改变覆盖当前值，差额记 manualDelta，其余保留演变 |
| 传闻                         | 已听闻不撤回/重复收益，新参数控制后续转述                |
| 日志                         | 追加本页策划 meta，仍有界 240 条                         |

失败不发布新世界/配置。note/jump/tick 预期错误转为可见反馈；意外渲染错误交 ErrorBoundary。配置导出仅四份定义；旧合包粘贴导入时，缺少的规则组/字段由 withRuleDefaults 按内置默认补齐。拓扑 ID/数量不得在热改中增删。

## 长跑与回放 schema

从当前配置副本创建 D1 11:40 新局；1800 游戏分钟等价 ×1 现实 30 分钟。每片 15 分钟，经 setTimeout 让出线程；暂停取消后续调度，结束停在终点。录制/暂停/导入/回放时锁普通 tick/jump/note/apply/reset，关闭 Demo 弹层。

每分钟 advanceWorld(...,1)，用 nextEventId 抽取增量并核对 totalEvents，避免日志窗口裁剪漏记录。每 30 分钟加起终点快照，1800 分钟共 61 份。只存最近一局，半局不发布。

当前 schemaVersion **1**，engineVersion **little-universe-w4.3**；语义变更升级引擎版本，改 JSON 内容无需升级。

| 顶层字段                              | 含义                                                                                                 |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| schemaVersion / engineVersion         | 结构/语义版本，不匹配拒绝                                                                            |
| config                                | 完整 WorldData，评审范围固定 8 人 6 地                                                               |
| startTime / endTime / durationMinutes | 起点 700，时长 1～1800，结束 = 起点 + 时长                                                           |
| snapshotInterval                      | 固定 30                                                                                              |
| events                                | 全量 WorldEvent[]，含 system 及结构化冲突/传闻/决策                                                  |
| snapshots                             | {offset, world, relationships}[]；world 是不含 events 的完整运行状态，relationships 为累计关系活动量 |

导入最大 16 MB / 30000 事件。检查版本、精确字段、时间与配置，再分片重算逐批比对事件和快照；不直接展示外来状态。失败保留原世界/档案。保留事件和快照便于独立核对历史；本轮未改成只存配置和哈希的重演配方。

游标取最近早于它的快照，克隆并恢复此前 240 条日志，补算 0～29 分钟。展示该 tick 结束状态，不表示同一分钟每个动作的中间帧。拖动暂停、游标夹值、末端自动停；回放 ×1 每秒 10 分钟，另有 ×2/×8。回放配置/世界同源，W3 草稿保持 liveData，退出返回原世界。

## 指标与选样

全量日志计所有 kind；生活事件只计 encounter/conflict/rumor/note（含入座），不计 goal/move/meta/system。密度 = 数量÷游戏小时，不是独立故事链数量或趣味评分。右侧保留 240 / 渲染最多 70，全档案另设每页 20 条的检索。

关系升温/摩擦降温按每对每分钟账本变化各记一次；自然疏远计发生衰减的关系对分钟，另累计数额与最终净升降关系对数。新边以建立时初值为基线。

默认选 6 条，可指定 0～8。纸条110、二跳100/单跳65、失约95、食堂资源85+min(对手数,3)/其他资源70+同项、性格摩擦55、夸稿/夜间45、日常10；同分按时间/id 升序，无随机数。
传闻按 rumor id 归组，用最深路径最早一跳作锚点，连真实源与传播。资源按地点/30分钟段、摩擦按双方/天去重。其他链取前6/后25分钟相关演员同地或移动，最多前2+锚点+后3；只是相关上下文，不冒充完整因果证明。首轮每类别最多2且链不重用事件，不足补不同锚点，记录不够就少展示，不造故事。

## 扩展边界

普通模拟可在 agents.json 增第九人并加关系，核心无需改；热改/评审仍限制现有拓扑/8人6地。当前测试与证据见 VALIDATION.md，不再混用历史阶段的测试数量。
