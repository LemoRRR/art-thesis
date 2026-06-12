# F4 艺术类研究工具 PRD

> 模块名称：艺术类量表生成 + 量化研究辅助 + 质性研究辅助  
> 文档状态：功能 PRD 草案  
> 日期：2026-06-12  
> 目标：把艺术学、设计学、电影学、传播学论文中常见的研究设计、问卷、量化分析、设计评价模型和质性研究流程做成一个可复用、可验收、可逐步扩展的研究工具模块。

## 1. 背景与定位

当前产品主链路是“材料理解 - 大纲生成 - 正文撰写/修改”。F4 不是直接写论文正文的普通聊天能力，而是论文方法章节和结果章节的研究工具箱。

F4 的核心价值是：

- 帮用户把模糊研究主题转成变量、维度、题项、假设和理论模型。
- 帮用户按标准 Excel 模板完成常见量化分析，并自动生成论文结果文字。
- 帮设计学用户完成 KANO、AHP 等评价模型的结构生成、数据计算和图表输出。
- 帮质性研究用户完成访谈文本整理、编码、主题归纳和研究框架辅助构建。

产品原则：

- **统计计算必须确定性**：均值、标准差、Cronbach's alpha、相关、T 检验、ANOVA、回归、中介、KANO、AHP 等结果由代码计算，不能交给 AI 猜。
- **AI 负责表达和结构化解释**：量表题项、假设、模型说明、检查报告、论文文字、质性编码建议由 Prompt 生成。
- **Excel 模板优先**：量化分析不做任意表格智能猜列，先固定模板，降低交付风险。
- **结果可复制、可导出、可回写正文**：所有工具结果都应该能复制、导出 txt/docx，并可一键插入 Stage3 当前论文。
- **艺术/设计语境优先**：默认术语、示例和输出格式贴合艺术学、设计学、电影学、传播学，而不是通用商业数据分析工具。

## 2. 用户角色与场景

### 2.1 论文写作者

需要在本科/硕士论文中完成问卷设计、量化分析、访谈编码和第四章结果写作。

典型任务：

- “我要研究短视频平台沉浸体验对非遗传播意愿的影响，帮我生成变量和量表。”
- “我已经收集了 280 份问卷，按模板上传，帮我生成第四章结果。”
- “我有访谈文本，帮我做开放编码、主轴编码和选择编码。”

### 2.2 设计评价研究用户

需要完成产品设计、交互设计、服务设计、适老化设计、文创设计等方向的需求分析和评价研究。

典型任务：

- “输入 12 个产品功能，生成 KANO 问卷。”
- “上传 KANO 数据，输出属性分类、Better-Worse 系数和优先级图。”
- “围绕老年人智能药盒评价，构建 AHP 指标体系并计算权重。”

### 2.3 甲方运营/Prompt 管理者

需要维护不同功能的 Prompt 模板、免责声明、输出格式，并根据项目迭代持续优化。

典型任务：

- 配置量表生成 Prompt。
- 配置扎根分析 Prompt。
- 调整论文第四章自动生成文字风格。

## 3. 信息架构

新增一级入口：`研究工具`

页面建议分为 5 个主 Tab：

1. `量表与模型`
2. `问卷检查`
3. `量化分析`
4. `设计评价`
5. `质性分析`

每个 Tab 内部是工具卡片或子 Tab，不做聊天流主界面。用户输入、运行、查看结果、复制/导出/插入论文的路径要稳定。

## 4. 功能范围

## 4.1 量表与模型

### 4.1.1 量表生成

输入：

- 研究主题，必填，上限 200 字。
- 自变量 X，必填。
- 因变量 Y，必填。
- 中介变量 M，可选。
- 调节变量 W，可选。
- 量表类型：5 分制 / 7 分制。
- 研究领域：艺术学 / 设计学 / 电影学 / 传播学 / 其他。
- 题项语言风格：正式学术 / 易懂问卷 / 面向学生 / 面向消费者。

输出：

- 变量概念界定。
- 操作化定义。
- 维度划分。
- 每个变量不少于 3 个题项。
- 自动包含反向题。
- 计分说明。
- 可复制问卷版。
- 可导出 Word 版。

最佳交互：

- 结果以“变量卡片”展示，每张卡片包含概念、维度、题项表。
- 题项支持单条编辑、删除、重新生成。
- 支持“一键生成问卷正文”。
- 支持“一键插入 Stage3 方法章节草稿”。

### 4.1.2 研究假设生成

输入：

- 从量表生成结果自动带入变量。
- 可手动补充变量关系。
- 可选择模型类型：直接效应 / 中介效应 / 调节效应 / 混合模型。

输出：

- H1/H2/H3 等假设语句。
- X -> Y、X -> M -> Y 等理论模型框架。
- 每条假设的理论依据简述。
- 可用于论文第二章或第三章的文字。

最佳交互：

- 视觉上展示简单模型图。
- 假设表包含：编号、路径、假设文本、理论依据、后续检验方式。

### 4.1.3 KANO 问卷生成

输入：

- 产品/服务名称。
- 功能列表，支持逐行输入。
- 受访者对象。

输出：

- 每个功能的正向问题。
- 每个功能的反向问题。
- 标准 KANO 选项。
- 可导出的 KANO 问卷表。

最佳交互：

- 功能列表可增删改。
- 生成后直接导出为 KANO 数据收集模板。

### 4.1.4 AHP 指标体系构建

输入：

- 研究对象。
- 评价目标。
- 研究领域。
- 可选参考维度。

输出：

- 目标层。
- 准则层。
- 指标层。
- 指标解释。
- 专家打分表模板。

最佳交互：

- 层级树展示。
- 指标可编辑、拖拽、增删。
- 一键导出专家评分模板。

