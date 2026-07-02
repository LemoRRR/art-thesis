# Prompt Map

本文档用于交付、维护和客户沟通：当客户希望调整某个 AI 行为时，可以先在这里定位对应模块、触发入口、Prompt 名称和代码位置。

当前状态：Prompt 主要写在 TypeScript/Node 源码中，适合工程师通过 Git 修改和版本管理。若后续要让客户“在后台直接改 Prompt”，建议把本文档中的 Prompt 项迁移到 `prompt_templates` 数据表或配置文件，再由后台读取。

## 使用原则

- 改写作口吻、输出格式、题项数量、引用密度：优先改对应 Prompt。
- 改统计计算、表格字段、图表渲染：通常不是 Prompt，而是后端规则或 Python/Node 计算逻辑。
- 改按钮、页面交互、插入位置：通常是前端组件或研究包拆分逻辑，不是 Prompt。
- 改客户默认模板：优先改 Stage2 大纲、Stage3 正文、研究工具生成、研究结果解释这四类 Prompt。

## 总览

| 模块 | Prompt 入口数 | 主要文件 |
| --- | ---: | --- |
| Stage1 材料理解 | 3 | `src/lib/prompts.ts` |
| 资料库/风格/案例 | 5 | `src/lib/prompts.ts`, `server/lib/extract.ts` |
| Stage2 大纲 | 2 | `src/lib/prompts.ts` |
| Stage3 正文写作 | 9 | `src/lib/prompts.ts`, `src/pages/Stage3.tsx` |
| 选区 AI 改写 | 2 | `src/lib/prompts.ts` |
| 文献检索与证据包 | 3 | `server/routes/scholar.ts` |
| 引用增强 | 1 | `server/routes/references.ts` |
| 研究工具生成 | 2 | `src/lib/researchToolQuality.ts` |
| 研究计算与插入论文 | 4 | `server/routes/research.ts` |

合计约 31 个 Prompt 入口。如果把 `promptQuickAction` 的快捷动作拆开算，则约 34 个客户可感知的 Prompt 行为。

## Stage1 材料理解

| Prompt | 位置 | 触发模块 | 用途 | 客户常改内容 |
| --- | --- | --- | --- | --- |
| `promptUnderstandFromText` | `src/lib/prompts.ts` | Stage1 上传/粘贴正文材料 | 从论文、材料、想法中识别题目、研究对象、核心论点、学段建议、研究路线 | 材料理解口径、学段判断、输出 JSON 字段 |
| `promptUnderstandFromOutline` | `src/lib/prompts.ts` | Stage1 上传/粘贴已有大纲 | 识别已有大纲结构和下一步写作建议 | 大纲识别标准、是否判断为已有大纲 |
| `promptChatFollowup` | `src/lib/prompts.ts` | Stage1 左侧对话追问 | 根据项目上下文回答用户追问，并继续完善理解 | 助手语气、追问方式、回答长度、研究方法建议 |

## 资料库、风格档案、案例提取

| Prompt | 位置 | 触发模块 | 用途 | 客户常改内容 |
| --- | --- | --- | --- | --- |
| `promptExtractStyle` | `src/lib/prompts.ts` | 资料库/旧风格提取 | 从文章中提取语言风格特征 | 风格维度、语言特征分类 |
| `promptExtractStyleProfile` | `src/lib/prompts.ts` | 风格档案页 | 生成可复用的学生语言风格档案 | 风格档案字段、示例句、禁用表达 |
| `promptExtractCases` | `src/lib/prompts.ts` | 资料库案例解析 | 从参考文章中提取案例、分析角度、可写入论文的材料 | 案例提取字段、案例数量、艺术类案例口径 |
| `promptExtractBackgroundMaterial` | `src/lib/prompts.ts` | 资料库背景材料解析 | 从资料中提取背景、理论、案例和章节调用建议 | 背景材料摘要方式、是否输出章节建议 |
| `buildExtractPrompt` | `server/lib/extract.ts` | 后端文档提取兜底 | 对上传文本做结构化提取 | 文档结构化字段、摘要方式 |

## Stage2 大纲

| Prompt | 位置 | 触发模块 | 用途 | 客户常改内容 |
| --- | --- | --- | --- | --- |
| `promptGenerateOutline` | `src/lib/prompts.ts` | Stage2 生成大纲 | 根据题目、材料、研究对象、学段生成论文大纲 | 默认章节格式、一二三编号、摘要/Abstract、研究计算承载章节 |
| `promptReviseOutline` | `src/lib/prompts.ts` | Stage2 根据意见修改大纲 | 按用户意见重排、增删、改名大纲 | 修改原则、是否保留原章节、编号规则 |

重点：学校格式、摘要节点、研究计算章节预留，主要改 `promptGenerateOutline`。

## Stage3 正文写作

