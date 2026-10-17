# TODO / 路线图

> 这份文档管两件事：**TS 版还没做完的**，和 **Rust 移植怎么切**。
> 最后更新：对应提交见 `git log -1`。

---

## 0. 这份文档的规矩

**每条待办都必须带「完成判据」。** 不是「做了」算完，而是「怎么验证做完了」算完 ——
这个项目里已经栽过跟头：写过的代码在跑不了工具链的情况下堆了五轮，
一恢复编译 + 执行，头一轮就抓出 12 个 bug，其中 4 个是**静默数值错误**
（不报错、只是数不对）。详见 README §5。

所以规矩是：

- 任何代码**没跑过就不算完成**（TS 要 `tsc` 绿 + 自检绿；Rust 要 `cargo test` 绿）
- 断言优先写**不变式**（「Π(1+r) == 末值/初值」），不写我口算的数 ——
  这个项目里我有 **4 次**口算期望值算错，引擎反而是对的
- 涉及视觉的，必须有 headless 截图，不能只看模型层

状态图例：`✅ 完成` · `🟡 部分` · `⬜ 未开始` · `❌ 不做` · `❓ 待你答复`

---

## 1. 当前状态（TS 版）

### 模块

| 路径 | 内容 |
| --- | --- |
| `src/engine/chart.ts` | 单图：蜡烛/成交量、双轴、十字光标、光标锚定缩放、通道、主题、显示范围 |
| `src/engine/grid.ts` | 多图网格 + 联动（按时间对齐）；可注入 `dataSource`、每格独立周期、`activechange` 事件；布局来自目录，支持非均匀排法 |
| `src/engine/layouts.ts` | 多图布局目录：1–16 张图、共 55 种排法（含非均匀），纯数据 + 栅格化函数 |
| `src/engine/pine.ts` | Pine v5 / v6 子集解释器 |
| `src/data/symbols.ts`、`src/workspace/SymbolSearchDialog.tsx` | 商品代码目录（9 类 97 个演示标的）+ 屏幕正中的「商品代码搜索」弹窗 |
| `src/engine/studies.ts`、`src/indicators/` | 指标（study）模型与画法（副图 / 叠加 / fill）+ 内置指标库（全部 Pine v6 脚本）+ 浏览器自检 |
| `src/engine/draw.ts` | 绘图工具层（89 种：线组/光标组/斐波那契组（含音叉族 5）/江恩组/图表形态组/艾略特波浪组/循环组/预测组/成交量组/测量组/笔刷箭头形状组/文本标注组 7 + emoji 标注） |
| `src/engine/equity.ts` | 权益曲线 + 双均线回测口径 |
| `src/engine/analytics.ts` | 收益分布 / 交易环形图 / 季节性叠加线 |
| `src/agent/` | Agent 抽象（provider / runner / 工具集）+ mock provider + DeepSeek 空壳 |
| `src/workspace/` | 图表区 React 外壳（顶栏、绘图栏、范围条、PaperTrade、右侧面板/图标栏） |
| `src/app/` | 应用外壳（顶栏 + 图表区 + 右侧 Agent 面板；左侧菜单已移除，原入口并入 Agent 面板 tab/历史列表）、页面组件（面板内嵌） |
| `src/data/mockBars.ts` | 演示数据源（TSLA/AAPL/NVDA/MSFT/SPY） |

### 页面

单页应用（Vite + React）。旧的 `index/pine/chart/equity/analytics.html` 已移除（可从 git 历史找回）；
Pine 编辑器、权益曲线、统计组件目前**没有对应的 UI 入口**，引擎和自检都还在，见 2.13。

### 测试基线（全部实跑通过）

```
npm run typecheck                          0 错误（strict）
npm test (vitest)                          引擎 829 PASS（绘图 39 + Pine 74 + Pine 撮合 69 + 权益 26 + 统计 34 + 回放 27 + 布局目录 346 + 默认缩放 8 + 趋势菜单 31）
                                           共 829 个 vitest 用例（含 Agent / 工作区 / 数据 / 回放 / 布局 / 指标库 15 / 图表样式 8 / 商品代码 10 / 颜色选择器 5 / paneLayout 10 / 绘图工具扩充 356（含 emoji 选中框 8 + 测量对齐 8 + 笔刷/荧光笔对齐 9 + 橡皮擦对齐 9）+ 工具默认属性 16（与官方 defaultProperties 逐条核对，其中 1 条是与参考库逐字节同步）+ 绘图属性工具条 22 + 长按信息卡 9 + 侧栏接线 26 + emoji 数据对齐 17，其中 1 条是与参考库逐字节同步 + emoji 资源层 15（twemoji 映射 / 面板尺寸 / 与线上面板快照 830 码点逐字节核对）+ 侧栏深色主题 12（两套色板变量同名同数量 / var 全部可解析 / 弹层文字对比度 AA / 不再靠 filter 反相）+ 光标下拉对齐 20（5 个图标逐字符等于线上 SVG / 行高 40 与 244 宽 / 选中行 #2e2e2e 白字 / 开关 38×20）+ 分组主按钮跟随工具 20（图标反查 / 退化规则 / 画完回光标通知外部 4）+ 属性条对齐线上 30（图标盒子尺寸 / 顺序 / 彩虹条 8 色标 / 深色两套变量）+ 页面十字光标 24（官方像素测量：虚线 5/6 / 标签块高 21·23 / 两套主题三色 / 横线只在绘图区内画 / 标签矩形夹边）+ 范围条中文文案 11（key 不变 / label 逐项等于官方中文 / 单位词 / 不再漏英文缩写）+ 左栏穿到底布局契约 11（DOM 谁包谁 / .ws-body 撑满 / 无死类名 / 范围条 32 高与 13px 字号 / 左栏底色不再用轨道灰 / 末段不补分隔线）+ 光标类型 19（五个光标工具的 CSS cursor 逐项等于线上：dot.cur 热点 11,11 / eraser.cur 热点 5,5 / 箭头与荧光笔 default；光晕 r18 rgba(242,54,69,.25) 只在荧光笔·橡皮擦、只在绘图区内、压在十字线之后）+ 趋势菜单对齐线上 31（三组 17 项同序 / 17 个 SVG 逐字符 / 菜单 224 与分组标题 24·11·.4 / 每项都能落到真实工具 / linreg 三条）+ 默认缩放 200 根 8（常量唯一出处 / 构造函数与 setBars 都走 applyDefaultView / 7 种视口宽度都数出整 200 根 / 数据不足全显示 / 窄视口靠右 / autoView 只活在默认视图 / resize 语义））
浏览器侧（dev 控制台 __app.runBrowserSelfTests()）
                                           图表 77（改造前 48，新增 setRange 回归 1 条 + 图表样式 8 条 + revealSpan 4 条 + 回放 15 条 + 默认缩放 1 条）+ 网格 20（含 55 种布局抽样的像素位置、时间联动）
                                           + 权益 39（含 2.4 持仓色带像素断言 2 条）+ 统计 50 + 指标 31（含 2.6 窗格拖拽 / 最大化 / 折叠 / 坐标轴 12 条）+ 样式 52 + 绘图 134（2.8 起纳入；含光标组、线组、斐波那契/江恩组 13 种、音叉族 5 种、图表形态/艾略特波浪/循环组 14 种、预测/成交量/测量组 12 种（测量含官方配色 / 中线箭头 / 三行卡片 / 轴标签 6 条）、笔刷/箭头/形状组 16 种（笔刷/荧光笔含官方默认色与线宽、平滑算法、端点圆点）、各工具默认样式（矩形紫 / 圆橙 / 三角绿 / 趋势线 2px）、文本标注组 7 种、emoji 标注（含选中框四角手柄与拖角改字号、twemoji 图未就绪时的字形兜底）、浮动属性工具条（setStyle/setLocked/repeatDraw/clone/selectionToolbarAnchor）与 setAllLocked 全锁断言、橡皮擦 5 条（悬停只亮不选 / 移开收掉 / 光标热点 5,5 / 锁定悬停不亮但照擦 / ⌘+点只隐藏一档且 undo 复原））
E2E（puppeteer 驱动 headless Chrome，未入库）  布局 13 + 指标 36 + 样式 38 + 商品代码搜索 28 + 测量对齐 13 + 笔刷/荧光笔对齐 13 + 工具默认样式 8 + 表情包换图 1 PASS / 0 FAIL（早先的整页 E2E 79 条已随脚本被覆盖，未重跑）
                                           近期功能 E2E：自选 15 + 告警 23 + 设置 20 + 交易 25 + 交易复刻 13 + 颜色选择器 13 + 副图窗格 8 + 右栏布局 13 + 绘图子菜单 23/26/26 + emoji 面板 14 + emoji 数据对齐 41 + emoji 选中框 20 + 测量对齐 13 + 笔刷/荧光笔对齐 13 + 绘图属性工具条 30 + 长按信息卡 6 + 对齐 charting_library 143 + 侧栏动作 17 + 橡皮擦对齐 20 + 光标下拉对齐 12 + 主按钮跟随工具 21 + 属性条对齐线上 36 PASS / 0 FAIL
```

**任何改动之后这套数字必须只增不减。** 加功能要加断言，改逻辑不能让已有断言变红。

### 改造时对引擎做过的改动（逻辑之外）

1. 六个文件由全局脚本改为 ESM：补 `export`，跨文件依赖改 `import`。算法一行没动。
2. `grid.ts`：`GridOptions` 增加 `dataSource` / `symbols` / `chartOptions`；`Tile` 增加 `timeframe`（每格独立周期）；
   新增 `activechange` 事件、`activeTimeframe()`、`setTileTimeframe()`。
3. **修了两个真 bug**（都是不报错、只是不对的那类）：
   - `chart.setRange()`：1px 下限装不下整段范围时，视口从范围起点往右铺，用户点「1M」看到的是最老的一段、最新一根在屏外。
     现在靠右对齐，并加了回归断言。
   - `grid.ensureTiles()`：联动「标的」开着时，切到 NVDA 再增加格子，新格子仍是初始标的 TSLA。现在跟随当前标的。

---

## 2. 待办：TS 侧

### P0 — 有明确价值、成本可控

#### 2.1 Pine 撮合 `strategy.*`（T3 Phase 2）

- 状态：✅ 已完成（`src/engine/strategy.ts` 撮合 + `pine.ts` 里的 `strategy.*` 内置 + `strategyTest.ts` 66 条自检；口径见 README §12.1）
- 内容：`strategy.entry/close/exit`、仓位计算（`percent_of_equity` / `fixed` / `cash`）、
  手续费、滑点、保证金、`pyramiding`、`process_orders_on_close`、权益曲线、
  交易列表、绩效指标（净利/回撤/Sharpe/盈亏比）
- 成本：**大**。这是整个 T3 里最容易出错的一块
- **完成判据**：
  1. 用 `strategy.*` 重写演示策略，其权益曲线与 `simulateMaCross()` 在**无手续费无滑点**下一致
  2. 至少 20 条断言，覆盖：仓位公式、手续费扣减方向、滑点方向、
     `pyramiding=0` 时不加仓、平仓后权益守恒
  3. **反向用例**：故意让保证金不足，必须**明确报错**而不是静默不下单
- ⚠️ 两个已知的「静默归零」坑，必须作为**回归用例**写进测试：
  1. 仓位按 **100% 权益**下单，被引擎自己判成「保证金不足」直接拒单 →
     0 笔成交、0 净利、0% 全部指标，而且**不报错、不警告**
  2. 只要产生**空头持仓**，就多记一批「同日进同出」的幽灵成交，
     有真实盈亏、会系统性扭曲笔数/胜率/盈亏比
- 这两条的**完成判据**：造出上面两种输入，引擎要么给出正确结果，要么**明确报错**，
  绝不能静默返回全零
- 完成情况（实跑）：
  - ✅ 判据 1：`strategy.*` 版双均线与 `simulateMaCross()` 在 400 根上**逐点一致**。
    比对时发现旧版 `simulateMaCross` 有前视偏差（用当根收盘均线、按当根开盘价成交），已修正为用上一根收盘的信号；
    把旧逻辑改回去，这条断言立刻失败（做过变异验证）
  - ✅ 判据 2：66 条断言（≥ 20），覆盖仓位公式 / 手续费方向 / 滑点方向 / pyramiding / 平仓后权益守恒 / 退出单 / 反手 / 绩效指标
  - ✅ 判据 3：150% 权益、显式 qty 超限、空头超限都**抛「保证金不足」**；非法声明头参数、不支持的参数同样抛错
  - ✅ 两个静默归零坑：100% 权益（含手续费）正常成交；空头只记 1 笔成交
- 遗留（不在 2.1 范围，传了会明确报错而不是被忽略）：limit / stop 入场单、点数止盈止损（`profit` / `loss`）、
  移动止损、部分平仓（`qty` / `qty_percent`）、`strategy.risk.*`、`calc_on_order_fills`、`use_bar_magnifier`；
  同一根里止损与止盈都够得着时没有逐笔数据，固定按止损先成交
- 回测结果目前只在代码里（`PineEngine.strategyResult()`，Agent 的 `run_pine` 会把笔数 / 净利 / 回撤 / 胜率带回去，
  成交标记画到图上）；权益曲线与交易列表在界面里的入口见 2.13

#### 2.2 Bar Replay

- 状态：✅ 已完成（`src/engine/replay.ts` 状态机 + `KChart.setReplayCount` 截断 + `ReplayBar` 控制条 + Agent `replay` 工具）
- 内容：截断到第 i 根、单步前进/后退、自动播放 + 变速（1/2/5/10/30 根/秒）、指标随截断重算
- **完成判据**与完成情况（实跑）：
  1. ✅ 步进到第 i 根时 `chart.bars.length === i+1`（图表自检 + E2E 点前进/后退按钮逐根核对）
  2. ✅ 指标值与「直接喂前 i+1 根」逐值一致（截断后整体重算，不做增量；多个位置逐值对比）
  3. ✅ 播放/暂停/变速状态机：27 条纯逻辑自检（含到末尾自动暂停、末尾再播放返回 false、越界夹紧、变速）
  4. ⚠️ 与原判据有出入：**最后一根显示为完整 K 线，不是 forming 状态**。forming 需要根内逐笔数据，
     现有数据源只有 OHLC，合成「半根」是编造数据，所以没做
- 行为口径：回放只作用于**当前选中的那一格**；换标的 / 换周期 / 改布局 / 点另一格都会结束回放并恢复完整数据；
  回放期间实时 `update()` 只更新完整数据、不会冒出「未来」的柱子；Agent 可说「开始回放 / 回放前进 5 根 / 回放每秒 10 根 / 退出回放」
- 限制：每步都整体重算指标，O(n) / 步，当前数据量（~1000 根）无感；通过「指标」对话框 / `add_indicator` 加的指标会随回放重算（已测因果性）；
  但用 `run_pine` 画上去的 plot 线不会，回放期间需要重新运行才会更新

#### 2.14 指标库（Pine v6）

- 状态：✅ 已完成（`src/indicators/` 脚本库 + `src/engine/studies.ts` 副图/叠加渲染 + `IndicatorDialog` + Agent `add_indicator / remove_indicator / list_indicators`）
- 约束（用户要求）：**所有指标必须用 Pine v6 写**——36 个可用指标全部是 `//@version=6` 脚本，由 `PineEngine` 执行
- 引擎同步升级：v5/v6 版本头（其它版本拒绝）、v6 移除 `when=`、类型前缀声明、`#RRGGBB(AA)`、`+=` 等复合赋值、`break/continue`、
  `plot` 位置参数 / 逐根颜色 / `display=none` / 返回句柄、`fill`、`input` 声明登记、十余个新 `ta.*` 与 `ta.tr/obv/accdist` 内置变量
- **完成判据**与完成情况（实跑）：
  1. ✅ 每个可用指标 `//@version=6`、能在 400 根行情上跑通且有非空输出（vitest）
  2. ✅ ~30 个指标的数值与独立 TS 参考实现逐根一致（容差 1e-7）——对数中发现并修正了 `ta.wma` 权重写反的旧 bug
  3. ✅ 副图布局不变式（贴边、首尾相接、总高 ≤ 60%、删光后主图恢复）、像素断言、副图内点击不触发绘图层、⚙/✕ 按钮命中、回放因果、实时 tick 重算（浏览器自检 19 条）
  4. ✅ 真鼠标 E2E 36 条：对话框结构（分区 / 胶囊 / BETA / 搜索 / 收藏 / 空态）→ 点击添加 → 图例 ⚙ 改参数 → ✕ 删除 → 切布局新格子带指标 → Agent 加 / 删 → 坏脚本隔离
- 诚实的边界：12 个参考页里的指标**做不了**（需要全市场 / 第二标的 / 更小周期数据，或 `line.*` + 枢轴检测，或 `math.acos`），
  清单里置灰并写明原因，不做近似；策略 / 简介 / 形态 / Options 胶囊与基本面、社区分区目前是空态；没有脚本编辑器（「我的脚本」空态）

