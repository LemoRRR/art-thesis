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

待讨论与补充。

## F4 艺术类量表生成 + 质性研究辅助

待讨论与补充。

## F5 案例参考与提取

待讨论与补充。

## F6 成果文本导出

待讨论与补充。

## F7 历史回溯

待讨论与补充。
