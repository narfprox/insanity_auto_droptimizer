#!/usr/bin/env node
/**
 * FASE 2 — Importa en WoWUtils (Viserio Cooldowns) las URLs de droptimizer
 * generadas por run.mjs.
 *
 *   node import.mjs --dry-run          # muestra que se enviaria, sin llamar a la API
 *   node import.mjs                    # importa el ultimo out/droptimizers-*.json
 *   node import.mjs --file out/droptimizers-....json
 *   node import.mjs --url https://www.raidbots.com/simbot/report/xxxx --profile-key heroic-max
 *
 * Requiere en el entorno (o en un .env al lado del programa):
 *   WOWUTILS_API_KEY    key del grupo (Group settings -> API sharing)
 *   WOWUTILS_GROUP_ID   id del grupo (sale en la URL de wowutils.com)
 * Coste: 5 puntos de rate limit por import.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const API = 'https://api.wowutils.com'
const COST_PER_IMPORT = 5

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

const apiKey = process.env.WOWUTILS_API_KEY
const groupId = flag('group', process.env.WOWUTILS_GROUP_ID)
const dryRun = has('dry-run')

if (!apiKey && !dryRun) {
  console.error('Falta WOWUTILS_API_KEY (ponla en un .env al lado del programa).')
  process.exit(1)
}
if (!groupId) {
  console.error('Falta el grupo: define WOWUTILS_GROUP_ID en el .env o pasa --group <id>.')
  process.exit(1)
}

// ---------------------------------------------------------------- entradas

/** [{url, profileKey, character, label}] */
let items = []
if (typeof flag('url') === 'string') {
  items = [{ url: flag('url'), profileKey: flag('profile-key') || undefined, character: '?', label: 'manual' }]
} else {
  let file = flag('file')
  if (typeof file !== 'string') {
    const dir = path.join(HERE, 'out')
    const candidates = fs.existsSync(dir)
      ? fs.readdirSync(dir).filter((f) => f.startsWith('droptimizers-') && f.endsWith('.json')).sort()
      : []
    if (!candidates.length) {
      console.error('No hay resultados en out/. Lanza antes: node run.mjs')
      process.exit(1)
    }
    file = path.join(dir, candidates[candidates.length - 1])
  }
  const results = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'))
  items = results
    .filter((r) => r.url && r.state === 'complete')
    .map((r) => ({ url: r.url, profileKey: r.profileKey, character: r.character, label: r.label }))
  console.log(`Fichero: ${file}`)
}

if (!items.length) {
  console.error('No hay droptimizers terminados que importar.')
  process.exit(1)
}

// ---------------------------------------------------------------- import

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0

console.log(`\nImportando ${items.length} droptimizer(s) al grupo ${groupId} — ${items.length * COST_PER_IMPORT} pts\n`)

for (const item of items) {
  const body = { url: item.url }
  if (item.profileKey && !has('no-profile-key')) body.profileKey = item.profileKey

  if (dryRun) {
    console.log(`[dry-run] POST /v1/groups/${groupId}/droptimizers ${JSON.stringify(body)}`)
    continue
  }

  const res = await fetch(`${API}/v1/groups/${groupId}/droptimizers`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  const remaining = res.headers.get('x-ratelimit-remaining')

  if (res.ok) {
    console.log(`OK  ${item.character} · ${item.label}  (quedan ${remaining ?? '?'} pts)`)
  } else {
    failures++
    console.log(`!!  ${item.character} · ${item.label} — HTTP ${res.status}: ${text.slice(0, 300)}`)
  }

  // Con 225 pts/h y 5 pts por import hay margen de sobra, pero si el presupuesto
  // se agota esperamos al reset en vez de encadenar 429.
  if (remaining !== null && Number(remaining) < COST_PER_IMPORT) {
    const reset = Number(res.headers.get('x-ratelimit-reset') || 0) * 1000
    const waitMs = Math.max(0, reset - Date.now()) + 2000
    console.log(`Sin puntos: esperando ${Math.ceil(waitMs / 1000)}s al reset...`)
    await sleep(waitMs)
  } else {
    await sleep(500)
  }
}

process.exit(failures ? 1 : 0)
