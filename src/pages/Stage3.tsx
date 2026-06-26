import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { BookOpen, CheckCircle2, Copy, Download, FlaskConical, History, MessageSquare, RefreshCw, Send, Sparkles } from 'lucide-react'
import ChatBubble from '../components/ChatBubble'
import DocumentToolbar from '../components/DocumentToolbar'
import MentionInput, { type MentionRef } from '../components/MentionInput'
import PaperDocumentEditor from '../components/PaperDocumentEditor'
import ReferencePanel from '../components/ReferencePanel'
import type { CitationPatchDraft, EvidenceCardAction } from '../components/ReferencePanel'
import ResearchDrawer from '../components/ResearchDrawer'
import Sidebar from '../components/Sidebar'
import TopBar from '../components/TopBar'
import VersionPanel from '../components/VersionPanel'
import { callDoubao, callGPT, type Message } from '../lib/ai'
import { outlinesAPI, scholarAPI, type ScholarPaper } from '../lib/api'
import { formatAcademicOutlineText, formatAcademicOutlineTitle, formatAcademicSectionContentWithOutline, isFrontMatterTitle } from '../lib/academicFormat'
import {
  finalizeSectionWithCitations,
  formatChapterEvidenceForPrompt,
  formatEvidenceWritingRules,
  formatEvidencePackForPrompt,
  formatCitableSourcesForPrompt,
  formatCitationPlanForPrompt,
  getCitationPromptRules,
  getStageCitableSources,
  selectCitableSourcesForTopic,
  stripCitationMarkers,
} from '../lib/citations'
import { buildAIContext, buildMentionContext } from '../lib/context'
import { formatSectionContent, formatSectionsForPaper, parsePaperBlocks, sectionsToPlainText } from '../lib/documentFormat'
import { exportSectionsToDocx } from '../lib/docxExport'
import { editorDocToPlainText, ensurePaperEditorDoc, paperTextToEditorDoc } from '../lib/editorDocument'
import { buildBibliographyContent, buildBibliographySection, createFootnote, deleteFootnote, getAllFootnotes, updateFootnoteNote } from '../lib/footnotes'
import {
  promptAdjustFinish,
  promptFinishDraft,
  promptGenerateChapter,
  promptGenerateFrontMatter,
  promptGeneratePaperPlan,
  promptReviseSection,
  promptSummarizeGeneratedChapter,
  type AcademicLevel,
} from '../lib/prompts'
import {
  chatStore,
  outlineStore,
  projectStore,
  researchAssetStore,
  researchPackageStore,
  researchTaskStore,
  referenceStore,
  sectionStore,
  styleProfileStore,
  versionStore,
  type CitationEvidenceSource,
  type CitationEvidencePack,
  type ChatMessage,
  type DocSection,
  type Outline,
  type OutlineSection,
  type ProjectContext,
  type ResearchAsset,
  type StyleProfile,
} from '../lib/storage'
import { createPackageFromAsset, repairResearchTablesInDoc, researchPackageToPaperNodes, splitResearchAssetIntoComponents } from '../lib/researchPackages'

type Mode = 'revise' | 'finish'
type GenerationStepStatus = 'active' | 'done' | 'error'
interface GenerationStep {
  id: string
  label: string
  status: GenerationStepStatus
  timestamp: number
}

const OUTLINE_TRANSITION_MS = 2200

const uid = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

const stage3LifecycleKey = (message: ChatMessage): string | null => {
  if (message.role !== 'ai') return null
  const content = message.content.trim()
  if (message.id === 's3_ready_to_generate' || content.startsWith('大纲已确认。')) return 'ready'
  if (message.id === 's3_wait_outline' || content.startsWith('还没有确认的大纲。')) return 'wait-outline'
  if (content.startsWith('已确认大纲，先生成全文写作计划')) return 'generation-start'
  if (content.startsWith('全文已生成完毕，共') || content.startsWith('全文已生成可编辑初稿')) return 'generation-done'
  if (content.startsWith('已根据大纲同步正文结构')) return 'outline-sync'
  return null
}

const normalizeStage3Messages = (sourceMessages: ChatMessage[]): ChatMessage[] => {
  const latestIndexByKey = new Map<string, number>()
  const keys = sourceMessages.map(message => stage3LifecycleKey(message))
  keys.forEach((key, index) => {
    if (key) latestIndexByKey.set(key, index)
  })

  const hasGeneratedDone = keys.includes('generation-done')

  return sourceMessages.filter((_message, index) => {
    const key = keys[index]
    if (!key) return true
    if (latestIndexByKey.get(key) !== index) return false
    if (hasGeneratedDone && (key === 'generation-start' || key === 'ready')) return false
    return true
  })
}

const normalizeAcademicLevel = (level: string): AcademicLevel => {
  return level === '硕士' || level === '期刊' ? level : '本科'
}

function scholarPaperToEvidenceSource(paper: ScholarPaper, provider?: string): CitationEvidenceSource {
  return {
    id: paper.id || paper.doi || paper.url || `${paper.title}-${paper.year ?? ''}`,
    title: paper.title,
    authors: paper.authors ?? [],
    year: paper.year,
    source: paper.source,
    doi: paper.doi,
    url: paper.url,
    abstract: paper.abstract,
    provider,
    citedByCount: paper.citedByCount,
    relevanceReason: paper.relevanceReason,
  }
}

function buildCitationAuditNote(sections: DocSection[], sourceCount: number): string {
  if (sourceCount === 0) return '未检索到可靠文献，本次正文未自动插入引用。'
  const footnoteCount = getAllFootnotes(sections).length
  if (footnoteCount === 0) return '已检索到文献，但正文未稳定生成引用标记；建议稍后点击“生成当前小节”或手动查看来源后重试。'
  return `已自动检索并选用 ${sourceCount} 条学术来源，正文中生成 ${footnoteCount} 处引用。`
}

function generationProgressPercent(current: number, total: number): number {
  if (!total) return 8
  return Math.max(8, Math.min(100, Math.round((current / total) * 100)))
}

function waitForNextPaint(): Promise<void> {
  return new Promise(resolve => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      resolve()
    }
    window.setTimeout(finish, 80)
    window.requestAnimationFrame(() => {
      window.setTimeout(finish, 0)
    })
  })
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs)
    promise
      .then(resolve)
      .catch(reject)
      .finally(() => window.clearTimeout(timeoutId))
  })
}

function apiOutlineToLocal(projectId: string, value: unknown): Outline | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const sections = Array.isArray(row.sections) ? row.sections as OutlineSection[] : []
  if (sections.length === 0) return null
  return {
    projectId: typeof row.project_id === 'string' ? row.project_id : projectId,
    sections,
    confirmedAt: typeof row.confirmed_at === 'string' ? new Date(row.confirmed_at).getTime() : undefined,
    updatedAt: typeof row.updated_at === 'string' ? new Date(row.updated_at).getTime() : Date.now(),
  }
}

function fallbackSectionDraft(input: {
  projectTitle: string
  chapterTitle: string
  chapterOutline: string
  researchObject?: string
  academicLevel: AcademicLevel
  reason?: string
}) {
  const cleanOutline = input.chapterOutline
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, 6)
  const objectText = input.researchObject || input.projectTitle
  const outlineText = cleanOutline.length
    ? `本章围绕${cleanOutline.join('、')}展开论述。`
    : `本章围绕“${input.chapterTitle}”展开论述。`

  if (/摘要|Abstract/i.test(input.chapterTitle)) {
    return [
      `本文以“${input.projectTitle}”为研究主题，围绕${objectText}的核心问题展开分析。研究在梳理相关理论与实践背景的基础上，结合论文大纲所设定的章节结构，对研究对象的形成语境、主要特征、评价维度与现实意义进行系统讨论。`,
      '全文强调问题意识、结构逻辑与论证层次的统一，后续可继续补充文献引用、案例细节和数据支撑，以进一步增强论文的学术可信度。',
      input.reason ? `本段为系统在生成服务异常时写入的保底初稿，原因：${input.reason}。` : '本段为系统保底初稿，可继续使用 AI 进行精修。',
    ].join('\n\n')
  }

  return [
    `${input.chapterTitle}是全文论证中的重要组成部分。围绕“${input.projectTitle}”这一研究主题，本章首先需要明确${objectText}在论文整体问题中的位置，并说明其与前后章节之间的逻辑关系。${outlineText}`,
    '从论证层次看，本章可先交代相关概念与研究背景，再结合具体材料展开分析，最后回到论文主旨，对该部分内容在审美判断、价值评价或方法建构中的意义进行归纳。这样的写法有助于避免章节之间彼此割裂，也能使读者更清晰地理解本章为何是全文论证链条中的必要环节。',
    `在正式完善时，建议继续补入可核验的文献来源、案例材料或研究计算结果，并根据${input.academicLevel}论文要求调整段落密度、引用规范和分析深度。${input.reason ? `本段为系统在生成服务异常时写入的保底初稿，原因：${input.reason}。` : '本段为系统保底初稿，可继续使用 AI 进行精修。'}`,
  ].join('\n\n')
}

function shouldPreserveExistingDraft(projectContext: ProjectContext): boolean {
  return Boolean(
    projectContext.hasDetectedDraft ||
    projectContext.pathType === 'existing_paper_revision' ||
    projectContext.nextStepRecommendation === 'revise_existing_draft'
  )
}

function outlineToText(sections: OutlineSection[], depth = 0): string {
  return formatAcademicOutlineText(sections, depth)
}

function chapterChildrenToText(section: OutlineSection): string {
  if (!section.children?.length) return section.title
  return section.children.map(child => {
    const grandchildren = child.children?.length
      ? `\n${child.children.map(grandchild => `    ${formatAcademicOutlineTitle(grandchild)}`).join('\n')}`
      : ''
    return `  ${formatAcademicOutlineTitle(child)}${grandchildren}`
  }).join('\n')
}

function outlineSectionTitle(section: OutlineSection): string {
  return formatAcademicOutlineTitle(section)
}

function isAbstractOutlineSection(section: OutlineSection): boolean {
  return section.order === '0' || isFrontMatterTitle(section.title)
}

function ensureFrontMatterOutlineSection(sections: OutlineSection[]): OutlineSection[] {
  const abstractSection = sections.find(isAbstractOutlineSection)
  if (abstractSection) {
    return [
      { ...abstractSection, order: '0', level: 1, title: '摘要', children: undefined },
      ...sections.filter(section => section !== abstractSection),
    ]
  }

  return [
    {
      id: 'front-matter-abstract',
      order: '0',
      level: 1,
      title: '摘要',
    },
    ...sections,
  ]
}

function outlineChildrenSignature(section: OutlineSection): string {
  return outlineToText(section.children ?? [])
}

function findOutlineSectionById(sections: OutlineSection[], id?: string): OutlineSection | null {
  if (!id) return null
  for (const section of sections) {
    if (section.id === id) return section
    const child = section.children ? findOutlineSectionById(section.children, id) : null
    if (child) return child
  }
  return null
}

function formatStyleProfileForPrompt(profile?: StyleProfile | null): string | undefined {
  if (!profile) return undefined
  return [
    `学生风格档案：${profile.profileName}（${profile.studentName}）`,
    `语言水平：${profile.writingLevel}`,
    `句式特征：${profile.sentenceStyle}`,
    `段落组织：${profile.paragraphLogic}`,
    `论证方式：${profile.argumentStyle}`,
    `过渡方式：${profile.transitionStyle}`,
    `词汇风格：${profile.vocabularyStyle}`,
    `风格画像：${profile.editableSummary}`,
    `边界：${profile.avoidContentReuseNotice || '只参考表达方式，不复用参考文章内容。'}`,
  ].filter(Boolean).join('\n')
}

function clipResearchText(text: string, max = 5000) {
  const clean = text.trim()
  return clean.length > max ? `${clean.slice(0, max).trim()}\n……（研究资产已截断，仅保留前部核心内容）` : clean
}

function researchAssetSectionTitle(asset: ResearchAsset) {
  if (asset.type === 'quant_analysis_result') return '第四章 数据分析结果'
  if (asset.type === 'survey_questionnaire' || asset.type === 'scale_schema') return '问卷设计与变量测量'
  if (asset.type === 'kano_result') return 'KANO需求分析'
  if (asset.type === 'ahp_result') return 'AHP评价指标体系'
  if (asset.type === 'qualitative_coding') return '质性编码分析'
  if (asset.type === 'questionnaire_review') return '问卷优化说明'
  return '研究工具设计'
}

function researchAssetOrder(asset: ResearchAsset) {
  if (asset.type === 'quant_analysis_result') return 4
  if (asset.type === 'survey_questionnaire' || asset.type === 'scale_schema') return 3
  if (asset.type === 'kano_result' || asset.type === 'ahp_result') return 4
  if (asset.type === 'qualitative_coding') return 4
  return 3
}

function isResearchAssetSection(section: DocSection) {
  return section.id.startsWith('research-') ||
    section.id.startsWith('research-section-') ||
    section.id.startsWith('research-generated-') ||
    section.id.startsWith('research-polished-') ||
    Boolean(section.sourceRefs?.some(id => researchAssetStore.get(id)))
}

function buildResearchReferenceContext(assetIds: string[]) {
  const assets = assetIds
    .map(id => researchAssetStore.get(id))
    .filter((asset): asset is ResearchAsset => Boolean(asset && asset.plainText.trim()))
  if (assets.length === 0) return ''
  return [
    '【Stage3 调用的研究计算资产】',
    '以下材料只作为论文表达和整合依据。不要机械粘贴原文；应结合当前章节任务转写为论文语言。',
    ...assets.map((asset, index) => [
      `${index + 1}. ${asset.title}`,
      `类型：${asset.type}`,
      `摘要：${asset.summary}`,
      `内容：\n${clipResearchText(asset.plainText, 2600)}`,
    ].join('\n')),
  ].join('\n\n')
}

function promptGenerateResearchAssetSection(
  asset: ResearchAsset,
  projectTitle: string,
  fullPaperText: string,
  academicLevel: AcademicLevel,
  styleGuide?: string
): Message[] {
  return [
    {
      role: 'system',
      content: `你是论文表达中心。请把研究计算资产转写成论文正文小节，而不是原样粘贴材料。

要求：
1. 使用正式论文语言，结构清楚，避免口语化。
2. 保留关键表格/问卷/统计结论的信息，但压缩冗余说明。
3. 如果资产是问卷或量表，重点写研究工具设计、变量测量、题项构成和后续使用方式。
4. 如果资产是分析结果，重点写样本、指标、结果含义和与论文主题的关系。
5. 不编造资产中没有的数据和结论。
6. 学段要求：${academicLevel}。
${styleGuide ? `\n【风格档案】\n${styleGuide}` : ''}`,
    },
    {
      role: 'user',
      content: `论文题目：${projectTitle}

建议小节标题：${researchAssetSectionTitle(asset)}

【全文上下文】
${clipResearchText(fullPaperText || '暂无已生成正文。', 3000)}

【研究计算资产】
标题：${asset.title}
摘要：${asset.summary}
内容：
${clipResearchText(asset.plainText)}

请生成可直接放入论文的正文小节。`,
    },
  ]
}