#### 2.3 图表 ↔ 统计组件联动

- 状态：⬜
- 内容：点权益曲线的回撤段 → 主图跳到那段时间；点季节性某一年 → 高亮；
  点收益分布某个箱 → 主图标出落在这个箱里的交易
- 成本：**中**
- **完成判据**：点击后主图的 `viewTimes()` 落在目标区间内（断言，不是肉眼看）

#### 2.4 底部色带到底是什么 ✅

- 状态：✅ 已完成（语义定稿 + 像素断言，实跑通过）
- **语义定稿**：TradingView 策略测试器口径——底部色带 = 策略**持仓区间**：
  多头段 = 上涨色、空头段 = 下跌色、未平仓段（走到数据末尾还没平的，带 `open` 标记）同方向色但更透明。
  依据：设计稿来源是 cn.tradingview.com，TV 策略测试器权益图底栏就是持仓区间着色；
  原先按「长仓=盈利色」的猜测方向是对的，本轮补齐空头色与未平仓段弱化。
- 实现位置：`src/engine/equity.ts` `EquityChart.setPositions()` + `drawPositions()`（绘图区最底 2px）
- **完成判据（实跑）**：
  1. ✅ 语义确认：如上，接口不变（若你的参考图语义不同，改 `drawPositions()` 一处即可）
  2. ✅ 断言：浏览器自检新增 2 条——
     「多头段绿主导 / 空头段红主导 / 空档非红非绿」（像素采样绘图区底 2px）+
     「未平仓段比已平仓段更接近背景」（透明度弱化）；node 环境 skip 数 11→13

### P1 — 等设计稿

#### 2.5 顶栏 / 右侧面板 / 左侧工具栏

- 状态：✅ 已接入。顶栏、右侧栏、左侧绘图栏都是 设计稿的原 DOM 组件（`src/workspace/dom/`），React 只做外壳与 store 同步。
  窄屏时顶栏按容器宽度逐级收起次要按钮（`@container`），避免挤出右侧面板。
- 遗留：
  1. ~~顶栏「图表样式」只有 K 线图可用~~ —— 已完成：设计稿菜单 21 行里的 **13 种**都在自有引擎里实现（K线 / 美国线 / 空心K线 / 成交量蜡烛 / 线形图 / 带标记线 / 阶梯线 / 面积图 / HLC区域 / 基准线 / 柱状图 / 高-低 / 平均K线），
     纯显示层变换，指标 / 回放 / 联动仍跑在真实 OHLC 上；菜单分 6 组并带 `?` 说明与 `☆` 收藏（工具栏快捷按钮，持久化）；顶栏菜单与 Agent 工具 `set_chart_style` 走同一个 store 字段。
     **剩下 8 个灰显、点了提示原因**：成交量轨迹 / 时间价格机会 / 交易时段成交量分布图（要逐笔或更小周期数据）；砖形图 / 新价线 / 卡吉图 / 点数图 / 范围图（非时间序列：bar 数量与时间轴都变，指标、回放、绘图锚点、联动都要重做，值得单独立项）。
     平均K线上的指标仍按真实 OHLC 计算（与部分平台「指标跑在平均K线上」的口径不同）
  2. ~~顶栏「布局」只有 5 种均匀网格~~ —— 已完成：布局选择器改为 13 行（1–10、12、14、16 张）× 共 55 种排法，含「左大右小」「上 1 下 3」等非均匀切分；
     「同步到所有图表」补齐为 商品代码 / 周期 / 十字线 / 时间 / 日期范围 五项（「时间」只对齐最新时刻、保留各格缩放；「日期范围」起止完全一致）；Agent 的 `set_layout` 新增 `count` + `variant` 写法
  3. 顶栏「保存」「警报」「比较」「快照」仍是占位提示，分别对应 2.9 与未排期项（「回放」已在 2.2 完成；「警报」见 2.11；「设置」见下条）；撤销/重做按钮目前恒可点（未读取 DrawLayer 的栈深度）
  3a. 顶栏「设置」已完成（Magic Patterns 设计稿两页导入稿）：对话框左导航 9 组，「商品代码」页（图例 Logo/标题/名称/图表值/K线变化值/成交量/最后一天变化值 + 买/卖按钮（= 交易面板显隐）+ 指标 输入/数值/背景）与「样式」页（上涨/下跌/美国线颜色、精确度、时区）真实现；
     草稿语义（确认提交/取消丢弃/恢复默认），localStorage 持久化（`src/store/chartSettingsStore.ts` + `src/workspace/SettingsDialog.tsx`）。
     **颜色选择器**（magicpatterns c7c97790，链接已 404）按 TV 经典样式实现为页内弹层：调色板 35 色网格 + 自定义 hex（3/6 位，非法拒绝不静默）+ 恢复默认 + Esc/点外关闭（`src/ui/ColorPicker.tsx`，5 条单测 + E2E 13 条）。
     诚实边界：不含不透明度滑块——引擎/设置链路没有 alpha 语义，不做假开关。
     引擎侧为纯显示层扩展：图例/指标图例开关、成交量显隐、价格精确度、显示时区（`setAppearance` + `setTimezoneShift`）。
     设计稿里没有引擎对应的行（预测烛线颜色/细K线/虚拟K线/数据修改/系统预设）没做假开关；「状态行/坐标和线条/版面/交易/警报/事件/范围图」7 组设计稿未给内容，是占位
  4. 左侧绘图栏的菜单项已全部接到真动作（2.8 ~ 2.8.8）：89 种工具都能画，移除 / 隐藏 / 锁定 / 继续绘图都生效，
     只剩「放大」没接（图表层动作，见 2.8.8 的诚实边界）；`tests/sidebarWiring.test.ts` 会拦住「新加一行忘了接线」
  5. 右侧图标栏（`dom/rightbar.ts` 原稿）：~~只有「自选表」面板可用（点一行切换标的）~~ —— 自选表已按 Magic Patterns 设计稿（TradingView 自选面板导入稿）完成：
     多分组（INDICES / Stocks / DIY，持久化到 localStorage）、列头（商品/最新价/涨跌/涨跌%/成交量，容器查询窄面板收成交量列）、
     行情行（logo / 延时 D 标 / 开收盘状态点 / 涨跌配色），点行切标的，右键上移/下移/移出，+ 内联搜索添加（`src/workspace/WatchlistPanel.tsx` + `src/store/watchlistStore.ts` + `src/data/quote.ts`，26 条单测）。
     行情仍是演示数据（quoteFor 口径见 `src/data/quote.ts` 头注释）；真实行情接入后换掉 quoteFor 数据源即可。
     面板下半部「详情和新闻」（表现/季节性/技术指标/资讯）还没做；对象树 / Pine Editor / 日历等点开仍是空态；「AI Copilot」展开左侧 Agent，「筛选器」跳转 Strategy Screener。
     「警报」面板也已完成（见 2.11）。
  5b. 下拉组件已统一为 `src/ui/Select.tsx`（ghost / field 两种形态、单选/多选、placement top/bottom、键盘 ↑↓ Enter Esc）：
     商品搜索过滤下拉、Agent Composer 模型选择、警报对话框 5 个下拉、设置对话框全部走它。顶栏的周期 / 样式 / 布局菜单是
     `dom/toolbar.ts` 设计稿原 DOM，按「1:1 还原」约定保留，不迁移。**新增下拉一律用 `ui/Select`。**
  5c. 交易面板已完成（Magic Patterns 下单面板导入稿，替换旧 PaperTrade 浮层）：`src/workspace/TradePanel.tsx` + `src/store/tradeStore.ts`。
     订单 tab：卖/买 bid-ask 按钮（last ∓ 半 tick 模拟盘口）、订单类型 市场/限价/止损、数量类型 流通股/货币、刻度值、
     退出（止盈/止损 tick 偏移折算绝对价）、额外设置（有效时间 日/周/月/GTC）、持仓/浮动/已实现摘要、挂单取消、最近成交、清空账户；
     市场深度 tab：围绕最新价的模拟十档（量为确定性伪随机，纯演示）。订单引擎：限价/止损 pending 触线成交、bracket 挂仓位、
     TIF 到期自动 expired、反手走 applyFill 口径、localStorage 持久化；tick 源 = chartStore.lastPrice（wireTradeEngine，与警报同款）。
     「买/卖按钮」图表设置控制面板显隐；**默认隐藏**——顶栏右端「交易」按钮（`#header-toolbar-trading`，TopBar 接线层运行时挂载，
     dom/toolbar.ts 设计稿原 DOM 不动）点击开/关，开时按钮变蓝按下态；设置勾选行与它写同一份 store，持久化跟随。
     诚实边界：成交无滑点/手续费、无真实盘口，市价单按提交时最新价成交。
  6. 浅色是主稿；深色主题下左侧绘图栏是用 CSS `filter` 反相凑的，不是正经的深色皮肤

### P2 — 成本较大

| # | 事项 | 状态 | 成本 | 完成判据 |
| --- | --- | --- | --- | --- |
| 2.6 | 同图多副图（pane）：拖分隔条改高、最大化、折叠 | ✅ | 中 | 副图有自己的坐标轴；既有 48 条图表断言不回归 |

> **2.6 完成情况（实跑）**：布局纯函数抽到 `engine/paneLayout.ts`（vitest 10 条直测：默认等高与旧公式逐值一致、
> 权重分配守恒、最大化 / 折叠、面积区间夹紧、小窗口下限回退 24px 保住「总高 ≤ 60%」不变式）；
> `chart.ts` 负责命中与绘制：拖主图↔副图分隔条改总面积（增量全给该副图、其它副图像素不变）、
> 拖副图间分隔条权重此消彼长、图例按钮 □ 最大化（主图压成 64px 细条、其余副图收窄 40px，再点还原；
> 同一时刻最多一个）、▼ 折叠成 22px 细条、双击分隔条重置布局、悬停分隔条 ns-resize 光标 + 分隔线加亮；
> 每个副图有自己的量程与纵轴刻度（密度随自身高度自适应）。
> 浏览器自检 19→31 条（新增拖拽 / 最大化 / 折叠 / 坐标轴 / 分隔条不进绘图层等 12 条）；
> 真实 UI E2E 8 条（指标对话框加 RSI+MACD → 真鼠标拖分隔条 → 点 □ 最大化 / 还原 → 点 ▼ 折叠 → 重置）。
> 踩坑：真实鼠标路径上交易面板（.trade 浮层）会拦截事件，E2E 前先关「买/卖按钮」。
| 2.7 | 数据源协议：反向分页、订阅、交易日历 | ⬜ | 中 | 假数据源跑通「首屏 + 向左补历史 + 实时推送」三段；`time` 必须是 open time/毫秒 |
| 2.8 | 绘图工具扩充（9 → 89 种） | ✅ | 每种 30~110 行 | 每种工具：画法 + 命中 + 手柄 + 撤销，四条都要有断言 |

> **2.8 完成情况（实跑，2026-10-17）**：新增 **6 种**——水平射线（1 点）、延长线（2 点，双向延伸）、
> 箭头（2 点，实心箭头）、椭圆（2 点，标准化椭圆方程命中）、三角形（3 点）、平行通道（3 点，平行四边形带状填充）。
> 交互层从「只支持两点 pending」泛化为任意锚点数（`pendingPlaced` 计数，放满 `def.points` 个才成型），
> 两点工具行为不变（有回归断言）。每种新工具四条判据各有断言：画法（stub ctx 计数 stroke/fill/ellipse/text）、
> 命中（图形上 on / 图形外 off）、手柄（选中后 part=0/1/2、拖手柄只动被拖锚点）、撤销（undo/redo 往返）——
> vitest `tests/drawTools.test.ts` 29 条 + 浏览器自检 draw 套件 53 条（`drawSelfTest` 原本没有挂进
> `runBrowserSelfTests`，本轮接入）。
> 顺带修了一个真 UI bug：左栏子菜单箭头（caret）在 DOM 里位于主按钮之前，被后者盖住**永远点不到**，
> 补 `z-index:1` 修复。左栏接线：趋势线子菜单新增 射线 / 水平射线 / 延长线 / 箭头 / 平行通道，
> 文字子菜单新增 椭圆，三角形形态 → 三角形工具。
> 诚实边界：多空仓位 / 笔刷 / 便签 / 价格标签 / 日期范围等仍是「暂未实现」toast，
> 属于「79 种全量不做」的既定范围（见 §2 明确不做）；XABCD / 头肩等形态已由后续轮次实现（见下）。

> **图表形态/艾略特波浪/循环组 完成情况（实跑，2026-10-17）**：按设计稿补齐「XABCD形态」按钮的
> 三组子菜单，新增 **14 种**绘图工具——图表形态 6 种（XABCD 5 点 / 赛福 5 点 / 头肩 5 点 /
> ABCD 4 点 / 三角形态 5 点 / 三驱 6 点，锚点折线 + 空心圆点 + 字母标签，`PATTERN_LABELS` 表驱动，
> 峰顶标上方、谷底标下方）、艾略特波浪 5 种（脉冲波 1-2-3-4-5 六点 / 修正波 A-B-C 四点 /
> 三角波 A-B-C-D-E 五点 / 双重组合浪 W-X-Y 四点 / 三重组合浪 W-X-Y-Z 五点）、循环 3 种
> （循环线 = 每周期一对垂直线（副线 18% 偏移，`CYCLE_COUNT`/`CYCLE_PAIR_OFF`）、
> 时间循环 = 每周期一根带序号垂直线（`TIMECYCLE_COUNT`）、正弦线 = 沿弦线叠加 2 个整周期
> 正弦（`sinePts` 纯函数，振幅 0.18×弦长））。每种工具四判据数据驱动断言（画法/命中 on/off/
> 手柄+撤销）：vitest `tests/drawTools.test.ts` 107→167 条，工具表 34→48 种，
> 浏览器自检 draw 套件 65→71 条；真实鼠标 E2E 23 条全绿（子菜单结构 + XABCD 五点/脉冲波六点/
> 循环线/正弦线逐点绘制）。左栏接线：`toolKeyForLabel` 新增 14 条映射，14 个新图标入 `sidebar-icons.ts`。

> **预测/成交量/测量组 完成情况（实跑，2026-10-17）**：按设计稿把「多头仓位」按钮从 2 项扩成
> 三组子菜单（预测 / 基于成交量 / 测量），新增 **12 种**绘图工具——预测 6 种（多头/空头仓位 =
> 目标箱+止损箱双价位线，目标价 = 入场 ± 风险×`POS_RR`；仓位预测 3 点折线 + 箭头 + 各段涨跌幅；
> K线形态 = 锚点启明星三根迷你K线 `CANDLE_PATTERN`；模拟K线 = 两锚点间 `SIM_CANDLES` 根确定性
> 假K线 `simCandlePx`；扇形 = 基线 ±`FAN_DEG` 射线 + 同半径连接弧）、基于成交量 3 种
> （锚定VWAP = `vwapSeries` 典型价累计曲线；固定范围/锚定成交量分布图 = `volumeProfile` 价格分箱
> 水平直方图 + POC 高亮，`VP_BINS`/`VP_WIDTH`）、测量 3 种（价格范围 = 竖线端帽 + 涨跌标签；
> 日期范围 = 横线端帽 + bar 数；日期和价格范围 = 虚线框 + 双标签）。
> vitest `tests/drawTools.test.ts` 167→211 条，工具表 48→60 种，浏览器自检 draw 套件 71→86 条；
> 真实鼠标 E2E 26 条全绿（三组结构逐行核对 + 12 种工具逐点绘制 + undo/redo）。
> 左栏接线：`toolKeyForLabel` 新增 12 条映射（「文字」子菜单里的「日期范围」也随之从 toast 变为真工具），
> 12 个新图标入 `sidebar-icons.ts`。诚实边界更新：多空仓位、日期范围、笔刷（真·自由笔迹）、
> 箭头标记、向上/向下箭头、矩形⌥R、旋转矩形、路径、圆、折线、弧形、曲线、双曲线已实现；
> 便签 / 价格标签等当时仍是「暂未实现」toast（后由 2.8.7 补齐）。

