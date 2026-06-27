export function assertPaperNarratives({ assert, components, tables = [], figures = [], label = 'research' }) {
  const narrativeComponents = components.filter(component => component.type === 'analysis')
  const targets = [...tables, ...figures]
  const beforeCount = narrativeComponents.filter(component => String(component.title ?? '').endsWith(': before')).length
  const afterCount = narrativeComponents.filter(component => String(component.title ?? '').endsWith(': after')).length
  assert(beforeCount >= targets.length, `not every ${label} table/figure has a before paragraph`)
  assert(afterCount >= targets.length, `not every ${label} table/figure has an after paragraph`)

  const narrativeText = narrativeComponents.map(component => component.content ?? '').join('\n')
  assert(!narrativeText.includes('用于辅助说明数据中的主要分布特征'), `${label} narrative still uses generic fallback wording`)
  assert(
    !/系统识别到|上传工作簿|当前工作簿|独立报告|研究包|system identified|uploaded workbook|current workbook|standalone report|research package/i.test(narrativeText),
    `${label} narrative leaks workflow/tool wording instead of thesis prose`
  )

  const missingNarrativeTargets = targets
    .filter(item => {
      const title = String(item.title ?? '')
      return !narrativeComponents.some(component => String(component.title ?? '').startsWith(`${title}: before`))
        || !narrativeComponents.some(component => String(component.title ?? '').startsWith(`${title}: after`))
    })
    .map(item => item.id ?? item.title)
  assert(missingNarrativeTargets.length === 0, `some ${label} paper tables/figures are missing local thesis prose: ${missingNarrativeTargets.join(', ')}`)

  const thinNarratives = narrativeComponents
    .filter(component => String(component.content ?? '').replace(/\s/g, '').length < 35)
    .map(component => component.title ?? component.id)
  assert(thinNarratives.length === 0, `some ${label} table/figure narratives are too thin for thesis insertion: ${thinNarratives.join(', ')}`)
}