function promptPolishResearchAssetIntoSection(
  asset: ResearchAsset,
  sectionTitle: string,
  currentContent: string,
  projectTitle: string,
  academicLevel: AcademicLevel,
  styleGuide?: string
): Message[] {
  return [
    {
      role: 'system',
      content: `你是论文表达中心。请把研究计算资产整合进当前论文小节。

要求：
1. 不是把资产原文附在末尾，而是改写、融入、承接当前小节。
2. 保留当前小节已有论述中仍然有价值的内容。
3. 根据资产类型决定写法：问卷/量表写方法与测量；分析结果写结果与解释；KANO/AHP写设计评价；质性编码写主题与编码。
4. 不编造资产中没有的数据。
5. 学段要求：${academicLevel}。
${styleGuide ? `\n【风格档案】\n${styleGuide}` : ''}`,
    },
    {
      role: 'user',
      content: `论文题目：${projectTitle}
当前小节：${sectionTitle}

【当前小节原文】
${currentContent.trim() || '当前小节尚无正文。'}

【需要整合的研究计算资产】
标题：${asset.title}
摘要：${asset.summary}
内容：
${clipResearchText(asset.plainText)}

请输出整合后的完整小节正文。`,
    },
  ]
}

function OutlineToDraftTransition({
  title,
  current,
  total,
}: {
  title: string
  current: number
  total: number
}) {
  const progress = total > 0 ? Math.max(10, Math.min(100, (current / total) * 100)) : 18

  return (
    <div className="outline-draft-transition" aria-live="polite">
      <div className="outline-draft-panel">
        <div className="outline-draft-kicker">大纲已确认</div>
        <div className="outline-draft-title">正在把结构转成全文写作计划</div>
        <div className="outline-draft-subtitle">
          {title || '未命名论文'} · {total > 0 ? `准备生成 ${total} 章正文` : '正在读取大纲结构'}
        </div>

        <div className="outline-draft-flow" aria-hidden="true">
          <div className="outline-draft-node is-source">大纲节点</div>
          <div className="outline-draft-stream">
            <span />
            <span />
            <span />
          </div>
          <div className="outline-draft-node is-plan">全文计划</div>
          <div className="outline-draft-stream">
            <span />
            <span />
            <span />
          </div>
          <div className="outline-draft-node is-draft">逐章正文</div>
        </div>

        <div className="outline-draft-progress">
          <div style={{ width: `${progress}%` }} />
        </div>
        <div className="outline-draft-status">
          {total > 0 && current > 0 ? `正在生成第 ${current} / ${total} 章…` : '正在整理章节论点、承接关系和引用策略…'}
        </div>
      </div>

      <style>{`
        .outline-draft-transition {
          position: absolute;
          inset: 0;
          z-index: 240;
          display: grid;
          place-items: center;
          background: rgba(250, 249, 245, 0.88);
          backdrop-filter: blur(8px);
          animation: outline-fade-in 0.18s ease-out both;
        }

        .outline-draft-panel {
          width: min(640px, calc(100vw - 48px));
          border: 1px solid rgba(45, 90, 61, 0.18);
          border-radius: 8px;
          background: #fff;
          box-shadow: 0 24px 60px rgba(38, 32, 24, 0.16);
          padding: 30px 34px;
          font-family: var(--font-sans);
        }

        .outline-draft-kicker {
          color: var(--color-accent);
          font-size: 12px;
          font-weight: 650;
          letter-spacing: 0.08em;
        }

        .outline-draft-title {
          margin-top: 8px;
          color: var(--color-ink);
          font-size: 22px;
          font-weight: 700;
        }

        .outline-draft-subtitle {
          margin-top: 8px;
          color: var(--color-ink-3);
          font-size: 13px;
        }

        .outline-draft-flow {
          margin-top: 28px;
          display: grid;
          grid-template-columns: 1fr 72px 1fr 72px 1fr;
          align-items: center;
          gap: 10px;
        }

        .outline-draft-node {
          height: 74px;
          border: 1px solid var(--color-border);
          border-radius: 8px;
          display: grid;
          place-items: center;
          color: var(--color-ink-2);
          background: var(--color-bg);
          font-size: 13px;
          font-weight: 650;
        }

        .outline-draft-node.is-plan {
          background: var(--color-accent-light);
          color: var(--color-accent);
          border-color: rgba(45, 90, 61, 0.18);
        }

        .outline-draft-node.is-draft {
          background: var(--color-accent);
          color: #fff;
          border-color: var(--color-accent);
          box-shadow: 0 10px 26px rgba(45, 90, 61, 0.18);
        }

        .outline-draft-stream {
          display: flex;
          justify-content: center;
          gap: 5px;
          overflow: hidden;
        }

        .outline-draft-stream span {
          width: 8px;
          height: 8px;
          border-radius: 999px;
          background: var(--color-accent);
          opacity: 0.2;
          animation: outline-pulse 1.1s ease-in-out infinite;
        }

        .outline-draft-stream span:nth-child(2) { animation-delay: 0.16s; }
        .outline-draft-stream span:nth-child(3) { animation-delay: 0.32s; }

        .outline-draft-progress {
          margin-top: 28px;
          height: 5px;
          border-radius: 999px;
          background: #E8E2D8;
          overflow: hidden;
        }

        .outline-draft-progress div {
          height: 100%;
          border-radius: inherit;
          background: var(--color-accent);
          transition: width 0.35s ease;
        }

        .outline-draft-status {
          margin-top: 10px;
          color: var(--color-ink-3);
          font-size: 12px;
          text-align: right;
        }

        @keyframes outline-fade-in {
          from { opacity: 0; transform: scale(0.99); }
          to { opacity: 1; transform: scale(1); }
        }

        @keyframes outline-pulse {
          0%, 100% { opacity: 0.2; transform: translateX(-6px) scale(0.82); }
          50% { opacity: 1; transform: translateX(6px) scale(1); }
        }
      `}</style>
    </div>
  )
}