### 2.8.6 设计稿「笔刷」子菜单（magicpatterns 26eac53c）——笔刷/箭头/形状三组 11 种新工具 ✅
> 笔刷按钮 3 项 → 三组子菜单（笔刷 2 / 箭头 4 / 形状 10，共 16 行）：笔刷 = 拖拽自由笔迹
> （与荧光笔同机制，默认色细线 `lineCap: round`）；箭头标记 = 单击实心上箭头 `arrowGlyphPts`；
> 向上/向下箭头 = 单击空心箭头（dir=±1 旋转）；旋转矩形 3 点 = p0p1 边 + p2 定高的平行四边形
> （`inParallelogram` 复用）；路径 4 点开放折线 / 折线 4 点闭合多边形；圆 = 圆心 + 半径；
> 弧形 = 外接框右上四分之一椭圆弧 `ellipseArcPts`；曲线 3 点 = 二次贝塞尔 `quadBezierPts`；
> 双曲线 2 焦点 = `hyperbolaPts` 两支（命中两支分开测，拼接连线不算图形）。
> 矩形补 ⌥R 快捷键。vitest `tests/drawTools.test.ts` 211→249 条，工具表 60→71 种，
> 浏览器自检 draw 套件 86→93 条；真实鼠标 E2E 26 条全绿（三组结构逐行核对 + ⌥R 快捷键 +
> 11 种新工具逐点/拖拽绘制 + undo/redo）。左栏接线：`toolKeyForLabel` 新增 12 条映射
> （矩形/路径随子菜单从 toast 变真工具），13 个新图标入 `sidebar-icons.ts`。
### 2.8.7 对齐本地 charting_library —— 音叉族 / 文本标注族 / 形状 17 种 ✅
> **参考库来源**：本机 `/Users/kevin/Desktop/charting_library`（TradingView Charting Library，
> `bundles/` 839 个 chunk）。先用 `grep -oE "['\"]LineTool[A-Za-z0-9]+['\"]" library.*.js drawing-toolbar.*.js`
> 把工具清单抽成 **100 个 `LineTool*` id** 的权威清单（不靠记忆），再逐条比对已有 72 种，差集里挑本轮要补的。
> 中文文案取不到官方值：`zh.8113` 只有指标名、没有工具名，`en.8113` 与它键集相同（各 1236 条），
> 所以新工具的中文名沿用本项目既有命名风格自拟。
>
> **REA MCP 的边界（如实记录）**：`analyze-javascript-application` 对整目录跑会在第 194/839 个 chunk
> 崩在 `AnalysisResourceConstraintError`（`cleanup_incomplete`，`process table could not be inspected: spawn EPERM`），
> 它同时在解析几十个 locale bundle，18MB 单包超出了它的资源预算。降级为「REA 给结构线索 + grep 出清单」的组合，
> 清单本身是完整的 100 条，不影响结论。
>
> **新增 17 种**（`DRAW_TOOLS` 72 → **89**，每种 60~110 行）：
> - 音叉族 5 种（3 点）：安德鲁音叉 `pitchfork` / 希夫音叉 `schiff`（起点 = a·b 中点）/
>   改良希夫音叉 `schiff2`（起点 = a 的 x 与 a·b 中点的 y）/ 内部分叉 `innerfork`（平行线取半距）/
>   扇形分叉 `pitchfan`（5 条射线打 b→c 五等分）。
>   渲染与命中共用同一个 `pitchforkRays(kind, a, b, c)`，射线延长到绘图区右缘 +40px，
>   非扇形时在两条外侧线之间淡填充 `rgba(120,123,134,0.08)`。
> - 文本标注族 7 种（1 点）：便签 `note` / 标注 `callout` / 评论 `comment` / 气泡 `balloon`（椭圆）/
>   价格便签 `pricenote` / 价格标签 `pricelabel`（贴在锚点右侧的小标签）/ 路标 `signpost`。
>   7 种共用一张 `cardBox` 偏移表（`[dx, dy, w, h]`）+ 一个 `renderCard`，渲染和命中**读同一张表**，
>   所以「看得见的地方点得到」不会因为改一处漂掉；气泡走椭圆、路标加引线。
> - 形状 4 种：圆加十字线 `circlelines`（2 点，圆 + 过圆心的水平/垂直延长线）/
>   三次贝塞尔 `beziercubic`（4 点，p1p2 是控制点、曲线不过它们，`cubicBezierPts` 40 段采样）/
>   平底 `flatbottom`（2 点，底边水平、顶点在底边中点上方 0.6×宽度）/
>   左箭头 `arrowmarl`、右箭头 `arrowmarr`（1 点，`arrowSideGlyphPts` 把单位顶点表按 dir=±1 旋转）。
>
> **判据与数字**：vitest `tests/drawTools.test.ts` 249 → **342** 条（新增 `ALIGN_SPECS` 17 条 × 四判据 = 68，
> 加 1 条几何）；全量 461 → **530 passed**；浏览器自检 draw 套件 105 → **113 PASS / 0 FAIL**；
> 真实鼠标 E2E **143 PASS / 0 FAIL**（三菜单分组逐行核对 + 17 种工具各 4 条：起点干净 / 落墨 / 类型与成型 /
> 撤销归零 + 重做）。
>
> **踩坑（值得记住）**：第一版 E2E 用「撤销后像素回到基线」当判据，12 种工具判失败、残差恒在 550~630 像素。
> 把差异掩码导成 PNG 才看清——残差是**布林带/EMA 抗锯齿落点变了**和右侧最后价虚线，不是图形残留：
> 画布每重绘一次，指标线的 AA 就不完全一致，「像素归零」这个判据在带指标的图上根本不成立。
> 改为在 `src/dev/drawRegistry.ts` 里登记各格 `DrawLayer`（`import.meta.env.DEV` 才执行），
> E2E 通过 `__app.drawingCount()` / `__app.drawings()` 读**真实图形数与类型**（并顺手加了
> `DrawLayer.pendingCount()` 断言「N 点放满即成型、不留半成品」）；像素只保留「有没有墨水」这一条弱证据。
> 左栏接线：斐波那契菜单新增第 4 组「音叉」，笔刷菜单箭头组 +2 / 形状组 +3，文字菜单由扁平 5 项
> 重排为「文本 8 / 形状 2」；`toolKeyForLabel` 新增 17 条映射，`sidebar-icons.ts` 新增 14 个图标。

### 2.8.8 把「已经上线」的菜单项全部接到真动作上（消灭「暂未实现」toast）✅
> **问题**：侧栏上看得见的行里有一批只是视觉上线、逻辑没接 —— 点下去统一走
> `toolKeyForLabel() === null` 的分支弹「暂未实现（见 TODO 2.8）」。按数据清出来的 11 行：
> 移除图形 / 移除指标 / 移除全部、隐藏绘图 / 隐藏指标、锁定所有绘图 / 锁定指标、继续绘图、放大；
> 另外 **「三角形」是个真 bug**：`toolKeyForLabel` 里只写了别名「三角形形态」，
> 而笔刷→形状里那一行的文案是「三角形」，于是这一行一直是空动作（`89 种全可达`那类断言查不出来，
> 因为 key 本身是可达的，断的是「这一行」）。
>
> **做法**：把「菜单项 → 意图」抽成纯函数 `drawIntent(label)`（`src/workspace/drawBus.ts`），
> 返回 `tool / magnet / clear / hide / lock / toggle / panel / stub` 八种意图；`DrawToolbar` 只负责执行副作用。
> 好处是"这一行到底有没有接上"变成可单测的数据，不再是散在 JSX 里的 if。
>
> **新增的引擎 / store 能力**：
> - `DrawLayer.setAllLocked(on)`：全锁 / 全解锁，**只改状态真变了的那些**并返回改动数；
>   一次操作只入一次撤销栈（连点两次不会堆空快照），空图层上是空操作。
> - `StudyDef.hidden`：隐藏指标 —— 照常运行、图例仍在，只是不画；`paneStudies()` 过滤后副图整块消失
>   （与「只是不画线、留个空副图」相比更贴近 TradingView）。
> - `studyStore.setAllHidden(on)` / `setLocked(on)`；`edit(uid)` 改成返回 `boolean` ——
>   锁定时进不了参数编辑（`edit(null)` 退出编辑仍放行，不然会卡在编辑态出不来），
>   图例里双击被拦下时 toast 说明；`removeStudy` / `setInputs` 同样受锁约束。
>
> **踩坑**：侧栏把「继续绘图」当成开关按钮，走的是 `onToggle` 而**不是** `onTool` ——
> 一开始只接了 `drawIntent` 的 toggle 分支，按钮点了没反应、E2E 里表现为「连画两个只出一个」。
> 现在 `onToggle` 与 `drawIntent` 两条路都认它（`drawBus.setRepeatDraw(on)` 幂等）。
>
> **断言**：新增 `tests/sidebarWiring.test.ts` 26 条 —— 侧栏每一条叶子行都必须有非 stub 意图
> （已知未接的只有「放大」，用白名单钉死，新加一行忘了接就会红）、每个 tool 意图指向真实存在的 key、
> 89 个 key 全可从侧栏点到、8 条动作行的意图逐条对齐、`setAllLocked` 的幂等/撤销回滚、
> studyStore 的隐藏与锁定。
> 全量 530 → **556 passed**；浏览器自检 draw 套件 113 → **116**；
> 真实鼠标 E2E「侧栏动作」**17 PASS / 0 FAIL**（三角形真画出 triangle、继续绘图连画两个、
> 全锁 3 个 + 解锁、隐藏指标后 `paneCount` 归零、移除图形/指标、锁定指标后 edit 被拒），
> 回归上一轮对齐 E2E 仍 **143 PASS / 0 FAIL**。
>
> **诚实边界**：「放大」仍没接 —— 它是图表层动作（单击以点为锚缩放），不属于绘图层，需要另开一条
> `chartIntent` 通道；「锁定指标」锁的是参数编辑与删除，不动图表层的拖拽（我们的指标本来不可拖）。

#### 2.8b emoji 表情集对齐（2026-10-17）

> **参考源**：`charting_library/bundles/drawing-toolbar.7f226c0314e0a6d13a77.js` 的 webpack 模块 173，
> 导出 `emojiGroups`（最近使用 + 8 组）与 `removeUnavailableEmoji`。分类名取自同版本 zh / en 语言包
> 同键文案（15426 / 96330 / 60558 / 35305 / 14232 / 15395 / 72302 / 6878 / 49546）。
>
> **结果**：8 组字符与组内顺序**逐条照抄**，395 / 183 / 114 / 111 / 125 / 247 / 288 / 257 = **1720**，
> 组内组间均无重复；官方中文名修正一处（`旅游&地点`，旧版自拟成「旅行&地点」）。
> 旧数据里的 🎪 重复项随之消失。新增 `EMOJI_ALL` / `isKnownEmoji` / `filterKnownEmoji`，
> 对齐官方 `removeUnavailableEmoji(e)=e.filter(k.has)` 的白名单语义，`loadEmojiRecents()` 读历史时先过滤。
>
> **顺带的性能修正**：面板从「点一次重建整块（原来 ~760 个 button）」改成「静态渲染 8 组一次 +
> 只重建『最近使用』区块」—— 1720 项全量重建每次要多花十几毫秒。
>
> **顺带修掉一个真 bug**：emoji 落笔原来是**半透明**的 —— 彩色字形会连 `fillStyle` 的 alpha 一起吃掉，
> 而默认样式 `fill` 是 `rgba(41,98,255,0.14)`，于是图上只剩一枚浅灰「幽灵表情」
> （同点位色阶：修前 15 / 修后 141）。现在先 `fillStyle='#000'`、`globalAlpha=1` 再 `fillText`，
> 并用 vitest 钉住「每次 fillText 时 fillStyle 必须是 #000」。
>
> **断言**：`tests/emojiData.test.ts` 12 条（组序 / 中英文名 / 每组条数 / 首尾元素 / 无重复 /
> 白名单语义 / 官方这版没有 🫠🫡🩷🧋🫐）；真鼠标 E2E「emoji 数据对齐」**41 PASS / 0 FAIL**
> （逐组 DOM 条数与首尾、国旗组头 6 个、全集 1720 无重、tab 定位、点选后 `__app.drawings()`
> 的 `types`/`texts` 证明落的就是选的那个字符、最近使用置顶且只刷新区块）。
>
> **诚实边界**：① 官方这版 emoji 表停在 v13，🫠🫡🩷🧋🫐🪿🛜 都不在其中，为「与官方一致」没有私自补进去，
> 要补建议单开一组「新增表情」。② 官方落笔默认 `linetoolemoji.size=40`（其单位）、emoji 旋转 `angle=0.5π`，
> 且选中后可在属性里换 emoji 与字号；我们仍是单点落笔、字号 28、不可旋转（属性条只有颜色/线宽/线型）。
> ③ 官方面板是**虚拟化列表**（单滚动 + 小标题），我们是设计稿的「9 tab + 单滚动 + 小标题」，数据相同、排布更窄。

#### 2.8c 表情数据改为「直接吃参考库」（2026-10-17）

> 2.8b 的字符是抄进 TS 字面量的，等于多了一份副本：参考库升级要人手重抄，抄错也没人知道。
> 这一轮把数据源头换成**把官方模块跑起来**，TS 里不再有第二份字符表。
>
> **为什么不能运行时 import**：那 18MB bundle 是 webpack 产物，模块 173 依赖 React、i18n、IconItem
> 与 TV 的运行时上下文，`import` 进来会连带初始化整个库；它是给页面用的，不是给库用的。
> 所以取在**同步时**：`scripts/sync-tv-emoji.mjs` 用 `node:vm` 造一个只有 `self/window` 的沙箱，
> 让 chunk 自己 `push` 进 `webpackChunktradingview`，再把模块表捞出来执行。
>
> **怎么骗过依赖**：假 `require` 只认真认三个 id —— React 的 `createElement` 返回 `null`、
> i18n 的 `t(k, ctx, v)` 原样返回 `v`、`IconItem` 返回 `null`；**其余一律返回 `{__moduleId:id}`**。
> 于是官方那句 `t(null,{context:"emoji_group"}, o(96330))` 的标题就成了一个带 id 的记号，
> 我们据此知道每组对应的语言包模块 id，再用真语言包（`zh.4782` / `en.4782`）调用那个 id 的工厂，
> 拿到「笑脸&人像 / smiles & people」。字符与组名都来自官方运行时，没有任何一处手抄。
>
> **产物两层**：`emoji-source.json`（1802 行 / 32KB，一个 emoji 一行，便于 diff —— 官方加一个表情就是
> 一行增删）+ `emoji-data.ts` 只剩薄适配层（派生 `EMOJI_CATEGORIES` / `EMOJI_ALL` / 白名单，
> 不存字符）。手绘 tab 图标挪到 `emoji-icons.ts`，按**语义 key**（smile/animal/…）对应而非数组下标，
> 官方调分组顺序也不会串图。
>
> **抽完就地断言**：9 组、首组必须是空的「最近使用」、每组 ≥50、全集无重复、
> 且 `removeUnavailableEmoji(['😀','文字','A','🇿🇼'])` 必须只留下两个 —— 任一条不满足就报错不写盘，
> 宁可失败也不写半对的数据。
>
> **防漂移**：`npm run sync:emoji` 重新生成、`npm run check:emoji` 只校对。
> `tests/emojiData.test.ts` 里有一条「本机有参考库时跑 `--check`，输出必须与提交的 JSON 逐字节一致」
> （1.4s；没库的机器 skip 而不是假绿）。chunk 定位按 `removeUnavailableEmoji:()=>` 找、候选文件排序后取，
> 换机器选到同一个（24.001 版落在 `5890.*.js`，`drawing-toolbar.*.js` 内联了同一模块）。
>
> **断言**：vitest 569 → **574**（新增 4 条出处与派生一致性 + 1 条逐字节同步）；
> 回归 emoji 数据对齐 E2E 41、旧 emoji 面板 E2E 14，全绿。

### 2.8.9 emoji 在图上的效果：选中框 / 四角圆手柄 / 拖角改大小 ✅

> **官方依据**（同一套 vm 抽取）：`linetoolemoji: { size: 40, emoji: "😀", angle: .5π }`；
> 它的类是 `LineToolEmoji extends LineToolSvgIconBase`，`_loadViews()` 里用
> `getTwemojiUrl(e, "svg")` 去拉 **twemoji 13.0.1** 的 SVG（`twemoji.maxcdn.com/v/13.0.1/` 或
> `cdnjs.cloudflare.com/ajax/libs/twemoji/13.0.1/`）——所以官方**不是**用系统 emoji 字体画的，
> 这也是为什么它跨平台长得一样。选中时是贴合字形的细蓝框 + 四个白色圆角手柄，拖角改大小。
>
> **跟着改的**：
> - 默认字号 28 → **40**（对齐官方 `size`），命中热区跟着字号走（之前写死 28，放大后点不中）；
> - 选中态换成官方式样：**1px 蓝框贴字形 + 四个白色圆角手柄（r=5）**，不再画通用 7×7 深色方块；
> - 中点**不再是手柄**（它是「位置」），拖中点 = 整体平移；四角才是手柄，拖动只改字号、中心不动；
> - 字号夹在 `[EMOJI_MIN 12, EMOJI_MAX 200]`，光标按角给 `nwse-resize` / `nesw-resize`。
>
> **几何同源**：`emojiBox` / `emojiCornerPts` / `emojiSizeFromCorner` 三个纯函数被**渲染、命中、
> 单测、E2E** 共用 —— 框画在哪、点在哪、E2E 量在哪，只有一份口径。
>
> **没跟着做的两件事**（诚实边界）：
> ① ~~渲染仍是系统彩色 emoji 字体，没有走 **twemoji SVG**~~ —— **已由 2.8.12 补上**（面板 png、
> 画布 svg，映射表 1720 个字符，规则拿线上 830 个码点验证）。
> ② 官方属性面板里还有 `angle`（旋转），我们只做缩放，不做旋转。
>
> **断言**：`tests/drawTools.test.ts` 342 → **351**（框几何 / 四角 part / 拖角算法与夹取 /
> 选中态笔数（1 个 `strokeRect` + 4 个 `arc` + 0 个通用方块）/ 热区随字号变大）；
> 浏览器自检 draw 套件 116 → **119**（角手柄 part、拖角改字号且中心不动、上下限夹取）；
> 真鼠标 E2E「emoji 选中框」**20 PASS / 0 FAIL**（未选中无框 → 选中后上边与四角都是蓝环 →
> 拖角 40→120 且中心不动 → 框跟着长大 → `Meta+Z` 复原 → 放大到 80 出对照图）。
>
> **踩坑**：① `hasText: '🚀'` 会先点到 **🧑‍🚀**（ZWJ 序列的 DOM 文本里就含 🚀），E2E 里必须按
> `textContent ===` 精确匹配。② 自检闸门在 DPR=2 下会报 chart 1 + styles 1 失败 ——
> 用干净 HEAD 复跑同样 1+1，是既有的像素判据对 DPR 敏感，与本轮无关；所以闸门固定在 DPR=1
> 的独立页面跑，截图页面才用 DPR=2。