| Prompt | 位置 | 触发模块 | 用途 | 客户常改内容 |
| --- | --- | --- | --- | --- |
| `promptWriteSection` | `src/lib/prompts.ts` | 旧章节生成/兼容写作入口 | 根据章节标题和上下文生成单节正文 | 单节字数、禁用词、风格注入、案例调用 |
| `promptGeneratePaperPlan` | `src/lib/prompts.ts` | 点击生成全文 | 生成全文写作计划、章节顺序、引用策略和研究结果承载计划 | 全文结构、每章写作重点、引用策略 |
| `promptGenerateFrontMatter` | `src/lib/prompts.ts` | 生成摘要/Abstract/关键词 | 生成中文摘要、英文摘要、关键词 | 摘要长度、Abstract 风格、关键词数量 |
| `promptGenerateChapter` | `src/lib/prompts.ts` | 逐章生成正文 | 按章节、大纲、证据包生成论文正文 | 正文论证密度、学术语气、引用标记、研究结果预留 |
| `promptSummarizeGeneratedChapter` | `src/lib/prompts.ts` | 每章生成后 | 总结已生成章节，作为后续章节上下文 | 摘要粒度、是否保留关键概念 |
| `promptReviseSection` | `src/lib/prompts.ts` | Stage3 按意见修改章节 | 按用户意见修改当前章节 | 修改口吻、保留原文程度、禁止套话 |
| `promptFinishDraft` | `src/lib/prompts.ts` | 收尾生成 | 生成结论、摘要补强、参考文献前说明等收尾内容 | 结论格式、研究不足、展望写法 |
| `promptAdjustFinish` | `src/lib/prompts.ts` | 调整收尾内容 | 根据用户意见二次调整收尾 | 调整范围、是否保留原结构 |
| `promptGenerateResearchAssetSection` / `promptPolishResearchAssetIntoSection` | `src/pages/Stage3.tsx` | 插入研究资产后生成章节段落 | 把研究结果资产扩写为当前章节内容，并润色成论文段落 | 研究结果融入正文方式、表图前后说明 |

重点：客户觉得“正文不学术”“空”“不像论文”，通常先改 `promptGenerateChapter`；客户觉得“研究结果插入后像模块”，通常改 `promptGenerateResearchAssetSection`、`promptPolishResearchAssetIntoSection` 和研究解释 Prompt。

## 选区 AI 改写

| Prompt | 位置 | 触发模块 | 用途 | 客户常改内容 |
| --- | --- | --- | --- | --- |
| `promptRewriteSelection` | `src/lib/prompts.ts` | Stage3 框选文字后 AI 改写 | 按自定义意见改写选中文本 | 改写强度、是否保留原意、学术化程度 |
| `promptQuickAction` | `src/lib/prompts.ts` | 选区快捷动作 | 缩短、扩写、学术化等快捷动作 | 快捷动作定义、输出长度、是否主动补充论证 |

说明：`promptQuickAction` 是一个入口，但包含多个动作。如果按客户体验拆分，可视为 3 个 Prompt 行为：缩短、扩写、学术化。

## 文献检索、筛选与证据包

| Prompt | 位置 | 触发模块 | 用途 | 客户常改内容 |
| --- | --- | --- | --- | --- |
| `generateSearchQueries` 内部 messages | `server/routes/scholar.ts` | `/api/scholar/prepare` | 根据题目、大纲、研究对象生成 OpenAlex/Crossref 检索式 | 检索词数量、中英文比例、学科关键词 |
| `selectSourcesWithAI` 内部 messages | `server/routes/scholar.ts` | 文献候选筛选 | 从候选文献中筛选可用于论文的来源 | 来源筛选标准、年份偏好、中文/英文文献比例 |
| `buildEvidencePackWithAI` 内部 messages | `server/routes/scholar.ts` | 文献证据包 | 把来源整理为理论、综述、方法、案例、章节证据包 | 证据分类方式、章节引用计划、引用数量目标 |

重点：客户觉得“引用文献来来去去就几个”“引用不贴观点”，优先检查这里和 `promptGenerateChapter`。

## 引用增强

| Prompt | 位置 | 触发模块 | 用途 | 客户常改内容 |
| --- | --- | --- | --- | --- |
| `buildEnhancementPrompt` | `server/routes/references.ts` | 引用增强/后补引用 | 找出正文中需要引用的位置，局部改写并绑定真实来源 | 引用密度、哪些句子必须加引用、是否只加脚注不改写 |

注意：引用增强必须遵守“只使用提供来源，不编造文献”。客户要改引用数量时，优先改目标数量和覆盖规则，不要放开真实性约束。

## 研究工具生成

| Prompt | 位置 | 触发模块 | 用途 | 客户常改内容 |
| --- | --- | --- | --- | --- |
| `buildResearchToolPrompt` | `src/lib/researchToolQuality.ts` | 研究计算 -> 没有数据 -> 生成问卷/访谈/AHP/编码表 | 生成正式研究工具 | 问卷题量、KANO 正反题数量、AHP 指标层级、访谈提纲、编码表字段 |
| `buildResearchToolRepairPrompt` | `src/lib/researchToolQuality.ts` | 研究工具质检后自动修复 | 根据质检问题补全研究工具 | 自动修复规则、题量不足时如何补题 |

