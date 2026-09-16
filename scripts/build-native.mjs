import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'

const run = promisify(execFile)
const root = dirname(fileURLToPath(import.meta.url))
const project = resolve(root, '..')
const outputDir = resolve(project, 'native/bin')

await mkdir(outputDir, { recursive: true })

if (process.platform === 'darwin') {
  const source = resolve(project, 'native/macos/dsh-fingerprint-auth.swift')
  const output = resolve(outputDir, 'dsh-fingerprint-auth')
  const moduleCache = resolve(tmpdir(), 'dsh-fingerprint-signature-module-cache')
  await mkdir(moduleCache, { recursive: true })
  await run('swiftc', [source, '-o', output, '-module-cache-path', moduleCache, '-framework', 'LocalAuthentication'])
  console.log(`built ${output}`)
} else if (process.platform === 'win32') {
  const source = resolve(project, 'native/windows/dsh-fingerprint-auth.csproj')
  const runtime = process.arch === 'arm64' ? 'win-arm64' : 'win-x64'
  await run('dotnet', ['publish', source, '-c', 'Release', '-r', runtime, '-o', outputDir])
  console.log(`built ${outputDir}`)
} else {
  console.log('No platform helper build is defined for this operating system.')
}