### 2.8.10 「测量」对齐 charting_library（MeasurePaneView）✅

> **官方依据**（本机 `charting_library/bundles/library.*.js`，模块 44381 那一带的 `fi` 类，
> 也就是十字光标的 measure pane view）：
>
> ```js
> const _i = color-tv-blue-500 (#2962FF), mi = color-ripe-red-400 (#F7525F)
> gi = { bgColorPositive: generateColor(_i, 80), bgColorNegative: generateColor(mi, 80),
>        colorPositive: color-tv-blue-600 (#1E53E5), colorNegative: mi,
>        labelBgColorPositive: _i, labelBgColorNegative: mi }
> ```
>
> 所以官方测量**不是涨绿跌红**，而是**涨蓝跌红**：矩形 20% 透明度、中线与箭头走同色系实色、
> 卡片是 90% 不透明的方向色 + 白色 12px 字；起止的时间 / 价格标签是蓝底白字
> （`axisLineToolLabelBackgroundColorCommon`）。文案三行来自 `{count} bars`（zh `zh.8113` 模块 33355 →
> `{count}根K线`）、`TimeSpanFormatter`（天/时/分/秒逐单位拼）、`VolumeFormatter`（K/M/B/T）。
>
> **跟着改的**（`src/engine/draw.ts`）：
> - 画法整个换掉：**虚线灰框 + 一行灰字** → **20% 透明底色 + 过中点的水平/垂直中线（终点侧 45° 箭头，
>   跨度 ≥ 50px 才画）+ 三行圆角卡片（价差(百分比) 跳动数 / {n}根K线, 时间跨度 / 成交量）**；
> - 卡片尺寸照官方 TextRenderer 的公式：`h = 行数×12 + (行数−1)×8 + 2×5 + 2×4 = 70`，
>   `w = 文字宽 + 18`，圆角 4，底色 alpha 0.9；位置用官方的 `calculateLabelPosition`（贴终点外侧 + 夹边）；
> - 新增 **`onAxisDraw` 钩子**（`ChartHooks` + `KChart.axisBox()/priceDecimals()`）：轴标签必须画在
>   坐标轴**之后**，在 `onDraw` 里画会被轴色块盖掉 —— 这是这轮唯一一处引擎接口改动；
> - 交互补上官方的「按住拖一下就量完」：松手时终点已拉开 ≥ 4px 即成型，静止点击仍按老规矩等第二个点；
> - 文案口径按官方格式化器复刻：价差/百分比用 **Unicode 减号 `−`**、去尾零；跨度 `5天 19小时 30分钟`；
>   成交量 `3.63M`；「跳动数」= 价差 ÷ 最小变动（`dec=2` 时 −0.26 → `−26`）。
>
> **几何同源**：`measureInfo` / `measureLabelBox` / `measureLabelAnchor` / `measureGuides` 四个纯函数
> 被**渲染、轴标签、单测、自检**共用 —— 卡片画在哪、单测算在哪，只有一份口径。
>
> **诚实边界**：
> ① 价格小数位为 0 的品种（如截图里的 362/375）**不拼「跳动数」**——官方 PipFormatter 此时会输出与价差
> 完全相同的数字（`−8 (−2.24%) −8`），是重复信息；这是唯一一处**故意不照抄**。
> ② 官方卡片的锚点公式是「贴终点外侧」，所以下跌（终点在下）时卡片在框**下面**；你给的参考图里卡片在框上面，
> 对应的是「终点在上」的走势 —— 公式本身按参考库实现，没有按截图反推。
> ③ 官方测量是临时十字光标测量（下一次点击就消失），我们仍是可选中 / 可拖动 / 可撤销的**持久图形**，
> 这是产品口径差异，不改。
>
> **断言**：`tests/drawTools.test.ts` 351 → **359**（格式化器 4 类 / measureInfo 三行与区间成交量含两端 /
> 卡片尺寸与锚点夹取 / 中线与箭头门槛 49 vs 50 / 底色与白字与"没有虚线" / 轴标签 2+2 /
> 拖拽手势 vs 两次点击）；浏览器自检 draw 119 → **125**；真鼠标 E2E「测量对齐」**13 PASS / 0 FAIL**
> （拖动预览有卡片 → 内部红底 → 两条中线是实色 → 卡片 90% 红 + 白字 → 时间/价格各 2 个蓝标签 →
> 涨的那次是蓝不是绿）；截图 `docs/shot-measure-align.png`（跌）/ `docs/shot-measure-up.png`（涨）。


### 2.8.11 「笔刷 / 荧光笔」对齐 charting_library（BrushBasePaneView）✅

> **官方依据**（本机 `charting_library/bundles`，`library.*.js` 默认属性表 +
> `lt-pane-views.*.js` 的 `52377`（BrushBasePaneView）/ `62641`（BrushPaneView）/ `75073`（HighlighterPaneView））：
>
> ```js
> linetoolbrush:       { linecolor: color-sky-blue-500 (#00bcd4), linewidth: 1,
>                        linestyle: 实线, smooth: 5, fillBackground: false }
> linetoolhighlighter: { linecolor: generateColor(color-ripe-red-500 #F23645, 80), smooth: 5 }
> // HighlighterPaneView 把 linewidth 写死 20、linecap/linejoin 都是 round
> // PolygonRenderer：单点 → 半径 = linewidth/2 的实心圆；hitTest 容差 = max(3, ceil(w/2))
> // SelectionRenderer：只画首/末两个「白底 + tv-blue-600 环」圆点（DPR1 外径 5.5 / 内环 3.5）
> // LineToolBrushBase.addPoint：与上一点屏幕距离 < 2px 的点直接丢弃
> ```
>
> 所以之前的实现有三处**明显不对味**：① 荧光笔是**黄**色、alpha 0.35、线宽 10；
> ② 笔迹是**折线**（没有平滑，手一抖就是锯齿）；③ 选中态画**虚线包围盒**。
>
> **跟着改的**（`src/engine/draw.ts` §2.6）：
> - 默认值换成官方的：笔刷 `#00bcd4` / 1px；荧光笔 `rgba(242,54,69,0.2)` / 20px（`styleForTool` 一条路，
>   `add()` 和落笔都走它，显式传入的样式仍然优先）；
> - **半透明只在颜色里**：删掉 `globalAlpha = 0.35`（再乘一层会比官方淡一半，白底实测 252/215/218 = 0.2 混合）；
> - 新增纯函数 `smoothStroke`：先把每段按 ≤ smooth(5) 像素重采样（每段最多插 5 个点），再做半径 5 的
>   箱式模糊（越界邻居夹端点），最后补一个**原始末点**收尾 —— 与官方 `_updateImpl` + `_smoothArray` 逐行等价；
> - 命中按**平滑后**的轨迹算（不会出现「看着在线上却点不中」），容差 `max(3, ceil(线宽/2))`：
>   荧光笔 ±10px、笔刷 ±3px（原来两者都是写死的 ±11 / ±8）；
> - 采点步长 6px → **2px**（官方 `addPoint`），数据量由平滑算法兜住；
> - 选中态：虚线包围盒 → **首/末点各一个白底 + `#1e53e5` 环圆点**（无可拖手柄 ——
>   官方 `hasEditableCoordinates() === false`）；
> - 笔刷保留官方 `linestyle` 属性（虚线合法），荧光笔恒实线。
>
> **诚实边界**：
> ① 官方笔刷还有 `fillBackground / transparency / leftEnd / rightEnd / smooth` 五个属性，我们的浮动属性条
> 只暴露颜色 / 线宽 / 线型 —— 默认值（不填背景、两端 Normal、smooth 5）与官方一致，但没有对应的 UI；
> ② 官方荧光笔的线宽不可调（写死 20），我们的属性条仍可改（默认值一致，算超集）；
> ③ 我们的荧光笔 / 笔刷是**持久图形**（可选中、拖动、撤销），官方是 LineDataSource 但同样持久 —— 这条一致。
>
> **断言**：`tests/drawTools.test.ts` 359 → **368**（默认色与线宽、`smoothStroke` 数值钉死
> `[3,4,6,10]` 与尖角磨圆、荧光笔 20px 圆头圆角 alpha=1、笔刷 1px miter、单击圆斑、
> 选中态两个圆点 + 无包围盒、命中带宽 10/3、<2px 丢点）；浏览器自检 draw 125 → **127**；
> 真鼠标 E2E「笔刷/荧光笔对齐」**13 PASS / 0 FAIL**（菜单行 → 落笔类型 → 20% 红 → 法线 6px 内 14px 外 →
> 端点白点与蓝环 → 笔刷青蓝 1px → 波浪平滑笔迹）；
> 截图 `docs/shot-brush-align.png`（两种笔迹同框）/ `docs/shot-brush-anchor.png`（选中端点圆点）。

> **各工具默认属性对齐（2026-10-17，用户给了一张 cn.tradingview.com 的图表链接）**：
> 链接 `https://cn.tradingview.com/chart/obmoJwJQ/` 匿名访问是 **403 + Chart Not Found**
> （`/api/v1/charts/obmoJwJQ/` 返回 `null`，真 Chrome 打开也是同一句「无法打开此图表布局」），
> 所以看不到那张图的布局；改从**同一份引擎**的默认属性表核对。
>
> **官方依据**：`charting_library/bundles/library.*.js` 的 webpack **模块 64548** ——
> 模块头先把颜色绑到单字母变量（`L = r("color-tv-blue-500")`、`K = color-ripe-red-500`、
> `te = grapes-purple-500`、`Pe = cold-gray-500`…，`n(x, 80)` 即 `generateColor` = 20% 透明），
> 随后是 `TradingView.defaultProperties` 里的 **87 个 `linetoolXXX` 块**。
>
> **抽法**：`scripts/sync-tv-tool-defaults.mjs` —— 解析模块头的变量表 + 逐块解 `linetoolXXX` 的
> 标量属性（键名并不统一：`color` / `linecolor` / `lineColor`、`backgroundColor`、`fontsize` / `fontSize`），
> 生成 `src/engine/tv-tool-defaults.json`（87 条，`--check` 逐字节校对）。
> 音叉族的主色在嵌套 `median`、斐波那契/江恩是逐 level 给色（`levels: true`），都按原样记下来。
>
> **最要紧的一条**：官方**不是「所有工具一个蓝色」**，形状各有专属色 ——
> 矩形紫 `#9c27b0`、圆橙 `#FF9800`、椭圆红 `#F23645`、三角/头肩/ABCD 绿 `#089981`、
> 三驱/三角形态深紫 `#673ab7`、旋转矩形 `#4caf50`、弧形 `#e91e63`、斐波那契灰 `#787B86`、
> 音叉/江恩红 `#F23645`；线条类统一 `#2962FF` 但**线宽是 2px**（我们原来是 1.6px）。
>
> **跟着改的**：`TV_TOOL_KEY`（我们的 66 个 key → 官方名）+ `tvToolStyle()` +
> `styleForTool()` 接上官方默认值（显式 patch 仍优先）；新增三条分支：
> 官方 `fillBackground: false` → 填充转 `transparent`、`linestyle` → dash、`fontSize` → 字号。
> 顺手修掉一个真 bug：**两点形状落笔走的是 `drawStyle()` 而不是 `styleForTool()`**，
> 所以就算默认表接上了，画出来的矩形仍是老蓝色（现在两条落笔路径统一）。
>
> **断言**：`tests/toolDefaults.test.ts` 16 条（快照 87 条 / 关键色与线宽逐条钉死 /
> 映射表每个官方名必须真实存在 / patch 优先 / 与参考库逐字节同步）；
> vitest 599 → **615**；浏览器自检 draw 127 → **129**；真鼠标 E2E「工具默认样式」**8 PASS / 0 FAIL**
> （矩形紫 20% 底 → 圆橙 → 三角绿 → 趋势线 2px 蓝 + 两处像素抽查）；
> 回归 测量 13 / 笔刷 13 / emoji 选中框 20 全绿。截图 `docs/shot-tool-defaults.png`。
>
> **诚实边界**：① 只接了「有确定对应关系」的 66 个工具，`dot` / `curve` / `hyperbola` /
> `tiltfan` / `xabcd` 官方没有同名工具，仍走蓝色默认；② 快照只取标量与嵌套主色，
> 斐波那契各 level 的颜色仍由我们的 `FIB_LEVELS` 管；③ 官方 `transparency` 我们只在
> 填充色缺失时用作兜底（`backgroundColor` 里已经带了 alpha）。


### 2.8.12 「表情」换成官方那套图（面板 + 画布都走 twemoji 13.0.1）✅

> **你给的 6 个 magicpatterns 链接**是 cn.tradingview.com 表情面板的 DOM 快照
> （`/imported/<uuid>`，页面里是一整棵 React JSX + 计算后的布局，直接 500 但内容在
> flight payload 里能抠出来）。6 页是同一个虚拟列表面板的不同滚动位置，合计 **830 个码点**。
>
> **快照说清楚了三件我们原来靠猜的事**：
> 1. 面板里的表情**不是字体字形**，是 `<img src="…/twemoji/13.0.1/72x72/<code>.png" width=24
>    height=24 decoding=async draggable=false alt="">` —— 官方库 `getTwemojiUrl()` 把 base
>    指到 cdnjs，面板取 png、画布取 **svg**（`EmojiPaneView extends SvgIconPaneView`）。
> 2. 尺寸：面板宽 **349**、一行 **9** 格、格高 **38**（9×38=342 > 337，官方靠 flex 压到 **37.44**）、
>    图标 **24**、左右留 6。
> 3. 分组标题：高 **30**、**11px**、字距 **.4px**、左缩进 **18**、上内边距 6、灰 `rgb(128,128,128)`、大写。
>
> **跟着改的**：
> - `src/engine/emoji-twemoji.json` + `scripts/sync-emoji-twemoji.mjs`：1720 个字符 → twemoji 文件名。
>   命名规则是从线上 830 个样本反推的 —— **按「非 ZWJ 码点后补 FE0F → 原样 → 去 FE0F」依次试，
>   取第一个真实存在的文件**；所以 🏳️‍🌈 是 `1f3f3-fe0f-200d-1f308`（带 FE0F）、❤️ 是 `2764`（不带）、
>   👨‍💼 是 `1f468-200d-1f4bc`（补了反倒不存在）。830 个样本**逐字节全中，0 例外**。
> - `src/engine/emojiAssets.ts`：`emojiPngUrl` / `emojiSvgUrl` + 图片缓存（加载中先画兜底字形，
>   `load` 后回调 `host.invalidate()` 重绘一次）。
> - `sidebar.ts`：格子从 44×42 字号 26 的字体字形，换成官方尺寸的 24px 图片（`loading=lazy`，
>   官方是虚拟列表，效果等价；图挂了才退回系统字形）+ 官方标题条；面板宽 434 → **349**。
> - `draw.ts`：画布上的 emoji 从 `fillText` 改成 `drawImage(svg, size×size)`（官方就是渲进
>   `size×size` 的 viewBox），`size` 仍是官方 `linetoolemoji.size = 40`。
> - 顺手修掉 tab 跳转定位：原来用 `offsetTop`（面板是 `position:fixed`，offsetParent 链把
>   tab 条高度算进去了），跳过去会顶掉标题；改成两个 `getBoundingClientRect()` 的差。
>
> **断言**：`tests/emojiAssets.test.ts` 15 条（1720 个字符全有映射且不撞 / 文件名格式 /
> 线上 830 码点逐字节复现 / FE0F 取舍的三个反例 / png 与 svg 两个地址 / 面板尺寸与快照逐字段相等 /
> 9×38 > 337 的挤格事实 / 与生成脚本逐字节）；vitest 615 → **630**，自检 draw 仍 **129**。
>
> **headless 实测**（Playwright，DPR=2）：面板 box **349×379**、格子 **37.4375×38**（官方 37.4453/37.4375）、
> 图标 **24×24**、标题 `11px / .4px / uppercase / rgb(128,128,128)`、1720 个格子 1720 张图 **0 个兜底**、
> 点「旗帜」跳转后标题正确落在顶部、点过之后「最近使用」置顶出现。
> 截图 `docs/shot-emoji-twemoji-panel.png` / `docs/shot-emoji-twemoji-chart.png`。
>
> **诚实边界**：① 图仍是**运行时从 cdnjs 拉**（官方也是这么干的），断网时面板退回系统字形、
> 画布退回字形 —— 不把 1720 张图塞进仓库（约 10MB＋）；② 官方是虚拟列表，我们是一次生成全部 1720 个
> `<img loading=lazy>`，首屏只下可见的几十张，但滚到底后总请求数比官方多；③ 快照只覆盖 6 个分组
> 区段（830/1720），另外 890 个码点靠资产表匹配，没有线上样本可核对 —— 规则本身已被 830 个样本验证。


