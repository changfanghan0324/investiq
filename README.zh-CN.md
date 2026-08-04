# InvestIQ — 投资研究与投资组合分析平台

**语言：** [English](README.md) | [简体中文](README.zh-CN.md)

[![CI](https://github.com/changfanghan0324/investiq/actions/workflows/ci.yml/badge.svg)](https://github.com/changfanghan0324/investiq/actions/workflows/ci.yml)

InvestIQ 是一个以证据为基础的美股研究平台，面向金融专业学生、初级股票研究分析师、资产管理实习生和自主投资者。平台的核心流程是：

> 公司基本面 → 情景估值 → 投资组合风险 → 投资备忘录

历史定期定额与复利计算器仍会保留，但它们只是辅助研究工具，不是平台的主要结论。

InvestIQ 不执行交易，不推荐证券，也不提供投资、法律或税务建议。任何模型估值都只是由明确假设产生的情景结果，不是目标价、预测或保证回报。

## 产品特点

- 先展示少量决策相关信息，需要时再展开详细数据、计算方法和来源。
- 公司财务数据来自 SEC EDGAR，并保留申报文件与 accession 证据。
- 估值模型将已报告事实、用户假设和模型结果明确分开。
- 投资组合分析使用共同交易日期，不填补缺失价格，也不混用回报口径。
- 支持英文和简体中文界面，以及四档文字大小。
- 核心金融计算是确定性的纯 TypeScript 函数，并由 Vitest 回归测试覆盖。
- 支持 CSV、浏览器打印 PDF 和 DCA 多页 PDF 导出。

## 主要页面

| 路径 | 工作区 | 功能 |
| --- | --- | --- |
| `/` | Research | 输入股票代码，进入公司、投资组合、市场和研究工具。 |
| `/company/[ticker]` | Company Summary | 展示公司身份、收入、营业利润率、自由现金流、价格风险和关键结论。 |
| `/company/[ticker]/financials` | Financial Analysis | 五年增长、盈利能力、现金流、财务健康、效率指标和申报来源。 |
| `/company/[ticker]/valuation` | Valuation | 五年 FCFF DCF、Bear/Base/Bull 情景、两组敏感性矩阵和可比公司估值。 |
| `/company/[ticker]/memo` | Investment Memo | 将公司概况、论点、催化剂、风险和估值结论整理成一页备忘录。 |
| `/company/[ticker]/report` | Equity Research Report | 可打印的中英文 A4 股票研究报告。 |
| `/case-study/aapl` | AAPL Case Study | 面向招聘审阅的稳定指南，说明证据模式与完整公司研究流程，不冻结市场数值。 |
| `/about` | About | 已核实的项目作者背景、产品边界与以证据为先的设计原则。 |
| `/compare` | Stock Comparison | 比较 2–5 只股票的累计回报、风险、Beta 和相关性，并导出 CSV。 |
| `/portfolio` | Portfolio Lab | 分析 1–10 只多头持仓的回报、风险、归因、集中度、相关性和再平衡情景。 |
| `/market` | Market Context | 市场 ETF 代理指标和仅保存在浏览器中的 watchlist。 |
| `/tools` | Research Tools | 辅助计算工具入口。 |
| `/tools/dca` | Historical DCA | 支持 1–10 个唯一持仓的定期投入、股息、费用、税务情景、交易流水和 PDF 报告。 |
| `/methodology` | Methodology | 数据口径、公式、假设、限制与来源。 |

旧路径 `/stock` 会跳转到 `/company/AAPL`，`/dca` 会跳转到 `/tools/dca`。

## 技术架构

```text
浏览器界面（研究、公司、比较、投资组合、工具）
  ├─ GET /api/fundamentals
  │    └─ SEC EDGAR submissions 与 XBRL companyfacts
  ├─ POST /api/market-data
  │    ├─ Yahoo Finance：拆股调整后的日线 OHLC 与价格历史
  │    └─ Massive：DCA 股息与拆股交叉验证
  ├─ 纯 TypeScript 财务、DCF、投资组合与回测引擎
  ├─ POST /api/assistant
  │    └─ Google Gemini：仅根据报告内容生成教育性解释
  ├─ Drizzle → Neon PostgreSQL
  └─ GET /api/health：公开能力状态，不执行实时数据库查询
```

主要技术：Next.js 16、React 19、严格 TypeScript、Vitest、Drizzle ORM、Neon PostgreSQL。

Python/FastAPI 暂缓引入；只有当优化、批量 ETL 或独立分析服务确实需要第二个运行环境时才增加，避免不必要的系统复杂度。

## 数据与计算原则

### 市场数据

- 当前只支持美国交易所上市、美元计价的普通股和 ETF。
- OTC 证券和指数代码不属于 DCA 支持范围，并返回明确错误，而不是“服务器繁忙”。
- 股票代码只允许 `A-Z`、`0-9`、`.` 和 `-`，长度为 1–12 个字符。
- 历史价格使用拆股调整后的 OHLC；普通股息不会嵌入价格，而是在 DCA 中单独处理。
- 分析页面只有在所有证券及 benchmark 都具备完整 adjusted-close 覆盖时才使用总回报代理，否则所有证券统一使用价格回报。
- 只使用已完成的美国常规交易时段日线。未来日期不会进入历史结果。
- 多股票请求依照页面顺序逐一读取，避免单一会话瞬间产生大量上游请求。
- 已知但无法可靠处理的公司行动会停止计算，不会静默估算。

### 公司基本面

- 来源为 SEC `submissions` 与 XBRL `companyfacts`。
- 年度数据只接受符合规则的 10-K、10-K/A 或 20-F。
- 数据按真实经济期间选择，而不是盲目使用文件中的 `fy` 标签。
- 后续重述数据优先，并为每个值保留 filing accession。
- 缺失项目不会被当成零；无法可靠计算的指标显示为 unavailable。
- 金融企业会启用专门的比率限制，避免套用不适合银行或保险公司的工业企业公式。

### 风险与绩效

- 一年按 252 个交易日进行波动率、Sharpe 与 Sortino 年化；CAGR 使用 365.25 个日历日。
- 波动率、Sharpe、Sortino、Beta、Alpha、VaR 和相关性至少需要 60 个对齐日回报；不足时不返回伪造的 `0`。
- 最大回撤为历史高点到后续低点的最大跌幅，并保留 peak、trough 与 recovery 日期。
- 历史 VaR 是经验分位数损失阈值，不是最坏损失上限。
- 投资组合比较使用所有证券交易日期的严格交集，不进行向前填充。
- 主要投资组合结果为一次性买入并持有；季度与年度再平衡只作为单独、零摩擦的历史情景。
- 风险解释只帮助用户理解历史数字，不产生买入、卖出或目标权重建议。

### DCF 估值

- 使用 unlevered FCFF：Revenue → EBIT → NOPAT + D&A − CapEx − ΔNWC。
- 必须满足 `WACC > terminal growth rate`。
- Enterprise Value 通过明确的净债务和稀释后股数转换为 Equity Value 与 implied share price。
- 市场价格不会进入 DCF 计算，只用于有日期标记的结果比较。
- Bear、Base、Bull 与敏感性表都会重新运行完整模型。
- 可比公司倍数必须由用户提供并注明来源；平台不会编造 peers 或行业中位数。

### DCA 回测

- Day 表示有效交易日；Week、Month、Year 从原始开始日期推进，非交易日顺延至下一个有效交易日。
- 每次买入使用执行日拆股调整后的最高价，期末持仓使用最后交易日收盘价。
- 支持美元金额或股数订单，零股一律向下截断至小数点后 3 位。
- 股息根据除息日持仓确认，并在支付日或下一个有效交易日再投资。
- 税前模式不扣股息预扣税或资本利得税；税后模式使用用户输入的简化税率。
- 手续费由版本化券商规则计算，内含 Robinhood、Webull、Moomoo、Firstrade 与 IBKR 情景；只有 Other/custom 可以编辑。
- 同时报告 Net gain ÷ contributions、TWR 和 MWRR/XIRR，三者不会混称为“总回报”。
- 不推算未来结果。若未来重新加入情景功能，必须独立标示为模拟估计，不能与历史回测混合。

更完整且具有变更控制效力的计算契约请查看英文 [README](README.md#calculation-assumptions) 与应用内 `/methodology` 页面。

## 本地开发

### 环境要求

- Node.js 24.x（由 `.nvmrc` 与 `package.json` 固定）
- npm
- Massive API key：DCA 股息与公司行动验证需要
- Google Gemini API key：仅 AI 报告解释功能需要
- Neon database：只在测试持久化或 migration 时需要

### 安装

```bash
nvm use
npm ci
cp .env.example .env.local
```

在不会提交到 Git 的 `.env.local` 中填写需要的值：

| 变量 | 是否需要 | 用途 |
| --- | --- | --- |
| `DATABASE_URL` | 持久化功能 | Neon pooled connection，仅供服务器查询。 |
| `DATABASE_URL_UNPOOLED` | 数据库 migration | Neon direct connection。 |
| `MASSIVE_API_KEY` | 实时 DCA 必需 | 股息历史与拆股验证。 |
| `GEMINI_API_KEY` | 可选 | AI 报告解释；没有它仍可使用计算、图表、CSV 与 PDF。 |
| `MARKET_DATA_PUBLIC_DISPLAY_LICENSE_CONFIRMED` | 公开生产数据必需 | 确认运营者已经取得所有数据源的公开展示与衍生分析权利。这个开关本身不会授予任何许可。 |
| `RATE_LIMIT_WAF_READY` | Vercel production 必需 | 确认对应的 Vercel WAF 限速规则已经发布。 |

任何密钥都不能使用 `NEXT_PUBLIC_` 前缀，否则值可能进入浏览器 bundle。不要提交 `.env.local`，也不要把密钥放进 issue、日志、截图、PDF 或聊天内容。

启动开发服务器：

```bash
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。公开健康状态位于 `GET /api/health`；它只报告服务能力和数据库配置状态，不输出密钥，也不执行 Neon 实时查询。

## 常用命令

```bash
npm run check       # typecheck + lint + test
npm run typecheck   # tsc --noEmit
npm run lint        # ESLint
npm run test        # Vitest
npm run build       # Next.js production build
npm run dev         # 本地开发服务器
npm run start       # 运行已构建的生产版本
npm run db:generate # 生成 Drizzle migration
npm run db:check    # 验证 migration journal
npm run db:migrate  # 执行 migration，需要 DATABASE_URL_UNPOOLED
```

所有核心测试均为确定性、无网络测试。修改金融公式、数据口径、费用规则或税务逻辑时，必须同步更新回归测试、README、应用内 methodology 和导出报告说明。

## GitHub 与持续集成

Repository：[changfanghan0324/investiq](https://github.com/changfanghan0324/investiq)

GitHub Actions 会在 push 与 pull request 时执行安装、类型检查、lint、测试和 production build。CI 徽章位于本页顶部。

提交前确认没有环境文件被 staged：

```bash
git status --short
git check-ignore .env.local
```

如果密钥曾进入 Git 历史记录，必须在数据商后台轮换；只删除文件或 commit 并不足够。

## Vercel 部署

这是标准 Next.js 项目。Vercel 使用 `npm run build` 和 `package.json` 中声明的 Node.js 版本，不需要自定义 build command。

生产与 Preview 环境应通过 Vercel 加密设置配置环境变量。部署后必须实际验证：

1. `/api/health` 返回合理状态。
2. 至少一个有效股票代码能完成完整分析。
3. CSV 与 PDF 能正常导出。
4. AI 功能在已配置时能回答报告范围内的问题。
5. 浏览器 bundle、错误信息和日志中没有密钥。

### 限速边界

供应商 API 路由通过 Vercel WAF 的 `@vercel/firewall` 进行每 IP 限速。生产规则使用稳定 ID `investiq-provider-backed-api`，建议固定窗口为每 60 秒 60 次请求。

这只是每客户端滥用保护，并不是跨所有用户与 serverless instance 的供应商总调用配额。若要公开提供已授权的实时数据，还需要一个持久化、跨 instance 的总配额计数器或队列。

当生产环境没有确认 WAF 规则时，系统会 fail closed 并在调用上游供应商之前返回中性 `503`。

### 市场数据授权

Yahoo Finance 与 Massive 对公开展示、再分发和衍生分析有各自限制。只有在已经取得所有数据源的书面权利后，才能设置：

```text
MARKET_DATA_PUBLIC_DISPLAY_LICENSE_CONFIRMED=true
```

该变量只是运营者确认，不会自动产生法律授权。没有确认时，公开生产环境只应使用明确标记的 demo 数据。

Portfolio Lab 与 Stock Comparison 会在读取股票前检查 `/api/health`。当真实价格分析不可用时，
页面不会继续发送必然失败的实时数据请求，而是在浏览器中使用生成的示例序列完成分析。页面告知、
资产名称与 CSV 都会明确标示“合成演示数据——不是市场历史”，不会把生成结果描述为 AAPL、MSFT、
SPY 或任何其他真实证券的表现。

## 安全说明

- API key 只能由 `src/server/` 下的服务器模块读取。
- 所有公共输入必须经过格式、数量与字节大小验证。
- 上游请求、响应与 AI payload 具有大小和超时限制。
- 公共错误信息保持中性，详细错误只能留在经过脱敏的服务器日志中。
- `/api/health` 不发起数据库查询，避免匿名请求放大 Neon 工作量。
- PDF 与 CSV 在浏览器本地生成；AI 报告摘要会发送给 Google Gemini。
- `localStorage` 只保存语言、文字大小、watchlist 与本地显示偏好，不应被当成可信授权边界。
- 不要在 `NEXT_PUBLIC_*`、源代码、Git 历史、客户端错误、截图或分析事件中保存秘密。

## 已知限制

- 市场数据不是实时、官方或机构级数据，可能延迟、修正、不完整或受限速影响。
- SEC 数据只代表标准化申报事实；口径差异和标签错误仍需人工研究判断。
- adjusted close 只是股息与拆股的总回报代理，不是独立审计的股息账本。
- 历史表现、DCF 和情景分析都不能保证未来结果。
- 投资组合目前没有可靠 sector 数据，因此不会根据 ticker 猜测行业配置。
- DCA 税务只是简化的固定税率估计，不处理税务 lot、wash sale、持有期与地区规则。
- 已知公司行动会 fail closed，但系统无法检测供应商完全没有报告的事件。
- AI 只解释确定性报告，不能代替分析师复核，也不能提供投资建议。

## 重要文件

| 路径 | 用途 |
| --- | --- |
| `README.md` | 英文完整产品、计算、部署与安全契约。 |
| `README.zh-CN.md` | 本简体中文说明。 |
| `CLAUDE.md` | 贡献者工作协议与变更控制规则。 |
| `docs/INVESTIQ_PRODUCT_SPEC.md` | 产品规格与工作区定义。 |
| `docs/INSTITUTIONAL_ANALYTICS_ROADMAP.md` | 机构级分析路线图。 |
| `src/app/` | 页面、布局与 API routes。 |
| `src/components/` | 用户界面组件。 |
| `src/domain/` | 纯金融计算与验证引擎。 |
| `src/server/` | 服务器数据源、安全和数据库适配器。 |
| `src/services/` | 浏览器 API、报告与导出服务。 |
| `src/i18n/` | 英文和简体中文翻译 catalog。 |
| `drizzle/` | PostgreSQL migrations 与治理 triggers。 |
| `design/investiq/` | 各工作区的视觉参考图。 |

## 免责声明

本项目是用于教育与个人作品集展示的研究软件，不是券商、交易平台、投资顾问或税务专业服务。仓库或平台输出的任何内容都不构成买入或卖出证券的建议。市场数据属于各自提供商，并受其条款约束。

---

如需更完整的逐项公式、DCA 费用与税务规则、测试矩阵和部署边界，请切换到 [English README](README.md) 或打开应用内 `/methodology`。