## 4.2 问卷检查

输入：

- 粘贴问卷文本，或上传 Word/TXT。
- 可选上传当前变量结构。

检查项：

- 重复或近似题目。
- 引导性问题。
- 双重问题。
- 维度覆盖缺失。
- 题项表述不一致。
- 量表长度合理性。
- 是否适合信效度分析。
- 是否存在过多反向题。

输出：

- 总体评分。
- 问题清单。
- 修改建议。
- 优化后的题项版本。
- 论文方法章节可用说明。

最佳交互：

- 左侧原问卷，右侧检查报告。
- 每条问题支持“采纳修改”。

## 4.3 量化分析

### 4.3.1 标准 Excel 模板

量化分析只支持标准模板。

建议提供 3 类模板：

1. `问卷量化标准模板.xlsx`
2. `KANO标准模板.xlsx`
3. `AHP专家评分标准模板.xlsx`

问卷量化标准模板建议 Sheet：

- `README`：填写说明。
- `变量字典`：变量、维度、题项、反向计分、量表范围。
- `样本数据`：一行一个样本，一列一个变量/题项。
- `分组变量`：性别、年龄、学历、职业等。
- `假设路径`：H1-Hn、X、M、Y、控制变量。

解析规则：

- 模板缺 Sheet 或关键列时，直接提示模板错误。
- 非标准模板不做自动猜测。
- 反向题按变量字典自动计分。
- 维度分数由题项均值计算。
- 变量总分由维度均值或题项均值计算，规则由模板字段决定。

### 4.3.2 样本统计

输出：

- 性别、年龄、学历、职业等频率表。
- 百分比。
- 论文描述文字。

### 4.3.3 描述性统计

输出：

- 各题项 Mean / SD / Min / Max。
- 各维度 Mean / SD / Min / Max。
- 变量总分 Mean / SD / Min / Max。
- 论文描述文字。

### 4.3.4 信度分析

计算：

- Cronbach's alpha。
- 可选：删除题项后的 alpha。

输出：

- 各维度 alpha。
- 等级判断：优秀 / 良好 / 可接受 / 偏低。
- 论文文字。

### 4.3.5 效度分析

计算：

- KMO。
- Bartlett 球形检验。
- 探索性因子分析 EFA。
- 因子载荷矩阵。
- 方差解释率。

输出：

- KMO 与 Bartlett 表。
- 因子载荷表。
- 累计方差解释率表。
- 论文文字。

实现提醒：

- 第一版可使用 `ml-matrix`、`simple-statistics` 或后端 Python/scipy 路线。
- 如果前端依赖复杂，建议后端 Node 调用 Python 脚本，保证统计能力完整。

### 4.3.6 Pearson 相关分析

输出：

- 相关系数矩阵。
- 显著性标注：`* p<.05`，`** p<.01`，`*** p<.001`。
- 论文文字。

### 4.3.7 差异分析

支持：

- 独立样本 T 检验。
- 单因素 ANOVA。

输出：

- 分组均值。
- t/F 值。
- p 值。
- 显著性判断。
- 论文文字。

### 4.3.8 回归分析

支持：

- 简单线性回归。
- 多元线性回归。
- 控制变量。

输出：

- beta。
- t。
- p。
- R² / Adjusted R²。
- F。
- 假设验证结论：H1-Hn 支持 / 不支持。
- 论文文字。

### 4.3.9 中介效应分析

第一版只支持 PROCESS Model 4 单中介：

- X -> M -> Y。
- Bootstrap 5000 次。
- 输出总效应、直接效应、间接效应。
- 输出 95% CI。
- 输出中介效应占比。
- 输出显著性判断。
- 输出论文文字。

最佳交互：

- 用户在模板中定义 X/M/Y。
- 页面展示路径图和结果表。
- 如果缺少 M 或变量列，提示不可分析。

## 4.4 设计评价

### 4.4.1 KANO 数据分析

输入：

- KANO 标准模板。

计算：

- 按正向/反向答案组合进行属性分类。
- 输出 A 魅力型 / O 期望型 / M 必备型 / I 无差异型 / R 反向型。
- Better 系数。
- Worse 系数。
- 优先级排序。

输出：

- 功能属性分类表。
- Better-Worse 系数表。
- 功能优先级表。
- 二维需求矩阵静态 PNG。
- 论文文字。

### 4.4.2 AHP 权重分析

输入：

- AHP 专家评分标准模板。

计算：

- 判断矩阵。
- 特征向量权重。
- CI。
- CR。
- 综合权重。

输出：

- 各层权重表。
- 一致性检验结果。
- 指标优先级排序。
- CR >= 0.1 时提示重新打分。
- 论文文字。

## 4.5 论文结果自动生成

输入：

- 已完成的统计分析结果。
- 可选择包含哪些章节。
- 可选择论文规格：本科 / 硕士 / 期刊。

输出：

- 4.1 样本统计。
- 4.2 描述性统计。
- 4.3 信度分析。
- 4.4 效度分析。
- 4.5 相关分析。
- 4.6 差异分析。
- 4.7 回归分析。
- 4.8 中介效应分析。
- 4.9 KANO 分析。
- 4.10 AHP 分析。

最佳交互：

- 分析结果完成后出现“生成第四章文字”按钮。
- 生成内容可复制、导出 docx/txt。
- 支持插入 Stage3 当前论文。
- 支持在原结果基础上补充要求后调整，不重新计算。

## 4.6 质性研究辅助

### 4.6.1 扎根理论三级编码

输入：

- 访谈文本，上限 5000 字。
- 可选研究主题。
- 可选受访者信息。

输出：

- 开放编码。
- 主轴编码。
- 选择编码。
- 编码树。
- 频次统计。
- 代表性原文片段。
- 论文文字。

