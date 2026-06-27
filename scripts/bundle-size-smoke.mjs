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

function main() {
  assert(fs.existsSync(distDir), 'dist/assets 不存在，请先运行 npm run build。')
  const assets = fs.readdirSync(distDir)
  const jsAssets = assets.filter(name => name.endsWith('.js'))
  const main = jsAssets
    .filter(name => /^index-[\w-]+\.js$/.test(name))
    .map(assetInfo)
    .sort((a, b) => b.bytes - a.bytes)[0]

  const stage3 = jsAssets.find(name => /^Stage3-[\w-]+\.js$/.test(name))
  const research = jsAssets.find(name => /^ResearchCenter-[\w-]+\.js$/.test(name))

  assert(main, '没有找到主入口 index-*.js')
  assert(stage3, 'Stage3 没有被拆成独立 chunk，可能又被首屏静态 import 了。')
  assert(research, 'ResearchCenter 没有被拆成独立 chunk，可能又被首屏静态 import 了。')
  assert(main.bytes < 650_000, `首屏主包过大：${main.bytes} bytes，应低于 650KB。`)
  assert(main.gzipBytes < 190_000, `首屏主包 gzip 过大：${main.gzipBytes} bytes，应低于 190KB。`)

  const stage3Info = assetInfo(stage3)
  const researchInfo = assetInfo(research)
  assert(stage3Info.bytes > main.bytes, 'Stage3 chunk 应该承载编辑器主体代码，当前包体异常偏小。')
  assert(researchInfo.bytes < main.bytes, 'ResearchCenter chunk 异常大，可能引入了首屏共享重型依赖。')

  console.log(JSON.stringify({
    ok: true,
    main,
    stage3: stage3Info,
    research: researchInfo,
  }, null, 2))
}

try {
  main()
} catch (error) {
  console.error(error)
  process.exit(1)
}
