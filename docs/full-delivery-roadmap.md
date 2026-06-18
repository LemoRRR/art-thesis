# 完整版交付功能路线图

> 更新时间：2026-06-11  
> 目的：记录最终交付模块 F1-F7 与当前产品之间的差距、讨论结论和后续实现事项。  
> 状态：讨论稿，不代表已经全部实现。

## 总体原则

- 现有产品已经形成“资料库 + 项目 + Stage1/Stage2/Stage3”的论文工作台主链路。
- 合同交付标准更偏“可控、有限、可验收”的功能集合。
- 后续实现时保留现有增强能力，同时补齐合同基础能力。
- 不为了合同砍掉已经更好用的能力，例如一键全文生成。

## F1 材料理解 + 学段判断

### 已达成共识

Stage1 继续作为统一入口。用户不需要提前选择“写新论文”或“改旧论文”，可以直接上传已有论文、输入题目、大纲、想法或混合材料，由系统识别下一步路径。

学段判断采用“AI 建议 + 用户确认”：

- AI 自动给出本科、硕士、期刊或其他的建议和理由。
- 最终以用户确认结果为准。
- 用户确认后，后续大纲和正文生成按确认学段执行。

### 需要补齐的统一理解模型字段

```ts
interface UnifiedUnderstandingModel {
  pathType: 'existing_paper_revision' | 'from_scratch_generation'
  inputType: 'paper' | 'outline' | 'topic' | 'mixed_material'
  hasDetectedOutline: boolean
  hasDetectedDraft: boolean
  researchObject: string
  writingBoundary: string
  academicLevelSuggestion: '本科' | '硕士' | '期刊' | '其他'
  academicLevelReason: string
  confirmedAcademicLevel?: '本科' | '硕士' | '期刊'
  coreArguments: string[]
  outlineSummary?: string
  draftSummary?: string
  nextStepRecommendation:
    | 'generate_outline'
    | 'confirm_detected_outline'
    | 'revise_existing_draft'
    | 'write_from_outline'
}
```

### 需要实现的产品变化

- Stage1 prompt 输出扩展字段。
- Stage1 理解完成卡片展示：
  - 路径判断：已有论文修改 / 从 0 生成
  - 输入类型：已有论文 / 大纲 / 题目想法 / 混合材料
  - 是否识别到大纲
  - 是否识别到正文
  - 核心论点
  - AI 学段建议与理由
  - 用户确认学段
  - 建议下一步
- 已有论文路径明确“不学习语言风格，只理解研究对象、核心论点和结构”。
- 如果上传论文有清晰大纲，后续进入大纲确认或正文修改。
- 如果上传论文没有清晰大纲，先提取或生成大纲。
- 如果只给题目/想法，进入从 0 生成大纲路径。

### 主要影响文件

- `src/lib/prompts.ts`
- `src/pages/Stage1.tsx`
- `src/lib/storage.ts`
- 可能涉及 Stage2/Stage3 的跳转逻辑。

## F2 正文撰写 / 修改

### 已达成共识

保留现有“一键全文生成”作为增强能力。合同要求“每次只处理当前小节，不自动推进”，应作为基础验收能力补齐，而不是取代全文生成。

F2 最终包含三种动作：

1. 一键全文生成：基于确认大纲生成全文草稿，属于效率增强能力。
2. 当前小节生成：只生成指定小节，不自动推进，不影响其他小节。
3. 当前段落/选区修改：只修改用户选中的段落或当前小节，不影响其他正文。

### 需要实现的产品变化

- Stage3 增加 `生成当前小节`。
- 如果当前小节已有内容，显示 `重写本小节` 或 `重新生成本小节`。
- 点击重写前提示只会影响当前小节。
- 每次生成或重写当前小节都记录版本历史。
- 选区修改入口继续保留，并强化“只改选区/当前段落”的语义。
- 一键全文生成按钮保留，但文案上可以标注为快捷能力。
- 已有论文修改路径下，默认进入修改模式，不自动重写全文。
- 从 0 写作路径下，默认可一键生成全文，也可逐小节生成。

### 暂不优先处理的合同边界项

以下事项后续可补，但当前不作为第一优先级：

- 每个小节/段落微调次数统计。
- 超过 10 次提示。
- 模式 B 输入 500 字、原文 5000 字硬限制。
- 禁用词规则配置界面。

### 主要影响文件

- `src/pages/Stage3.tsx`
- `src/components/DocArea.tsx`
- `src/components/PaperEditor.tsx`
- `src/lib/prompts.ts`
- `src/lib/storage.ts`

## F1/F2 分阶段实现建议

### 阶段一：F1 识别模型

- 扩展 Stage1 prompt 和解析字段。
- 展示路径判断、学段建议、核心论点、下一步建议。
- 用户确认学段后再进入下一步。

### 阶段二：Stage2 支持提取/确认已有大纲

- 如果 Stage1 识别到已有大纲，Stage2 优先展示提取大纲。
- 如果没有大纲，Stage2 再生成大纲。
- Stage2 定位为“大纲确认中心”。

### 阶段三：F2 当前小节生成

- Stage3 支持生成/重写当前小节。
- 不自动推进。
- 不影响其他小节。
- 记录版本历史。

### 阶段四：已有论文修改路径