最佳交互：

- 结果拆成“编码表”和“编码树”。
- 编码表支持编辑。
- 频次统计支持复制/导出。

### 4.6.2 情感编码

输入：

- 文本，上限 5000 字。
- 可选情感维度定义。

输出：

- 情感编码说明表。
- 情感类别。
- 判断依据。
- 频次统计。
- 代表性文本片段。
- 论文文字。

### 4.6.3 主题提取与案例归纳

输入：

- 访谈文本、观察记录、案例材料。

输出：

- 主题列表。
- 案例归纳表。
- 研究框架建议。
- 可写入论文的分析段落。

## 5. Prompt 管理

由于甲方会持续提供 Prompt，系统需要有 Prompt 插槽，而不是把所有 Prompt 写死。

建议新增 Prompt 配置模型：

```ts
interface ResearchPromptTemplate {
  id: string
  key:
    | 'scale_generation'
    | 'hypothesis_generation'
    | 'kano_questionnaire'
    | 'ahp_framework'
    | 'questionnaire_check'
    | 'chapter4_generation'
    | 'grounded_coding'
    | 'emotion_coding'
    | 'theme_extraction'
  name: string
  content: string
  variables: string[]
  version: number
  updatedAt: number
}
```

第一版可以先做内置默认 Prompt，后续再加管理页。

运行时 Prompt 变量示例：

- `{{researchTopic}}`
- `{{independentVariable}}`
- `{{dependentVariable}}`
- `{{mediatorVariable}}`
- `{{moderatorVariable}}`
- `{{scaleType}}`
- `{{analysisTables}}`
- `{{qualitativeText}}`

## 6. 数据结构建议

```ts
interface ResearchToolProject {
  id: string
  paperProjectId?: string
  title: string
  domain: 'art' | 'design' | 'film' | 'communication' | 'other'
  createdAt: number
  updatedAt: number
}

interface ResearchToolRun {
  id: string
  projectId: string
  toolType:
    | 'scale'
    | 'hypothesis'
    | 'questionnaire_check'
    | 'quant_analysis'
    | 'kano_analysis'
    | 'ahp_analysis'
    | 'grounded_coding'
    | 'emotion_coding'
  input: unknown
  result: unknown
  generatedText?: string
  createdAt: number
}

interface QuantAnalysisResult {
  sampleStats?: TableResult[]
  descriptiveStats?: TableResult[]
  reliability?: TableResult[]
  validity?: TableResult[]
  correlation?: TableResult[]
  difference?: TableResult[]
  regression?: TableResult[]
  mediation?: TableResult[]
  generatedChapterText?: string
}

interface TableResult {
  title: string
  columns: string[]
  rows: Array<Array<string | number>>
  note?: string
}
```

## 7. 技术实现建议

### 7.1 前端

新增页面：

- `src/pages/ResearchTools.tsx`

新增组件：

- `ResearchToolTabs`
- `ScaleBuilder`
- `QuestionnaireChecker`
- `QuantTemplateUpload`
- `QuantAnalysisDashboard`
- `KanoAnalyzer`
- `AhpAnalyzer`
- `QualitativeCoder`
- `ResultExportBar`

### 7.2 后端

新增 API：

- `POST /api/research-tools/ai/run`
- `POST /api/research-tools/quant/analyze`
- `POST /api/research-tools/kano/analyze`
- `POST /api/research-tools/ahp/analyze`
- `GET /api/research-tools/templates/:type`

### 7.3 Excel 解析

推荐后端解析，原因：

- 统计库更稳定。
- 文件体积较大时不压前端。
- 后续可替换 Python/scipy/statsmodels。

Node 方案：

- `xlsx` 解析模板。
- `jstat` / `simple-statistics` / `ml-matrix` 做基础统计。
- 自写 KANO、AHP、Cronbach alpha、相关矩阵。

Python 方案：

- `pandas`
- `numpy`
- `scipy`
- `statsmodels`
- `factor_analyzer`

如果部署平台允许，Python 方案统计能力更完整；如果部署环境偏 Vercel serverless，则第一版应控制依赖，先 Node 实现最核心分析。

### 7.4 PNG 图表

KANO 二维矩阵和后续图表建议后端使用 canvas 生成静态 PNG。

当前项目已有 `@napi-rs/canvas`，可复用。

## 8. 页面流程

### 8.1 量表与模型流程

1. 用户输入研究主题和变量。
2. 点击生成量表。
3. 系统输出变量定义、维度、题项、计分说明。
4. 用户编辑题项。
5. 点击生成研究假设。
6. 用户导出问卷或插入论文。

### 8.2 量化分析流程

1. 用户下载标准 Excel 模板。
2. 用户按模板填写数据。
3. 上传模板。
4. 系统校验模板。
5. 系统计算统计结果。
6. 页面展示分析仪表板。
7. 用户生成第四章文字。
8. 复制、导出或插入论文。

### 8.3 质性分析流程

1. 用户粘贴访谈文本。
2. 选择扎根编码或情感编码。
3. 系统输出编码表、编码树、频次统计。
4. 用户编辑编码。
5. 系统生成论文分析段落。

## 9. MVP 分期

### Phase 1：AI 研究设计与质性工具

目标：最快把 F4 可见能力做出来。

包含：

- 研究工具页面。
- 量表生成。
- 研究假设生成。
- KANO 问卷生成。
- AHP 指标体系生成。
- 问卷检查。
- 扎根分析。
- 情感编码。
- 复制和 txt/docx 导出。

不包含：

- Excel 量化计算。
- KANO/AHP 上传数据分析。

### Phase 2：标准 Excel 量化分析

包含：