function FullGenerationProgressPage({
  title,
  current,
  total,
  percent,
  statusLabel,
  steps,
  completedCount,
  sourceCount,
}: {
  title: string
  current: number
  total: number
  percent: number
  statusLabel: string
  steps: GenerationStep[]
  completedCount: number
  sourceCount: number
}) {
  const logRef = useRef<HTMLDivElement>(null)
  const visibleSteps = steps.length > 0
    ? steps
    : [{ id: 'boot', label: '正在启动全文生成任务', status: 'active' as const, timestamp: 0 }]

  useEffect(() => {
    const node = logRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [visibleSteps.length])

  return (
    <div className="stage3-generation-page" aria-live="polite">
      <div className="stage3-generation-card">
        <div className="stage3-generation-head">
          <div>
            <div className="stage3-generation-kicker">AI 正在生成全文</div>
            <div className="stage3-generation-title">{title || '未命名论文'}</div>
            <div className="stage3-generation-subtitle">
              系统会先检索文献和规划引用，再逐章写入正文。当前页面可以停留等待，已完成内容会自动保存。
            </div>
          </div>
          <div className="stage3-generation-percent">{percent}%</div>
        </div>

        <div className="stage3-generation-bar">
          <div style={{ width: `${percent}%` }} />
        </div>

        <div className="stage3-generation-current">
          <Sparkles size={15} />
          <span>{statusLabel || (total > 0 ? `正在生成第 ${current} / ${total} 章…` : '正在准备全文生成…')}</span>
        </div>

        <div className="stage3-generation-metrics">
          <div>
            <strong>{completedCount}</strong>
            <span>已完成章节</span>
          </div>
          <div>
            <strong>{Math.max(total, 0)}</strong>
            <span>计划章节</span>
          </div>
          <div>
            <strong>{sourceCount}</strong>
            <span>可用来源</span>
          </div>
        </div>

        <div className="stage3-generation-log" ref={logRef}>
          {visibleSteps.map((step, index) => (
            <div key={step.id} className={`stage3-generation-log-row is-${step.status}`}>
              <span className="stage3-generation-log-dot" />
              <div>
                <div>{step.label}</div>
                <small>{index === visibleSteps.length - 1 && step.status === 'active' ? '正在处理' : step.status === 'error' ? '已降级处理' : '已完成'}</small>
              </div>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        .stage3-generation-page {
          flex: 1;
          min-width: 0;
          overflow: auto;
          background: #F4F1EA;
          display: grid;
          place-items: start center;
          padding: 56px 24px 72px;
          font-family: var(--font-sans);
        }

        .stage3-generation-card {
          width: min(760px, 100%);
          border: 1px solid rgba(45, 90, 61, 0.16);
          border-radius: 8px;
          background: #fff;
          box-shadow: 0 18px 44px rgba(38, 32, 24, 0.12);
          padding: 26px 28px;
        }

        .stage3-generation-head {
          display: flex;
          justify-content: space-between;
          gap: 24px;
          align-items: flex-start;
        }

        .stage3-generation-kicker {
          color: var(--color-accent);
          font-size: 12px;
          font-weight: 800;
        }

        .stage3-generation-title {
          margin-top: 8px;
          color: var(--color-ink);
          font-size: 20px;
          font-weight: 850;
          line-height: 1.35;
        }

        .stage3-generation-subtitle {
          margin-top: 8px;
          color: var(--color-ink-3);
          font-size: 13px;
          line-height: 1.7;
        }

        .stage3-generation-percent {
          flex-shrink: 0;
          width: 68px;
          height: 68px;
          border-radius: 999px;
          border: 1px solid rgba(45, 90, 61, 0.18);
          display: grid;
          place-items: center;
          color: var(--color-accent);
          background: var(--color-accent-light);
          font-size: 17px;
          font-weight: 850;
        }

        .stage3-generation-bar {
          margin-top: 24px;
          height: 8px;
          border-radius: 999px;
          background: #E8E2D8;
          overflow: hidden;
        }

        .stage3-generation-bar div {
          height: 100%;
          border-radius: inherit;
          background: linear-gradient(90deg, var(--color-accent), #8DC5A1);
          transition: width 0.35s ease;
        }

        .stage3-generation-current {
          margin-top: 16px;
          display: flex;
          align-items: center;
          gap: 8px;
          color: var(--color-accent);
          font-size: 13px;
          font-weight: 750;
        }

        .stage3-generation-current svg {
          animation: stage3-generation-pulse 1.3s ease-in-out infinite;
        }

        .stage3-generation-metrics {
          margin-top: 18px;
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
        }

        .stage3-generation-metrics div {
          border: 1px solid var(--color-border);
          border-radius: 8px;
          background: #FBFAF7;
          padding: 12px;
          display: grid;
          gap: 4px;
        }

        .stage3-generation-metrics strong {
          color: var(--color-ink);
          font-size: 18px;
        }

        .stage3-generation-metrics span {
          color: var(--color-ink-3);
          font-size: 12px;
        }

        .stage3-generation-log {
          margin-top: 18px;
          max-height: 260px;
          overflow-y: auto;
          border: 1px solid var(--color-border);
          border-radius: 8px;
          background: #FCFBF8;
          padding: 8px;
        }

        .stage3-generation-log-row {
          display: grid;
          grid-template-columns: 10px 1fr;
          gap: 9px;
          padding: 9px 8px;
          color: var(--color-ink-2);
          font-size: 12px;
          line-height: 1.5;
        }

        .stage3-generation-log-row + .stage3-generation-log-row {
          border-top: 1px solid rgba(38, 32, 24, 0.06);
        }

        .stage3-generation-log-row small {
          display: block;
          margin-top: 2px;
          color: var(--color-ink-3);
          font-size: 11px;
        }

        .stage3-generation-log-dot {
          width: 7px;
          height: 7px;
          margin-top: 5px;
          border-radius: 999px;
          background: var(--color-accent);
        }

        .stage3-generation-log-row.is-active .stage3-generation-log-dot {
          animation: stage3-generation-pulse 1.1s ease-in-out infinite;
        }

        .stage3-generation-log-row.is-done .stage3-generation-log-dot {
          background: var(--color-border-strong);
        }

        .stage3-generation-log-row.is-error .stage3-generation-log-dot {
          background: #D8614C;
        }

        .stage3-generation-log-row.is-error {
          color: #A13B2D;
        }

        @keyframes stage3-generation-pulse {
          0%, 100% { opacity: 0.45; transform: scale(0.92); }
          50% { opacity: 1; transform: scale(1.08); }
        }
      `}</style>
    </div>
  )
}

function normalizeSectionTitle(title: string): string {
  return title
    .replace(/^\s*\d+(?:\.\d+)*\s*/, '')
    .replace(/\s+/g, '')
    .trim()
}

function normalizeMeaningTitle(title: string): string {
  return title
    .replace(/^\s*\d+(?:\.\d+)*\s*/, '')
    .replace(/[：:，,。.\s]/g, '')
    .trim()
}

function streamGPTText(
  messages: Message[],
  signal?: AbortSignal,
  onChunk?: (text: string) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    let fullContent = ''
    callGPT(
      messages,
      {
        onChunk: (chunk) => {
          fullContent += chunk
          onChunk?.(fullContent)
        },
        onDone: () => resolve(fullContent),
        onError: reject,
      },
      signal
    )
  })
}

function BibliographyCard({
  content,
  footnoteCount,
}: {
  content: string
  footnoteCount: number
}) {
  if (!content) return null

  return (
    <div style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border)', fontSize: 11, color: 'var(--color-ink-3)', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span>参考文献（由 {footnoteCount} 条脚注自动生成）</span>
        <button
          onClick={async () => {
            await navigator.clipboard.writeText(content)
            alert('参考文献已复制')
          }}
          style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-ink-3)', fontSize: 11, flexShrink: 0 }}
        >
          复制
        </button>
      </div>
      <div style={{ padding: 12, fontSize: 12, lineHeight: 1.85, color: 'var(--color-ink-2)', whiteSpace: 'pre-wrap', maxHeight: 180, overflowY: 'auto' }}>
        {content}
      </div>
      <div style={{ padding: '8px 12px', borderTop: '1px solid var(--color-border)', fontSize: 11, color: 'var(--color-ink-3)' }}>
        点击正文或页脚中的 [n] 可编辑/删除脚注；导出 Word 时会附带本章参考文献。
      </div>
    </div>
  )
}

function extractFinishPart(result: string, heading: string) {
  const aliases: Record<string, string[]> = {
    摘要: ['摘要', '中文摘要'],
    关键词: ['关键词', '关键字'],
    Keywords: ['Keywords', 'Keyword'],
  }
  const normalizeLabel = (value: string) => value.toLowerCase().replace(/\s+/g, '')
  const wanted = new Set((aliases[heading] ?? [heading]).map(normalizeLabel))
  let current = ''
  let captured = ''

  result.split(/\n+/).forEach(raw => {
    const text = raw.trim()
    if (!text) return
    const match = text.match(/^【?\s*(摘要|中文摘要|关键词|关键字|Abstract|Keywords?|引言|结语)\s*】?\s*[:：]?\s*(.*)$/i)
    if (match) {
      current = normalizeLabel(match[1])
      const rest = match[2]?.trim()
      if (rest && wanted.has(current)) captured = [captured, rest].filter(Boolean).join('\n')
      return
    }
    if (wanted.has(current)) captured = [captured, text].filter(Boolean).join('\n')
  })

  return captured.trim()
}

function buildFinishSections(result: string, projectId: string): DocSection[] {
  const abstractParts = [
    extractFinishPart(result, '摘要') ? `【摘要】\n${extractFinishPart(result, '摘要')}` : '',
    extractFinishPart(result, '关键词') ? `【关键词】\n${extractFinishPart(result, '关键词')}` : '',
    extractFinishPart(result, 'Abstract') ? `【Abstract】\n${extractFinishPart(result, 'Abstract')}` : '',
    extractFinishPart(result, 'Keywords') ? `【Keywords】\n${extractFinishPart(result, 'Keywords')}` : '',
  ].filter(Boolean).join('\n\n')
  const introduction = extractFinishPart(result, '引言')
  const conclusion = extractFinishPart(result, '结语')
  const now = Date.now()

  const finishSections: Array<DocSection | null> = [
    abstractParts ? {
      id: 'finish-abstract-export',
      projectId,
      title: '摘要与 Abstract',
      content: formatSectionContent(abstractParts),
      status: 'done' as const,
      lastModified: now,
      order: -2,
    } : null,
    introduction ? {
      id: 'finish-introduction-export',
      projectId,
      title: '引言',
      content: formatSectionContent(introduction),
      status: 'done' as const,
      lastModified: now,
      order: -1,
    } : null,
    conclusion ? {
      id: 'finish-conclusion-export',
      projectId,
      title: '结语',
      content: formatSectionContent(conclusion),
      status: 'done' as const,
      lastModified: now,
      order: Number.MAX_SAFE_INTEGER - 1,
    } : null,
  ]

  return finishSections.filter((section): section is DocSection => section !== null)
}

export default function Stage3() {
  const navigate = useNavigate()
  const location = useLocation()
  const params = useParams()
  const project = projectStore.ensure(params.projectId)
  const bottomRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const hasStartedGenerationRef = useRef(false)
  const generationRunIdRef = useRef(0)

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [sections, setSections] = useState<DocSection[]>([])
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null)
  const [inputText, setInputText] = useState('')
  const [mode, setMode] = useState<Mode>('revise')
  const [isLoading, setIsLoading] = useState(false)
  const [streamingId, setStreamingId] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [showReferences, setShowReferences] = useState(false)
  const [showResearchDrawer, setShowResearchDrawer] = useState(false)
  const [researchReferenceAssetIds, setResearchReferenceAssetIds] = useState<string[]>([])
  const [isGeneratingFull, setIsGeneratingFull] = useState(false)
  const [isPreparingDraft, setIsPreparingDraft] = useState(() => {
    const outline = outlineStore.get(project.id)
    return sectionStore.getByProject(project.id).length === 0 && Boolean(outline?.sections?.length && !shouldPreserveExistingDraft(project.context))
  })
  const [awaitingDraftStart, setAwaitingDraftStart] = useState(() => {
    const outline = outlineStore.get(project.id)
    return sectionStore.getByProject(project.id).length === 0 && Boolean(outline?.sections?.length && !shouldPreserveExistingDraft(project.context))
  })
  const [generatingProgress, setGeneratingProgress] = useState({ current: 0, total: 0 })
  const [generationStatusLabel, setGenerationStatusLabel] = useState('')
  const [generationSteps, setGenerationSteps] = useState<GenerationStep[]>([])
  const [pendingAddedOutlineSections, setPendingAddedOutlineSections] = useState<OutlineSection[]>([])
  const [generationErrorMessage, setGenerationErrorMessage] = useState('')
  const [citationAuditNote, setCitationAuditNote] = useState('')
  const [allGenerated, setAllGenerated] = useState(false)
  const [finishResult, setFinishResult] = useState('')
  const [finishLoading, setFinishLoading] = useState(false)
  const [adjustInput, setAdjustInput] = useState('')
  const [isAdjusting, setIsAdjusting] = useState(false)
  const [projectTitle, setProjectTitle] = useState(project.title)
  const [mentions, setMentions] = useState<MentionRef[]>([])
  const [selectedStyleProfileId, setSelectedStyleProfileId] = useState('')
  const [showOutlineTransition, setShowOutlineTransition] = useState(() => {
    const key = `outline_to_draft_transition_${project.id}`
    const markedAt = Number(sessionStorage.getItem(key) ?? 0)
    const state = location.state as { fromOutline?: boolean } | null
    const search = new URLSearchParams(location.search)
    return Boolean(state?.fromOutline || search.get('transition') === 'outline' || (markedAt && Date.now() - markedAt < 30_000))
  })

  const academicLevel = normalizeAcademicLevel(project.context.academicLevel)
  const styleProfiles = useMemo(() => styleProfileStore.getAll(), [])
  const selectedStyleProfile = useMemo(
    () => styleProfiles.find(profile => profile.id === selectedStyleProfileId) ?? null,
    [selectedStyleProfileId, styleProfiles]
  )
  const activeStyleGuide = useMemo(() => {
    const profileGuide = formatStyleProfileForPrompt(selectedStyleProfile)
    return [project.context.stylePreference, profileGuide].filter(Boolean).join('\n\n') || undefined
  }, [project.context.stylePreference, selectedStyleProfile])
  const resolveOutlineForGeneration = useCallback(async (): Promise<Outline | null> => {
    const localOutline = outlineStore.get(project.id)
    if (localOutline?.sections?.length) return localOutline

    try {
      const remoteOutline = apiOutlineToLocal(
        project.id,
        await withTimeout(outlinesAPI.getByProject(project.id), 6_000, '读取线上大纲超过 6 秒')
      )
      if (remoteOutline?.sections?.length) {
        outlineStore.save(remoteOutline)
        return remoteOutline
      }
    } catch (error) {
      console.warn('[Stage3] Failed to reload outline before generation', error)
    }

    return null
  }, [project.id])
  const footnoteCount = useMemo(() => getAllFootnotes(sections).length, [sections])
  const bibliographyContent = useMemo(() => buildBibliographyContent(sections), [sections])
  const incompleteSectionCount = useMemo(
    () => sections.filter(section => section.status !== 'done').length,
    [sections]
  )
  const showGenerationRecovery = !isGeneratingFull && sections.length > 0 && (!allGenerated || incompleteSectionCount > 0)
  const generationPercent = generationProgressPercent(generatingProgress.current, generatingProgress.total)

  const pushGenerationStep = useCallback((label: string, status: GenerationStepStatus = 'active') => {
    setGenerationSteps(prev => {
      const closedPrev = prev.map((step, index) =>
        index === prev.length - 1 && step.status === 'active' ? { ...step, status: 'done' as const } : step
      )
      return [...closedPrev, { id: uid(), label, status, timestamp: Date.now() }].slice(-8)
    })
  }, [])

  useEffect(() => {
    if (!showOutlineTransition) return
    const key = `outline_to_draft_transition_${project.id}`
    sessionStorage.removeItem(key)
    if (new URLSearchParams(location.search).get('transition') === 'outline') {
      window.history.replaceState(window.history.state, '', location.pathname)
    }
    const timer = window.setTimeout(() => setShowOutlineTransition(false), OUTLINE_TRANSITION_MS)
    return () => window.clearTimeout(timer)
  }, [location.pathname, location.search, project.id, showOutlineTransition])

  const persistSections = useCallback((next: DocSection[], snapshotLabel?: string) => {
    sectionStore.saveForProject(project.id, next)
    if (snapshotLabel) versionStore.snapshot(snapshotLabel, project.id)
    return next
  }, [project.id])

  const repairMissingResearchTables = useCallback((inputSections: DocSection[]) => {
    let changed = false
    const repairedSections = inputSections.map(section => {
      const sourceRefs = section.sourceRefs ?? []
      if (sourceRefs.length === 0) return section

      const packages = sourceRefs
        .map(ref => researchPackageStore.get(ref))
        .filter((pkg): pkg is NonNullable<ReturnType<typeof researchPackageStore.get>> => Boolean(pkg))

      const assetPackages = sourceRefs
        .map(ref => researchAssetStore.get(ref))
        .filter((asset): asset is NonNullable<ReturnType<typeof researchAssetStore.get>> => Boolean(asset))
        .map(asset => ({
          id: `repair-${asset.id}`,
          projectId: project.id,
          title: asset.title,
          method: asset.type,
          methodLabel: asset.summary,
          capabilityTier: 'partial_loop' as const,
          components: splitResearchAssetIntoComponents(asset),
          insertedComponentIds: [],
          versions: [],
          createdAt: asset.createdAt,
          updatedAt: asset.updatedAt,
        }))

      const repairSources = [...packages, ...assetPackages].filter(pkg => pkg.components.length > 0)
      if (repairSources.length === 0) return section

      const sourceDoc = ensurePaperEditorDoc(section.content, section.editorDoc)
      const repaired = repairResearchTablesInDoc(sourceDoc, repairSources)
      if (!repaired.changed) return section

      changed = true
      return {
        ...section,
        content: editorDocToPlainText(repaired.doc),
        editorDoc: repaired.doc,
        lastModified: Date.now(),
      }
    })

    return { sections: repairedSections, changed }
  }, [project.id])

  const saveStageMessages = useCallback((nextMessages: ChatMessage[]) => {
    const normalizedMessages = normalizeStage3Messages(nextMessages)
    chatStore.saveForProject(project.id, 'stage3', normalizedMessages)
    return normalizedMessages
  }, [project.id])

  const buildCitationAwareContext = useCallback((baseContext: string, mentionItemIds: string[] = []) => {
    const citableSources = getStageCitableSources(project.id, mentionItemIds)
    const evidencePack = referenceStore.get(project.id, 'stage3').evidencePack
    const citationContext = [
      baseContext,
      formatCitableSourcesForPrompt(citableSources),
      formatCitationPlanForPrompt(evidencePack, citableSources),
      formatEvidencePackForPrompt(evidencePack, citableSources),
      formatEvidenceWritingRules(citableSources.length > 0),
      `【引用脚注规则】\n${getCitationPromptRules(citableSources.length > 0)}`,
    ].filter(Boolean).join('\n\n')

    return { citationContext, citableSources, evidencePack }
  }, [project.id])

  const buildChapterCitationContext = useCallback((
    baseContext: string,
    sources: ReturnType<typeof getStageCitableSources>,
    evidencePack: CitationEvidencePack | undefined,
    chapterTitle: string,
    chapterOutline: string
  ) => {
    const chapterSources = selectCitableSourcesForTopic(
      sources,
      `${projectTitle}\n${project.context.researchObject ?? ''}\n${chapterTitle}\n${chapterOutline}`,
      8
    )
    return [
      baseContext,
      chapterSources.length > 0
        ? '【本章优先证据包】\n以下来源是系统根据当前章节标题和小节结构自动匹配的优先来源。生成正文时先利用这些来源建立论证，再决定是否插入引用。'
        : '',
      formatCitableSourcesForPrompt(chapterSources),
      formatCitationPlanForPrompt(evidencePack, sources),
      formatChapterEvidenceForPrompt(evidencePack, sources, chapterTitle),
      formatEvidenceWritingRules(chapterSources.length > 0),
      `【引用脚注规则】\n${getCitationPromptRules(chapterSources.length > 0)}`,
    ].filter(Boolean).join('\n\n')
  }, [project.context.researchObject, projectTitle])

  const prepareAutoCitationContext = useCallback(async (
    outlineSections: OutlineSection[],
    baseContext: string,
    mentionItemIds: string[] = [],
    options: { force?: boolean } = {}
  ) => {
    const selection = referenceStore.get(project.id, 'stage3')
    const shouldPrepare = selection.autoCitationEnabled !== false && (options.force || !(selection.autoSources?.length))

    if (shouldPrepare) {
      setGenerationStatusLabel('正在检索相关学术文献…')
      try {
        const response = await scholarAPI.prepare({
          title: projectTitle,
          outline: outlineToText(outlineSections),
          researchObject: project.context.researchObject,
          academicLevel,
          limit: 40,
          targetFinalCitationCount: 30,
          firstDraftCitationCount: 16,
        })
        const autoSources = response.autoSources.map(source => scholarPaperToEvidenceSource(source, response.provider))
        referenceStore.save({
          ...selection,
          autoCitationEnabled: true,
          autoSources,
          evidencePack: response.evidencePack,
          lastAutoRunAt: Date.now(),
        })
        const evidenceSummary = response.evidencePack?.summary ? `\n证据包：${response.evidencePack.summary}` : ''
        setCitationAuditNote((response.auditNote || (autoSources.length ? `已自动筛选 ${autoSources.length} 条学术来源。` : '未检索到可靠文献，本次不会自动插入引用。')) + evidenceSummary)
      } catch (error) {
        referenceStore.save({
          ...selection,
          autoCitationEnabled: true,
          autoSources: [],
          evidencePack: undefined,
          lastAutoRunAt: Date.now(),
        })
        const message = error instanceof Error ? error.message : '请稍后重试'
        const serviceHint = message.includes('404') || message.includes('401') || message.includes('Failed to fetch')
          ? '文献检索服务未连接或登录态失效，已降级为普通正文生成。请刷新/重新登录后再试自动引用。'
          : `文献检索失败，已降级为普通正文生成：${message}`
        setCitationAuditNote(serviceHint)
      }
    }

    setGenerationStatusLabel('正在筛选来源并组织引用策略…')
    return buildCitationAwareContext(baseContext, mentionItemIds)
  }, [academicLevel, buildCitationAwareContext, project.context.researchObject, project.id, projectTitle])

  const reconcileSectionsWithOutline = useCallback((sourceSections: DocSection[], outlineSections: OutlineSection[]) => {
    const usedSectionIds = new Set<string>()
    const nextSections: DocSection[] = []
    const addedOutlineSections: OutlineSection[] = []
    const removedSections: DocSection[] = []
    const notices: string[] = []

    outlineSections.forEach((outlineSection, index) => {
      const expectedTitle = outlineSectionTitle(outlineSection)
      const childrenSignature = outlineChildrenSignature(outlineSection)
      const matched = sourceSections.find(section => section.outlineNodeId === outlineSection.id) ??
        sourceSections.find(section =>
          !usedSectionIds.has(section.id) &&
          normalizeSectionTitle(section.title) === normalizeSectionTitle(expectedTitle)
        )

      if (!matched) {
        addedOutlineSections.push(outlineSection)
        notices.push(`新增章节「${expectedTitle}」将单独生成正文。`)
        return
      }

      usedSectionIds.add(matched.id)
      const oldTitleMeaning = normalizeMeaningTitle(matched.title)
      const newTitleMeaning = normalizeMeaningTitle(expectedTitle)
      const titleChanged = matched.title !== expectedTitle
      const meaningChanged = oldTitleMeaning !== newTitleMeaning
      const childChanged = Boolean(matched.outlineChildrenSignature) && matched.outlineChildrenSignature !== childrenSignature

      if (titleChanged && !meaningChanged) {
        notices.push(`章节「${matched.title}」已同步为「${expectedTitle}」。`)
      } else if (titleChanged && meaningChanged) {
        notices.push(`章节「${matched.title}」标题含义变为「${expectedTitle}」，建议稍后用 AI 对该章做一次定向调整。`)
      }

      if (childChanged) {
        notices.push(`章节「${expectedTitle}」的小节结构发生变化，原正文已保留，建议对新增/变化小节进行补写或局部重写。`)
      }

      const syncedContent = formatAcademicSectionContentWithOutline(
        matched.content,
        expectedTitle,
        outlineSection
      )
      const contentChanged = syncedContent !== matched.content

      nextSections.push({
        ...matched,
        title: expectedTitle,
        content: syncedContent,
        editorDoc: contentChanged ? paperTextToEditorDoc(syncedContent) : matched.editorDoc,
        outlineNodeId: outlineSection.id,
        outlineOrder: outlineSection.order,
        outlineChildrenSignature: childrenSignature,
        order: index,
        lastModified: titleChanged || contentChanged ? Date.now() : matched.lastModified,
      })
    })

    sourceSections.forEach(section => {
      if (usedSectionIds.has(section.id)) return
      if (isResearchAssetSection(section)) {
        nextSections.push({
          ...section,
          order: nextSections.length,
        })
        return
      }
      removedSections.push(section)
    })

    return { nextSections, addedOutlineSections, removedSections, notices }
  }, [])

  const startFullGeneration = useCallback(async (outlineSections: OutlineSection[]) => {
    if (hasStartedGenerationRef.current || outlineSections.length === 0) return
    const runId = generationRunIdRef.current + 1
    generationRunIdRef.current = runId
    const isActiveGenerationRun = () => generationRunIdRef.current === runId
    hasStartedGenerationRef.current = true
    setAwaitingDraftStart(false)
    setIsPreparingDraft(true)
    setIsGeneratingFull(true)
    setAllGenerated(false)
    setGenerationErrorMessage('')
    setGenerationSteps([])
    setGeneratingProgress({ current: 0, total: outlineSections.length })
    setGenerationStatusLabel('正在分析大纲并准备文献检索…')
    pushGenerationStep('分析大纲结构、研究对象和写作边界')
    await waitForNextPaint()
    if (!isActiveGenerationRun()) return

    try {
    const currentProject = projectStore.ensure(project.id)
    const fullOutlineSummary = outlineToText(outlineSections)
    const baseGenerationContext = buildAIContext({ projectId: project.id, stage: 'stage3' })
    let citationContext = baseGenerationContext
    let citableSources: ReturnType<typeof getStageCitableSources> = []
    let evidencePack: CitationEvidencePack | undefined
    try {
      pushGenerationStep('联网检索学术来源并筛选证据包')
      const preparedCitationContext = await withTimeout(
        prepareAutoCitationContext(
          outlineSections,
          baseGenerationContext,
          [],
          { force: true }
        ),
        90_000,
        '文献准备超过 90 秒，已先进入普通全文生成；可稍后使用引用增强补齐引用。'
      )
      if (!isActiveGenerationRun()) return
      citationContext = preparedCitationContext.citationContext
      citableSources = preparedCitationContext.citableSources
      evidencePack = preparedCitationContext.evidencePack
    } catch (error) {
      if (!isActiveGenerationRun()) return
      const message = error instanceof Error ? error.message : '文献准备失败'
      pushGenerationStep(`文献准备失败，已转为普通正文生成：${message}`, 'error')
      setCitationAuditNote(`文献准备失败，已转为普通正文生成：${message}`)
    }
    const comprehensionSummary = currentProject.context.rawSummary ?? ''
    const bannedPhrases = currentProject.context.bannedPhrases ?? []
    const styleGuide = activeStyleGuide
    const generatedSections: DocSection[] = []
    let paperPlan: string
    const chapterSummaries: string[] = []
    const generationErrors: string[] = []

    const startMsg: ChatMessage = {
      id: `s3_${uid()}`,
      role: 'ai',
      content: `已确认大纲，先生成全文写作计划，再按 ${outlineSections.length} 章逐章生成正文。`,
      timestamp: Date.now(),
      projectId: project.id,
      stage: 'stage3',
    }
    setMessages(prev => {
      const next = prev.length > 0 ? [...prev, startMsg] : [startMsg]
      return saveStageMessages(next)
    })

    let planAbort: AbortController | null = null
    try {
      pushGenerationStep('生成全文写作计划和引用策略')
      setGenerationStatusLabel('正在生成全文写作计划与引用策略…')
      planAbort = new AbortController()
      paperPlan = await withTimeout(
        streamGPTText(
          promptGeneratePaperPlan(
            fullOutlineSummary,
            comprehensionSummary,
            citationContext,
            academicLevel,
            styleGuide
          ),
          planAbort.signal
        ),
        18_000,
        '全文写作计划生成超过 18 秒，已直接进入逐章生成。'
      )
      if (!isActiveGenerationRun()) return
    } catch (error) {
      if (!isActiveGenerationRun()) return
      if (error instanceof Error && error.message.includes('超过')) planAbort?.abort()
      pushGenerationStep(error instanceof Error ? error.message : '全文写作计划生成失败，已直接进入逐章生成', 'error')
      paperPlan = ''
    }

    for (let index = 0; index < outlineSections.length; index += 1) {
      if (!isActiveGenerationRun()) return
      const chapter = outlineSections[index]
      const chapterTitle = outlineSectionTitle(chapter)
      const chapterOutline = chapterChildrenToText(chapter)
      setGeneratingProgress({ current: index + 1, total: outlineSections.length })
      setGenerationStatusLabel(`正在生成第 ${index + 1} / ${outlineSections.length} 章，并按检索来源插入引用…`)
      pushGenerationStep(`生成第 ${index + 1} / ${outlineSections.length} 章：${chapterTitle}`)

      const section: DocSection = {
        id: uid(),
        projectId: project.id,
        outlineNodeId: chapter.id,
        outlineOrder: chapter.order,
        outlineChildrenSignature: outlineChildrenSignature(chapter),
        generationPlan: paperPlan,
        title: chapterTitle,
        content: '',
        status: 'generating',
        lastModified: Date.now(),
        order: index,
      }

      generatedSections.push(section)
      setSections([...generatedSections])
      if (index === 0) setActiveSectionId(section.id)

      const abort = new AbortController()
      abortRef.current = abort
      try {
        const chapterCitationContext = isAbstractOutlineSection(chapter)
          ? citationContext
          : buildChapterCitationContext(baseGenerationContext, citableSources, evidencePack, chapterTitle, chapterOutline)
        const generationMessages = isAbstractOutlineSection(chapter)
          ? promptGenerateFrontMatter(
              fullOutlineSummary,
              comprehensionSummary,
              chapterCitationContext,
              academicLevel,
              paperPlan,
              styleGuide
            )
          : promptGenerateChapter(
              chapterTitle,
              chapterOutline,
              fullOutlineSummary,
              comprehensionSummary,
              chapterCitationContext,
              bannedPhrases,
              academicLevel,
              styleGuide,
              undefined,
              paperPlan,
              chapterSummaries.join('\n\n'),
              outlineSections[index + 1] ? outlineSectionTitle(outlineSections[index + 1]) : undefined
            )

        const fullContent = await withTimeout(
          streamGPTText(
            generationMessages,
            abort.signal,
            (streamed) => {
              if (!isActiveGenerationRun()) return
              setSections(prev => prev.map(item =>
                item.id === section.id ? { ...item, content: stripCitationMarkers(streamed) } : item
              ))
            }
          ),
          35_000,
          `${chapterTitle} 生成超过 35 秒，已写入可编辑保底初稿。`
        )
        if (!isActiveGenerationRun()) return
        if (!stripCitationMarkers(fullContent).trim()) {
          throw new Error('AI 没有返回正文内容')
        }

        let chapterSummary = ''
        try {
          chapterSummary = await streamGPTText(promptSummarizeGeneratedChapter(chapterTitle, stripCitationMarkers(fullContent)))
          if (!isActiveGenerationRun()) return
          chapterSummaries.push(`${chapterTitle}：${chapterSummary}`)
        } catch {
          if (!isActiveGenerationRun()) return
          chapterSummary = stripCitationMarkers(fullContent).slice(0, 220)
          chapterSummaries.push(`${chapterTitle}：${chapterSummary}`)
        }

        const finalizedSections = finalizeSectionWithCitations(
          generatedSections,
          section.id,
          fullContent,
          citableSources
        )
        const normalizedContent = formatAcademicSectionContentWithOutline(
          finalizedSections[index].content,
          chapterTitle,
          chapter
        )
        const doneSection = {
          ...finalizedSections[index],
          content: normalizedContent,
          outlineNodeId: chapter.id,
          outlineOrder: chapter.order,
          outlineChildrenSignature: outlineChildrenSignature(chapter),
          generationPlan: paperPlan,
          generatedSummary: chapterSummary,
          editorDoc: paperTextToEditorDoc(normalizedContent),
          status: 'done' as const,
          lastModified: Date.now(),
        }
        generatedSections[index] = doneSection
        setSections(prev => prev.map(item => item.id === section.id ? doneSection : item))
        sectionStore.saveForProject(project.id, generatedSections, { syncRemote: false })
        versionStore.snapshot(`AI 生成：${chapter.title}`, project.id)
      } catch (error) {
        if (!isActiveGenerationRun()) return
        if (error instanceof Error && error.message.includes('超过')) abort.abort()
        const errorMessage = `${outlineSectionTitle(chapter)}：${error instanceof Error ? error.message : '生成失败'}`
        generationErrors.push(errorMessage)
        pushGenerationStep(errorMessage, 'error')
        const fallbackContent = formatAcademicSectionContentWithOutline(
          fallbackSectionDraft({
            projectTitle,
            chapterTitle,
            chapterOutline,
            researchObject: currentProject.context.researchObject,
            academicLevel,
            reason: error instanceof Error ? error.message : '生成失败',
          }),
          chapterTitle,
          chapter
        )
        const fallbackSection = {
          ...section,
          content: fallbackContent,
          generatedSummary: fallbackContent.slice(0, 220),
          editorDoc: paperTextToEditorDoc(fallbackContent),
          status: 'done' as const,
          lastModified: Date.now(),
        }
        generatedSections[index] = fallbackSection
        setSections(prev => prev.map(item => item.id === section.id ? fallbackSection : item))
        sectionStore.saveForProject(project.id, generatedSections, { syncRemote: false })
      }
    }

    if (!isActiveGenerationRun()) return
    setIsGeneratingFull(false)
    setIsPreparingDraft(false)
    setAllGenerated(generatedSections.length > 0 && generatedSections.every(section => section.status === 'done'))
    sectionStore.saveForProject(project.id, generatedSections)
    const auditNote = buildCitationAuditNote(generatedSections, citableSources.length)
    setCitationAuditNote(prev => [
      prev,
      auditNote,
      generationErrors.length ? `部分章节使用保底初稿：${generationErrors.slice(0, 3).join('；')}` : '',
    ].filter(Boolean).join('\n'))
    setGenerationStatusLabel('')

    if (generationErrors.length > 0) {
      const message = `AI 生成部分失败，已写入可编辑保底初稿：${generationErrors.slice(0, 5).join('；')}`
      setGenerationErrorMessage(message)
      pushGenerationStep('已写入可编辑保底初稿，可继续编辑或重新生成', 'done')
    } else {
      setGenerationErrorMessage('')
      pushGenerationStep('全文生成完成，已保存为可编辑正文', 'done')
    }

    const doneMsg: ChatMessage = {
      id: `s3_${uid()}`,
      role: 'ai',
      content: generationErrors.length > 0
        ? `全文已生成可编辑初稿，共 ${outlineSections.length} 章。\n\n部分章节因在线生成服务异常使用了保底初稿，可在右侧继续编辑，或稍后重新生成。`
        : `全文已生成完毕，共 ${outlineSections.length} 章。\n\n你可以在右侧直接查看和编辑，或在左侧对具体章节提出修改意见。`,
      timestamp: Date.now(),
      projectId: project.id,
      stage: 'stage3',
    }
    setMessages(prev => {
      const next = [...prev, doneMsg]
      return saveStageMessages(next)
    })
    } catch (error) {
      if (!isActiveGenerationRun()) return
      const message = error instanceof Error ? error.message : '生成流程异常中断'
      setIsGeneratingFull(false)
      setIsPreparingDraft(false)
      setAwaitingDraftStart(false)
      setGenerationStatusLabel('')
      setGenerationErrorMessage(`生成全文中断：${message}`)
      setAllGenerated(false)
      pushGenerationStep(`生成全文中断：${message}`, 'error')
      setMessages(prev => saveStageMessages([
        ...prev,
        {
          id: `s3_generation_fatal_${uid()}`,
          role: 'ai',
          content: `生成全文中断：${message}\n\n可以点击正文中心或顶部的“重新生成全文”再次尝试。`,
          timestamp: Date.now(),
          projectId: project.id,
          stage: 'stage3',
        },
      ]))
    }
  }, [academicLevel, activeStyleGuide, buildChapterCitationContext, prepareAutoCitationContext, project.id, projectTitle, pushGenerationStep, saveStageMessages])

  const generateAdditionalSections = useCallback(async (
    newOutlineSections: OutlineSection[],
    startIndex: number,
    existingSections: DocSection[],
    allOutlineSections: OutlineSection[]
  ) => {
    if (newOutlineSections.length === 0) return

    setIsGeneratingFull(true)
    setGeneratingProgress({ current: 0, total: newOutlineSections.length })
    setGenerationStatusLabel('正在准备新增章节的引用来源…')

    const currentProject = projectStore.ensure(project.id)
    const fullOutlineSummary = outlineToText(allOutlineSections)
    const baseGenerationContext = buildAIContext({ projectId: project.id, stage: 'stage3' })
    const { citationContext, citableSources, evidencePack } = await prepareAutoCitationContext(
      allOutlineSections,
      baseGenerationContext
    )
    const comprehensionSummary = currentProject.context.rawSummary ?? ''
    const bannedPhrases = currentProject.context.bannedPhrases ?? []
    const styleGuide = activeStyleGuide
    const nextSections = [...existingSections]
    const paperPlan = existingSections.find(section => section.generationPlan)?.generationPlan ?? ''
    const chapterSummaries = existingSections
      .filter(section => section.generatedSummary)
      .map(section => `${section.title}：${section.generatedSummary}`)

    const startMsg: ChatMessage = {
      id: `s3_${uid()}`,
      role: 'ai',
      content: `检测到大纲新增 ${newOutlineSections.length} 个章节，开始只生成新增部分；已有正文不会被覆盖。`,
      timestamp: Date.now(),
      projectId: project.id,
      stage: 'stage3',
    }
    setMessages(prev => {
      const next = [...prev, startMsg]
      return saveStageMessages(next)
    })

    for (let index = 0; index < newOutlineSections.length; index += 1) {
      const chapter = newOutlineSections[index]
      const chapterTitle = outlineSectionTitle(chapter)
      const chapterOutline = chapterChildrenToText(chapter)
      const outlineIndex = allOutlineSections.findIndex(item => item.id === chapter.id)
      const sectionIndex = outlineIndex === -1 ? startIndex + index : Math.min(outlineIndex, nextSections.length)
      setGeneratingProgress({ current: index + 1, total: newOutlineSections.length })
      setGenerationStatusLabel(`正在生成新增章节 ${index + 1} / ${newOutlineSections.length}，并匹配引用来源…`)

      const section: DocSection = {
        id: uid(),
        projectId: project.id,
        outlineNodeId: chapter.id,
        outlineOrder: chapter.order,
        outlineChildrenSignature: outlineChildrenSignature(chapter),
        generationPlan: paperPlan,
        title: chapterTitle,
        content: '',
        status: 'generating',
        lastModified: Date.now(),
        order: sectionIndex,
      }

      nextSections.splice(sectionIndex, 0, section)
      setSections([...nextSections])
      setActiveSectionId(section.id)

      await new Promise<void>((resolve) => {
        let fullContent = ''
        const abort = new AbortController()
        abortRef.current = abort
        const chapterCitationContext = isAbstractOutlineSection(chapter)
          ? citationContext
          : buildChapterCitationContext(baseGenerationContext, citableSources, evidencePack, chapterTitle, chapterOutline)
        const generationMessages = isAbstractOutlineSection(chapter)
          ? promptGenerateFrontMatter(
              fullOutlineSummary,
              comprehensionSummary,
              chapterCitationContext,
              academicLevel,
              paperPlan,
              styleGuide
            )
          : promptGenerateChapter(
              chapterTitle,
              chapterOutline,
              fullOutlineSummary,
              comprehensionSummary,
              chapterCitationContext,
              bannedPhrases,
              academicLevel,
              styleGuide,
              undefined,
              paperPlan,
              chapterSummaries.join('\n\n'),
              allOutlineSections[sectionIndex + 1] ? outlineSectionTitle(allOutlineSections[sectionIndex + 1]) : undefined
            )

        callGPT(
          generationMessages,
          {
            onChunk: (chunk) => {
              fullContent += chunk
              setSections(prev => prev.map(item =>
                item.id === section.id ? { ...item, content: stripCitationMarkers(fullContent) } : item
              ))
            },
            onDone: () => {
              const finalizedSections = finalizeSectionWithCitations(
                nextSections,
                section.id,
                fullContent,
                citableSources
              )
              const finalizedSection = finalizedSections.find(item => item.id === section.id) ?? section
              const normalizedContent = formatAcademicSectionContentWithOutline(
                finalizedSection.content,
                chapterTitle,
                chapter
              )
              const doneSection = {
                ...finalizedSection,
                content: normalizedContent,
                outlineNodeId: chapter.id,
                outlineOrder: chapter.order,
                outlineChildrenSignature: outlineChildrenSignature(chapter),
                generationPlan: paperPlan,
                editorDoc: paperTextToEditorDoc(normalizedContent),
                status: 'done' as const,
                lastModified: Date.now(),
              }
              const currentIndex = nextSections.findIndex(item => item.id === section.id)
              if (currentIndex !== -1) nextSections[currentIndex] = doneSection
              setSections([...nextSections])
              sectionStore.saveForProject(project.id, nextSections, { syncRemote: false })
              versionStore.snapshot(`AI 生成新增章节：${chapter.title}`, project.id)
              resolve()
            },
            onError: () => {
              const failedSection = { ...section, status: 'pending' as const, lastModified: Date.now() }
              const currentIndex = nextSections.findIndex(item => item.id === section.id)
              if (currentIndex !== -1) nextSections[currentIndex] = failedSection
              setSections([...nextSections])
              resolve()
            },
          },
          abort.signal
        )
      })
    }

    setIsGeneratingFull(false)
    setAllGenerated(nextSections.every(section => section.status === 'done'))
    sectionStore.saveForProject(project.id, nextSections)
    setGenerationStatusLabel('')
  }, [academicLevel, activeStyleGuide, buildChapterCitationContext, prepareAutoCitationContext, project.id, saveStageMessages])

  useEffect(() => {
    const rawSavedMessages = chatStore.getByProject(project.id, 'stage3')
    const savedMessages = normalizeStage3Messages(rawSavedMessages)
    if (savedMessages.length !== rawSavedMessages.length) {
      saveStageMessages(savedMessages)
    }
    const savedSections = sectionStore.getByProject(project.id)
    const outline = outlineStore.get(project.id)
    const routeState = location.state as { insertedSectionId?: string } | null
    const preferredActiveSectionId = routeState?.insertedSectionId
    const preserveExistingDraft = shouldPreserveExistingDraft(project.context)

    if (savedMessages.length > 0) queueMicrotask(() => setMessages(savedMessages))

    if (savedSections.length > 0) {
      let formattedSections = formatSectionsForPaper(savedSections)
      const tableRepair = repairMissingResearchTables(formattedSections)
      formattedSections = tableRepair.sections
      const tableRepairSnapshotDescription = tableRepair.changed ? '修复研究表格显示' : ''

      if (outline?.sections?.length) {
        const outlineSections = ensureFrontMatterOutlineSection(outline.sections)
        let syncSnapshotDescription = tableRepairSnapshotDescription
        const {
          nextSections,
          addedOutlineSections,
          removedSections,
          notices,
        } = reconcileSectionsWithOutline(formattedSections, outlineSections)

        formattedSections = nextSections

        if (removedSections.length > 0) {
          formattedSections = [
            ...formattedSections,
            ...removedSections.map((section, index) => ({
              ...section,
              order: formattedSections.length + index,
            })),
          ]
          notices.push('Outline changed: removed sections were kept to avoid accidental deletion.')
        }

        if (notices.length > 0) {
          const noticeMsg: ChatMessage = {
            id: `s3_outline_sync_${Date.now()}`,
            role: 'ai',
            content: `已根据大纲同步正文结构：\n${notices.map(item => `- ${item}`).join('\n')}`,
            timestamp: Date.now(),
            projectId: project.id,
            stage: 'stage3',
          }
          queueMicrotask(() => {
            setMessages(prev => {
              const next = prev.some(message => message.id === noticeMsg.id) ? prev : [...prev, noticeMsg]
              return saveStageMessages(next)
            })
          })
          syncSnapshotDescription ||= '根据大纲同步正文结构'
        }

        queueMicrotask(() => {
          setIsPreparingDraft(false)
          setSections(formattedSections)
          setActiveSectionId(
            preferredActiveSectionId && formattedSections.some(section => section.id === preferredActiveSectionId)
              ? preferredActiveSectionId
              : formattedSections[0]?.id ?? null
          )
          setAllGenerated(formattedSections.every(section => section.status === 'done'))
        })
        sectionStore.saveForProject(project.id, formattedSections, { syncRemote: false })
        if (syncSnapshotDescription) versionStore.snapshot(syncSnapshotDescription, project.id)

        const hasIncompleteSyncedSections = formattedSections.some(section => section.status !== 'done')
        if (addedOutlineSections.length > 0 && hasIncompleteSyncedSections) {
          queueMicrotask(() => {
            setPendingAddedOutlineSections(prev => {
              const prevKey = prev.map(section => section.id).join('|')
              const nextKey = addedOutlineSections.map(section => section.id).join('|')
              return prevKey === nextKey ? prev : addedOutlineSections
            })
          })
        } else {
          queueMicrotask(() => setPendingAddedOutlineSections([]))
        }
      } else {
        if (tableRepair.changed) {
          sectionStore.saveForProject(project.id, formattedSections, { syncRemote: false })
          versionStore.snapshot(tableRepairSnapshotDescription, project.id)
        }
        queueMicrotask(() => {
          setIsPreparingDraft(false)
          setSections(formattedSections)
          setActiveSectionId(
            preferredActiveSectionId && formattedSections.some(section => section.id === preferredActiveSectionId)
              ? preferredActiveSectionId
              : formattedSections[0]?.id ?? null
          )
          setAllGenerated(formattedSections.every(section => section.status === 'done'))
        })
      }
      hasStartedGenerationRef.current = true
    } else if (savedMessages.some(message => {
      const key = stage3LifecycleKey(message)
      return key !== 'ready' && key !== 'wait-outline'
    })) {
      const now = Date.now()
      const blankSection: DocSection = {
        id: `blank-section-${project.id}`,
        projectId: project.id,
        title: '正文',
        content: '',
        editorDoc: paperTextToEditorDoc(''),
        status: 'done',
        lastModified: now,
        order: 0,
      }
      queueMicrotask(() => {
        setIsPreparingDraft(false)
        setAwaitingDraftStart(false)
        setSections([blankSection])
        setActiveSectionId(blankSection.id)
        setAllGenerated(true)
      })
      sectionStore.saveForProject(project.id, [blankSection], { syncRemote: false })
      hasStartedGenerationRef.current = true
    } else if (outline?.sections?.length && !preserveExistingDraft && !hasStartedGenerationRef.current) {
      const readyMsg: ChatMessage = {
        id: 's3_ready_to_generate',
        role: 'ai',
        content: '已读取到大纲。点击正文中心的“生成全文”后，系统会自动检索学术文献、筛选来源，并生成第一版正文。',
        timestamp: Date.now(),
        projectId: project.id,
        stage: 'stage3',
      }
      queueMicrotask(() => {
        setIsPreparingDraft(false)
        setAwaitingDraftStart(true)
        setMessages([readyMsg])
      })
      saveStageMessages([readyMsg])
    } else if (outline?.sections?.length) {
      const waitMsg: ChatMessage = {
        id: 's3_wait_outline',
        role: 'ai',
        content: '已读取到大纲和已有正文线索。为避免覆盖原文，系统不会自动生成全文；你可以在右侧继续修改，或回到阶段二调整大纲。',
        timestamp: Date.now(),
        projectId: project.id,
        stage: 'stage3',
      }
      queueMicrotask(() => {
        setIsPreparingDraft(false)
        setAwaitingDraftStart(false)
        setMessages([waitMsg])
      })
      saveStageMessages([waitMsg])
    } else {
      const waitMsg: ChatMessage = {
        id: 's3_wait_outline',
        role: 'ai',
        content: '还没有确认的大纲。请先回到阶段二生成并确认大纲。',
        timestamp: Date.now(),
        projectId: project.id,
        stage: 'stage3',
      }
      queueMicrotask(() => {
        setIsPreparingDraft(false)
        setMessages([waitMsg])
      })
      saveStageMessages([waitMsg])
    }

    if (project.currentStage !== 'stage3') {
      projectStore.update(project.id, { currentStage: 'stage3' })
    }
  }, [location.key, location.state, project.context, project.currentStage, project.id, reconcileSectionsWithOutline, repairMissingResearchTables, saveStageMessages])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (sections.length > 0 && !isGeneratingFull) {
      sectionStore.saveForProject(project.id, sections)
    }
  }, [isGeneratingFull, project.id, sections])

  const handleReviseMode = useCallback(async (
    opinion: string,
    currentMessages: ChatMessage[],
    mentionContext = '',
    mentionItemIds: string[] = []
  ) => {
    const activeSection = sections.find(section => section.id === activeSectionId)
    if (!activeSection) {
      const errMsg: ChatMessage = {
        id: `s3_${uid()}`,
        role: 'ai',
        content: '请先在右侧点击要修改的章节，然后再输入修改意见。',
        timestamp: Date.now(),
        projectId: project.id,
        stage: 'stage3',
      }
      const next = [...currentMessages, errMsg]
      setMessages(next)
      saveStageMessages(next)
      return
    }

    const aiMsgId = `s3_${uid()}`
    const aiMsg: ChatMessage = {
      id: aiMsgId,
      role: 'ai',
      content: '',
      timestamp: Date.now(),
      projectId: project.id,
      stage: 'stage3',
    }
    setMessages(prev => [...prev, aiMsg])
    setIsLoading(true)
    setStreamingId(aiMsgId)
    setSections(prev => prev.map(section =>
      section.id === activeSectionId ? { ...section, status: 'generating' } : section
    ))

    const baseReferenceContext = [
      buildAIContext({
        projectId: project.id,
        stage: 'stage3',
        userInput: opinion,
        currentSectionId: activeSection.id,
      }),
      buildResearchReferenceContext(researchReferenceAssetIds),
      activeStyleGuide ? `【/ 调用的风格档案】\n${activeStyleGuide}` : '',
      mentionContext,
    ].filter(Boolean).join('\n\n---\n\n')
    const { citationContext, citableSources } = buildCitationAwareContext(baseReferenceContext, mentionItemIds)
    const bannedPhrases = project.context.bannedPhrases ?? []
    let fullContent = ''
    const abort = new AbortController()
    abortRef.current = abort

    callDoubao(
      promptReviseSection(opinion, activeSection.content, citationContext, bannedPhrases),
      {
        onChunk: (chunk) => {
          fullContent += chunk
          setSections(prev => prev.map(section =>
            section.id === activeSectionId ? { ...section, content: stripCitationMarkers(fullContent) } : section
          ))
          setMessages(prev => prev.map(message =>
            message.id === aiMsgId ? { ...message, content: `正在修改「${activeSection.title}」…` } : message
          ))
        },
        onDone: () => {
          setIsLoading(false)
          setStreamingId(null)
          setSections(prev => finalizeSectionWithCitations(
            prev,
            activeSection.id,
            fullContent,
            citableSources
          ).map(section =>
            section.id === activeSection.id
              ? { ...section, editorDoc: paperTextToEditorDoc(section.content), status: 'done', lastModified: Date.now() }
              : section
          ))
          versionStore.snapshot(`按意见修改：${activeSection.title}`, project.id)
          const finalMessages = [...currentMessages, { ...aiMsg, content: `「${activeSection.title}」修改完成。还有需要调整的地方吗？` }]
          setMessages(finalMessages)
          saveStageMessages(finalMessages)
        },
        onError: (err) => {
          setIsLoading(false)
          setStreamingId(null)
          setSections(prev => prev.map(section =>
            section.id === activeSectionId ? { ...section, status: 'done' } : section
          ))
          const errMessages = [...currentMessages, { ...aiMsg, content: `修改失败：${err.message}` }]
          setMessages(errMessages)
          saveStageMessages(errMessages)
        },
      },
      abort.signal
    )
  }, [activeSectionId, activeStyleGuide, buildCitationAwareContext, project.context.bannedPhrases, project.id, researchReferenceAssetIds, saveStageMessages, sections])

  const sendMessage = useCallback(async () => {
    const rawText = inputText.trim()
    if ((!rawText && mentions.length === 0) || isLoading) return
    const text = rawText || `请结合 ${mentions.map(item => `${item.styleProfileId ? '/' : '@'}${item.title}`).join('、')} 为当前章节补充可引用论据，并按 [1]、[2] 的参考文献格式插入引用。`
    setInputText('')
    const mentionContext = buildMentionContext(mentions)
    const mentionItemIds = mentions.map(item => item.itemId).filter((id): id is string => Boolean(id))
    setMentions([])

    const userMsg: ChatMessage = {
      id: `s3_${uid()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
      projectId: project.id,
      stage: 'stage3',
    }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    saveStageMessages(newMessages)
    await handleReviseMode(text, newMessages, mentionContext, mentionItemIds)
  }, [handleReviseMode, inputText, isLoading, mentions, messages, project.id, saveStageMessages])

  const runFinish = () => {
    const fullText = sectionsToPlainText(sections)
    if (!fullText || finishLoading) return
    setFinishResult('')
    setFinishLoading(true)

    const abort = new AbortController()
    abortRef.current = abort
    let result = ''

    callGPT(
      promptFinishDraft(fullText, project.context.researchObject || projectTitle, academicLevel),
      {
        onChunk: (chunk) => {
          result += chunk
          setFinishResult(result)
        },
        onDone: () => setFinishLoading(false),
        onError: () => setFinishLoading(false),
      },
      abort.signal
    )
  }

  const runAdjust = () => {
    if (!adjustInput.trim() || !finishResult || isAdjusting) return
    setIsAdjusting(true)
    const abort = new AbortController()
    abortRef.current = abort
    let result = ''

    callGPT(
      promptAdjustFinish(finishResult, adjustInput),
      {
        onChunk: (chunk) => {
          result += chunk
          setFinishResult(result)
        },
        onDone: () => {
          setIsAdjusting(false)
          setAdjustInput('')
        },
        onError: () => setIsAdjusting(false),
      },
      abort.signal
    )
  }

  const buildCompleteSections = () => {
    const finishSections = finishResult ? buildFinishSections(finishResult, project.id) : []
    const frontSections = finishSections.filter(section => section.title !== '结语')
    const backSections = finishSections.filter(section => section.title === '结语')
    const bodySections = sections.filter(section => !/^参考文献$/i.test(section.title.trim()))
    const baseSections = [...frontSections, ...bodySections, ...backSections]

    const bibliographySection = buildBibliographySection(bodySections, project.id)
    if (bibliographySection) baseSections.push(bibliographySection)

    return baseSections
  }

  const copyAll = async () => {
    await navigator.clipboard.writeText(sectionsToPlainText(buildCompleteSections(), projectTitle))
    alert('全文已复制到剪贴板')
  }

  const exportWord = async () => {
    if (isGeneratingFull) {
      alert('正文还在生成中，请等生成完成后再导出 Word。')
      return
    }
    const exportSections = buildCompleteSections()
    if (exportSections.length === 0) {
      alert('当前还没有可导出的正文。请先生成全文，或在正文编辑区写入内容后再导出。')
      return
    }
    try {
      await exportSectionsToDocx(projectTitle, exportSections)
    } catch (error) {
      alert(`Word 导出失败：${error instanceof Error ? error.message : '请刷新后重试'}`)
    }
  }

  const updateProjectTitle = (title: string) => {
    setProjectTitle(title)
    projectStore.update(project.id, { title: title.trim() || '未命名论文' })
  }

  const handleUpdateFootnote = useCallback((footnoteId: string, noteText: string) => {
    setSections(prev => persistSections(
      updateFootnoteNote(prev, footnoteId, noteText),
      '更新脚注'
    ))
  }, [persistSections])

  const handleDeleteFootnote = useCallback((footnoteId: string) => {
    setSections(prev => persistSections(
      deleteFootnote(prev, footnoteId),
      '删除脚注'
    ))
  }, [persistSections])

  const regenerateFullText = async () => {
    const localOutline = outlineStore.get(project.id)
    abortRef.current?.abort()
    generationRunIdRef.current += 1
    hasStartedGenerationRef.current = false
    setAwaitingDraftStart(false)
    setIsGeneratingFull(true)
    setIsPreparingDraft(true)
    setGenerationStatusLabel(localOutline?.sections?.length ? '正在重置正文并准备重新生成…' : '正在读取线上大纲…')
    setGeneratingProgress({ current: 0, total: localOutline?.sections?.length || 1 })
    setGenerationSteps([
      {
        id: `reset_${uid()}`,
        label: localOutline?.sections?.length ? '正在重置正文并准备重新生成' : '正在读取线上大纲',
        status: 'active',
        timestamp: Date.now(),
      },
    ])
    setActiveSectionId(null)
    setAllGenerated(false)
    setGenerationErrorMessage('')
    setCitationAuditNote('')
    setFinishResult('')
    setAdjustInput('')
    setIsLoading(false)
    setStreamingId(null)
    void waitForNextPaint().then(async () => {
      const outline = await resolveOutlineForGeneration()
      if (!outline?.sections?.length) {
        setIsGeneratingFull(false)
        setIsPreparingDraft(false)
        setGenerationStatusLabel('')
        setGenerationErrorMessage('未读取到可用大纲。请回到阶段二重新确认大纲后，再生成全文。')
        setGenerationSteps(prev => prev.map(step =>
          step.status === 'active'
            ? { ...step, status: 'error', label: '未读取到可用大纲，请回到阶段二确认' }
            : step
        ))
        alert('未读取到可用大纲。请回到阶段二重新确认大纲后，再生成全文。')
        return
      }

      hasStartedGenerationRef.current = false
      setSections([])
      sectionStore.saveForProject(project.id, [], { syncRemote: false })
      setGeneratingProgress({ current: 0, total: outline.sections.length })
      window.setTimeout(() => {
        hasStartedGenerationRef.current = false
        void startFullGeneration(ensureFrontMatterOutlineSection(outline.sections))
      }, 0)
    })
  }

  const generateActiveSectionOnly = async () => {
    const targetSection = sections.find(section => section.id === activeSectionId) ?? sections[0]
    if (!targetSection || isGeneratingFull || isLoading) {
      alert('请先选择要生成或重写的小节。')
      return
    }

    const outline = outlineStore.get(project.id)
    if (!outline?.sections?.length) {
      alert('请先在阶段二确认大纲。')
      return
    }

    if (targetSection.content.trim() && !confirm(`确认重写「${targetSection.title}」？只会替换当前小节，不影响其他内容。`)) return

    const outlineSections = ensureFrontMatterOutlineSection(outline.sections)
    const outlineNode = findOutlineSectionById(outlineSections, targetSection.outlineNodeId)
    const chapterTitle = outlineNode ? outlineSectionTitle(outlineNode) : targetSection.title
    const chapterOutline = outlineNode ? chapterChildrenToText(outlineNode) : targetSection.title
    const currentProject = projectStore.ensure(project.id)
    const fullOutlineSummary = outlineToText(outlineSections)
    const baseGenerationContext = [
      buildAIContext({
        projectId: project.id,
        stage: 'stage3',
        currentSectionId: targetSection.id,
      }),
      buildResearchReferenceContext(researchReferenceAssetIds),
    ].filter(Boolean).join('\n\n---\n\n')
    const { citableSources, evidencePack } = await prepareAutoCitationContext(
      outlineSections,
      baseGenerationContext
    )
    const comprehensionSummary = currentProject.context.rawSummary ?? ''
    const bannedPhrases = currentProject.context.bannedPhrases ?? []
    const previousChapterSummaries = sections
      .filter(section => section.id !== targetSection.id && section.generatedSummary)
      .map(section => `${section.title}：${section.generatedSummary}`)
      .join('\n\n')

    setIsGeneratingFull(true)
    setGeneratingProgress({ current: 1, total: 1 })
    setGenerationStatusLabel('正在生成当前小节并自动匹配引用…')
    setSections(prev => prev.map(section =>
      section.id === targetSection.id ? { ...section, content: '', status: 'generating' } : section
    ))

    const abort = new AbortController()
    abortRef.current = abort
    try {
      const chapterCitationContext = buildChapterCitationContext(
        baseGenerationContext,
        citableSources,
        evidencePack,
        chapterTitle,
        chapterOutline
      )
      const fullContent = await streamGPTText(
        promptGenerateChapter(
          chapterTitle,
          chapterOutline,
          fullOutlineSummary,
          comprehensionSummary,
          chapterCitationContext,
          bannedPhrases,
          academicLevel,
          activeStyleGuide,
          undefined,
          targetSection.generationPlan,
          previousChapterSummaries,
          undefined
        ),
        abort.signal,
        streamed => {
          setSections(prev => prev.map(section =>
            section.id === targetSection.id ? { ...section, content: stripCitationMarkers(streamed) } : section
          ))
        }
      )

      let chapterSummary = ''
      try {
        chapterSummary = await streamGPTText(promptSummarizeGeneratedChapter(chapterTitle, stripCitationMarkers(fullContent)))
      } catch {
        chapterSummary = stripCitationMarkers(fullContent).slice(0, 220)
      }

      setSections(prev => {
        const finalized = finalizeSectionWithCitations(
          prev,
          targetSection.id,
          fullContent,
          citableSources
        ).map(section =>
          section.id === targetSection.id
            ? (() => {
                const normalizedContent = formatAcademicSectionContentWithOutline(
                  section.content,
                  chapterTitle,
                  outlineNode
                )
                return {
                  ...section,
                  title: chapterTitle,
                  content: normalizedContent,
                  outlineNodeId: targetSection.outlineNodeId,
                  outlineOrder: targetSection.outlineOrder,
                  outlineChildrenSignature: targetSection.outlineChildrenSignature,
                  generatedSummary: chapterSummary,
                  editorDoc: paperTextToEditorDoc(normalizedContent),
                  status: 'done' as const,
                  lastModified: Date.now(),
                }
              })()
            : section
        )
        return persistSections(finalized, `生成当前小节：${chapterTitle}`)
      })
    } catch (error) {
      setSections(prev => prev.map(section =>
        section.id === targetSection.id ? { ...section, status: 'pending' } : section
      ))
      alert(`生成当前小节失败：${error instanceof Error ? error.message : '请稍后重试'}`)
    } finally {
      setIsGeneratingFull(false)
      setGeneratingProgress({ current: 0, total: 0 })
      setGenerationStatusLabel('')
    }
  }

  const syncSectionsToCloud = async () => {
    try {
      const cachedSections = sectionStore.getByProject(project.id)
      const sourceSections = sections.length > 0 ? sections : cachedSections
      if (sourceSections.length === 0) {
        alert('当前没有可同步的正文。请先生成全文，或确认本地正文没有被清空。')
        return
      }
      sectionStore.saveForProject(project.id, sourceSections)
      const count = await sectionStore.syncProject(project.id)
      alert(`已同步 ${count} 个章节到 Supabase`)
    } catch (error) {
      alert(`同步失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const markResearchAssetUsed = (asset: ResearchAsset, sectionId?: string) => {
    researchAssetStore.update(asset.id, {
      status: 'used_in_paper',
      linkedSectionIds: sectionId
        ? Array.from(new Set([...(asset.linkedSectionIds ?? []), sectionId]))
        : asset.linkedSectionIds,
    })
    if (asset.taskId) {
      researchTaskStore.update(asset.taskId, {
        status: 'inserted_into_paper',
        nextActionLabel: '在 Stage3 润色并整合',
      })
    }
  }

  const addResearchAssetAsReference = (asset: ResearchAsset) => {
    setResearchReferenceAssetIds(prev => Array.from(new Set([...prev, asset.id])))
    const referenceMsg: ChatMessage = {
      id: `s3_${uid()}`,
      role: 'ai',
      content: `已把「${asset.title}」加入 Stage3 参考上下文。之后修改或生成当前小节时，会把它作为研究依据，但不会直接插入正文。`,
      timestamp: Date.now(),
      projectId: project.id,
      stage: 'stage3',
    }
    const nextMessages = [...messages, referenceMsg]
    setMessages(nextMessages)
    saveStageMessages(nextMessages)
    setShowResearchDrawer(false)
  }

  const applyCitationPatches = (patches: CitationPatchDraft[]) => {
    if (patches.length === 0) return
    let appliedCount = 0
    let nextSections = sections

    patches.forEach(patch => {
      nextSections = nextSections.map(section => {
        if (section.id !== patch.sectionId) return section
        if (isFrontMatterTitle(section.title) || /^(?:关键词|关键字|目录|参考文献|致谢|附录|题目|标题|论文题目)$/i.test(section.title.trim())) return section
        const anchorText = patch.revisedText?.trim() || patch.originalText
        const alreadyExists = (section.footnotes ?? []).some(footnote =>
          (footnote.anchorText === patch.originalText || footnote.anchorText === anchorText) &&
          footnote.noteText === patch.source.noteText
        )
        if (alreadyExists) return section

        const nextContent = section.content.includes(patch.originalText)
          ? section.content.replace(patch.originalText, anchorText)
          : section.content
        const blocks = parsePaperBlocks(nextContent)
        const blockIndex = blocks.findIndex(block => block.type === 'paragraph' && block.text.includes(anchorText))
        if (blockIndex < 0) return section

        const start = blocks[blockIndex].text.indexOf(anchorText)
        if (start < 0) return section

        const footnote = createFootnote(nextSections, {
          blockIndex,
          start,
          end: start + anchorText.length,
          anchorText,
          noteText: patch.source.noteText,
        })
        appliedCount += 1
        return {
          ...section,
          content: nextContent,
          footnotes: [...(section.footnotes ?? []), footnote],
          editorDoc: paperTextToEditorDoc(nextContent),
          lastModified: Date.now(),
        }
      })
    })

    setSections(persistSections(nextSections, appliedCount > 0 ? `引用增强：应用 ${appliedCount} 条引用建议` : undefined))

    setCitationAuditNote(appliedCount > 0
      ? `引用增强已应用 ${appliedCount} 条建议。可在正文中点击脚注继续编辑。`
      : '引用增强未找到可写入的位置：可能是正文已经被修改，建议重新扫描引用点。'
    )
  }

  const insertEvidenceCardIntoCurrentSection = (evidence: EvidenceCardAction) => {
    const targetId = activeSectionId ?? sections[0]?.id
    if (!targetId) {
      setCitationAuditNote('请先选择一个正文章节，再插入证据卡。')
      return
    }

    let inserted = false
    setSections(prev => {
      const next = prev.map(section => {
        if (section.id !== targetId) return section
        const claimText = evidence.claim.trim()
        if (!claimText) return section
        const content = `${section.content.trimEnd()}\n\n${claimText}`
        const blocks = parsePaperBlocks(content)
        const blockIndex = Math.max(0, blocks.length - 1)
        const footnote = createFootnote(prev, {
          blockIndex,
          start: 0,
          end: claimText.length,
          anchorText: claimText,
          noteText: evidence.source.noteText,
        })
        inserted = true
        return {
          ...section,
          content,
          footnotes: [...(section.footnotes ?? []), footnote],
          editorDoc: paperTextToEditorDoc(content),
          lastModified: Date.now(),
        }
      })
      return persistSections(next, inserted ? `插入证据卡：${evidence.source.title}` : undefined)
    })

    setCitationAuditNote(inserted
      ? `已把证据卡插入当前章节，并写入来源脚注：${evidence.source.title}`
      : '证据卡插入失败：未找到当前章节。'
    )
  }

  const useEvidenceCardForRewrite = (evidence: EvidenceCardAction) => {
    const instruction = [
      '请结合下面这张证据卡改写当前小节中最相关的一段，并在合适句子后插入引用脚注。',
      `证据观点：${evidence.claim}`,
      evidence.writingUse ? `写作位置：${evidence.writingUse}` : '',
      `来源：${evidence.source.title}`,
      '要求：只改写与证据直接相关的段落，不要扩大文献结论，不要编造来源。'
    ].filter(Boolean).join('\n')
    setInputText(instruction)
    setCitationAuditNote('已把证据卡放入右侧修改指令。你可以直接提交修改，让 AI 局部改写并插入引用。')
  }

  const insertResearchAssetIntoCurrentSection = (asset: ResearchAsset) => {
    const now = Date.now()
    const targetId = activeSectionId ?? sections[0]?.id
    const pkg = createPackageFromAsset({
      projectId: project.id,
      chapterId: targetId,
      asset,
      intentSummary: asset.summary,
    })
    const componentIds = pkg.components.map(component => component.id)
    researchPackageStore.markInserted(pkg.id, componentIds)
    const researchNodes = researchPackageToPaperNodes(pkg, componentIds)

    if (sections.length === 0) {
      const editorDoc = {
        type: 'doc' as const,
        content: researchNodes,
      }
      const section: DocSection = {
        id: `research-section-${asset.id}-${now}`,
        projectId: project.id,
        title: asset.type === 'quant_analysis_result' ? '数据分析结果' : '研究材料',
        content: editorDocToPlainText(editorDoc),
        editorDoc,
        status: 'done',
        lastModified: now,
        order: 0,
        sourceRefs: [asset.id],
      }
      setSections(persistSections([section], `插入研究支撑：${asset.title}`))
      setActiveSectionId(section.id)
      markResearchAssetUsed(asset, section.id)
    } else {
      setSections(prev => persistSections(prev.map(section => {
        if (section.id !== targetId) return section
        const sourceDoc = ensurePaperEditorDoc(section.content, section.editorDoc)
        const editorDoc = {
          ...sourceDoc,
          content: [...(sourceDoc.content ?? []), ...researchNodes],
        }
        return {
          ...section,
          content: editorDocToPlainText(editorDoc),
          editorDoc,
          status: 'done',
          lastModified: now,
          sourceRefs: Array.from(new Set([...(section.sourceRefs ?? []), asset.id])),
        }
      }), `插入研究支撑：${asset.title}`))
      if (targetId) setActiveSectionId(targetId)
      markResearchAssetUsed(asset, targetId)
    }

    setShowResearchDrawer(false)
  }

  const generateResearchAssetChapter = async (asset: ResearchAsset) => {
    if (isGeneratingFull || isLoading) return
    const now = Date.now()
    const sectionTitle = researchAssetSectionTitle(asset)
    const section: DocSection = {
      id: `research-generated-${asset.id}-${now}`,
      projectId: project.id,
      title: sectionTitle,
      content: '',
      editorDoc: paperTextToEditorDoc(''),
      status: 'generating',
      lastModified: now,
      order: researchAssetOrder(asset),
    }
    setShowResearchDrawer(false)
    setIsGeneratingFull(true)
    setGeneratingProgress({ current: 1, total: 1 })
    setSections(prev => persistSections([...prev, section], `创建研究章节：${sectionTitle}`))
    setActiveSectionId(section.id)

    const abort = new AbortController()
    abortRef.current = abort
    let fullContent: string
    try {
      fullContent = await streamGPTText(
        promptGenerateResearchAssetSection(
          asset,
          projectTitle,
          sectionsToPlainText(sections, projectTitle),
          academicLevel,
          activeStyleGuide
        ),
        abort.signal,
        streamed => {
          setSections(prev => prev.map(item =>
            item.id === section.id ? { ...item, content: stripCitationMarkers(streamed) } : item
          ))
        }
      )
      const doneSection: DocSection = {
        ...section,
        content: stripCitationMarkers(fullContent),
        editorDoc: paperTextToEditorDoc(stripCitationMarkers(fullContent)),
        status: 'done',
        lastModified: Date.now(),
      }
      setSections(prev => persistSections(prev.map(item => item.id === section.id ? doneSection : item), `生成研究章节：${sectionTitle}`))
      markResearchAssetUsed(asset, section.id)
      versionStore.snapshot(`生成研究章节：${sectionTitle}`, project.id)
    } catch (error) {
      setSections(prev => prev.map(item => item.id === section.id ? { ...item, status: 'pending' } : item))
      alert(`生成研究章节失败：${error instanceof Error ? error.message : '请稍后重试'}`)
    } finally {
      setIsGeneratingFull(false)
      setGeneratingProgress({ current: 0, total: 0 })
    }
  }

  const insertResearchAssetAndPolish = async (asset: ResearchAsset) => {
    if (isLoading || isGeneratingFull) return
    const now = Date.now()
    let targetSection = sections.find(section => section.id === activeSectionId) ?? sections[0]

    if (!targetSection) {
      targetSection = {
        id: `research-polished-${asset.id}-${now}`,
        projectId: project.id,
        title: researchAssetSectionTitle(asset),
        content: '',
        editorDoc: paperTextToEditorDoc(''),
        status: 'pending',
        lastModified: now,
        order: researchAssetOrder(asset),
      }
      setSections(persistSections([targetSection], `创建研究整合章节：${targetSection.title}`))
      setActiveSectionId(targetSection.id)
    }

    setShowResearchDrawer(false)
    setIsLoading(true)
    setStreamingId(targetSection.id)
    setSections(prev => prev.map(section =>
      section.id === targetSection.id ? { ...section, status: 'generating' } : section
    ))

    const abort = new AbortController()
    abortRef.current = abort
    let fullContent = ''
    try {
      await new Promise<void>((resolve, reject) => {
        callDoubao(
          promptPolishResearchAssetIntoSection(
            asset,
            targetSection.title,
            targetSection.content,
            projectTitle,
            academicLevel,
            activeStyleGuide
          ),
          {
            onChunk: (chunk) => {
              fullContent += chunk
              setSections(prev => prev.map(section =>
                section.id === targetSection.id ? { ...section, content: stripCitationMarkers(fullContent) } : section
              ))
            },
            onDone: () => resolve(),
            onError: reject,
          },
          abort.signal
        )
      })

      setSections(prev => persistSections(prev.map(section =>
        section.id === targetSection.id
          ? {
              ...section,
              content: stripCitationMarkers(fullContent),
              editorDoc: paperTextToEditorDoc(stripCitationMarkers(fullContent)),
              status: 'done',
              lastModified: Date.now(),
            }
          : section
      ), `整合研究资产：${asset.title}`))
      markResearchAssetUsed(asset, targetSection.id)
      versionStore.snapshot(`整合研究资产：${asset.title}`, project.id)
    } catch (error) {
      setSections(prev => prev.map(section =>
        section.id === targetSection.id ? { ...section, status: 'done' } : section
      ))
      alert(`插入并润色失败：${error instanceof Error ? error.message : '请稍后重试'}`)
    } finally {
      setIsLoading(false)
      setStreamingId(null)
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      sendMessage()
    }
  }

  const totalChars = sections.reduce((total, section) => total + section.content.replace(/\s/g, '').length, 0)
  const currentOutline = outlineStore.get(project.id)
  const currentOutlineSections = currentOutline?.sections
  const hasCurrentOutline = Boolean(currentOutlineSections?.length)
  const canAutoGenerateFromCurrentOutline = Boolean(currentOutlineSections?.length && !shouldPreserveExistingDraft(project.context))
  const showCenterGenerateButton = sections.length === 0 && !isGeneratingFull
  const centerGenerateButtonLabel = hasCurrentOutline ? '生成全文' : '检查大纲并生成'
  const autoCitationSourceCount = referenceStore.get(project.id, 'stage3').autoSources?.length ?? 0
  const pendingAddedTitleList = pendingAddedOutlineSections.map(outlineSectionTitle).join('、')
  const generatePendingAddedSections = () => {
    if (!pendingAddedOutlineSections.length || !currentOutlineSections?.length || isGeneratingFull) return
    const outlineSections = ensureFrontMatterOutlineSection(currentOutlineSections)
    const pending = pendingAddedOutlineSections
    setPendingAddedOutlineSections([])
    void generateAdditionalSections(pending, sections.length, sections, outlineSections)
  }

  return (
    <div style={{ height: '100vh', display: 'flex', background: 'var(--color-bg)', overflow: 'hidden' }}>
      <Sidebar />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
        <TopBar
          currentStep={2}
          right={
            <div style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
              {styleProfiles.length > 0 && (
                <select
                  value={selectedStyleProfileId}
                  onChange={event => setSelectedStyleProfileId(event.target.value)}
                  title="选择风格档案"
                  style={{ height: 28, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--color-ink-2)', fontSize: 12, padding: '0 8px', fontFamily: 'var(--font-sans)', flexShrink: 0 }}
                >
                  <option value="">不使用风格档案</option>
                  {styleProfiles.map(profile => (
                    <option key={profile.id} value={profile.id}>{profile.studentName || profile.profileName}</option>
                  ))}
                </select>
              )}
              <button
                onClick={() => setShowReferences(value => !value)}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 'var(--radius-sm)', border: `1px solid ${showReferences ? 'var(--color-accent)' : 'var(--color-border)'}`, background: showReferences ? 'var(--color-accent-light)' : 'transparent', color: showReferences ? 'var(--color-accent)' : 'var(--color-ink-3)', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
              >
                <BookOpen size={13} />
                来源
              </button>
              <button
                onClick={() => {
                  setShowResearchDrawer(value => !value)
                  setShowReferences(false)
                }}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 'var(--radius-sm)', border: `1px solid ${showResearchDrawer ? 'var(--color-accent)' : 'var(--color-border)'}`, background: showResearchDrawer ? 'var(--color-accent-light)' : 'transparent', color: showResearchDrawer ? 'var(--color-accent)' : 'var(--color-ink-3)', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
              >
                <FlaskConical size={13} />
                研究
              </button>
              <button
                onClick={() => setShowHistory(value => !value)}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 'var(--radius-sm)', border: `1px solid ${showHistory ? 'var(--color-accent)' : 'var(--color-border)'}`, background: showHistory ? 'var(--color-accent-light)' : 'transparent', color: showHistory ? 'var(--color-accent)' : 'var(--color-ink-3)', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
              >
                <History size={13} />
                版本历史
              </button>
              <button
                onClick={copyAll}
                disabled={sections.length === 0}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', background: 'transparent', color: sections.length === 0 ? 'var(--color-ink-3)' : 'var(--color-ink-2)', fontSize: 12, cursor: sections.length === 0 ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
              >
                <Copy size={13} />
                复制全文
              </button>
              {(!hasCurrentOutline || sections.length > 0) && (
                <button
                  onClick={hasCurrentOutline ? regenerateFullText : () => navigate(`/projects/${project.id}/stage2`)}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-ink-2)', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
                >
                  <RefreshCw size={13} />
                  {hasCurrentOutline ? (isGeneratingFull ? '停止并重新生成' : '重新生成全文') : '回到大纲'}
                </button>
              )}
              <button
                onClick={() => void generateActiveSectionOnly()}
                disabled={isGeneratingFull || !activeSectionId}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', background: 'transparent', color: isGeneratingFull || !activeSectionId ? 'var(--color-ink-3)' : 'var(--color-accent)', fontSize: 12, cursor: isGeneratingFull || !activeSectionId ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
              >
                <Sparkles size={13} />
                生成当前小节
              </button>
              <button
                onClick={syncSectionsToCloud}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-accent)', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
              >
                <CheckCircle2 size={13} />
                同步云端
              </button>
              <button
                onClick={() => navigate(`/projects/${project.id}`)}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-ink-3)', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
              >
                <Download size={13} />
                返回项目
              </button>
            </div>
          }
        />

        {showOutlineTransition && (
          <OutlineToDraftTransition
            title={projectTitle}
            current={generatingProgress.current}
            total={generatingProgress.total}
          />
        )}

        {isGeneratingFull && (
          <div style={{ position: 'absolute', top: 92, left: 12, right: 12, zIndex: 100, background: 'rgba(255,255,255,0.96)', border: '1px solid var(--color-border)', borderRadius: 8, boxShadow: 'var(--shadow-md)', padding: '10px 12px', display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Sparkles size={15} color="var(--color-accent)" />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12, color: 'var(--color-accent)', fontWeight: 800 }}>
                  {generationStatusLabel || `正在生成第 ${generatingProgress.current} / ${generatingProgress.total} 章…`}
                </div>
                <div style={{ marginTop: 3, fontSize: 11, color: 'var(--color-ink-3)' }}>
                  AI 会先检索和筛选来源，再逐章写入正文。页面可停留等待，已完成章节会自动保存。
                </div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-ink-3)', fontWeight: 750 }}>
                {generationPercent}%
              </div>
            </div>
            <div style={{ height: 6, background: 'var(--color-border)', borderRadius: 999, overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  background: 'linear-gradient(90deg, var(--color-accent), #8DC5A1)',
                  width: `${generationPercent}%`,
                  transition: 'width 0.35s ease',
                }}
              />
            </div>
            {generationSteps.length > 0 && (
              <div style={{ display: 'grid', gap: 4, maxHeight: 86, overflowY: 'auto', paddingRight: 4 }}>
                {generationSteps.slice(-5).reverse().map(step => (
                  <div key={step.id} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, color: step.status === 'error' ? '#A13B2D' : step.status === 'done' ? 'var(--color-ink-3)' : 'var(--color-ink-2)', lineHeight: 1.45 }}>
                    <span style={{ width: 6, height: 6, borderRadius: 999, background: step.status === 'error' ? '#D8614C' : step.status === 'done' ? 'var(--color-border-strong)' : 'var(--color-accent)', flexShrink: 0 }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{step.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {showGenerationRecovery && (
          <div style={{ position: 'absolute', top: 92, left: 12, right: 12, zIndex: 90, background: '#FFF8EA', border: '1px solid #E8D5A8', borderRadius: 8, boxShadow: 'var(--shadow-sm)', padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: 'var(--color-ink)', fontWeight: 850 }}>
                正文生成未完成
              </div>
              <div style={{ marginTop: 3, fontSize: 11, color: 'var(--color-ink-3)', lineHeight: 1.5 }}>
                {generationErrorMessage || `检测到 ${incompleteSectionCount} 个章节尚未完成。可以保留当前内容继续编辑，也可以重新生成全文恢复。`}
              </div>
            </div>
            <button
              onClick={regenerateFullText}
              style={{ display: 'flex', alignItems: 'center', gap: 5, border: '1px solid var(--color-accent)', background: 'var(--color-accent)', color: '#fff', borderRadius: 6, padding: '7px 10px', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font-sans)', flexShrink: 0 }}
            >
              <RefreshCw size={13} />
              重新生成全文
            </button>
          </div>
        )}

        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <div style={{ width: 270, flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
            <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)', flexShrink: 0, padding: '0 8px' }}>
              {([
                { key: 'revise', label: '按意见修改' },
                { key: 'finish', label: '收尾生成' },
              ] as const).map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setMode(tab.key)}
                  style={{ flex: 1, padding: '10px 4px', border: 'none', borderBottom: `2px solid ${mode === tab.key ? 'var(--color-accent)' : 'transparent'}`, background: 'transparent', color: mode === tab.key ? 'var(--color-accent)' : 'var(--color-ink-3)', fontSize: 12, fontWeight: mode === tab.key ? 500 : 400, cursor: 'pointer', fontFamily: 'var(--font-sans)' }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {mode === 'revise' ? (
              <>
                <div style={{ flex: 1, overflowY: 'auto', padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {!allGenerated && !isGeneratingFull && (
                    <div style={{ padding: 12, fontSize: 12, color: 'var(--color-ink-3)', lineHeight: 1.7, background: 'var(--color-bg)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                      全文生成完成后即可开始修改。
                    </div>
                  )}
                  {messages.map(message => (
                    <ChatBubble key={message.id} role={message.role} content={message.content} isStreaming={streamingId === message.id} />
                  ))}
                  <div ref={bottomRef} />
                </div>

                {allGenerated && activeSectionId && (
                  <div style={{ padding: '6px 10px', background: 'var(--color-doubao-light)', borderTop: '1px solid var(--color-border)', fontSize: 11, color: 'var(--color-doubao)', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <MessageSquare size={11} />
                    当前：{sections.find(section => section.id === activeSectionId)?.title?.slice(0, 20)}…
                  </div>
                )}

                {footnoteCount > 0 && (
                  <div style={{ padding: '0 10px 10px', flexShrink: 0 }}>
                    <BibliographyCard content={bibliographyContent} footnoteCount={footnoteCount} />
                  </div>
                )}

                <div style={{ borderTop: '1px solid var(--color-border)', padding: 10, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <MentionInput
                    value={inputText}
                    onChange={setInputText}
                    mentions={mentions}
                    onMentionsChange={setMentions}
                    onKeyDown={handleKeyDown}
                    placeholder={allGenerated ? '说修改意见，输入 @ 调用资料库，输入 / 调用风格档案' : '等待全文生成完成…'}
                    rows={3}
                    disabled={!allGenerated || isLoading}
                    styleProfiles={styleProfiles}
                    selectedStyleProfileId={selectedStyleProfileId}
                    onStyleProfileSelect={setSelectedStyleProfileId}
                  />
                  <button
                    onClick={sendMessage}
                    disabled={!allGenerated || isLoading || (!inputText.trim() && mentions.length === 0)}
                    style={{ width: '100%', padding: '8px', borderRadius: 'var(--radius-sm)', border: 'none', background: allGenerated && !isLoading && (inputText.trim() || mentions.length > 0) ? 'var(--color-accent)' : 'var(--color-border)', color: '#fff', fontSize: 13, fontWeight: 500, cursor: allGenerated && !isLoading && (inputText.trim() || mentions.length > 0) ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                  >
                    {isLoading ? <><Sparkles size={13} /> 修改中…</> : <><Send size={13} /> 提交修改</>}
                  </button>
                </div>
              </>
            ) : (
              <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 12, color: 'var(--color-ink-3)', lineHeight: 1.7 }}>
                  基于完整正文，生成中文摘要、英文 Abstract、关键词、引言和结语。
                </div>
                <button
                  onClick={runFinish}
                  disabled={!allGenerated || finishLoading}
                  style={{ width: '100%', border: 'none', borderRadius: 'var(--radius-sm)', background: allGenerated && !finishLoading ? 'var(--color-accent)' : 'var(--color-border)', color: '#fff', padding: '9px 0', fontSize: 12, fontWeight: 500, cursor: allGenerated && !finishLoading ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                >
                  <Sparkles size={13} />
                  {finishLoading ? '生成中…' : '生成摘要 / Abstract / 引言 / 结语'}
                </button>

                {finishResult && (
                  <div style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                    <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border)', fontSize: 11, color: 'var(--color-ink-3)', display: 'flex', justifyContent: 'space-between' }}>
                      <span>{finishLoading ? '生成中…' : '生成完成 ✓'}</span>
                      <button
                        onClick={async () => {
                          await navigator.clipboard.writeText(finishResult)
                          alert('已复制')
                        }}
                        style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-ink-3)', fontSize: 11 }}
                      >
                        复制
                      </button>
                    </div>
                    <div style={{ padding: 12, fontSize: 12, lineHeight: 1.9, color: 'var(--color-ink-2)', whiteSpace: 'pre-wrap', maxHeight: 260, overflowY: 'auto' }}>
                      {finishResult}
                    </div>
                    {!finishLoading && (
                      <div style={{ padding: '10px 12px', borderTop: '1px solid var(--color-border)' }}>
                        <textarea
                          value={adjustInput}
                          onChange={event => setAdjustInput(event.target.value)}
                          placeholder="追加调整，如：英文摘要更像论文 Abstract、关键词改成影视空间叙事、结语别拔高…"
                          rows={2}
                          style={{ width: '100%', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '6px 8px', fontSize: 11, resize: 'none', fontFamily: 'var(--font-sans)', outline: 'none', boxSizing: 'border-box' }}
                        />
                        <button
                          onClick={runAdjust}
                          disabled={!adjustInput.trim() || isAdjusting}
                          style={{ marginTop: 6, width: '100%', border: 'none', borderRadius: 'var(--radius-sm)', background: adjustInput.trim() && !isAdjusting ? 'var(--color-accent)' : 'var(--color-border)', color: '#fff', padding: '7px 0', fontSize: 11, cursor: adjustInput.trim() && !isAdjusting ? 'pointer' : 'not-allowed' }}
                        >
                          {isAdjusting ? '调整中…' : '提交调整'}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <BibliographyCard content={bibliographyContent} footnoteCount={footnoteCount} />
              </div>
            )}
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '0 16px', height: 44, borderBottom: '1px solid var(--color-border)', background: '#FBFAF7', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <input
                value={projectTitle}
                onChange={event => updateProjectTitle(event.target.value)}
                placeholder="输入论文标题…"
                title="点击修改论文名称"
                style={{
                  flex: 1,
                  minWidth: 0,
                  border: 'none',
                  borderBottom: '1px dashed var(--color-border-strong)',
                  outline: 'none',
                  background: 'transparent',
                  color: 'var(--color-ink)',
                  fontFamily: 'var(--font-sans)',
                  fontSize: 13,
                  fontWeight: 500,
                  padding: '3px 0',
                }}
              />
              <span style={{ fontSize: 11, color: 'var(--color-ink-3)' }}>
                {sections.filter(section => section.status === 'done').length} / {sections.length} 章已完成
              </span>
            </div>
            <DocumentToolbar
              onCopy={copyAll}
              onExportWord={exportWord}
              disabled={sections.length === 0}
            />

            {pendingAddedOutlineSections.length > 0 && !isGeneratingFull && (
              <div style={{ margin: '10px 16px 0', border: '1px solid #E8D5A8', background: '#FFF8EA', borderRadius: 8, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: 'var(--color-ink)', fontSize: 12, fontWeight: 850 }}>
                    检测到大纲新增 {pendingAddedOutlineSections.length} 个章节
                  </div>
                  <div style={{ marginTop: 3, color: 'var(--color-ink-3)', fontSize: 11, lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    将生成：{pendingAddedTitleList}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setPendingAddedOutlineSections([])}
                  style={{ border: '1px solid var(--color-border)', background: '#fff', color: 'var(--color-ink-3)', borderRadius: 6, padding: '7px 10px', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font-sans)', flexShrink: 0 }}
                >
                  暂不处理
                </button>
                <button
                  type="button"
                  onClick={generatePendingAddedSections}
                  style={{ border: '1px solid var(--color-accent)', background: 'var(--color-accent)', color: '#fff', borderRadius: 6, padding: '7px 10px', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font-sans)', flexShrink: 0 }}
                >
                  生成新增章节
                </button>
              </div>
            )}

            <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
              {isGeneratingFull ? (
                <FullGenerationProgressPage
                  title={projectTitle}
                  current={generatingProgress.current}
                  total={generatingProgress.total}
                  percent={generationPercent}
                  statusLabel={generationStatusLabel}
                  steps={generationSteps}
                  completedCount={Math.max(0, generatingProgress.current - 1)}
                  sourceCount={autoCitationSourceCount}
                />
              ) : (
              <PaperDocumentEditor
                projectId={project.id}
                paperTitle={projectTitle}
                sections={sections}
                outlineSections={currentOutlineSections ? ensureFrontMatterOutlineSection(currentOutlineSections) : undefined}
                isPreparing={isPreparingDraft || isGeneratingFull || showOutlineTransition}
                activeSectionId={activeSectionId}
                onSectionClick={id => setActiveSectionId(id)}
                onSectionsChange={(nextSections, snapshotLabel) => {
                  setSections(persistSections(nextSections.map(section => ({
                    ...section,
                    projectId: project.id,
                    status: section.status === 'generating' ? 'generating' : 'done',
                    lastModified: Date.now(),
                  })), snapshotLabel))
                }}
                onPaperTitleChange={updateProjectTitle}
                onGenerateSection={() => void generateActiveSectionOnly()}
                onInsertResearchSupport={() => setShowResearchDrawer(true)}
                onRegenerateResearchSupport={() => setShowResearchDrawer(true)}
                onUpdateFootnote={handleUpdateFootnote}
                onDeleteFootnote={handleDeleteFootnote}
                emptyTitle={currentOutlineSections?.length && !canAutoGenerateFromCurrentOutline ? '已识别已有正文' : awaitingDraftStart ? '准备生成第一版正文' : undefined}
                emptyText={currentOutlineSections?.length && !canAutoGenerateFromCurrentOutline ? '系统判断当前项目更适合修改已有论文，因此不会自动覆盖生成全文。可以从左侧提出修改意见，或点击下方按钮后确认重建第一版正文。' : awaitingDraftStart ? 'AI 会自动检索学术文献、筛选来源，再把引用写入正文。' : undefined}
                emptyAction={showCenterGenerateButton ? (
                  <button
                    type="button"
                    onClick={regenerateFullText}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      minWidth: 148,
                      padding: '10px 18px',
                      border: 'none',
                      borderRadius: 8,
                      background: 'var(--color-accent)',
                      color: '#fff',
                      fontSize: 14,
                      fontWeight: 850,
                      cursor: 'pointer',
                      boxShadow: '0 10px 24px rgba(45, 90, 61, 0.16)',
                      fontFamily: 'var(--font-sans)',
                    }}
                  >
                    <Sparkles size={16} />
                    {centerGenerateButtonLabel}
                  </button>
                ) : undefined}
              />
              )}

              {showHistory && !isGeneratingFull && (
                <VersionPanel
                  projectId={project.id}
                  onClose={() => setShowHistory(false)}
                  onRestore={(snapshot) => {
                    const restoredSections = snapshot.sections.map(section => ({ ...section, projectId: project.id }))
                    setSections(restoredSections)
                    versionStore.restore(snapshot, project.id)
                  }}
                />
              )}
            </div>

            <div style={{ padding: '5px 16px', borderTop: '1px solid var(--color-border)', background: 'var(--color-accent-light)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <span style={{ fontSize: 11, color: 'var(--color-accent)', display: 'flex', alignItems: 'center', gap: 5 }}>
                {allGenerated ? <><CheckCircle2 size={11} /> 全文已生成，可继续修改</> : isGeneratingFull ? (generationStatusLabel || '正在生成全文…') : currentOutlineSections?.length && !canAutoGenerateFromCurrentOutline ? '● 已进入已有正文修改模式' : awaitingDraftStart ? '● 将自动检索文献并生成全文' : '● 等待大纲'}
              </span>
              <span style={{ fontSize: 11, color: 'var(--color-ink-3)' }}>
                {autoCitationSourceCount > 0 ? `${autoCitationSourceCount} 条来源 · ` : ''}{totalChars} 字
              </span>
            </div>
            {citationAuditNote && (
              <div style={{ padding: '6px 16px', borderTop: '1px solid rgba(45, 90, 61, 0.16)', background: '#F8FBF8', color: 'var(--color-ink-3)', fontSize: 11, lineHeight: 1.5, flexShrink: 0 }}>
                {citationAuditNote.split('\n').slice(-2).join(' ')}
              </div>
            )}
          </div>
        </div>
      </div>

      <ReferencePanel
        projectId={project.id}
        stage="stage3"
        open={showReferences}
        onClose={() => setShowReferences(false)}
        onApplyToActiveSection={() => void generateActiveSectionOnly()}
        onApplyCitationPatches={applyCitationPatches}
        onInsertEvidenceCard={insertEvidenceCardIntoCurrentSection}
        onUseEvidenceForRewrite={useEvidenceCardForRewrite}
      />
      <ResearchDrawer
        projectId={project.id}
        open={showResearchDrawer}
        activeSectionTitle={sections.find(section => section.id === activeSectionId)?.title}
        onClose={() => setShowResearchDrawer(false)}
        onOpenDetails={() => navigate(`/projects/${project.id}/research`)}
        onInsertAsset={insertResearchAssetIntoCurrentSection}
        onUseAsReference={addResearchAssetAsReference}
        onGenerateChapter={generateResearchAssetChapter}
        onInsertAndPolish={insertResearchAssetAndPolish}
      />
    </div>
  )
}