### 2.8.13 深色主题：左侧绘图栏与它弹出的菜单 ✅

> **你报的现象**：切到夜里（深色）后，点左栏小箭头弹出的子菜单是**白卡 + 浅灰字**，
> 整屏几乎读不出字。实测容器：`background` 白 `#fff`、`color` `#e8ecf1` ——
> 对比度 **1.19 : 1**（正文要求 4.5，等于隐形）。
>
> **根因不是「忘了写深色样式」，是那层 filter 打不到该打的地方**：左栏本体一直是
> 写死的浅色稿，深色靠 `app.css` 里一句 `.draw-toolbar .kc-sidebar { filter: invert(.9)
> hue-rotate(180deg) }` 整体反相。但**子菜单和 emoji 面板都挂在 `<body>` 下**
> （`position: fixed`，否则会被 sidebar 的 `overflow-x: hidden` 裁掉），压根不在那个 filter
> 的作用域里；它们只从 body 继承到深色的浅色文字，背景却还是写死的白。
>
> **做法**：不再反相，给左栏写正经的两套色板 —— 变量定义在 `:root`（挂在 body 下的弹层
> 也能继承到），`:root[data-theme='dark']` 换一套值；深色值直接取 `tokens.css` 的
> `--bg-subtle / --bg / --bg-hover / --bg-active / --border`，跟顶栏、右栏面板同族。
> 图标本来全是 `currentColor`，跟着 `--kcs-ink` 自己变色，不需要逐个改。
>
> | | 浅色（保持设计稿原值） | 深色 |
> | --- | --- | --- |
> | 轨道底 | `rgb(235,235,235)` | `#151a20` |
> | 分组卡片 | `#fff` | `#0f1216` |
> | 图标 / 文字 | `rgb(15,15,15)` | `#e8ecf1` |
> | 悬停 / 选中药丸 | `rgb(242,242,242)` / `rgb(235,235,235)` | `#212832` / `#29313c` |
> | 弹层底（子菜单 / emoji） | `#fff` | `#1b2128` + 1px `#323c49` 描边 + 深投影 |
> | 分组标题 / 快捷键 | `rgb(140,140,145)` | `#8a919e` |
>
> **断言**：新增 `tests/sidebarTheme.test.ts` 12 条 —— 浅/深两套 `--kcs-*` **同名同数量**
> （少一个就意味着某处在深色下还留浅色值）、样式里用到的每个 `var(--kcs-*)` 都真有定义且
> 能顺着 `tokens.css` 解析到具体颜色、弹层文字对比度（深色正文 **13.67:1**、次要文字 **5.12:1**、
> 浅色正文 **19.17:1**）、浅色设计稿原值未被顺手改掉、`app.css` 里不再有对 `.kc-sidebar` 的
> `filter: invert`。vitest 630 → **642**。
>
> **headless 实测**（Playwright，DPR=2）：深色下子菜单 `rgb(27,33,40)` 底 + `rgb(232,236,241)` 字、
> 按钮选中态 `rgb(41,49,60)`、轨道 `rgb(21,26,32)`、`filter: none`；emoji 面板
> `rgb(27,33,40)` 底、标题 `rgb(138,145,158)`；浅色子菜单仍是 `#fff` + `rgb(15,15,15)`（未回归）。
> 截图 `docs/shot-dark-side-menu.png` / `docs/shot-dark-emoji-panel.png` / `docs/shot-dark-side-on.png`。
>
> **诚实边界**：① 右侧图标栏（`.kc-rightbar`）和顶栏工具条仍在用 `filter: invert(.9)
> hue-rotate(180deg)` 那套老办法 —— 它们没有挂在 body 下的弹层，反相本身不出错，只是配色和左栏
> 不再是同一套（右栏图标里有品牌渐变，直接换色板要逐个核）；② 深色下的「选中行」沿用
> `--bg-active`，与官方的 `#2a2e39` 不是同一个值 —— 取的是本项目的 tokens，视觉一致优先于数值一致。


### 2.8.14 「橡皮擦」对齐 charting_library（LineToolEraser / _tryHandleEraserMouseDown）✅

> **你报的现象**：橡皮擦点一下就把整条删了，悬停时没有任何反馈，光标还是十字线；
> 与官方那套「悬停亮起来 → 点掉 / ⌘+点只擦一档」不是一回事。
>
> **先说清楚工具链**：REA 这一轮仍然不可用（MCP 握手成功但客户端没加载 rea 工具；静态分析在本机
> chunk 上 `spawn EPERM`；镜头要 9222 调试端口）。所以照旧直接读本地 `charting_library/bundles`
> 反推，五条口径逐条对上：
>
> | | 官方（bundle 里的证据） | 本项目原来 | 现在 |
> | --- | --- | --- | --- |
> | 工具注册 | `supportedLineTools` 里 `eraser:{name:"eraser",onlySelectable:!0}` —— 不是 LineTool，点了不落图形 | 同（本来就没画东西） | 同 |
> | 锁定能不能擦 | `_tryHandleEraserMouseDown` 的调用点在 `lockDrawings()` / `isLocked()` **之前**，`removeSource` 只看 `isUserDeletable()`（= `userEditEnabled`） | 有 `!hit.d.locked` 保护，擦不动 | **照擦**，`setLocked` 注释也改成「Delete 删不掉；橡皮擦是例外」 |
> | 悬停反馈 | `_updateHoveredSource` 里 `tool==='eraser'` → `model.setHoveredSource()`；view 端 `areAnchorsVisible() = (isHoveredSource() && !isLocked() \|\| isSelectedSource()) && isEditMode()`；`showOnTopOnHovering()` → 悬停的图形最后画（置顶） | 无 | `hoverId`：悬停亮锚点 + 置顶重绘，**只亮不选**（`activeId` 不动、属性条不弹）、锁定不亮、移开收掉 |
> | 光标 | `7717.*.css` → `.pane--cursor-eraser{cursor:url(eraser.<hash>.cur)}`；`.cur` 实测 32×32 / 32bpp / 热点 **(5,5)**，白橡皮 + `#353535` 实心右上角 + 左上角十字 | 十字线 | `ERASER_CURSOR`（内联 SVG，同一造型同一热点），`cursorAt()` 按命中分派 `move` / `pointer` / `nwse-resize` 等 |
> | 多档位工具 | `processErase(model, eraseMarker)` 只把 `levelN.visible` 置 false（命令名 `TranslatedString("erase level line")`），**图形本身还在** | 整条删 | ⌘/Ctrl + 点某条档位线 → `hiddenLevels` 记下标、渲染跳过、命中跳过；不按模改键仍是整条删 |
>
> 只有 `mousedown` 才处理（官方 `_tryHandleEraserMouseDown` 挂在 `_mouseDownEvent`，没有拖拽连擦），
> 所以「按住拖过去连擦」没做 —— 这是对齐，不是缺功能。
>
> **连带修的两处**：
> ① `KChart` 在 `hooks.onMove` 之后自己写 `canvas.style.cursor`，会把图层设的光标盖掉 →
> `ChartHooks` 新增 `cursorFor` / `onLeave`，光标外部优先；
> ② dev 注册表 `unregisterDrawLayer` 在组件卸载时漏调，StrictMode 双挂载后留下 2 个**僵尸层**，
> `drawings()[0]` 会读到死层（E2E 一开始就是这么被坑的：图形数恒为 0）→ 卸载时一并反注册。
>
> **断言**：vitest 642 → **651**（新增 9 条：锁定照擦 / ⌘+点只隐藏该档 + 该档不再命中 + 重复擦幂等
> + undo 复原 / 不按模改键整条删 / 无档位工具 ⌘+点也整条删 / 悬停只在橡皮下亮且不动 `activeId` /
> 锁定悬停不亮 / `cursorAt` 的 url 含 `5 5, crosshair`）；`drawSelfTest` **129 → 134**。
>
> **headless 实测**（Playwright，20 条全绿）：悬停线上 `hover` 恰好一层有值、`cursor` 是
> `url("data:image/svg+xml;utf8,…") 5 5, crosshair`、属性条不弹；点一下 `count` 1→0；
> 锁定时 `locked=1` 但悬停不亮、点击仍 `count`→0；斐波那契 ⌘+点中线后 `hiddenLevels===[[3]]`
> 且 `count` 仍为 1。截图 `docs/shot-eraser-hover.png`（锚点亮起、无属性条）、
> `docs/shot-eraser-level.png`（0.5 那条黄线缺位，其余档位还在）。
>
> **诚实边界**：① 悬停高亮只画锚点方块，没有官方那个「擦掉后会怎样」的预览描边；
> ② 档位擦除只覆盖 6 个带档位数组的工具（`LEVEL_TOOLS`：fib / fibext / fibchannel / fibfan /
> fibtz / fibttz），扇形与江恩类的档位几何还没拆到 `processErase` 那么细；
> ③ 官方擦除后会走一次 `model.removeSource(..., isUserDeletable())` 并广播变更事件，
> 我们走的是 `remove()` + 自己的 undo 栈 —— 行为等价，事件名不对等。


### 2.8.15 「光标」下拉（十字线 / 圆点 / 箭头 / 荧光笔 / 橡皮擦）对齐线上 TradingView ✅

> **你报的现象**：这张下拉里的图标和官方不是一套 —— 圆点太大、箭头是一根斜线、
> 荧光笔是一支笔、橡皮擦是描边的方块；行高、字号、选中态、开关也都不一样。
>
> **这次不用猜了，直接抓线上**：`https://cn.tradingview.com/chart/?symbol=BTCUSDT`
> （你给的 `obmoJwJQ` 那张图匿名访问是 "Chart Not Found"，需要你的登录态）——
> 用 Playwright 打开左栏 `[data-name=linetool-group-cursors]` 的箭头，把下拉里每一行的
> **行内 `<svg>` 原样 + `getComputedStyle` 度量**抄下来，存成 `tests/fixtures/tv-cursor-menu.json`。
>
> 官方实测（浅色）：
>
> | | 官方 | 我们原来 |
> | --- | --- | --- |
> | 菜单 | 244 宽、四周 `6px`、14px/18px 字 | 220 宽、`6px 0`、13px 字 |
> | 行 | **40 高**、左右 4、圆角 6、图标与文字间距 4 | 34 高、左右 12、无圆角 |
> | 图标 | 28×28（橡皮擦 **29×31**），离行左 4 | 28×28，手绘形状 |
> | 选中行 | `#2e2e2e` 底 + **白字** | 浅灰 `rgb(240,240,243)` + 墨色字 |
> | 悬停 | `rgb(242,242,242)` | 同（本来就对） |
> | 分隔线 | 1px `#ebebeb`，上下各 6；**橡皮擦上下各一条** | 只有开关前面一条 |
> | 开关行 | 32 高、14px 字 | 34 高、13px 字 |
> | 开关 | 38×20 / 圆角 20 / 旋钮 14 内缩 3 / 开 `#2e2e2e` 关 `#9c9c9c` | 34×20 / 旋钮 16 内缩 2 / 开 `rgb(15,15,15)` 关 `rgb(200,200,200)` |
>
> **图标本身也全换了**（不是「描得更像」，是把官方 `<path>` 抄下来）：
> 圆点 `r=3`（原来 3.6）；箭头 = 官方那支**鼠标指针**（原来是斜线箭头）；
> 荧光笔 = 圆圈里一支笔尖（原来是一支笔）；橡皮擦 = 29×31 视框的斜方块（原来描边）。
> 十字线本来就与官方逐字符相同，没动。
>
> **断言**：新增 `tests/cursorMenu.test.ts` 20 条 —— 5 个图标**逐字符**等于 fixture 里的官方 SVG、
> 侧栏「箭头」确实接的是 `ARROW_CURSOR` 而不是画线箭头、菜单 244/6px/14px、行高 40/左右 4/间距 4/圆角 6、
> 开关 38×20 且旋钮 `left: 21px`（关态 3px）、选中行 `#2e2e2e` + 白字且对比度 **13.7:1**、悬停/分隔线/开关三个颜色都等于官方值。
> vitest 651 → **671**。
>
> **headless 实测**（Playwright，12 条全绿）：菜单 244×270（与官方截图**同尺寸**）、行 232×40、
> 图标离行左 4 / 文字离行左 36（=4+28+4）、图标盒 `28,28,28,28,29×31`、选中行
> `rgb(46,46,46)` + `rgb(255,255,255)`、开关 38×20 圆角 20 旋钮 14 `left:21px`；
> 深色下菜单 `rgb(27,33,40)`、选中行 `rgb(41,49,60)`、文字 `rgb(232,236,241)`。
> 截图 `docs/shot-cursor-menu-compare.png`（左官方、右我们，两张都是 244×270@2x）、
> `docs/shot-cursor-menu-aligned-light.png` / `-dark.png`。
>
> **诚实边界**：① 只对齐了「光标」这一组；趋势线 / 斐波那契 / 形态等菜单的图标仍是设计稿手绘的
> （`ARROW_ICON` 仍然是画线箭头，`sidebar.ts` 里注释已标明它属于趋势线组），要一起对齐就用同一套抓取脚本再跑一遍；
> ② 我们的行里还多带了官方没有的「快捷键提示 / 收藏星 / 分组标题」，这些是设计稿的东西，保留但跟着新度量重排；
> ③ 官方菜单的阴影 / 圆角来自外层弹层容器（`menuBox` 自身是透明的），我们仍是自己那套 `--kcs-pop-shadow`，视觉接近但不是同一个值。


### 2.8.16 左侧分组按钮跟随当前工具（图标 + 点击行为）✅

> **你报的现象**：上一轮只换了下拉里的图标样式，可**选完箭头，左边那颗按钮还是十字线**，
> 再点它画的也还是十字线 —— 官方那颗按钮显示的就是「当前工具」，点它继续画当前工具。
>
> **根因**：`SECTIONS` 里每组只有一个写死的 `icon`，`pick()` 只负责给按钮加选中类，
> 从没换过里面的 `<svg>`；主按钮的 click 又写死 `pick(btn, t.label)`，永远派发组名。
>
> **改法**（`src/workspace/dom/sidebar.ts`）：
> - 纯函数 `itemIcon(t, label)` / `mainButtonView(t, activeLabel)`：在组里找那一行的图标；
>   找不到（或传的是分隔线占位 `MENU_SEP`）就退回「组名 + 组图标」，不会把按钮换空白。
> - 每个分组按钮用 `WeakMap` 记住「组内当前工具」（`activeOf`）。`pick(btn, label, icon)`
>   带图标时替换 `btn.innerHTML`、写 `data-tool`、`title`，并更新 `activeOf`。
> - 主按钮点击改成 `pick(btn, activeOf.get(btn) ?? t.label)` —— 选了箭头之后点它还是箭头。
> - 菜单打开时按 `activeOf` 给对应行补 `.sel`（菜单只构建一次，不重同步就丢选中态）。
> - `.kc-sb-btn > svg` 从写死 `left:12/top:5` 换成 `left/top:50% + translate(-50%,-50%)`：
>   28×28 的落点与原来一模一样，而橡皮擦图标是官方的 **29×31**，写死会向右下偏 1px。
>
> **另一半：画完回光标时图标也要拨回去**。图层画完一个图形 / 按 Esc 会 `setTool('cursor')`，
> 但侧栏不知道 → 图标停在「箭头」上，还是不一致。为此加了一条**单向**回调链：
> `DrawLayer.backToCursor()` → `DrawHost.onToolAutoChange` → `KChart` 转发 `ChartHooks.onToolChange`
> → `ChartGridView` 广播 `drawBus.setTool`（同值短路）→ `DrawToolbar` 订阅后用
> `sidebarLabelForTool(key)` 反查中文名 → `setSidebarActive(root, label)` 把主按钮拨回去。
> 只报「自动」切换：外部主动 `setTool()` 不触发，避免和侧栏同步来回打转。
>
> **断言**：新增 `tests/sidebarMainButton.test.ts` **20 条** + `drawTools` 里 4 条：
> 初始/选中/退回/分隔线占位、橡皮擦 29×31、趋势线组选「水平线」、每组每个子项都有图标、
> `pick` 三条接线、主按钮不再派发组名、`sidebarLabelForTool` 8 个 key 反查正确（含单按钮「测量」「图标」）、
> 认不出的 key 返回 null；引擎侧：两点工具成型通知一次 `cursor`、`repeatDraw` 开着不通知、
> Esc 通知、外部 `setTool` 不通知。vitest 671 → **695**；`tsc` 0 错；`npm run build` 通过。
>
> **headless 实测**（Playwright，**21 条全绿**）：初始 `data-tool=十字线` 且图标在 pill 正中；
> 选箭头 → `data-tool/title=箭头`、主按钮 SVG 与菜单里那行**逐字符相同**、工具变 `arrow`；
> 点主按钮仍派发 `arrow`；重开菜单「箭头」是唯一选中行；选橡皮擦 → 图标 **29×31** 且居中、
> 点主按钮派发 `eraser`；**在图上真画一个箭头 → 工具回 `cursor`、主按钮同时变回十字线 28×28**；
> 选荧光笔后按 Esc → 两者一起回十字线。截图 `docs/shot-sidebar-mainbtn-arrow.png`（选中箭头，
> 左栏那颗已变鼠标指针）、`docs/shot-sidebar-mainbtn-eraser.png`（左栏变成 29×31 的橡皮）。
>
> **诚实边界**：① `aria-label` 保留组名（方便定位与无障碍），当前工具写在 `title` 与 `data-tool` 里；
> ② 只在「侧栏 → 工具」「工具 → 侧栏」两条路上同步，浮动属性条的「重复绘制」开关不改变主按钮的语义；
> ③ 多格布局下每个窗格各自有一个 `DrawLayer`，画完时只有先广播的那一次会改侧栏（`drawBus` 同值短路）。