- 标准问卷模板下载。
- Excel 上传和模板校验。
- 样本统计。
- 描述性统计。
- 信度分析。
- Pearson 相关。
- 回归分析。
- 第四章文字生成。

### Phase 3：高级统计与设计评价

包含：

- KMO、Bartlett、EFA。
- T 检验、ANOVA。
- 中介效应 Bootstrap。
- KANO 数据分析和 PNG 图。
- AHP 权重、一致性检验。

### Phase 4：Prompt 管理与论文工作流融合

包含：

- Prompt 管理页。
- 结果历史。
- 一键插入 Stage3。
- 研究工具结果和项目绑定。

## 10. 验收标准

### MVP 验收

- 研究工具入口可访问。
- 量表生成可根据主题和变量输出结构化结果。
- 研究假设可生成 H1-Hn。
- KANO 问卷可生成正向/反向问题。
- AHP 可生成三层指标体系。
- 问卷检查可输出报告。
- 扎根分析可输出三级编码和频次。
- 情感编码可输出编码表。
- 所有结果支持复制和导出。

### 量化分析验收

- 标准模板可下载。
- 标准模板上传后可解析。
- 非标准模板给出明确错误提示。
- 样本统计、描述性统计、信度、相关、回归至少可稳定输出。
- 分析结果可生成论文第四章文字。

### 设计评价验收

- KANO 模板上传后可输出属性分类、Better-Worse 和 PNG 图。
- AHP 模板上传后可输出权重、CI/CR 和优先级。
- CR >= 0.1 时提示重新打分。

## 11. 主要风险

- EFA、KMO、Bartlett、中介 Bootstrap 依赖统计实现质量，建议不要用 AI 替代计算。
- 标准模板设计会决定后续体验，模板字段需要先稳定。
- Prompt 由甲方提供时，系统仍要做输入校验和输出结构兜底。
- Vercel serverless 环境对重型统计库和 Python 支持有限，复杂统计可能需要独立后端。
- 生成论文文字时要区分“计算结果”和“解释性描述”，避免 AI 改写数值。

## 12. 推荐第一步

先实现 Phase 1，也就是研究工具页面和 AI 生成类功能。

原因：

- 不依赖复杂统计库。
- 能快速形成可演示模块。
- 与现有 `callGPT` / `callDoubao` / docx 导出能力兼容。
- 后续 Excel 量化分析可以独立迭代，不阻塞 F4 的产品形态确认。

Phase 1 完成后，再开始设计 Excel 模板和统计计算服务。

## 13. 外部问卷平台接入设计

F4 不应该只停留在“生成问卷文本”。更理想的闭环是：

```text
研究主题/变量
  -> 生成量表/问卷
  -> 发布到问卷平台
  -> 回收数据
  -> 标准化为系统分析模板
  -> 量化分析
  -> 生成第四章文字
  -> 插入论文正文
```

### 13.1 接入原则

- 第一优先级不是绑定某一家问卷平台，而是定义系统自己的 `SurveySchema`。
- 腾讯问卷、飞书问卷、多维表格、问卷星等都作为外部适配器。
- 所有外部问卷数据回流后，都必须转换成系统标准分析模板，再进入统计计算。
- 外部平台只负责投放和收集，系统负责研究结构、统计分析和论文写作。

### 13.2 系统内部问卷结构

```ts
interface SurveySchema {
  id: string
  title: string
  description?: string
  scaleType: 'likert_5' | 'likert_7' | 'kano' | 'custom'
  variables: Array<{
    key: string
    name: string
    role: 'independent' | 'dependent' | 'mediator' | 'moderator' | 'control'
    dimensions: Array<{
      key: string
      name: string
      items: SurveyItem[]
    }>
  }>
  demographics: SurveyItem[]
  items: SurveyItem[]
  scoringRules: Array<{
    itemKey: string
    variableKey: string
    dimensionKey?: string
    reverseScored?: boolean
    min: number
    max: number
  }>
}

interface SurveyItem {
  key: string
  title: string
  type: 'single_choice' | 'multiple_choice' | 'likert' | 'text' | 'number'
  required: boolean
  options?: Array<{ label: string; value: string | number }>
}
```

### 13.3 平台适配器

```ts
interface SurveyProviderAdapter {
  provider: 'tencent_wj' | 'feishu_forms' | 'feishu_base' | 'manual_excel'
  createSurvey(schema: SurveySchema): Promise<ExternalSurvey>
  getSurveyMeta(externalSurveyId: string): Promise<ExternalSurvey>
  pullResponses(externalSurveyId: string): Promise<SurveyResponseDataset>
  exportResponses?(externalSurveyId: string): Promise<FileRef>
}
```

外部平台适配器只解决三件事：

1. 把 `SurveySchema` 转成外部平台题目。
2. 返回投放链接、二维码或嵌入地址。
3. 把外部平台回收数据转回 `SurveyResponseDataset`。

### 13.4 腾讯问卷接入

适合场景：

- 需要专业问卷平台。
- 需要外部链接、二维码、团队协作和正式问卷回收。
- 甲方已有腾讯问卷账号或愿意申请开放接口。

产品形态：

- 用户在系统中生成量表。
- 点击“发布到腾讯问卷”。
- 系统通过适配器创建问卷。
- 返回问卷链接和二维码。
- 后续点击“同步回收数据”，把答卷数据拉回系统。

注意：

- 腾讯问卷开放接口一般需要接入申请和账号权限。
- 第一版可以先支持“导出腾讯问卷导入格式”，不强依赖自动创建。

### 13.5 飞书问卷 / 飞书多维表格接入

适合场景：

- 甲方团队已经在飞书工作。
- 希望问卷数据天然进入多维表格，方便协作和二次整理。
- 后续需要飞书文档、表格、知识库协同。

