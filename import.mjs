#!/usr/bin/env node
/**
 * Sube a WoWUtils (Viserio Cooldowns) las URLs de droptimizer generadas por
 * run.mjs. Es la version en linea de comandos de la opcion 5 del menu.
 *
 *   node import.mjs --dry-run          # muestra que se enviaria, sin llamar a la API
 *   node import.mjs                    # sube el ultimo out/droptimizers-*.json
 *   node import.mjs --file out/droptimizers-....json
 *   node import.mjs --url https://www.raidbots.com/simbot/report/xxxx --profile-key heroic-max
 *
 * Credenciales: variables de entorno WOWUTILS_API_KEY y WOWUTILS_GROUP_ID, un
 * .env al lado, o el wowutils-account.json que deja el menu.
 * Coste: 5 puntos de rate limit por import.
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  HERE, OUT_DIR, log, readWowutils, importDroptimizers, importableFrom, latestResultsFile,
} from './lib.mjs'

for (const dir of [HERE, path.resolve(HERE, '..'), path.resolve(HERE, '..', '..')]) {
  try { process.loadEnvFile(path.join(dir, '.env')); break } catch { /* seguimos buscando */ }
}

const args = process.argv.slice(2)
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`)
  if (i === -1) return fallback
  const next = args[i + 1]
  return next && !next.startsWith('--') ? next : true
}
const has = (name) => args.includes(`--${name}`)
const dryRun = has('dry-run')

const creds = readWowutils()
if (!creds && !dryRun) {
  console.error('Falta la configuracion de WoWUtils: define WOWUTILS_API_KEY y WOWUTILS_GROUP_ID')
  console.error('(o configuralo desde el menu: opcion 5 → 2).')
  process.exit(1)
}
const groupId = flag('group') || creds?.groupId || '<grupo>'

let items
if (typeof flag('url') === 'string') {
  items = [{ url: flag('url'), profileKey: flag('profile-key') || undefined, character: '?', label: 'manual' }]
} else {
  const file = typeof flag('file') === 'string' ? path.resolve(flag('file')) : latestResultsFile(OUT_DIR)
  if (!file) {
    console.error('No hay resultados en out/. Lanza antes: node run.mjs')
    process.exit(1)
  }
  log(`Fichero: ${file}`)
  items = importableFrom(JSON.parse(fs.readFileSync(file, 'utf8')))
}

if (!items.length) {
  console.error('No hay droptimizers terminados que importar.')
  process.exit(1)
}
if (has('no-profile-key')) items = items.map(({ profileKey, ...rest }) => rest)

log(`\nImportando ${items.length} droptimizer(s) al grupo ${groupId} — ${items.length * 5} pts\n`)
const { failed } = await importDroptimizers(items, { ...creds, groupId, dryRun })
process.exit(failed.length ? 1 : 0)