### 2.8.17 浮动属性工具条对齐线上 TradingView ✅

> **你报的现象**：选中图形后浮出来的那条工具条也不对 —— 圆点、箭头、荧光笔、橡皮擦
> 那一组只管了下拉，工具条本身还是设计稿手绘的：铅笔下面是纯色块、三点是实心、没有
> 独立「线型」按钮、锁是闭合的、按钮宽窄也不一致。
>
> **真值从哪来**：线上 SaaS 版那条（Charting Library v24 里**没有**这个组件，只在
> tradingview.com 有），但匿名账号一画图就被「免费加入」拦住。所以这次直接拿你给的
> 截图当尺子：`docs/ref-tv-propsbar.png`，762×106 的 2x 图，用 PIL 做行列投影量出
> 每个元素的 bbox，除以 2 就是 CSS 值。
>
> **量出来的结构**（全部 38 步进，条高 38、圆角 8、左右各 2）：
>
> | 元素 | 尺寸 | 说明 |
> | --- | --- | --- |
> | 拖拽手柄 | 22×38 | 2 列 × 3 行圆点，整块 8×12，点色 `rgb(184,184,184)` |
> | 克隆 | 38（图标 16） | 2×2 网格缺右下，右下是加号 |
> | 颜色 | 38（铅笔 20） | 铅笔 + **22×4 的彩虹渐变条**（8 个色标：紫→蓝→青→绿→黄→橙→红） |
> | 线宽 | **70** | 18 长的线样（**粗细 = 当前线宽**）+ 4 间距 + 「2px」（14px 字） |
> | 线型 | 38（20×20） | 一条细横线，点开选实线/虚线/点线 |
> | 设置 | 38（21×18） | 六边形 + 内圆 r=2.6 |
> | 锁 | 38（16×19） | **开口锁**，锁孔是实心竖条；锁定后换闭合图标 |
> | 垃圾桶 | 38（18×20） | 梯形桶身 + 顶盖 + 扁提手 |
> | 更多 | 38（19×5） | **三个空心圆**（r=1.6、中心距 7），不是实心点 |
>
> **几处真 bug**：
> ① 线宽那颗原来按内容自适应（约 80 宽），官方是固定 70；
> ② 「线型」原来塞在六边形（设置）按钮里，官方是两个独立按钮 —— 拆开，设置里放
>    「重复绘制」开关与「删除全部」，重复绘制不再占工具条一个位置（官方那条也没有）；
> ③ 铅笔的旋转方向一开始写反了（`rotate(-45)` 让笔尖跑到右下），改 `+45` 才是笔帽右上、
>    笔尖左下；笔尖的 V 没闭合时看着像「<」，补 `Z` 收口成三角；
> ④ 线样高度原来写死 4，现在跟着线宽走（`widthSampleH`：1→2、4→4、8→8，上限 8）。
>
> **深色**：条挂 body 下，同样吃 `:root` 上的两套 `--kpb-*`（8 个变量：bg / ink / hover /
> on / sub / grip / shadow / pop-shadow），深色指向 `--bg-sunken` / `--text` / `--bg-hover` /
> `--accent-soft`，正文对比度 ≥ 4.5:1。
>
> **断言**：新增 `tests/propsBar.test.ts` **30 条** —— 尺寸常量（38/70/22）、CSS 里只有
> 一处 `.wide`、源码次序 = `BAR_ORDER`、9 个图标的盒子尺寸逐个核对、三点是空心（`fill="none"`
> 且无 `fill="currentColor"`）、彩虹条 8 个色标与首尾色、`widthSampleH` 边界、锁定时换图标
> 与禁用垃圾桶、`sync` 只在值变时动 DOM；深色 6 条（两套变量同名同数量 / 指向 tokens /
> 底暗字亮 / 对比度 AA / 浅色仍是白底黑字 / 弹层也吃变量）。vitest 695 → **725**。
>
> **headless 实测**（Playwright，**36 条全绿**）：条 362×38、圆角 8、字号 14、内边距 0 2；
> 九个 `[data-item]` 顺序与官方一致；手柄 22、线宽 70、其余七个 38；图标盒子
> `8×12 / 16×16 / 20×20 / 20×20 / 21×18 / 16×19 / 18×20 / 19×5` 逐个相等；
> 彩虹条 22×4 且 computed 是 `linear-gradient(...8 色标...)`；线宽文案 2px/14px、线样 18×2，
> 改成 4px 后线样同步变 4；锁定后标题变「解锁」、垃圾桶禁用；深色下条底 `rgb(27,33,40)`、
> 文字 `rgb(232,236,241)`。
> 截图：`docs/shot-propsbar-compare.png`（左官方截图、右我们）、`shot-propsbar-icons.png`
> （六个图标 38 CSS 同比例上下对照）、`shot-propsbar-aligned-light.png` / `-dark.png`。
>
> **诚实边界**：① 官方那条来自 SaaS 版截图，Charting Library 的公开 demo 里根本没有这个
> 组件，所以是「照像素重绘」而不是「抄 path」—— 铅笔的笔帽弧度、垃圾桶提手高度还差 1px 级；
> ② 我们多保留了弹层里的「重复绘制 / 删除全部」，官方那条是进完整设置对话框；
> ③ 线宽面板仍是 1/2/4/8 四档（官方是滑块）。


### 2.8.18 页面上的「光标」= 画布里的十字线（横线 / 灰阶 / 虚线节奏 / 轴标签）✅

> **你报的现象**：`docs/ref-user-crosshair-before.png`（262×284 的 2x 截屏）—— 画布上是一根
> **近黑的虚竖线**、配一根**浅灰的实横线**，和官网不是一回事。前几轮我把「光标」当成了左侧
> 工具组的下拉图标（2.8.15）和分组主按钮（2.8.16），这次说的是**鼠标在图上画出来的那个十字**。
>
> **真值从哪来**：REA 这次同样不可用（工具列表里没有、静态分析 `spawn EPERM`），改走
> 「headless Chrome + Playwright」：打开 `https://cn.tradingview.com/chart/?symbol=BTCUSDT`
> （1600×900、dpr=2、匿名可看），把鼠标移进绘图区，2x 截图后**逐像素扫线**
> （原图存 `docs/ref-tv-crosshair.png`）。测出来的东西：
>
> | 项 | 官方（设备像素 @2x → CSS） | 改前 | 改后 |
> | --- | --- | --- | --- |
> | 竖线 | 有，`rgb(156,156,156)`，2 设备 = **1px**，亮 10 / 暗 12 → **5 亮 6 暗** | 有，浅色下 `#131722`（近黑），4/4 | 同官方 |
> | 横线 | 有，**同色同节奏**，从左沿铺到右沿 | **根本没画**（截图里那条浅灰横线其实是水平网格线） | 有 |
> | 价格轴标签 | 42 设备 = **21 CSS** 高，底色 `rgb(15,15,15)`，白字，微圆角 | 18 高，`#787b86` 灰底 | 21 / `#0f0f0f` / 白 / r2 |
> | 时间轴标签 | ≈46 设备 = **23 CSS** 高，底色同上，带星期几 | 18 高，灰底 | 23 / `#0f0f0f` / 白 / r2 |
> | 时间标签内边距 | 左右各 ≈10（宽 = 文字宽 + 20） | 7 | 10 |
>
> **根因有四个，不是「颜色没调好」那么简单**：
> ① 浅色主题的 `cross` 写成了 `#131722` —— 那其实是**深色**主题标签底色的值，被当成线色用了
>   （白底上对比度 17:1，官方只有 2.7:1，所以看着又黑又硬）；
> ② 一个 `crossColor` 同时当「线色」和「标签底色」，而官方是**两个颜色**：线是中性灰、
>   标签是近黑块 —— 拆成 `crossColor` / `crossLabelColor` / `crossInkColor` 三项；
> ③ **横向那条线从来没画过**：`draw()` 里只调了 `drawCrosshairV()`。副图（`drawStudyPanes`）
>   里倒是有横线，但节奏和标签也是老值，主副图各画一套；
> ④ `equity.ts`（权益曲线）复制了同一份旧代码 —— 顺着一起改，否则那把 cross 改成浅灰后，
>   它的轴标签会变成「浅灰底 + 白字」直接看不见。
>
> **断言**：新增 `tests/crosshair.test.ts` **24 条** —— 官方测量常量（`CROSS_DASH = [5,6]`、
> 标签块高 21/23、内边距 10）；两套主题三色；线色 R=G=B（不能带蓝调）、浅色线对比度落在
> 2.2~3.2、深色 ≥ 3、标签底色 ≠ 线色、标签字对比度 ≥ 4.5；`crossPriceLabelRect` /
> `crossTimeLabelRect` 的居中与**贴边回顶**；`fillRoundRect` 的圆角/退化/不动 save 栈；
> 以及用「假 this + 记录型 ctx」直接调 `drawCrosshairV` / `drawCrosshairH`：两条线都
> `setLineDash([5,6])`、颜色取主题、竖线 y 从 plot.t 到 plot.b、横线 x 从 plot.l 到 plot.r、
> 鼠标在绘图区外（上下轴、y<0、pointer=null）**不画横线**、深色换色。vitest 725 → **749**。
>
> **headless 实测**（本地 dev server + Playwright，dpr=2，浅色/深色各一遍）：竖线列
> 672/673（2 设备像素），亮段 10、暗段 12，与官方**逐值相等**；横线行 774/775 同节奏；
> 价格标签块 42 设备 = 21 CSS、宽 124 设备 = 62（= axisWidth-4）；时间标签块 46 设备 = 23 CSS；
> 深色线 `rgb(121,121,121)`、标签块 `rgb(61,61,61)`；两套主题 console 无报错。
> 截图：`docs/shot-crosshair-compare.png`（左官方 / 右本地，交点·价格标签·时间标签三行对照）、
> `shot-crosshair-aligned-light.png`、`shot-crosshair-aligned-dark.png`。
>
> **诚实边界**：① 深色的 `#797979` / `#3d3d3d` 取自**同一套调色板**的 widget dark 主题
> （站点深色主题要登录态才能切，匿名拿不到），属于同源推断而非站点直测；
> ② 官方价格标签左侧还有一个「+」按钮（设置 → 坐标和线条 → 价格标签和价格线 → 加号按钮），
> 以及轴数字带千分位，我们都没做 —— 那是坐标格式的事，不属于十字线；
> ③ 时间标签的文案取舍仍按**可见跨度**（≤75 天带时分、>400 天只到月），官方按**周期**算，
> 所以日线半年视图我们是「周五 08/10」、官方是「周五 2026-08-10」；
> ④ 只在主图/副图里画，价格轴自己那块条带不画线（官方也不画，靠标签）。


### 2.8.19 显示范围条改成中文（1天 / 1个月 / 全部）✅

> **你给的图**：`docs/ref-tv-rangebar-zh.png`（官方中文版那一行：`1天 5天 1个月 3个月 6个月 YTD
> 1年 5年 全部 | 📅`），我们那行还是 `1D 7D 1M 3M 6M YTD 1Y 5Y | ALL`。
>
> **改法（只动文案，不动语义）**：`RANGES` 里 `label` 全部换中文，**`key` 一个都没动**
> —— `key` 被 `setRange` / 布局存档 / Agent 工具参数（`chartControls.knownRanges`、
> `providers/mock.ts` 的 `RANGE_RE`）引用，动了就是连锁破坏。
>
> | key | 改前 label | 改后 label |
> | --- | --- | --- |
> | 1D / 7D | 1D / 7D | 1天 / 7天 |
> | 1M / 3M / 6M | 1M / 3M / 6M | 1个月 / 3个月 / 6个月 |
> | YTD | YTD | YTD（官方中文版也没翻） |
> | 1Y / 5Y / ALL | 1Y / 5Y / ALL | 1年 / 5年 / 全部 |
>
> 字号 12 → **13px**：汉字比同字号英文「满」，12px 下的 1天/个月 偏小发虚；
> 13 与本应用顶栏一致（官方那一行是 14px，我们是 13px 基准的紧凑版）。逐像素核对：
> 官方汉字墨高 24 设备 = 12 CSS（≈14px 字），我们是 20 设备 = 10 CSS（12px 字，改后 22 设备）。
>
> **断言**：新增 `tests/rangeLabels.test.ts` **11 条** —— key 与顺序不变；label 逐项等于官方中文；
> 除 YTD 外每项都含汉字、都不含拉丁字母；文案唯一；毫秒跨度没被文案带偏（1D=1 天…5Y=1825 天）；
> 数字与 key 对得上（1D→1天、6M→6个月）；单位词用对（天 / 个月 / 年）。vitest 749 → **760**。
> 截图：`docs/shot-rangebar-zh.png`、`shot-rangebar-zh-compare.png`（同 2x 设备像素不缩放对照）。
>
> **诚实边界**：① 官方第二项是「**5天**」（5 个交易日），我们这条的内部跨度就是 **7 天**，
> 文案如实写「7天」而不是抄成 5天 —— 要变成 5 天得改 `rangeMatch` / Agent 提示词 / README，
> 属于改语义，等你一句话；② 官方「全部」右边还有一个「📅 日历区间」按钮，我们没有；
> 它的分隔线在「全部」右侧（因为要跟日历按钮隔开），我们仍在「5年 | 全部」之间。


### 2.8.20 左侧绘图工具栏「直接穿到底」✅