两种路线：

#### 路线 A：飞书多维表格优先

- 系统生成字段结构。
- 创建或更新飞书多维表格字段。
- 通过表单视图发布问卷。
- 回收数据直接进入多维表格。
- 系统读取多维表格记录进行分析。

优点：

- 数据结构更接近 Excel 模板。
- 回流和清洗更容易。
- 适合团队协作。

#### 路线 B：飞书问卷优先

- 系统创建飞书问卷或导出问卷结构。
- 用户在飞书问卷中投放。
- 数据再导出或同步到系统。

优点：

- 更像传统问卷体验。

风险：

- 具体可自动化程度取决于飞书开放接口和当前 MCP 能力。

### 13.6 MCP 的定位

MCP 适合做“连接层”，但不应把业务逻辑直接绑死在某个 MCP 上。

推荐结构：

```text
F4 页面
  -> Research Tools API
  -> Survey Provider Service
  -> Provider Adapter
  -> MCP / OpenAPI / 手动导入
```

这样即使某个 MCP 不稳定、权限不足或接口变化，F4 主流程仍可运行。

MCP 可以承担：

- 创建飞书多维表格。
- 写入问卷字段。
- 读取回收数据。
- 创建飞书文档保存问卷说明。
- 把结果同步到飞书文档。

OpenAPI 更适合承担：

- 生产环境稳定发布。
- 用户授权。
- 自动同步数据。
- 后端定时任务。

### 13.7 推荐落地顺序

#### Phase A：系统内部问卷 + 导出

- 生成 `SurveySchema`。
- 支持导出 Word、Excel、CSV。
- 支持导出“可复制到腾讯问卷/飞书问卷”的题目格式。

#### Phase B：飞书多维表格适配

- 创建多维表格字段。
- 生成表单视图或指导用户一键生成表单。
- 从多维表格读取数据。
- 转成标准分析模板。

#### Phase C：腾讯问卷适配

- 接入腾讯问卷开放接口。
- 创建问卷。
- 获取投放链接。
- 同步答卷数据。

#### Phase D：多平台 Provider 管理

- 支持用户选择问卷平台。
- 保存授权状态。
- 显示同步状态。
- 支持手动重新同步。

## 14. F4 与论文正文的交互设计

F4 的分析环境必须和论文正文互动，否则用户会在“研究工具”和“正文写作”之间来回复制，很容易丢上下文。

### 14.1 项目绑定

每个研究工具运行结果都应该绑定到一个论文项目：

```ts
interface ResearchArtifact {
  id: string
  projectId: string
  type:
    | 'survey_schema'
    | 'scale_result'
    | 'hypothesis_model'
    | 'quant_analysis'
    | 'kano_analysis'
    | 'ahp_analysis'
    | 'qualitative_coding'
    | 'chapter4_text'
  title: string
  summary: string
  structuredData: unknown
  generatedText?: string
  createdAt: number
  updatedAt: number
}
```

### 14.2 正文可调用

Stage3 应该支持引用 F4 结果：

- `@资料库` 调资料。
- `/风格档案` 调风格。
- `#研究结果` 调 F4 分析结果。

用户在正文修改时可以输入：

```text
#信度分析结果 请把这部分写成第四章 4.3 信度分析的小节。
```

系统会把对应表格和数值带入 prompt，AI 只能解释结果，不能改动数值。

### 14.3 一键插入章节

F4 分析完成后提供三个动作：

1. `复制`
2. `导出`
3. `插入论文`

插入论文时支持：

- 插入到当前章节。
- 新建 `第四章 数据分析与结果`。
- 按 4.1-4.10 自动生成多个 sections。

### 14.4 数值锁定

所有统计结果进入论文生成时，数值必须锁定。

Prompt 中应明确：

```text
以下表格中的统计数值是计算结果，不得改写、不得四舍五入到不同精度、不得创造不存在的显著性。
你只能根据这些结果生成论文解释文字。
```

### 14.5 结果版本

如果用户重新上传数据或重新分析，系统应保留结果版本：

- 数据集版本。
- 分析版本。
- 生成文字版本。

Stage3 插入正文时记录来源：

```text
本节来源：F4 量化分析结果 v3，生成于 2026-06-12 18:42。
```

### 14.6 推荐正文交互闭环

最佳体验：

```text
Stage1 理解主题
  -> F4 生成变量/量表/假设
  -> F4 发布问卷或导出模板
  -> F4 上传/同步数据并分析
  -> F4 生成第四章文字
  -> Stage3 插入第四章
  -> Stage3 按风格档案和全文语境润色
```

这样 F4 是研究计算中心，Stage3 是论文表达中心。两者互相调用，但职责不混。

## 15. 量表、F4 与 Stage3 的内部闭环逻辑

本节先不考虑飞书、腾讯问卷等外部平台，只定义系统自己的核心逻辑。

F4 不是独立的问卷生成器。量表生成必须依托论文项目内容，量表结果也必须反过来影响论文正文生成。

更优的整体产品逻辑是：

```text
Stage1 决定研究路线
Stage2 为研究路线设计结构
F4 完成研究任务和计算
Stage3 负责写作表达和整合
```

其中 Stage3 直接生成量表是一种快捷入口或补救路径，不是主路径。主路径应该从 Stage1 开始识别研究路线，并让 Stage2 大纲提前为量化、质性或设计评价研究预留结构。

### 15.1 基本关系

