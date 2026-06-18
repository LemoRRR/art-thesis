export interface WordPaginationOptions {
  pageHeight: number
  topMargin: number
  bottomMargin: number
  pageGap: number
  minHeadingFollowingSpace: number
}

export interface WordPaginationResult {
  pageCount: number
  breaks: Array<{
    pageNumber: number
    blockIndex: number
    offset: number
  }>
}

function clearPagination(blocks: HTMLElement[]) {
  blocks.forEach(block => {
    block.classList.remove('paper-page-break-before')
    block.style.removeProperty('margin-top')
    block.style.removeProperty('--page-break-gap')
    block.removeAttribute('data-page-number')
  })
}

function blockIsHeading(block: HTMLElement) {
  return block.tagName === 'H2' || block.tagName === 'H3'
}

function blockTop(block: HTMLElement, root: HTMLElement) {
  return block.getBoundingClientRect().top - root.getBoundingClientRect().top
}

function blockBottom(block: HTMLElement, root: HTMLElement) {
  return block.getBoundingClientRect().bottom - root.getBoundingClientRect().top
}

function nextContentBlock(blocks: HTMLElement[], index: number) {
  return blocks.slice(index + 1).find(block => !blockIsHeading(block))
}

export function applyWordPagination(
  editorRoot: HTMLElement,
  contentRoot: HTMLElement,
  options: WordPaginationOptions
): WordPaginationResult {
  const blocks = Array.from(editorRoot.querySelectorAll<HTMLElement>('h2, h3, p'))
    .filter(block => block.getClientRects().length > 0)
  clearPagination(blocks)

  let pageNumber = 1
  let pageBottom = options.pageHeight - options.bottomMargin
  const breaks: WordPaginationResult['breaks'] = []

  blocks.forEach((block, index) => {
    const top = blockTop(block, contentRoot)
    const bottom = blockBottom(block, contentRoot)
    const nextBlock = nextContentBlock(blocks, index)
    const nextBottom = nextBlock ? blockBottom(nextBlock, contentRoot) : bottom
    const headingWouldOrphan = blockIsHeading(block) && nextBottom > pageBottom - options.minHeadingFollowingSpace
    const blockOverflows = bottom > pageBottom
    const canMoveToNextPage = top > (pageNumber - 1) * options.pageHeight + options.topMargin

    if ((blockOverflows || headingWouldOrphan) && canMoveToNextPage) {
      const remainingPageSpace = Math.max(0, pageBottom - top)
      const gap = remainingPageSpace + options.topMargin
      pageNumber += 1
      block.classList.add('paper-page-break-before')
      block.style.setProperty('margin-top', `${gap}px`)
      block.style.setProperty('--page-break-gap', `${gap}px`)
      block.setAttribute('data-page-number', String(pageNumber))
      breaks.push({ pageNumber, blockIndex: index, offset: gap })
      pageBottom = pageNumber * options.pageHeight - options.bottomMargin
    }
  })

  const contentHeight = contentRoot.scrollHeight
  const pageCount = Math.max(1, pageNumber, Math.ceil(contentHeight / options.pageHeight))
  return { pageCount, breaks }
}
