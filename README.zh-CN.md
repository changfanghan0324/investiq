# ModelGuard

## 在浏览器中私密审计财务模型

ModelGuard 帮助分析师在模型交给复核者或投资委员会之前，检查会计链接、公式、DCF 逻辑、假设与情景一致性。

现有 InvestIQ 仓库与 Vercel 项目原地保留。公开产品现在是 ModelGuard；旧的市场、组合、DCA、公司研究、SEC 与 AI 界面已从活动运行时退役。回滚点为带注释的标签 `investiq-v1-before-modelguard`。

[在线演示](https://investiq-eight-xi.vercel.app/) · [仓库](https://github.com/changfanghan0324/investiq)

## 隐私契约

- 工作簿在浏览器中读取，并在 Web Worker 中解析。
- 工作簿不会上传、写入数据库、保存到浏览器存储，也不会发送给 AI 助手。
- 生产运行时没有市场数据提供方、SEC API、认证、分析、上传端点或数据库依赖。
- 关闭或清除标签页会释放内存中的会话；导出在本地生成。

## 审计流程

选择 `.xlsx` 后，ModelGuard 会保留工作表可见性、公式、缓存值、合并区域、命名范围与外部链接元数据，但不会跟随外部关系。确定性规则会生成包含规则 ID、严重性、位置、观察值与预期条件的单元格级问题。两个本地版本可以按单元格比较，审计回执可以导出为 JSON、CSV 或 PDF。

当前限制为 20 MB、50 个工作表、200,000 个非空单元格、100,000 个公式与 5,000 个命名范围。

当前目录包含 33 条固定规则：6 条工作表/链接检查、5 条会计勾稽、11 条 DCF 检查、5 条情景检查与 6 条假设治理检查。相同工作簿会得到相同结果；缺失数据会显示为无法验证，而不是被推断为零。对话式 AI 可用于探索问题或整理说明，但仍需用工作簿与来源逐格复核；ModelGuard 是互补的本地回执工具。

## 为什么不只使用 AI？

ModelGuard 负责可重复、以证据为先的模型预审；对话式助手仍可用于探索问题或整理说明。

| 对话式助手 | ModelGuard |
| --- | --- |
| 灵活复核 | 固定规则集 |
| 依赖提示词 | 可重复 |
| 可能遗漏检查 | 完整的配置清单 |
| 通用解释 | 工作表/单元格证据 |
| 版本追踪较困难 | 已解决/新增/持续问题 |
| 通常需要上传文件 | 浏览器本地处理 |

## 历史 InvestIQ 说明

旧公开演示曾使用合成市场示例，文档明确写过：“Price, comparison, portfolio, and DCA examples use synthetic data.” 这些路由现在会重定向到 ModelGuard；活动产品不显示合成或实时市场价格。

## 开发

需要 Node.js 24.x。运行 `npm ci` 后执行：

```bash
npm run dev
npm run typecheck
npm run lint
npm run test
npm run build
```

详见 [ModelGuard 产品规格](docs/MODELGUARD_PRODUCT_SPEC.md)、[规则目录](docs/MODELGUARD_RULE_CATALOG.md)、[隐私契约](docs/MODELGUARD_PRIVACY.md) 与 [安全模型](docs/MODELGUARD_SECURITY.md)。

ModelGuard 是教育用途的模型复核软件，不构成投资、会计、税务或法律建议。