> **你的口径**：`左侧栏为直接穿到底` —— 底部范围条不许从绘图工具栏下面横过去，
> 左栏要一直贯到窗口底部（官方就是这样：左栏和底部的范围/时间行是左右并列，不是上下叠）。
>
> **改前结构**（`ChartWorkspace.tsx`）：
> `ws-main ─ TopBar / ws-middle ─ [DrawToolbar | ws-grid] / RangeBar`
> —— `ws-middle` 只有 `flex: 1; min-height: 0`，左栏高度止步于**范围条上沿**（y=868），
> 范围条从 x=0 横贯到 x=1084，视觉上把左栏「切断」了。
>
> **改后结构**：`ws-main ─ TopBar / ws-body ─ [DrawToolbar | ws-stack ─ [ws-grid / RangeBar]]`
> - `.ws-body { flex: 1; min-height: 0; display: flex }` —— 左栏与右列在同一行，撑满顶栏以下到窗口底；
> - `.ws-stack { flex: 1; min-width: 0; min-height: 0; flex-direction: column }` —— 图表在上、范围条在下；
> - `.ws-grid` 补 `min-height: 0`（纵向 flex 里不补就会把范围条挤出屏幕）；
> - 老类名 `.ws-middle` **整条删掉**（不留死结构）。
>
> **第二刀：底部那条灰带**（你补充的「删除下面栏位，不要留灰色了」）。穿到底之后才发现：
> `.kc-sidebar` 的底色是 `--kcs-base`（浅色 `#ebebeb`），而每一段工具是 `--kcs-card`（白）——
> 工具排完之后的空白段就把那层灰底露出来了（实测左下角 `rgb(235,235,235)`，官方左栏是纯白
> `rgb(255,255,255)`）。改两处：
> ① `.kc-sidebar` 背景 `--kcs-base` → `--kcs-card`（整列一块白 / 深色下是页面底色，
>   `--kcs-rule` 单独当分隔线色）；② 渲染时**最后一段后面不再补分隔线**（那条线下面是空的，
>   穿到底之后就是一条悬空灰线）。改后实测左下角：浅色 `rgb(255,255,255)`、深色 `rgb(15,18,22)`，
>   与页面同色；左栏右边线仍是 `#e6e8eb` / `#242c36` 的 1px，一直画到窗口底。
>
> **headless 实测**（1440×900，dpr=2，浅色/深色各一遍）：
> `.draw-toolbar` = `x0 y39 w53 h861 bottom 900`（= 视口高，真穿到底）；
> `.rangebar` = `x53 y868 w1031 h32`（贴着左栏右沿起，不再盖住左栏）；两套主题 console 无报错。
> 截图：`docs/shot-rail-fullheight-light.png` / `-dark.png`、`shot-rail-bottom-corner.png`。
>
> **断言**：新增 `tests/layoutRail.test.ts` **11 条** —— 把 JSX 与 CSS 当文本读，钉住
> ① `ws-body` 里 `DrawToolbar` 与 `ws-stack` 是兄弟、`RangeBar` 在 `ws-stack` 内（图表块之后）；
> ② `ws-middle` 在两边都无残留；③ `.ws-body` 有 `flex:1 + min-height:0 + display:flex` 且不对齐到顶；
> ④ `.ws-stack` 纵向 + 可收缩；⑤ `.ws-grid` 有 `min-height: 0`；⑥ `.draw-toolbar` 仍是 52px + 右边线、
> 自己不定高（定高就穿不到底）；⑦ `.rangebar` 仍 32 高 + 上边线；⑧ 范围按钮 13px；⑨ 左栏底色走 `--kcs-card`（不是轨道灰）、
> 分隔线走 `--kcs-rule`；⑩ 末段不再补分隔线。vitest 760 → **771**。
>
> **诚实边界**：左栏内容（15 颗按钮 + 分隔线）仍是**顶部对齐**，穿到底之后下方是一段空白 ——
> 官方也一样（它的工具也是从顶栏下沿开始往下排），区别是现在这段空白与页面同色、看不出「块」。
> 另外逐条量了官方左栏的分隔线位置：官方只有 **3 条**（图标之后 / 放大之后 / 移除之前），
> 我们有 **6 条**（多出十字线后、斐波那契后、文字后；末段那条悬空线这次已经删掉）。
> 多出来的 3 条要不要一并按官方砍掉，说一声就改 —— 那是视觉约定，不算 bug，所以没擅自动。


### 2.8.21 页面上的「光标类型」：圆点 / 箭头 / 荧光笔 / 橡皮擦 各自一套 ✅

> **你给的四张图**（`docs/ref-tv-cursor-*.png`）：左栏选完某个光标工具后，**鼠标在图上长什么样** ——
> ① 箭头 = 普通系统箭头（而且**连十字线都不画**）；② 圆点 = 一个小黑点；③ 荧光笔 = 箭头 + 一圈粉色光晕；
> ④ 橡皮擦 = 橡皮图标 + 同一个粉色光晕。我们改前**四个全是 `crosshair`**（只有橡皮擦例外）。
>
> **真值不是猜的**：同一台 headless Chrome 打开 `cn.tradingview.com/chart/?symbol=BTCUSDT`，
> 逐个工具点开 → 读 `getComputedStyle(canvas).cursor`；再让指针停在同一点截两张图（有 / 无光晕）
> **逐像素作差**，按合成方程 `over = C·a + base·(1-a)` 反解光晕的 alpha 与原色：
>
> | 工具 | 官方 CSS cursor | 官方还画什么 | 我们改前 | 我们改后 |
> | --- | --- | --- | --- | --- |
> | 十字线 | `crosshair` | 十字线 | 同 | 同 |
> | 圆点 | `url(dot.3d617b6b01edba83a7f4.cur), default`（32×32，热点 **11,11**） | 十字线 | `crosshair` ❌ | `DOT_CURSOR`（同热点 11 11） |
> | 箭头 | `default` | **什么都不画** | `crosshair` ❌ | `default` |
> | 荧光笔 | `default` | 十字线 + 光晕 | `crosshair` ❌ | `default` + 光晕 |
> | 橡皮擦 | `url(eraser.c80610a04a92d2465b03.cur), default`（热点 **5,5**） | 十字线 + 光晕 | 有图标、没光晕 | 图标 + 光晕 |
>
> **光晕**（官方两张截图逐字节相同，所以荧光笔和橡皮擦是同一个）：外接框 76 设备像素 @dpr2 =
> **半径 18 CSS**、色 **rgba(242,54,69,0.25)**（原色正好是 TradingView 的红 `#f23645`）；
> 它压在十字线**之上**（虚线穿过光晕会发红）。圆点 / 箭头 / 十字线都没有光晕。
>
> **改法**：
> ① `draw.ts` 新增 `DOT_CURSOR`（32×32 SVG：#353535 实心点 r2.7 + 80% 白边 r4.4，热点 `11 11`），
>    `ERASER_CURSOR` 按官方位图重画（细长斜条 `(6,20)→(22,5)`、宽 7.4、深色一截 + 白身 + 1.4px「+」热点标记，
>    热点 `5 5` 没动）；
> ② 纯函数 `cursorForTool(tool)`（`null` = 交回命中判定）与 `hasCursorHalo(tool)`，
>    `cursorForHit()` 先问工具级、再问命中 —— 所以圆点工具压在图形上也不会变 `move`；
> ③ 光晕 `renderCursorHalo(ctx, pt)` **不进 `render()`**：`KChart` 新增 `onOverlay(ctx, pointer)` 钩子，
>    在 `drawCrosshairV/H` **之后**、裁剪区内调用（指针位置由图表给，外部图层不用自己记、也不会记过期）；
> ④ `ChartGridView` 把 `onOverlay` 接到 `renderCursorHalo`。
>
> **断言**：新增 `tests/cursorTypes.test.ts` **19 条** —— 两个光标的热点分别是 11,11 / 5,5（对准官方
> ICONDIRENTRY）且不是同一个字符串；五个工具 → 五个 CSS 值；其它绘图工具仍 `crosshair`；
> 只有荧光笔 / 橡皮擦 `hasCursorHalo`；`cursorAt` 与 `cursorForTool` 同表（含「圆点压在图形上仍是圆点」）；
> 光晕 r18 / 原色 `#f23645` / alpha 0.25；画不画（工具 × 指针是否在绘图区内 × 是否为 null）；
> 以及 `chart.ts` 里 `onDraw → drawCrosshairV → drawCrosshairH → onOverlay` 的**先后顺序**（源码序断言）。
> vitest 771 → **790**。
>
> **headless 实测**（1440×900，dpr=2）：五个工具读到的 cursor 依次是
> `crosshair` / `<data-uri> 11 11, crosshair` / `default` / `default` / `<data-uri> 5 5, crosshair`，
> 与官方逐项相同；光晕在浅色下的混合结果与官方同值（白底 `rgb(252,205,208)`）。
> 截图：`docs/shot-cursor-types-compare.png`（左官方右本地）、`docs/shot-cursor-glyphs.png`（.cur 位图 vs 我们的 SVG，放大 6 倍）。
>
> **诚实边界**：
> ① 我们复刻的是**造型**不是位图：圆点 2.7/4.4 与橡皮那条 7.4 宽的斜条是按官方 32×32 像素表描的，放大 6 倍看
>    仍有 1px 级差异；官方 `.cur` 是二进制 Win 光标，没有搬进仓库（`url()` 里是 `data:image/svg+xml`）。
> ② 官方的**箭头工具是纯光标模式**（不画图、不出十字线）；我们这颗 `箭头` 到现在仍是「画箭头」的绘图工具，
>    所以它**保留十字线**（不然两点定位看不见），这是语义差异不是样式差异 —— 要不要改成纯光标模式，
>    涉及给它一个独立的工具 key（`箭头` 这个标签在趋势线组、形状组里也用到），你说一声我再动。
> ③ 我们的**竖十字线吸附到 bar 中心**，官方是跟着指针连续走；所以光晕（在指针上）可能比竖线偏半根 K 线。
> 光晕不能挪到吸附位置上 —— 橡皮擦是按原始指针命中，挪了就骗人。
> ④ 深色主题下光晕用的是同一个 `rgba(242,54,69,.25)`（官方深色页要登录才切得动，没量到，属同源推断）。

### 2.8.22 默认缩放 = 最近 200 根（打开 / 换标的 / 换周期都回到它）✅

> **你的口径**：「每次最好展示最近 200 根 bar，默认时缩放」。
> 改前 `KChart` 构造函数与 `setBars` 都写死 `showLast(180)`：打开是 180 根，换标的 / 换周期也回到 180 根 ——
> 比官方（打开时约 200 根）少一段上下文。
>
> **改法**：
> ① `chart.ts` 新增导出常量 `DEFAULT_VISIBLE_BARS = 200`（**唯一出处**，别再散着写数字）；
> ② 视口逻辑拆成三个：`applyShowLast(k)`（只改视口）、`applyDefaultView()`（= applyShowLast(200) + `autoView = true`）、
>    `showLast(k)`（= applyShowLast(k) + `autoView = false`）。构造函数与 `setBars` 都走 `applyDefaultView()` ——
>    「换标的 / 换周期 / 换布局新建格」天然都是 200 根；
> ③ **根数精确**：barW 没被 1px / 60px 夹住时直接令 `from = n - 200`，而不是 `from = n - plot.w / barW` ——
>    后者是浮点，差 1e-13 就会让 `visible()` 数出 199 或 201 根；
> ④ `autoView`（还停在默认视图上）：`resize()` 时若仍为 true，就按 200 根重算 barW ——
>    建图那一刻画布宽度可能还没定（栅格/布局刚插进 DOM），不留这个自愈，会带着一个按临时宽度算出来的 barW 一直用下去；
>    用户一**缩放 / 平移 / 点范围 / 联动 revealSpan** 就置 false，之后 resize 只夹边、不再把视口拉回去。
>
> **headless 实测**（1440×900，dpr=2，`window.__app.getGrid()`）：
> 打开 `[{tf:30m, n:780, visCount:200, barW:2.245}, {tf:1D, n:1000, visCount:200}]`，两格右端都贴住最新一根；
> 切 15m → 200；手动滚轮缩到 92 根 → 换标的 NVDA → **回到 200**；窗口 1440→1680 → barW 2.245→2.845，
> 仍是 200（`autoView` 自愈）；刷新后又 200；console 无报错。
> 截图：`docs/shot-default-200-bars.png`（TSLA 30m + 1D，两格各 200 根）。
>
> **断言**：新增 `tests/defaultView.test.ts` **8 条** —— 常量 = 200；构造函数与 `setBars` 都调 `applyDefaultView`
> 且 `chart.ts` 里不再有 `showLast(180)`；800px 视口下 `from = n-200`、可见**恰好** 200 根；
> 7 种宽度（449/600/733/800/1000/1277/1441）都数出整 200 根；数据不足 200 → 全显示且第一根可见；
> 视口窄于 200px（4×4 布局）→ barW 触 1px 下限、仍然靠右；`autoView` 在 applyDefaultView / showLast /
> fitContent / zoomAt / revealSpan 下的取值；以及 resize 语义（宽度 300→900 后仍是 200 根，缩放过后 barW 不被改）。
> vitest 790 → **798**。
>
> **顺手修的两条「一直假红」**（改前 HEAD 上就红，与本轮无关，但既然碰上了）：
> ① `chart.ts` 自检「面积：线下方有渐变填充」原来是**单点**取样，那个点偶尔正落在网格线 / 均线上（两种样式在那里
>   颜色一样）→ 改成取线下方 6×8 css 的一块，比对「两图之间变了的像素 ≥ 8」；
> ② `styleTest.ts` 的 `hi` 直接取 `visible()[1]`，会把右端**半根**柱子算进「可见」（它的中心已经跑到价格轴外
>   `xCenter(i) > plot.r`）→ 改成按 `xCenter(i) <= plot.r - 6` 收缩；「带标记线圆点是实心」也从单点 `(x+3, y)`
>   改成 5×5 里数紫点 ≥ 8（折线本身穿过圆心，单点会被线色盖住）。
> 改后浏览器侧自检全绿：图表 **77** / 样式 **52** / 网格 20 / 权益 39 / 统计 50 / 指标 31 / 绘图 134，0 FAIL。
>
> **诚实边界**：
> ① 200 根是**根数**口径，不是跨度口径 —— 底部范围条的高亮仍按视口覆盖的**日历跨度**反推，
>    所以 30m 周期下 200 根（约 18 个自然日）会高亮「1个月」。这是反推规则的粗糙处，本轮没动；
> ② 小格子（4×4 布局，绘图区不到 200px）物理上装不下 200 根，barW 触 1px 下限后只能显示绘图区宽度那么多根，
>    但**右端仍对齐最新一根**（宁丢最老的一段，也不让最新价出屏，与 `setRange` 的夹紧哲学一致）；
> ③ 窗口变宽时我们保持「200 根」（barW 变宽），官方保持「bar 间距」（根数变多）—— 这是口径差异，为的是「默认就是 200 根」；
> ④ `equity.ts`（权益曲线，暂无 UI 入口）里的 `showLast(180)` 没动。

### 2.8.23 「趋势工具」下拉逐项对齐线上 TradingView（17 项 / 三组 / 图标逐字符）✅

> **你的口径**：「这块功能还是需要一一对齐一下。建议与官网用 rea 进行获取与开发」。REA 这个会话里仍然不可用，
> 改用 **Playwright 打开 cn.tradingview.com 匿名图表**（登录态都不用），点开左栏那颗趋势按钮的小箭头，
> 把下拉里 20 行（3 个分组标题 + 17 个工具）的 `[role="row"]` 全导出来：标签、顺序、`aria-keyshortcuts`、
> 行内 `<svg>`、`getComputedStyle` 度量，全部落进 `tests/fixtures/tv-trend-menu.json`。量到的官方结构是：
>
> | 组 | 条目 |
> | --- | --- |
> | 线 | 趋势线 ⌥T / 射线 / 信息线 / 延长线 / 趋势角度 / 水平线 ⌥H / 水平射线 ⌥J / 垂直线 ⌥V / 横线 ⌥C |
> | 通道 | 平行通道 / 回归趋势 / 平顶·平底 / 不相交通道 |
> | 分叉线 | 分叉线 / 希夫干草叉 / 改良希夫干草叉 / 内部分叉线 |
>
> 我们原来那份是「设计稿版」：线 5 项 + 一条无名分隔 + 水平 4 项 + 「箭头 / 平行通道」收尾，
> 一共 11 项，还多了官方没有的「箭头」（官方把箭头放在标注组）。
>
> **改法**：
> ① 菜单结构按官方重排成三组 17 项（`sidebar.ts` 的 `SECTIONS`），组标题「线 / 通道 / 分叉线」；
> ② 17 个图标全部换成官方 SVG 原文（`sidebar-icons.ts`）—— 原来那 8 个是手绘的「圆点 + 斜线」，
>    形状根本不是同一批图；连主图标 `TRENDLINE` 也换成官方那份（原来多了几处无意义的空格，逐字符比会红）；
> ③ 度量：菜单 **224** 宽（「光标」那份仍是 244，挂在各自 `ToolDef.menuWidth` 上，不再写死一条 `min-width`）、
>    行 40 高 / `2px 4px` 内边距 / 圆角 6、分组标题 24 高 / 11px / 字距 .4 / 左缩进 8 / 组间空 13、
>    快捷键 12px #707070 且与星星隔 8px、悬停底色 #f2f2f2、字体栈换成官方那串（不再跟着 app 的 Inter）；
> ④ 「信息线」的问号徽标与每行右侧的收藏星都改成**悬停才出现**（官方是 `showOnHover`），
>    徽标换成官方 18×18 问号（原来是我们自己画的「灰底 i」）；
> ⑤ 选中态只跟**全局当前工具**走：原来按「这颗按钮上次派发的工具」标，光标模式下打开下拉，
>    趋势线那一行也会被染成深底 —— 官方只在真正选中时才是深底白字；
> ⑥ 新增 3 个真正能画的工具：`regression`（两锚点圈区间，对收盘价做一元最小二乘，画中线 + 两侧 ±1σ）、
>    `flat`（平顶·平底，取区间最高 high / 最低 low 画一条水平线）、`disjoint`（不相交通道，两条关于首锚镜像的斜线）；
>    分叉线那 4 项不另起几何，直接复用已有的 `pitchforkRays()`（`pitchfork` / `schiff` / `schiff2` / `innerfork`）。
>    回归趋势同时补了官方默认属性映射 `regressiontrend`（`flat` / `disjoint` 在快照里没有同名键，落回蓝默认，
>    不硬编一个官方不存在的名字）。
>
> **headless 实测**（1440×900，dpr=2，`setLayoutId('1-1')`）：
> 菜单盒子 **224×790**、20 行相对位置与官方**逐行相等**（6 / 30 / 70 / … / 350 / **403** / 427 / … / 547 / **600** / 624 / … / 744）；
> 行内度量：图标 28×28、文字左边缘 x=96（官方 95，差的 1px 是菜单整体 x 54 vs 53）、快捷键右接星星前留 8px；
> 悬停「信息线」→ 底色 rgb(242,242,242)、圆角 6、问号 18×18 与星星 24×24 同时 `opacity:1`；
> 四个新工具各点两/三下都能落图形（`__app.drawingCount()` 1→2→3→4），console 0 报错。
> 截图：`docs/shot-trend-menu-compare.png`（官方 / 我们并排）、`docs/shot-trend-menu.png`、
> `docs/shot-trend-menu-dark.png`、`docs/shot-trend-new-tools.png`（四种新图形画在 TSLA 30m 上）。
>
> **断言**：新增 `tests/trendMenu.test.ts` **31 条** —— 三组 17 项与官方同名同序；「箭头」不在本组但标注组仍在；
> 快捷键 5 条逐项等于官方（含空格）；信息线带 info 徽标；**17 个图标逐字符等于 fixture**（含 28×28 视框）；
> 菜单 224 / 行 40 与 `2px 4px` / 分组标题 24·11·.4·8 / 组间 13 / 快捷键 12px；17 项都能 `toolKeyForLabel` 到
> 有锚点数的真实工具；分叉线四项映射到已有 key；`linreg` 的三条（完美直线 / 正交噪声 / 空与单点）。
> vitest 798 → **829**（30 个文件全绿），`tsc` 0 错；浏览器自检 图表 77 / 样式 52 / 网格 20 / 权益 39 / 统计 50 /
> 指标 31 / 绘图 134，**0 FAIL**。
>
> **诚实边界**：
> ① 官方菜单顶部那行灰块是**按钮 tooltip**（「趋势工具」），不是选中态；截图里它是 Playwright 悬停残留，我们没做；
> ② 「回归趋势」的 ±1σ 带是按**收盘价**拟合的简化口径，官方还带 R² 标签与可拖拽的带宽手柄，本轮没做；
> ③ 「平顶/平底」只画一条水平线（官方会区分 top/bottom 两条并允许拖拽），「不相交通道」用首锚镜像出第二条线，
>    与官方三点式构造可能不完全一致 —— 这两项目前是「能用、形状对」，细节待后续抓官方绘制结果再校；
> ④ 分组标题 11px / 字距 .4 是官方浅色值；深色主题官方要登录才切得动，我们沿用自己的 `--kcs-menu-meta`。



