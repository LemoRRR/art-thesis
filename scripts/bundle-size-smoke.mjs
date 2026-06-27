import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const distDir = path.resolve(process.cwd(), 'dist/assets')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function assetInfo(fileName) {
  const filePath = path.join(distDir, fileName)
  const buffer = fs.readFileSync(filePath)
  return {
    fileName,
    bytes: buffer.length,
    gzipBytes: zlib.gzipSync(buffer).length,
  }
}

function findAsset(jsAssets, pattern, label) {
  const found = jsAssets.find(name => pattern.test(name))
  assert(found, `${label} chunk is missing.`)
  return found
}

function main() {
  assert(fs.existsSync(distDir), 'dist/assets does not exist. Run `npm run build` first.')
  const jsAssets = fs.readdirSync(distDir).filter(name => name.endsWith('.js'))
  const main = jsAssets
    .filter(name => /^index-[\w-]+\.js$/.test(name))
    .map(assetInfo)
    .sort((a, b) => b.bytes - a.bytes)[0]

  assert(main, 'Main entry index-*.js was not found.')
  const stage3Info = assetInfo(findAsset(jsAssets, /^Stage3-[\w-]+\.js$/, 'Stage3'))
  const paperEditorInfo = assetInfo(findAsset(jsAssets, /^PaperDocumentEditor-[\w-]+\.js$/, 'PaperDocumentEditor'))
  const editorVendorInfo = assetInfo(findAsset(jsAssets, /^editor-vendor-[\w-]+\.js$/, 'editor-vendor'))
  const docxExportInfo = assetInfo(findAsset(jsAssets, /^docxExport-[\w-]+\.js$/, 'docxExport'))
  const docxVendorInfo = assetInfo(findAsset(jsAssets, /^docx-vendor-[\w-]+\.js$/, 'docx-vendor'))
  const researchInfo = assetInfo(findAsset(jsAssets, /^ResearchCenter-[\w-]+\.js$/, 'ResearchCenter'))

  assert(main.bytes < 650_000, `Main bundle is too large: ${main.bytes} bytes; expected < 650KB.`)
  assert(main.gzipBytes < 190_000, `Main bundle gzip is too large: ${main.gzipBytes} bytes; expected < 190KB.`)
  assert(stage3Info.bytes < 160_000, `Stage3 shell bundle is too large: ${stage3Info.bytes} bytes; heavy editor/export code should be lazy-loaded.`)
  assert(stage3Info.gzipBytes < 55_000, `Stage3 shell gzip is too large: ${stage3Info.gzipBytes} bytes; expected < 55KB.`)
  assert(paperEditorInfo.bytes < 180_000, `PaperDocumentEditor app chunk is too large: ${paperEditorInfo.bytes} bytes; editor vendor may have leaked into it.`)
  assert(editorVendorInfo.bytes < 550_000, `editor-vendor is too large: ${editorVendorInfo.bytes} bytes; review TipTap/ProseMirror imports.`)
  assert(docxExportInfo.bytes < 80_000, `docxExport app chunk is too large: ${docxExportInfo.bytes} bytes; docx vendor may have leaked into it.`)
  assert(researchInfo.bytes < main.bytes, 'ResearchCenter is unexpectedly larger than the main bundle.')

  console.log(JSON.stringify({
    ok: true,
    main,
    stage3: stage3Info,
    paperEditor: paperEditorInfo,
    editorVendor: editorVendorInfo,
    docxExport: docxExportInfo,
    docxVendor: docxVendorInfo,
    research: researchInfo,
  }, null, 2))
}

try {
  main()
} catch (error) {
  console.error(error)
  process.exit(1)
}