```text
Stage1 项目理解 + 研究路线判断
  -> 研究对象、写作边界、核心论点、学段、研究路线
  -> 生成 Research Plan

Stage2 大纲生成
  -> 根据 Research Plan 预留方法章节、数据章节、分析章节、结果章节
  -> 自动生成 F4 研究任务清单

F4 研究计算中心
  -> 生成量表/假设/访谈提纲/KANO/AHP
  -> 等待用户收集数据
  -> 上传或录入数据
  -> 校验、计算、生成表格和结果文字

Stage3 正文表达中心
  -> 自动感知 Research Plan 和 F4 研究资产
  -> 写研究方法、结果章节、讨论和结论
  -> 插入、润色和整合 F4 结果
```

系统里应把 F4 结果看成一种新的项目资产，类似资料库和风格档案，但语义更强。

- 资料库回答：写什么材料。
- 风格档案回答：怎么表达。
- F4 研究资产回答：这篇论文采用什么研究设计、问卷、变量、统计结果和质性编码。

### 15.1.1 Stage1 研究路线判断

Stage1 理解完成时，不只输出研究对象和学段，还应输出研究路线建议。

```ts
interface ResearchPlan {
  methodType:
    | 'theoretical'
    | 'case_study'
    | 'quantitative'
    | 'qualitative'
    | 'mixed'
    | 'design_evaluation'

  methodLabel: string
  methodReason: string

  suggestedTools: Array<
    | 'scale_generation'
    | 'hypothesis_model'
    | 'survey_analysis'
    | 'mediation'
    | 'kano'
    | 'ahp'
    | 'grounded_coding'
    | 'emotion_coding'
    | 'theme_extraction'
    | 'case_summary'
  >

  variables?: {
    independent?: string[]
    dependent?: string[]
    mediator?: string[]
    moderator?: string[]
    control?: string[]
  }

  dataNeeds: string[]
  outlineRequirements: string[]
  pendingResearchTasks: string[]
}
```

Stage1 理解卡片建议增加：

```text
研究路线建议：量化研究
建议理由：当前主题涉及影响因素、满意度、意愿或变量关系，适合问卷与回归分析。
建议工具：量表生成、研究假设、问卷数据分析、中介效应分析

[确认该路线] [改为质性研究] [改为案例分析] [改为设计评价] [暂不确定]
```

用户确认后，Research Plan 进入项目上下文，并影响 Stage2 大纲。

### 15.1.2 Stage2 为研究路线设计结构

Stage2 生成大纲时必须读取 Research Plan。

如果是量化研究，大纲应自动预留：

```text
第三章 研究设计
  3.1 研究模型与假设
  3.2 变量定义与测量
  3.3 问卷设计
  3.4 数据收集与样本说明
  3.5 数据分析方法

第四章 数据分析与结果
  4.1 样本统计
  4.2 描述性统计
  4.3 信度与效度分析
  4.4 相关分析
  4.5 回归分析
  4.6 中介效应分析
  4.7 假设检验结果
```

如果是质性研究，大纲应自动预留：

```text
第三章 研究设计
  3.1 研究对象与访谈设计
  3.2 资料收集
  3.3 编码方法
  3.4 研究伦理与可信度处理

第四章 质性分析结果
  4.1 开放编码
  4.2 主轴编码
  4.3 选择编码
  4.4 主题模型建构
  4.5 案例归纳
```

如果是设计评价，大纲应自动预留：

```text
第三章 研究设计与评价模型
  3.1 用户需求调研
  3.2 KANO 问卷设计
  3.3 AHP 指标体系构建
  3.4 数据收集与分析方法

第四章 设计评价结果
  4.1 KANO 需求属性分析
  4.2 Better-Worse 系数分析
  4.3 AHP 权重分析
  4.4 设计优化策略
```

Stage2 确认大纲后，应自动创建 F4 研究任务清单。

示例：

```text
研究任务
- 生成研究假设
- 生成量表题项
- 生成问卷模板
- 等待用户收集数据
- 上传回收数据
- 运行信效度分析
- 运行相关/回归/中介分析
- 生成第四章结果文字
```

### 15.2 研究资产类型

```ts
type ResearchAssetType =
  | 'research_design'
  | 'scale_schema'
  | 'survey_questionnaire'
  | 'hypothesis_model'
  | 'quant_dataset'
  | 'quant_analysis_result'
  | 'kano_result'
  | 'ahp_result'
  | 'qualitative_coding'
  | 'chapter_text'

interface ResearchAsset {
  id: string
  projectId: string
  type: ResearchAssetType
  title: string
  summary: string
  source:
    | 'generated_from_project'
    | 'created_in_stage3'
    | 'uploaded_by_user'
    | 'manual_input'
  structuredData: unknown
  plainText: string
  status: 'draft' | 'confirmed' | 'used_in_paper'
  linkedSectionIds?: string[]
  createdAt: number
  updatedAt: number
}
```

### 15.2.1 研究任务状态机

问卷生成和数据分析之间存在真实的时间差与空间差。用户可能今天生成问卷，几天后才从腾讯问卷、飞书、问卷星、微信群或线下录入拿到数据。因此 F4 必须把“等待收集数据”设计成正式状态，而不是空白状态。

```ts
type ResearchTaskStatus =
  | 'route_planned'
  | 'scale_drafting'
  | 'scale_confirmed'
  | 'survey_ready'
  | 'collecting_data'
  | 'data_uploaded'
  | 'data_validated'
  | 'analysis_done'
  | 'chapter_text_ready'
  | 'inserted_into_paper'

interface ResearchTask {
  id: string
  projectId: string
  title: string
  methodType: ResearchPlan['methodType']
  status: ResearchTaskStatus
  currentScaleAssetId?: string
  datasetAssetId?: string
  analysisAssetId?: string
  chapterTextAssetId?: string
  nextActionLabel: string
  createdAt: number
  updatedAt: number
}
```