| 2.9 | 布局存档（localStorage / 服务端） | ⬜ | 小 | 存/读往返一致，含视口、通道开关、绘图、联动开关 |
| 2.10 | 手机端手势：双指缩放、惯性滑动 | ⬜ | 中 | 真机或 Chrome 设备模拟下截图 + 手势日志 |
| 2.12 | **接入 DeepSeek harness** | ⬜ | 中 | 实现 `providers/deepseek.ts` 的 `send()`；用真实 harness 跑通「文本 → 工具调用 → 结果回灌 → 总结」；工具参数校验失败时模型能看到错误并自我修正；密钥由服务端持有，不进前端包 |
| 2.13 | Pine 编辑器 / 权益曲线 / 统计组件的 UI 入口 | ⬜ | 中 | 在三栏里找到位置（右侧图标栏的 Pine Editor、Strategies 页的权益曲线与统计）；引擎自检不回归 |
| 2.14 | 真实行情数据源（替换 `mockBars.ts`） | ⬜ | 中 | 同 2.7；另外要覆盖 `1m~4h` 日内周期与交易时段（RTH/ETH 按钮现在只是个开关） |
| 2.15 | PaperTrade 接入权益曲线 / 图上标记 | ⬜ | 小 | 下单后图上出现成交标记；持仓口径沿用 `paperAccount.ts`（含反手），不变式测试保留 |
| 2.16 | Agent 工具扩充 | ⬜ | 小 | 绘图（画趋势线/水平线）、加 MA/通道参数、读取当前图表状态；每个工具带参数校验与失败用例 |


### P3 — 价值待评估

| # | 事项 | 状态 | 说明 |
| --- | --- | --- | --- |
| 2.11 | 告警面板 | ✅ | 已完成：右栏「警报」面板（警报/日志 tab，行 = ticker•状态•时间，右键暂停/删除，+ 打开创建）+「创建警报」对话框（条件 价格/穿过/值、触发 仅一次/每次、到期时间、消息预览、通知 App/弹窗/声音 多选，全部下拉走统一 `ui/Select`）+ Alerts 页真数据表格。触发引擎在 `store/alertStore.ts`（条件由假变真才触发；只评估当前图表标的的最新价；模拟实时报价由 ChartGridView 每 2s 轻推活动格最后一根 bar）。16 条单测 + E2E 23 条 |
| 2.12 | i18n | ⬜ | 现在文案是中文硬编码 |

### ❌ 明确不做

| 事项 | 为什么 |
| --- | --- |
| **逐像素视觉对等** | 需要参考截图逐帧比，我没有也不打算声称有 |
| **79 种绘图工具全量** | 框架在了，剩下是内容工作量。全量是几个月，价值存疑 |
| **Pine 全兼容** | 理由见 README §12 开头：成熟的专用引擎都会在仓位计算上静默算错 |

---

## 3. Rust 移植计划

> ⚠️ **这一节是计划，不是代码。**
> 本机**没装 Rust**（`rustc` / `cargo` / `rustup` 都不在），所以我一行 Rust 都没写。
> 按 §0 的规矩，**没编译过的 Rust 不算完成** —— 而且未编译的 Rust 比未编译的 TS 更容易骗人，
> 因为借用检查器那一关光靠读是过不去的。

### 3.1 先回答四个问题，否则别动手

1. **目标是什么？**
   - (a) 浏览器图表更快 → 大概率**不该整体重写**，见 §3.7
   - (b) native 回测 / 给 Python 调用 → 全 Rust 是对的
   - (c) 多语言复用同一套核心 → 全 Rust 是对的，但边界设计要更谨慎
   - (d) 学 Rust → 从 `kpine` 开始，别从渲染开始
2. **最终跑在哪？** WASM / native / 两者都要？（影响能否用 `std`、能否用线程）
3. **现有 TS 版怎么办？** 替换 / 并存 / 只搬一部分？
4. **有没有性能基线？** 没有就先量（R0）。**「感觉慢」不是重写的理由。**

### 3.2 边界怎么切（最关键的一段）

**不能整个搬。** 按「碰不碰 DOM」和「是否逐点过边界」切：

| 搬去 Rust | 留在 JS |
| --- | --- |
| 数据模型（bars / series）、`resample` | canvas 2D 绘制调用 |
| 视口 / 刻度数学（`xOf`/`iOf`/`yOf`/`niceStep`） | DOM、事件、布局、CSS |
| 指标计算（MA/BOLL/RSI/MACD/ATR…） | 文本排版、字体、CJK |
| 命中检测（绘图工具、十字光标） | 圆角气泡、图例那些"手工像素活" |
| **Pine 引擎**（词法/语法/运行时/内置） | |
| 统计（直方图分箱、盈亏分组、季节性日序） | |
| **几何生成**（产出 typed array，给 JS 画） | |

**核心约束：数据必须批量过边界，不能逐 bar / 逐点过。**
WASM ↔ JS 每次调用有固定开销（纳秒级到微秒级），
一个「每根 bar 过一次边界」的朴素实现会**比纯 JS 还慢**。
这是 WASM 移植最常见的翻车方式，R3 的判据专门盯它。

### 3.3 计划中的 crate 结构

```
kchart/                      cargo workspace
├── crates/
│   ├── kcore/               纯计算。不依赖 DOM、不依赖 wasm。
│   │                        数据模型 / 视口 / 刻度 / 指标 / resample / 统计
│   ├── kpine/               Pine 引擎，依赖 kcore
│   ├── kwasm/               wasm-bindgen 绑定，依赖 kcore + kpine
│   └── kcli/                native 回测 CLI，依赖 kpine
├── tests/                   跨 crate 的集成测试 + 与 TS 版的逐值对齐脚本
└── docs/
```

关键 crate：

- `wasm-bindgen` / `js-sys` / `web-sys` —— WASM 绑定
- `serde` + `serde-wasm-bindgen` —— 配置/结果的结构化传递
- `wasm-pack` —— 打包
- `criterion` —— native 基准（R0/R1 用）

### 3.4 四个必须在动手前定下来的设计决定

**① 内存所有权 —— 这次移植真正难的地方，不是语法。**

TS 版里 `chart.bars` 被 chart / grid / draw / pine / equity 到处直接引用。
到 Rust 里这是借用检查器的噩梦。必须改成**索引化 + 集中持有**：

```rust
// 数据由 store 独占持有，别处只持 id 和区间
pub struct DataStore { series: Vec<Vec<Bar>> }
pub struct SeriesId(u32);

// 或者共享不可变：Arc<[Bar]>，视图只存索引
```

指标同理：各指标产出 `Vec<Option<f64>>`，由 `IndicatorStore` 持有，外部拿句柄。

> **这意味着 Rust 版不是 TS 版的转写，而是数据模型的重设计。** 工期要按这个估。

**② 状态的键 —— Pine 引擎的 per-node state。**

TS 版用 `Map<AST节点, 状态>`。Rust 里不要用 `HashMap<NodeId, State>`（哈希开销），
用 `Vec<Option<State>>`，下标就是 `NodeId`（解析期给每个节点编号）。
`na` 用 `f64::NAN` 而不是 `Option<f64>`（省一半内存、快一倍），但要严格遵守 na 传播规则。

**③ 浮点一致性。**

两边都是 f64，但 `sin`/`exp`/`pow` 在 V8 和 Rust libm 上**末位可能差 1 ULP**。
所以跨实现比对必须**用容差**（建议 1e-9 相对误差），不要写「逐位相等」的断言 ——
那种断言会随机红，然后你就开始怀疑人生。

**④ 错误处理 —— 保持 TS 版的一条好习惯。**

TS 版里「未实现的 Pine 特性」会**明确抛错**，不会静默给 `na`。
Rust 侧用 `Result<T, PineError>` + 明确的错误枚举，**不要用 `unwrap_or(NAN)` 把错误吞掉**。
静默错误是这类代码最大的敌人（本项目已经吃过 4 次亏）。

### 3.5 分阶段，每阶段都有完成判据

#### R0 · 度量基线（不需要写 Rust）

- 内容：在 TS 版上量 10k / 100k / 500k 根 bar 的首帧时间、平移帧时间、指标重算时间；
  用 Chrome Performance 定位瓶颈（是绘制？是刻度计算？是 GC？）
- **完成判据**：拿到一页数字 + 明确指出瓶颈在哪个函数。
  **如果瓶颈是绘制而不是计算，那 Rust 帮不上多少忙 —— 这时候应该先考虑 WebGL。**
- 成本：半天

#### R1 · `kcore`（纯计算）

- 内容：`Bar` / `DataStore` / 视口 / `nice_step` / `resample` / `sma·ema·rma·rsi·atr·bb·macd` /
  直方图分箱 / 盈亏分组 / `calendar_doy`
- **完成判据**：
  1. `cargo test` 全绿
  2. 把 TS 版**纯计算那部分**断言逐条搬过来（图表 48 条里属于纯计算的大约 20 条、
     权益 24 条、统计 30 条）
  3. 与 TS 输出**逐值对齐**（容差 1e-12），用同一个脚本跑两边
- 成本：1~2 周（含对齐脚本）

#### R2 · `kpine`（Pine 引擎）

- 内容：词法（缩进敏感）/ Pratt 语法 / 序列语义运行时 / 45 个内置 / plot 输出
- **完成判据**：
  1. `cargo test` 全绿
  2. TS 版 **49 条 Pine 断言**在 Rust 侧逐条通过
  3. 同一批脚本两边输出逐值一致（容差 1e-9）
  4. **`ta.ema` 的 SMA 播种方式仍未对参考实现核过** —— 这条限制照搬，别假装解决了
- 成本：2~3 周
- 备注：这是 Rust 收益最大、风险最低的一块。**如果只搬一块，搬这块。**
  远期优化：把 AST 解释改成字节码/闭包列表，1M bars 时才需要

#### R3 · `kwasm`（浏览器绑定）

- 内容：`wasm-bindgen` 绑定，typed array 批传
- **完成判据**：
  1. 浏览器里能加载 wasm，100k bars 首帧 / 平移帧时间**优于 R0 的 TS 基线**
  2. **跨边界次数有硬上限**：首屏 ≤ 5 次、一次平移 ≤ 2 次。
     在绑定层加计数器断言这条 —— 这是防「逐点过边界」的唯一有效手段
  3. wasm 体积有预算（建议 < 300 KB gzip）
- 成本：1~2 周

#### R4 · 渲染策略（三选一，建议先 A）

| 方案 | 做法 | 成本 | 备注 |
| --- | --- | --- | --- |
| **A** | Rust 算几何 → JS 画 | 低 | **建议先做这个**，风险最低，能立刻量出收益 |
| B | Rust + `web-sys` 直接画 canvas | 中 | 文本/字体/CJK 要重做，不划算 |
| C | Rust + `wgpu`/WebGL | 高 | 100k+ bars 才值得 |

- **完成判据（A）**：与现 TS 版**同数据同视口**下截图比对，像素差异可解释；
  帧时间优于 R0 基线

#### R5 · 并存与替换

- **完成判据**：TS 版**保留**为参考实现，两套输出一致性有自动化脚本盯着。
  半年后两边数字不一样时，能立刻知道是谁错了 —— 没有这个脚本，漂移是必然的

### 3.6 风险（诚实清单）

| 风险 | 后果 | 缓解 |
| --- | --- | --- |
| **跨边界成本吃掉收益** | 移植完比原来还慢 | R0 先量基线；R3 加跨边界计数断言 |
| **数据模型必须重设计** | 不是转写，工期超预期 | §3.4 先定所有权模型再动手 |
| **失去「双击 HTML 就能跑」** | 现在是这个库的卖点之一，WASM 需要构建步骤 + 加载 wasm | 保留 TS 版并存；或只在"大数据量模式"下用 wasm |
| **两套实现漂移** | 半年后数字对不上，不知道谁对 | R5 的一致性脚本是**必做项**，不是加分项 |
| **开发速度** | Rust 迭代比 TS 慢，前期难受 | 从纯计算 crate 开始（好测、改起来快） |
| **浮点末位差异** | 「逐位相等」断言随机红 | §3.4③ 用容差 |
| **canvas 文本/CJK** | 搬到 Rust 要重做 | 别搬绘制，文本留 JS |

### 3.7 我的建议

- **只要浏览器图表 → 别整体重写。** 只搬 `kpine` + 指标 + 统计这三块：
  纯计算、收益最大、风险最低，而且不碰渲染就不会破坏现有的 271 条断言。
- **要 native 回测 / 给 Python 用 → 全 Rust 是对的**，从 `kpine` 开始（无 DOM，收益最大）。
- **要学 Rust → 也从 `kpine` 开始**，别从渲染开始 —— 渲染会把你埋在 `web-sys` 的类型噪音里。

**不论选哪条，先做 R0。** 「感觉慢」不是重写的理由，量出来的瓶颈才是。

---

## 4. 需要你回答的问题

| # | 问题 | 影响 |
| --- | --- | --- |
| Q1 | Rust 的**目标**是什么？（a 浏览器更快 / b native 回测 / c 多语言复用 / d 学习） | 决定整个架构 |
| Q2 | 最终跑在 **WASM 还是 native**？ | 决定能否用 std/线程、决定绑定层设计 |
| Q3 | 现有 **TS 版是替换、并存还是只搬一部分**？ | 决定 R5 怎么做，也决定要不要维护两套 |
| Q4 | 有没有**性能基线**？现在哪一块让你觉得慢？ | 决定要不要做 R0，以及瓶颈判断 |
| Q5 | 参考图底部那条**色带到底是什么**？（见 §2.4） | ~~几行代码，但语义不能猜~~ 已定稿：持仓区间（TV 策略测试器口径），见 2.4 |
| Q6 | Magic Patterns 的**设计稿**怎么给我？（导出 HTML/JSX 最好，截图次之） | 卡着 P1 全部 |

---

## 5. 环境备忘

| 项 | 值 |
| --- | --- |
| Node | 20+（开发时用的是 Node 24） |
| 依赖 | `react` / `react-dom` / `zustand`（运行时）；`typescript` / `vite` / `vitest` / `@vitejs/plugin-react`（开发） |
| 类型检查 | `npm run typecheck` |
| 单测 | `npm test` |
| 浏览器验证 | 开发模式下 `window.__app`（`getGrid` / `chartStore` / `runBrowserSelfTests`）；E2E 用 puppeteer-core 驱动系统 Chrome（脚本未入库） |
| **Rust** | ❌ **未安装**（见第 3 节，移植计划不变） |

> `~/.gitconfig` 里如果配了本地代理（如 `http.proxy=127.0.0.1:7897`）而代理没开，`git clone` 会失败；`git -c http.proxy= -c https.proxy= ...` 可绕过。
