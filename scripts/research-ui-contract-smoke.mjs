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

console.log(JSON.stringify({
  ok: true,
  checkedFiles: contracts.length,
  checkedTestIds: contracts.reduce((sum, item) => sum + item.ids.length, 0),
}, null, 2))