| 状态 | 含义 | Stage3 可做什么 |
| --- | --- | --- |
| `route_planned` | Stage1 已确认研究路线 | 可写研究思路，不写具体量表 |
| `scale_drafting` | 正在生成或编辑量表 | 不自动写入正文 |
| `scale_confirmed` | 当前正式量表已确认 | 可写变量测量、问卷设计 |
| `survey_ready` | 问卷/数据模板已生成 | 可写问卷设计和数据收集方案 |
| `collecting_data` | 用户正在外部收集数据 | 可写方法章节，不可生成统计结果 |
| `data_uploaded` | 已上传数据，待校验 | 可提示等待校验 |
| `data_validated` | 数据校验通过，待分析 | 可写样本来源，不写最终统计结论 |
| `analysis_done` | 统计或编码分析完成 | 可生成第四章结果 |
| `chapter_text_ready` | F4 已生成论文结果文字 | 可插入 Stage3 |
| `inserted_into_paper` | 已插入正文 | 可继续润色和整合 |

项目首页、F4 页面和 Stage3 都应显示未完成研究任务。

```text
待继续研究任务
短视频非遗传播意愿问卷
状态：等待收集数据
当前量表：v2
下一步：上传回收数据
[查看问卷] [下载数据模板] [上传数据]
```

### 15.3 量表生成依托论文内容

用户进入 F4 量表生成时，系统不应该只给一个空输入框，而应该默认带入当前论文项目上下文。

默认上下文包括：

- Stage1 材料理解结果。
- 论文题目。
- 研究对象。
- 写作边界。
- 核心论点。
- 已确认学段。
- Stage2 大纲。
- Stage3 已写正文，尤其是绪论、研究背景、理论基础、研究方法相关章节。
- 用户在 F4 中手动补充的变量关系。

量表生成 Prompt 的输入应由两部分组成：

```text
【论文项目上下文】
来自 Stage1/Stage2/Stage3 的稳定信息。

【本次量表生成输入】
用户明确填写的研究主题、自变量、因变量、中介变量、调节变量、量表类型。
```

优先级规则：

1. 用户在 F4 表单里明确填写的变量和关系优先。
2. Stage1/Stage2/Stage3 项目上下文用于补足研究语境。
3. AI 不应发明与论文主题无关的新变量。
4. 如果上下文和用户输入冲突，提示用户确认，而不是静默覆盖。

### 15.4 Stage3 直接输入量表的逻辑

用户可能不会先进入 F4，而是在 Stage3 写论文时直接说：

```text
帮我根据这一章内容生成一个李克特 5 分量表。
```

或：

```text
根据当前论文，生成“感知有用性、审美体验、使用意愿”的问卷题项。
```

这种情况下 Stage3 不应该只返回一段普通文本，而应该触发“研究资产生成”逻辑。

建议交互：

1. Stage3 识别用户意图属于量表/问卷/假设/质性/统计工具。
2. 系统弹出或侧边打开 F4 轻量面板。
3. 自动带入当前章节、项目理解和用户刚输入的要求。
4. 调用 F4 量表生成能力。
5. 生成结果保存为 `scale_schema` 或 `survey_questionnaire` 研究资产。
6. Stage3 聊天返回摘要，并提示“已保存为研究资产，可插入研究方法章节”。

示例返回：

```text
已根据当前论文生成“沉浸体验-审美认同-传播意愿”量表，共 3 个变量、9 个题项，其中 2 个反向题。已保存到研究工具，可用于后续问卷导出和第四章分析。
```

### 15.4.1 量表编辑、保存与确认

量表不是一次性 AI 输出，而是可编辑、可保存、可确认、可版本化的研究资产。

状态流：

```text
AI 生成草稿
  -> 用户编辑
  -> 保存草稿
  -> 确认为当前量表
  -> 生成问卷/数据模板
  -> 等待收集数据
  -> 上传数据并分析
  -> 插入论文
```

量表资产建议结构：

```ts
interface ScaleAsset {
  id: string
  projectId: string
  taskId: string
  title: string
  status: 'draft' | 'confirmed' | 'archived'
  version: number
  basedOnVersionId?: string
  researchTopic: string
  scaleType: 'likert_5' | 'likert_7'
  variables: Array<{
    id: string
    name: string
    role: 'independent' | 'dependent' | 'mediator' | 'moderator' | 'control'
    definition: string
    dimensions: Array<{
      id: string
      name: string
      definition: string
      items: Array<{
        id: string
        code: string
        text: string
        reverseScored: boolean
        required: boolean
        disabled?: boolean
      }>
    }>
  }>
  scoringRules: string
  notes: string
  createdAt: number
  updatedAt: number
}
```

用户操作：

- 编辑题项文本。
- 单题重新生成。
- 添加/停用题项。
- 标记反向题。
- 调整变量和维度归属。
- 保存草稿。
- 确认为当前量表。
- 生成问卷。
- 生成数据模板。
- 插入论文方法章节。

只有 `confirmed` 量表会进入 Stage3 自动上下文。`draft` 不自动影响正文。

如果用户修改已确认量表：

```text
你正在修改已确认量表。保存后将生成新版本，旧版本仍会保留。
[保存为草稿版本] [保存并设为当前正式量表]
```

如果量表已经进入 `collecting_data`，系统需要保护题项编号和变量归属：

- 修改错别字和说明文字：允许。
- 修改题项 code：不建议。
- 删除题项：默认停用，不物理删除。
- 修改变量结构：创建新量表版本。
- 已上传数据后：结构锁定，除非创建新研究任务或新数据模板版本。

### 15.5 Stage3 生成正文时感知量表

当 Stage3 写以下章节时，必须自动考虑已有 F4 研究资产：

- 研究方法。
- 问卷设计。
- 变量测量。
- 数据来源。
- 信效度分析。
- 结果分析。
- 讨论。
- 结论。