重点：客户觉得“问卷太少”“AHP 太模板”“KANO 不专业”，主要改 `buildResearchToolPrompt` 和对应 mode rule。

## 研究计算与插入论文

| Prompt | 位置 | 触发模块 | 用途 | 客户常改内容 |
| --- | --- | --- | --- | --- |
| `interpretAnalysisResult` 内部 messages | `server/routes/research.ts` | `/api/research/interpret` 或分析后自动解释 | 把统计/编码结果改写成论文方法、结果分析、图表前后说明 | 结果解释风格、保守表述、图表说明句式 |
| `/api/research/intent` 内部 messages | `server/routes/research.ts` | 研究计算入口 | 判断用户研究目的、能力等级、推荐方法 | 方法识别标准、out_of_scope 边界 |
| `/api/research/analysis-plan` 内部 messages | `server/routes/research.ts` | 上传数据后生成分析方案 | 判断适合的统计方法、变量角色、公式、输出包 | 统计方法选择逻辑、变量角色解释 |
| `/api/research/write-plan` 内部 messages | `server/routes/research.ts` | 一键插入论文 | 判断研究组件应写入研究方法、数据分析、讨论还是结论章节 | 图表插入位置、信效度放哪章、讨论建议放哪章 |

说明：
- KMO、Bartlett、T 检验、Cronbach、ANOVA、EFA、回归、中介等计算本身不是 Prompt，结果解释才经过 Prompt。
- 情感编码和扎根/主题编码的初始编码主要由后端规则生成，最终论文话术、图表说明通过 `interpretAnalysisResult` 统一学术化。

## 哪些不是 Prompt

| 功能 | 主要位置 | 为什么不是 Prompt |
| --- | --- | --- |
| KMO、Bartlett、T 检验、Cronbach alpha、ANOVA、EFA、回归、中介 | `server/python/research_analysis.py`, `server/routes/research.ts` | 这些是统计计算，不应通过 Prompt 改结果 |
| KANO、AHP 图表生成 | `server/routes/research.ts` | 图表和表格字段由代码生成 |
| 研究包拆分为 method/table/figure/analysis | `src/lib/researchPackages.ts` | 决定如何插入 Word/正文，是结构规则 |
| Word 导出格式 | `src/lib/docxExport.ts` | 是 docx 结构、样式和表图渲染 |
| OpenAlex/Crossref 检索 API | `server/routes/scholar.ts` | 检索 API 逻辑不是 Prompt，但检索词生成是 Prompt |
| 选区工具条显示/遮挡 | `src/components/PaperDocumentEditor.tsx`, `src/components/SelectionToolbar.tsx` | 是前端定位和交互问题 |

## 客户说法与修改入口

| 客户说法 | 优先修改 |
| --- | --- |
| “摘要太短/太像 AI” | `promptGenerateFrontMatter` |
| “正文不够学术/太空” | `promptGenerateChapter` |
| “大纲格式要按学校模板” | `promptGenerateOutline` |
| “问卷题太少/不专业” | `buildResearchToolPrompt`, `buildResearchToolRepairPrompt` |
| “KANO/AHP 表不专业” | 先看 `buildResearchToolPrompt`；若是结果表字段，再看 `server/routes/research.ts` |
| “研究结果插入位置不对” | `/api/research/write-plan` prompt + `fallbackWritePlan` 规则 |
| “图表说明不像论文” | `interpretAnalysisResult` prompt + deterministic narratives |
| “引用太少/引用位置不准” | `buildEnhancementPrompt`, `buildEvidencePackWithAI`, `promptGenerateChapter` |
| “选中后 AI 改写不符合口吻” | `promptRewriteSelection`, `promptQuickAction` |
| “语言风格要像某个学生” | `promptExtractStyleProfile` + Stage3 写作 prompt 中风格注入规则 |

## 建议的客户可编辑档案方案

如果客户要“立刻在某个档案上改 Prompt”，建议下一步做 Prompt 配置化，而不是长期让客户改源码。

推荐结构：

1. 新增 `prompt_templates` 数据表或 `config/prompts/*.md` 配置目录。
2. 每个模板包含：`key`、`module`、`displayName`、`version`、`enabled`、`systemPrompt`、`userPromptTemplate`、`updatedBy`、`updatedAt`。
3. 后台新增 Prompt 管理页，按模块展示：材料理解、大纲生成、正文生成、选区改写、问卷/AHP/KANO、研究解释、引用增强。
4. 每次生成记录 Prompt 版本，方便追踪“为什么这次输出变了”。
5. 保留默认 Prompt 作为代码兜底，客户配置出错时可以一键恢复。

这样客户可以直接改 Prompt 档案，同时仍保留版本、回滚和交付可控性。
