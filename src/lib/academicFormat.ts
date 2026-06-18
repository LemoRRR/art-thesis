import type { OutlineSection } from './storage'
import { parsePaperBlocks } from './documentFormat'

const CHINESE_NUMERALS = ['', '\u4e00', '\u4e8c', '\u4e09', '\u56db', '\u4e94', '\u516d', '\u4e03', '\u516b', '\u4e5d', '\u5341']
const CJK_NUMERAL = '\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u5343\u4e07'

export function toChineseNumber(value: number): string {
  if (value <= 0) return String(value)
  if (value <= 10) return CHINESE_NUMERALS[value]
  if (value < 20) return `\u5341${CHINESE_NUMERALS[value - 10]}`
  if (value < 100) {
    const ten = Math.floor(value / 10)
    const one = value % 10
    return `${CHINESE_NUMERALS[ten]}\u5341${one ? CHINESE_NUMERALS[one] : ''}`
  }
  return String(value)
}

export function isFrontMatterTitle(title: string): boolean {
  return /^(?:0\s*)?(\u6458\u8981|abstract|\u4e2d\u82f1\u6587\u6458\u8981|\u6458\u8981\u4e0e\s*abstract)/i.test(title.trim())
}

export function stripAcademicTitlePrefix(title: string): string {
  return title
    .trim()
    .replace(/^0\s+/, '')
    .replace(/^\d+(?:\.\d+)*[.\u3001\s]+/, '')
    .replace(new RegExp(`^\u7b2c[${CJK_NUMERAL}\\d]+[\u7ae0\u8282\u7bc7\u90e8]\\s*`), '')
    .replace(new RegExp(`^[${CJK_NUMERAL}]+[\u3001.]\\s*`), '')
    .replace(new RegExp(`^\uff08[${CJK_NUMERAL}]+\uff09\\s*`), '')
    .trim()
}

export function formatAcademicOutlineMarker(order: string): string {
  if (order === '0') return ''
  const parts = order.split('.').map(part => Number.parseInt(part, 10)).filter(Number.isFinite)
  if (parts.length === 1) return `${toChineseNumber(parts[0])}\u3001`
  if (parts.length === 2) return `\uff08${toChineseNumber(parts[1])}\uff09`
  if (parts.length === 3) return `${parts[2]}.`
  return order
}

export function formatAcademicOutlineTitle(section: Pick<OutlineSection, 'order' | 'title'>): string {
  const title = stripAcademicTitlePrefix(section.title)
  if (section.order === '0' || isFrontMatterTitle(title)) return '\u6458\u8981'

  const marker = formatAcademicOutlineMarker(section.order)
  return marker ? `${marker}${marker.endsWith('.') ? ' ' : ''}${title}` : title
}

export function formatAcademicOutlineText(sections: OutlineSection[], depth = 0): string {
  return sections.map(section => {
    const indent = '  '.repeat(depth)
    const children = section.children ? formatAcademicOutlineText(section.children, depth + 1) : ''
    return `${indent}${formatAcademicOutlineTitle(section)}${children ? `\n${children}` : ''}`
  }).join('\n')
}

function normalizedTitleKey(title: string): string {
  return stripAcademicTitlePrefix(title)
    .replace(/[\s:：,，.。;；、()[\]（）【】《》"'“”‘’]/g, '')
    .toLowerCase()
}

function collectOutlineTitleMap(section: OutlineSection | undefined, map = new Map<string, string>()) {
  ;(section?.children ?? []).forEach(child => {
    map.set(normalizedTitleKey(child.title), formatAcademicOutlineTitle(child))
    map.set(normalizedTitleKey(formatAcademicOutlineTitle(child)), formatAcademicOutlineTitle(child))
    collectOutlineTitleMap(child, map)
  })
  return map
}

export function formatAcademicSectionContentWithOutline(
  content: string,
  sectionTitle: string,
  outlineSection?: OutlineSection | null
): string {
  const blocks = parsePaperBlocks(content)
  if (blocks.length === 0) return ''

  const sectionKey = normalizedTitleKey(sectionTitle)
  const outlineTitleMap = collectOutlineTitleMap(outlineSection ?? undefined)

  return blocks
    .filter((block, index) => index !== 0 || normalizedTitleKey(block.text) !== sectionKey)
    .map(block => {
      const key = normalizedTitleKey(block.text)
      return outlineTitleMap.get(key) ?? block.text
    })
    .join('\n\n')
}
