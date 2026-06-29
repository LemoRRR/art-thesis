import { spawn } from 'node:child_process'

const args = new Set(process.argv.slice(2))
const isFull = args.has('--full')
const skipBuild = args.has('--skip-build')
const skipSeed = args.has('--skip-seed')

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const quickChecks = [
  ['smoke:prod-auth-project', 'Production auth, project CRUD, and /me'],
  ['smoke:prod-cloud-restore', 'Cross-browser cloud restore for outline, paper, and research package'],
  ['smoke:prod-stage3-generation-e2e', 'Stage3 full paper generation with progress and cloud persistence'],
]

const fullChecks = [
  ['smoke:prod-citation-enhance', 'Citation enhancement relevance and source coverage'],
  ['smoke:prod-research-kano', 'Production KANO/entropy research calculation and Word export'],
  ['smoke:prod-stage3-research-e2e', 'Stage3 to research calculation to paper insertion to Word export'],
]

const checks = [
  ...(skipBuild ? [] : [['build', 'Production build']]),
  ...quickChecks,
  ...(isFull ? fullChecks : []),
  ...(skipSeed ? [] : [['seed:prod-demo', 'Seed or refresh a production customer demo project']]),
]

function runNpmScript(scriptName, label) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    console.log(`\n=== ${label} ===`)
    console.log(`$ npm run ${scriptName}`)

    const command = process.platform === 'win32' ? `${npmCommand} run ${scriptName}` : npmCommand
    const commandArgs = process.platform === 'win32' ? [] : ['run', scriptName]
    const child = spawn(command, commandArgs, {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })

    child.on('error', reject)
    child.on('exit', code => {
      const durationSeconds = ((Date.now() - startedAt) / 1000).toFixed(1)
      if (code === 0) {
        console.log(`✓ ${label} passed in ${durationSeconds}s`)
        resolve()
      } else {
        reject(new Error(`${label} failed with exit code ${code}`))
      }
    })
  })
}

async function main() {
  console.log('Production delivery check')
  console.log(`Mode: ${isFull ? 'full' : 'quick'}`)
  console.log(`Checks: ${checks.map(([, label]) => label).join(' -> ')}`)

  for (const [scriptName, label] of checks) {
    await runNpmScript(scriptName, label)
  }

  console.log('\nProduction delivery check passed.')
  console.log('Before a customer demo, still open the seeded project once manually and export Word from the browser.')
}

main().catch(error => {
  console.error('\nProduction delivery check failed.')
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