- 将上传的已有论文解析成正文 sections。
- 与提取或确认的大纲节点绑定。
- Stage3 默认进入修改模式。
- 一键全文生成弱化为可选快捷能力。

## F3 语言风格记忆库

### 已达成共识

语言风格记忆库必须与资料库分开。

- 资料库回答“写什么”，保存内容资料、案例、观点、背景、理论和可引用信息。
- 语言风格记忆库回答“怎么写”，保存某个学生/作者的语言水平、句式习惯、段落组织和论证节奏。
- 上传已有论文用于 F1 修改时，默认只理解研究对象、核心论点和结构，不学习语言风格。
- 只有用户明确选择“提取为风格档案”时，才进入 F3。

### 合同交付要求

- 输入参考文章，支持 Word/PDF。
- 单次参考文章上限 10000 字。
- 提取并存储语言风格特征。
- 支持多个学生独立档案，上限 50 个。
- 同一学生第二次使用时自动调取上次档案。
- 甲方可手动编辑、删除档案内容。
- 档案数据可导出为 txt/csv。
- 风格记忆效果依赖参考文章质量，不承诺风格相似度作为验收指标。

### 产品定义

F3 不做“模仿某篇文章内容”，而是为某个学生保存可复用的语言水平和表达习惯画像。后续写作时只作为表达约束调用，不复用参考文章的内容、观点、案例和具体表达。

建议命名：

- 导航入口：`风格档案`
- 单条数据：`学生风格档案`

### 建议数据模型

```ts
interface StyleProfile {
  id: string
  userId: string
  studentName: string
  profileName: string
  sourceFileName?: string
  sourceTextLength: number
  writingLevel: string
  sentenceStyle: string
  paragraphLogic: string
  argumentStyle: string
  transitionStyle: string
  vocabularyStyle: string
  avoidContentReuseNotice: string
  editableSummary: string
  createdAt: number
  updatedAt: number
}
```

### 风格提取结果应包含

- 语言水平：本科/硕士/期刊感、学术化程度、表达成熟度。
- 句式特征：长短句比例、常见句式、是否偏概念化表达。
- 段落组织：先提出观点还是先描述现象、段落展开节奏。
- 论证方式：概念解释、案例分析、理论连接、总结句习惯。
- 过渡方式：章节之间和段落之间如何衔接。
- 词汇风格：抽象词、学科术语、评价性词语使用习惯。
- 风险提醒：不得复用原文观点、案例、措辞或具体内容。

### 使用流程

1. 用户进入 `风格档案`。
2. 新建学生档案。
3. 上传参考文章 Word/PDF。
4. 系统只截取或处理前 10000 字。
5. AI 生成风格画像。
6. 用户可手动编辑画像。
7. 保存为学生档案。
8. 后续进入 Stage3 生成或修改正文时，可选择使用某个风格档案。
9. Prompt 中只注入风格画像，不注入原文内容。

### 写作调用规则

Stage3 生成或修改正文时，可以提供风格选择：

- 不使用风格档案
- 使用某个学生风格档案

Prompt 约束示例：

```text
【语言风格约束】
请参考以下风格画像调整表达方式：
...

注意：只参考语言水平、句式、段落组织和论证节奏，不复用参考文章的观点、案例、素材、原句或具体内容。
```

### 需要实现的产品变化

- 新增 `风格档案` 页面或资料库内独立 Tab。
- 支持学生风格档案列表。
- 支持新建、编辑、删除档案。
- 支持上传 Word/PDF 后提取风格画像。
- 支持档案上限 50 个。
- 支持同一学生后续自动调取或默认推荐最近档案。
- 支持导出 txt/csv。
- Stage3 生成和修改时支持选择风格档案。
- F1 已有论文修改路径默认不触发风格学习。

### 主要影响文件

- `src/pages/Library.tsx` 或新增 `src/pages/StyleProfiles.tsx`
- `src/components/Sidebar.tsx`
- `src/lib/prompts.ts`
- `src/lib/storage.ts`
- `src/lib/api.ts`
- 后端新增 style profile API 和 Supabase 表。

### 数据表建议

```sql
create table style_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  student_name text not null,
  profile_name text not null,
  source_file_name text,
  source_text_length integer not null default 0,
  writing_level text not null default '',
  sentence_style text not null default '',
  paragraph_logic text not null default '',
  argument_style text not null default '',
  transition_style text not null default '',
  vocabulary_style text not null default '',
  avoid_content_reuse_notice text not null default '',
  editable_summary text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

### 分阶段实现建议

#### 阶段一：本地风格档案

- 先用本地 store 做列表、新建、编辑、删除。
- 不影响现有资料库和写作主流程。

#### 阶段二：风格提取

- 复用文件上传/解析能力。
- 新增只提取风格的 prompt。
- 严格提示不提取具体内容。

#### 阶段三：写作调用

- Stage3 增加风格档案选择。
- 章节生成、当前小节生成、选区修改都可带风格画像。

#### 阶段四：云端与导出

- Supabase 表与 RLS。
- txt/csv 导出。
- 档案数量上限 50 个。

## F4 艺术类量表生成 + 质性研究辅助

待讨论与补充。

## F5 案例参考与提取

待讨论与补充。

## F6 成果文本导出

待讨论与补充。

## F7 历史回溯

待讨论与补充。