例如用户生成“研究方法”章节时，如果项目中存在已确认量表，Prompt 应注入：

```text
【本项目已有量表设计】
变量：沉浸体验、审美认同、传播意愿
量表类型：李克特 5 分
题项数量：每变量 3 题
反向题：...
计分方式：...

写作要求：
- 生成研究方法/问卷设计内容时，必须使用以上量表信息。
- 不要重新创造另一套变量或题项。
- 可以把量表设计转化为论文方法章节的自然表述。
```

如果项目中存在量化分析结果，生成第四章时应注入：

```text
【本项目已有量化分析结果】
样本统计表：...
信度分析：...
相关分析：...
回归分析：...

写作要求：
- 统计数值不得改写。
- 只能围绕结果进行论文式解释。
- 不得创造不存在的显著性。
```

### 15.6 研究资产的启用规则

不是所有 F4 草稿都应该自动进入 Stage3。

建议状态：

- `draft`：刚生成，未确认。不会自动进入 Stage3 生成上下文。
- `confirmed`：用户确认使用。会进入 Stage3 相关章节上下文。
- `used_in_paper`：已插入或被正文引用。

Stage3 自动注入规则：

| 章节类型 | 自动注入资产 |
| --- | --- |
| 绪论/研究背景 | 研究设计摘要、理论模型 |
| 文献综述/理论基础 | 假设模型、变量定义 |
| 研究方法 | 量表、问卷、抽样方案、访谈方案 |
| 数据分析/第四章 | 量化分析结果、KANO/AHP/质性编码 |
| 讨论 | 假设验证结论、主要发现 |
| 结论 | 研究发现摘要、贡献与不足 |

如果章节类型无法判断，则只注入资产摘要，不注入完整表格，避免 prompt 过长。

### 15.7 用户可控的调用方式

Stage3 应提供三种调用方式：

#### 方式 A：自动感知

用户生成研究方法章节时，系统自动读取已确认量表。

适合：

- 用户已经在 F4 完成量表。
- 章节标题明显包含“研究方法”“问卷设计”“变量测量”。

#### 方式 B：手动引用

用户输入：

```text
#量表设计 请把它写进研究方法。
```

或：

```text
#信度分析结果 生成 4.3 信度分析。
```

适合：

- 用户想明确指定某个研究资产。
- 同一项目有多个版本的量表或分析结果。

#### 方式 C：从 Stage3 新建

用户输入：

```text
根据当前论文生成一套问卷。
```

系统创建 F4 研究资产，再让用户确认是否插入正文。

适合：

- 用户还没进入 F4。
- 写到方法章节时才发现需要问卷。

### 15.8 量表对全文生成的影响

如果用户在全文生成前已经确认量表，Stage3 一键全文生成也应该感知它。

影响包括：

- 大纲中如果有“研究方法”，正文应写入变量、量表、题项和计分说明。
- 如果有“数据分析”章节但没有数据，正文应写成“待数据回收后分析”，不要编造结果。
- 如果已有分析结果，第四章应使用真实结果表。
- 摘要、结论中可以提到“采用问卷调查法”，但不能编造样本量或显著结论。

全文生成 Prompt 应加入研究资产摘要：

```text
【项目研究资产摘要】
已确认量表：...
已确认假设：...
已上传数据：无/有
已完成分析：无/有

生成规则：
- 已确认的研究设计必须贯穿方法章节。
- 没有数据分析结果时，不得生成虚构统计结论。
- 有统计结果时，必须以 F4 计算结果为准。
```

如果研究任务处于不同状态，全文生成规则也不同：

| 研究任务状态 | 全文生成规则 |
| --- | --- |
| 已确认研究路线，但未确认量表 | 可写研究设计设想，不能写具体问卷题项 |
| 已确认量表 | 可写变量测量、问卷设计、计分方式 |
| 等待收集数据 | 可写数据收集计划，不能写统计结果 |
| 已上传但未分析 | 可写样本来源，不能写信效度/回归结论 |
| 已完成分析 | 可写第四章、讨论、结论 |

生成摘要和结论时也应遵守同样规则。没有分析结果时，不得声称“研究发现”“结果表明”。

### 15.9 量表版本与正文同步

量表可能在论文写作过程中被修改。

需要记录：

- 当前量表版本。
- 哪些正文 section 使用了该版本。
- 如果量表更新，提示用户是否同步更新相关章节。

示例：

```text
你修改了“审美体验”变量的题项。当前论文中“3.2 问卷设计”使用的是旧版本，是否重新生成该小节？
```

第一版可以只做弱提示，不自动重写。

### 15.10 推荐 MVP 逻辑

第一版最小可用闭环应同时覆盖“路线前置”和“量表资产”：

1. Stage1 输出研究路线建议，用户可确认或改选。
2. Stage2 根据研究路线生成大纲，并创建 F4 研究任务。
3. F4 量表生成默认读取项目上下文。
4. 用户可编辑、保存草稿、确认为当前量表。
5. 确认量表后，研究任务进入 `scale_confirmed` 或 `survey_ready`。
6. 用户导出问卷/数据模板，任务进入 `collecting_data`。
7. Stage3 生成研究方法章节时自动注入已确认量表摘要。
8. Stage3 生成第四章时，如果没有分析结果，提示去 F4 上传数据，不编造结果。
9. Stage3 支持 `#量表设计` 手动引用。
10. Stage3 中输入“生成量表/问卷”时，跳转或打开 F4 面板生成研究资产。
11. F4 结果支持“一键插入当前章节 / 新建研究方法章节”。

这个 MVP 先不需要外部问卷平台，也不需要完整统计分析。它先解决最核心的问题：量表来自论文，论文知道量表。
