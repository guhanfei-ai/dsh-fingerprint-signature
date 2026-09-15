import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = resolve(root, 'src/client/index.js')
const outputPath = resolve(root, 'client.js')
const source = await readFile(sourcePath, 'utf8')

if (!source.includes('window.__ModuleLoader__.load({')) {
  throw new Error('client source is missing the ModuleLoader entry')
}
if (!source.includes('exports.apply = apply')) {
  throw new Error('client source is missing the plugin apply export')
}

await writeFile(outputPath, source.endsWith('\n') ? source : `${source}\n`, 'utf8')
console.log('built client.js from src/client/index.js')

