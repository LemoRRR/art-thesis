import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8')
}

const contracts = [
  {
    file: 'src/pages/ProjectHome.tsx',
    ids: ['project-research-entry'],
  },
  {
    file: 'src/pages/Stage3.tsx',
    ids: ['stage3-open-research'],
  },
  {
    file: 'src/components/ResearchDrawer.tsx',
    ids: [
      'stage3-research-drawer',
      'research-drawer-notice',
      'research-analysis-request',
      'research-upload-label',
      'research-upload-input',
      'research-generate-plan',
      'research-run-plan',
      'research-insert-latest',
      'research-use-reference',
      'research-insert-polish',
      'research-insert-package',
      'research-generate-chapter',
      'research-open-details',
    ],
  },
  {
    file: 'src/components/DocumentToolbar.tsx',
    ids: ['document-copy-all', 'document-export-word'],
  },
]

for (const contract of contracts) {
  const source = read(contract.file)
  for (const id of contract.ids) {
    assert(source.includes(`data-testid="${id}"`), `${contract.file} is missing data-testid="${id}"`)
  }
}

const researchCenterSource = read('src/pages/ResearchCenter.tsx')
const projectHomeSource = read('src/pages/ProjectHome.tsx')
const stage3Source = read('src/pages/Stage3.tsx')
const referencePanelSource = read('src/components/ReferencePanel.tsx')
assert(projectHomeSource.includes('const hasDraftContent = sections.some'), 'ProjectHome must compute whether a full draft exists before routing to research')
assert(
  projectHomeSource.includes("hasDraftContent ? 'research' : 'stage3'"),
  'ProjectHome research entry must send users to Stage3 until a full draft exists'
)
assert(
  projectHomeSource.includes('请先进入文章生成，生成或确认全文初稿后再做研究计算'),
  'ProjectHome research entry is missing the workflow guidance message'
)
assert(researchCenterSource.includes('const hasDraftContent = useMemo'), 'ResearchCenter must compute whether a full draft exists')
assert(
  researchCenterSource.includes('if (!hasDraftContent && !isAssetPage)'),
  'ResearchCenter must guard direct /research access before a full draft exists'
)
assert(
  researchCenterSource.includes('请先生成或确认论文正文，再进行数据分析'),
  'ResearchCenter direct-access guard is missing the user-facing workflow message'
)
assert(
  researchCenterSource.indexOf('if (!hasDraftContent && !isAssetPage)') < researchCenterSource.indexOf('if (isAssetPage)'),
  'ResearchCenter draft guard should run before the asset-page branch'
)
assert(
  stage3Source.includes('citationEnhanceAutoStartKey') && stage3Source.includes('autoStartEnhancementKey={citationEnhanceAutoStartKey}'),
  'Stage3 citation calibration should open the reference panel and auto-start enhancement'
)
assert(
  referencePanelSource.includes('autoStartEnhancementKey') && referencePanelSource.includes('scanCitationPoints()'),
  'ReferencePanel must support auto-starting citation enhancement'
)

console.log(JSON.stringify({
  ok: true,
  checkedFiles: contracts.length,
  checkedTestIds: contracts.reduce((sum, item) => sum + item.ids.length, 0),
  checkedProjectHomeResearchGate: true,
  checkedResearchGuard: true,
  checkedCitationAutoStart: true,
}, null, 2))
