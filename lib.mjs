/**
 * Nucleo compartido: navegador, sesion de Raidbots, configuracion de la web y
 * lanzamiento de los sims. run.mjs (CLI + menu) es quien lo usa.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import DEFAULT_PROFILES from './profiles.json' with { type: 'json' }

export const BASE = 'https://www.raidbots.com'
export const DROPTIMIZER_URL = `${BASE}/simbot/droptimizer`

export const IS_PACKAGED = (() => {
  try {
    // eslint-disable-next-line no-undef
    return !!(process.versions.sea || require('node:sea').isSea())
  } catch { return false }
})()

/** Carpeta de trabajo: junto al .exe si esta empaquetado, si no junto al script. */
export const HERE = process.env.DROPTIMIZER_HOME
  ? path.resolve(process.env.DROPTIMIZER_HOME)
  : IS_PACKAGED ? path.dirname(process.execPath) : path.dirname(fileURLToPath(import.meta.url))

/*
 * Todo lo que el programa lee o escribe vive bajo datos/, para que al
 * descomprimir solo se vea el ejecutable y no un revoltijo de ficheros.
 */
export const DATOS = process.env.DROPTIMIZER_DATA
  ? path.resolve(process.env.DROPTIMIZER_DATA)
  : path.join(HERE, 'datos')

export const MEDIA_DIR = path.join(DATOS, 'media')
export const PROFILE_DIR = path.join(DATOS, 'navegador')
export const UI_PROFILE_DIR = path.join(DATOS, 'ventana')
export const SIMC_DIR = path.join(DATOS, 'simc')
export const OUT_DIR = path.join(DATOS, 'out')
export const ACCOUNT_FILE = path.join(DATOS, 'raidbots-account.json')
export const WOWUTILS_FILE_PATH = path.join(DATOS, 'wowutils-account.json')
export const CONFIG_FILE = path.join(DATOS, 'config.json')

/** Donde buscar un fichero de datos: primero datos/, luego el sitio de siempre. */
export const buscarDato = (...candidatos) => candidatos.find((f) => f && fs.existsSync(f)) || null

/**
 * Las versiones anteriores lo dejaban todo suelto junto al .exe. Al arrancar se
 * mueve a datos/ lo que hubiera, para no perder la sesion ni la configuracion
 * de quien viene actualizando.
 */
export function migrarEstructuraVieja() {
  const mudanzas = [
    ['.browser-profile', PROFILE_DIR],
    ['.ui-profile', UI_PROFILE_DIR],
    ['simc', SIMC_DIR],
    ['out', OUT_DIR],
    ['config.json', CONFIG_FILE],
    ['raidbots-account.json', ACCOUNT_FILE],
    ['wowutils-account.json', WOWUTILS_FILE_PATH],
  ]
  let movidos = 0
  for (const [viejo, nuevo] of mudanzas) {
    const origen = path.join(HERE, viejo)
    if (!fs.existsSync(origen) || fs.existsSync(nuevo)) continue
    try {
      fs.mkdirSync(path.dirname(nuevo), { recursive: true })
      fs.renameSync(origen, nuevo)
      movidos++
    } catch { /* si no se puede mover, se queda donde estaba */ }
  }
  if (movidos) log(`  (ordenados ${movidos} ficheros de la version anterior en datos/)`)
}

/*
 * Las clases tal y como las escribe el addon al principio del export:
 *   deathknight="Gonsudk"
 * Ojo: el addon las escribe SIN guion bajo (deathknight, demonhunter) aunque
 * SimulationCraft por dentro use death_knight. Se aceptan las dos formas.
 */
const CLASSES = [
  'death_?knight', 'demon_?hunter', 'druid', 'evoker', 'hunter', 'mage', 'monk',
  'paladin', 'priest', 'rogue', 'shaman', 'warlock', 'warrior',
]

// ---------------------------------------------------------------- utils

/*
 * Todo el progreso sale por aqui. La consola es el destino por defecto, pero la
 * interfaz grafica lo redirige a su propio panel con setLogger().
 */
let sink = (...m) => console.log(...m)
export const log = (...m) => sink(...m)
export function setLogger(fn) { sink = fn || ((...m) => console.log(...m)) }

export const stamp = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z')
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/*
 * Una sola interfaz de readline para todo el programa: si se creara una por
 * pregunta, al cerrarla se perderia lo que ya hubiera leido de stdin.
 * La salida va por un stream propio que se puede silenciar (contraseñas).
 */
let rl = null
let output = null

function getReadline() {
  if (!rl) {
    output = new Writable({
      write(chunk, encoding, callback) {
        if (!output.silent) process.stdout.write(chunk, encoding)
        callback()
      },
    })
    rl = readline.createInterface({ input: process.stdin, output, terminal: true })
    rl.on('close', () => { rl = null })
  }
  return rl
}

export function prompt(question) {
  return new Promise((resolve) => getReadline().question(question, (v) => resolve(v.trim())))
}

/** Igual que prompt pero sin mostrar lo que se teclea (contraseñas). */
export function promptHidden(question) {
  return new Promise((resolve) => {
    getReadline().question(question, (value) => {
      output.silent = false
      process.stdout.write('\n')
      resolve(value.trim())
    })
    output.silent = true // la pregunta ya esta escrita; lo que se teclee, no
  })
}

export function closePrompts() {
  rl?.close()
  rl = null
}

/** Datos basicos del personaje a partir del string SimC. */
export function parseSimc(text) {
  const line = (re) => (text.match(re) || [])[1] || null
  const encontrado = text.match(new RegExp(`^(${CLASSES.join('|')})="?([^"\n]+)"?`, 'm'))
  return {
    name: encontrado ? encontrado[2].trim() : null,
    class: encontrado ? encontrado[1].replace('_', '') : null,
    spec: line(/^spec=(\w+)/m),
    realm: line(/^server=(\S+)/m),
    region: line(/^region=(\S+)/m),
  }
}

export function simcFileName(character) {
  const base = [character.name, character.spec].filter(Boolean).join('-').toLowerCase()
    .replace(/[^a-z0-9-]/g, '') || 'personaje'
  return `${base}.simc`
}

/** Lee el portapapeles del sistema (donde deja el texto el addon SimC). */
export function readClipboard() {
  try {
    if (process.platform === 'win32') {
      return execFileSync('powershell', ['-NoProfile', '-Command', 'Get-Clipboard -Raw'], {
        encoding: 'utf8', maxBuffer: 10 * 1024 * 1024,
      })
    }
    if (process.platform === 'darwin') return execFileSync('pbpaste', { encoding: 'utf8' })
    return execFileSync('xclip', ['-selection', 'clipboard', '-o'], { encoding: 'utf8' })
  } catch {
    return null
  }
}

/** Un texto solo vale si trae clase + spec (o sea, si es un export del addon). */
export function looksLikeSimc(text) {
  if (!text || text.length < 200) return false
  const c = parseSimc(text)
  return !!(c.name && c.class)
}

// ---------------------------------------------------------------- config

export function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) } catch { return {} }
}

export function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2))
}

/** Perfiles de droptimizer: manda un profiles.json al lado del programa si existe. */
export function loadProfiles() {
  const file = buscarDato(path.join(DATOS, 'profiles.json'), path.join(HERE, 'profiles.json'))
  if (file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { log('aviso: profiles.json no es valido, se usan los de fabrica') }
  }
  return DEFAULT_PROFILES
}

// ---------------------------------------------------------------- cuenta

/** Credenciales guardadas: variables de entorno o raidbots-account.json. */
export function readAccount() {
  if (process.env.RAIDBOTS_EMAIL && process.env.RAIDBOTS_PASSWORD) {
    return { email: process.env.RAIDBOTS_EMAIL, password: process.env.RAIDBOTS_PASSWORD, from: 'variables de entorno' }
  }
  if (fs.existsSync(ACCOUNT_FILE)) {
    try {
      const { email, password } = JSON.parse(fs.readFileSync(ACCOUNT_FILE, 'utf8'))
      if (email && password) return { email, password, from: 'credenciales guardadas' }
    } catch { log('aviso: raidbots-account.json no es un JSON valido') }
  }
  return null
}

export function saveAccount({ email, password }) {
  fs.writeFileSync(ACCOUNT_FILE, JSON.stringify({ email, password }, null, 2))
}

export function forgetAccount() {
  fs.rmSync(ACCOUNT_FILE, { force: true })
}

// ---------------------------------------------------------------- WoWUtils

export const WOWUTILS_API = 'https://api.wowutils.com'
export const WOWUTILS_FILE = WOWUTILS_FILE_PATH
const COST_PER_IMPORT = 5

/** Key + grupo de WoWUtils: variables de entorno o wowutils-account.json. */
export function readWowutils() {
  if (process.env.WOWUTILS_API_KEY && process.env.WOWUTILS_GROUP_ID) {
    return { apiKey: process.env.WOWUTILS_API_KEY, groupId: process.env.WOWUTILS_GROUP_ID, from: 'variables de entorno' }
  }
  if (fs.existsSync(WOWUTILS_FILE)) {
    try {
      const { apiKey, groupId } = JSON.parse(fs.readFileSync(WOWUTILS_FILE, 'utf8'))
      if (apiKey && groupId) return { apiKey, groupId, from: 'configuracion guardada' }
    } catch { log('aviso: wowutils-account.json no es un JSON valido') }
  }
  return null
}

export function saveWowutils({ apiKey, groupId }) {
  fs.writeFileSync(WOWUTILS_FILE, JSON.stringify({ apiKey, groupId }, null, 2))
}

export function forgetWowutils() {
  fs.rmSync(WOWUTILS_FILE, { force: true })
}

/** Comprueba que la key vale y devuelve el nombre del grupo (cuesta 1 punto). */
export async function checkWowutils({ apiKey, groupId }) {
  try {
    const res = await fetch(`${WOWUTILS_API}/v1/groups/${encodeURIComponent(groupId)}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    })
    if (res.status === 401 || res.status === 403) return { ok: false, message: 'la API key no vale para ese grupo' }
    if (res.status === 404) return { ok: false, message: 'ese grupo no existe (revisa el id)' }
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}` }
    const body = await res.json()
    const group = body?.data || body
    return { ok: true, name: group?.name || groupId, remaining: res.headers.get('x-ratelimit-remaining') }
  } catch (e) {
    return { ok: false, message: e.message }
  }
}

/**
 * Sube droptimizers al grupo. Cada import cuesta 5 puntos del presupuesto por
 * hora del grupo; si se agota, espera al reset en vez de encadenar 429.
 */
export async function importDroptimizers(items, { apiKey, groupId, dryRun = false }) {
  const done = []
  const failed = []

  for (const item of items) {
    const body = { url: item.url }
    if (item.profileKey) body.profileKey = item.profileKey

    if (dryRun) {
      log(`[dry-run] POST /v1/groups/${groupId}/droptimizers ${JSON.stringify(body)}`)
      done.push(item)
      continue
    }

    let res = await fetch(`${WOWUTILS_API}/v1/groups/${encodeURIComponent(groupId)}/droptimizers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    let text = await res.text()

    // Si el profileKey no le gusta, se reintenta sin el: WoWUtils lo deduce del report.
    if (!res.ok && body.profileKey && /profilekey/i.test(text)) {
      res = await fetch(`${WOWUTILS_API}/v1/groups/${encodeURIComponent(groupId)}/droptimizers`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: item.url }),
      })
      text = await res.text()
    }

    const remaining = res.headers.get('x-ratelimit-remaining')
    if (res.ok) {
      done.push(item)
      log(`  OK  ${item.character || '?'} · ${item.label || item.profileKey || ''}  (quedan ${remaining ?? '?'} pts)`)
    } else {
      failed.push({ ...item, error: `HTTP ${res.status}: ${text.slice(0, 200)}` })
      log(`  !!  ${item.character || '?'} · ${item.label || ''} — HTTP ${res.status}: ${text.slice(0, 200)}`)
    }

    if (remaining !== null && Number(remaining) < COST_PER_IMPORT) {
      const reset = Number(res.headers.get('x-ratelimit-reset') || 0) * 1000
      const waitMs = Math.max(0, reset - Date.now()) + 2000
      log(`  sin puntos: esperando ${Math.ceil(waitMs / 1000)}s al reset del grupo...`)
      await sleep(waitMs)
    } else {
      await sleep(500)
    }
  }
  return { done, failed }
}

/** Los droptimizers de un fichero de resultados que se pueden importar. */
export function importableFrom(results) {
  return results
    .filter((r) => r.url && r.state === 'complete')
    .map((r) => ({ url: r.url, profileKey: r.profileKey, character: r.character, label: r.label }))
}

/** El fichero out/droptimizers-*.json mas reciente. */
export function latestResultsFile(outDir) {
  if (!fs.existsSync(outDir)) return null
  const files = fs.readdirSync(outDir)
    .filter((f) => f.startsWith('droptimizers-') && f.endsWith('.json'))
    .sort()
  return files.length ? path.join(outDir, files[files.length - 1]) : null
}

// ---------------------------------------------------------------- navegador

/*
 * Aqui hubo una limpieza automatica de navegadores colgados que enumeraba
 * procesos y los mataba con PowerShell. Se ha quitado a proposito: un programa
 * sin firmar que lanza PowerShell para matar procesos dispara la heuristica de
 * comportamiento de Windows Defender (Trojan:Win32/SuspExec.SE), y no compensa
 * para un caso que ya no deberia ocurrir: el navegador solo vive mientras dura
 * la accion y se cierra tambien ante Ctrl+C o el cierre de la ventana.
 * Si aun asi quedara alguno suelto, se avisa con instrucciones y lo cierra el
 * usuario. Ver README, apartado "Procesos del navegador".
 */

/**
 * Usa el Chrome/Edge ya instalado: no hace falta descargar Chromium.
 *
 * Chrome va primero a proposito. Windows 11 publica en Alt+Tab las pestañas de
 * Edge (ajuste "Alt+Tab: ventanas y las 20 pestañas mas recientes"), y las
 * pestañas de nuestra automatizacion headless aparecen ahi como entradas con la
 * miniatura en blanco que se van acumulando. Chrome no se integra con eso.
 */
export async function launchContext({ headless = true } = {}) {
  const channels = process.env.RB_BROWSER_CHANNEL
    ? [process.env.RB_BROWSER_CHANNEL]
    : ['chrome', 'msedge', 'chromium']
  const common = {
    headless,
    viewport: { width: 1500, height: 1000 },
    args: ['--disable-blink-features=AutomationControlled'],
  }
  const fallos = []
  const intentar = async () => {
    for (const channel of channels) {
      try {
        const context = await chromium.launchPersistentContext(PROFILE_DIR, { ...common, channel })
        if (channel === 'msedge') {
          log('  (usando Edge porque no encuentro Chrome: si te salen pestañas sueltas en Alt+Tab,')
          log('   ponlo en Configuracion → Sistema → Multitarea → Alt+Tab → "Solo ventanas abiertas")')
        }
        return context
      } catch (e) { fallos.push(`${channel}: ${e.message.split('\n')[0]}`) }
    }
    return null
  }

  /*
   * Si falla, lo mas comun no es que el perfil este roto sino que otra copia del
   * programa lo tenga abierto: Chrome no deja dos procesos con el mismo perfil y
   * el segundo muere al instante. Se espera y se reintenta antes de tocar nada.
   */
  let context = await intentar()
  for (let intento = 1; !context && intento <= 3; intento++) {
    await sleep(3000)
    fallos.length = 0
    context = await intentar()
    if (context) log('  (el navegador tardo en soltar el perfil; ya va)')
  }
  if (context) return context

  /*
   * Si el navegador muere nada mas abrir, casi siempre es que la carpeta del
   * perfil quedo tocada: pasa si se abren dos copias del programa a la vez o si
   * el proceso murio de mala manera. Se aparta y se empieza con uno limpio; la
   * sesion de Raidbots se recupera sola si hay credenciales guardadas.
   */
  const perfilRoto = fallos.some((f) => /has been closed|Target page|crashed|ProcessSingleton|profile directory|being used|SingletonLock/i.test(f))
  if (perfilRoto && fs.existsSync(PROFILE_DIR)) {
    const apartado = `${PROFILE_DIR}-roto-${Date.now()}`
    try {
      fs.renameSync(PROFILE_DIR, apartado)
      log('  el perfil del navegador estaba tocado: se empieza con uno limpio')
      log(`  (el anterior queda en ${path.basename(apartado)}, se puede borrar)`)
      context = await intentar()
      if (context) return context
    } catch { /* si ni se puede apartar, se cae al error de abajo */ }
  }

  const lastErr = { message: fallos.join(' | ') }
  if (process.env.RB_EXECUTABLE_PATH) {
    return chromium.launchPersistentContext(PROFILE_DIR, { ...common, executablePath: process.env.RB_EXECUTABLE_PATH })
  }
  // Un proceso anterior que se quedo vivo bloquea la carpeta del perfil.
  if (/ProcessSingleton|profile directory|being used|SingletonLock/i.test(lastErr?.message || '')) {
    throw new Error('La carpeta .browser-profile esta en uso: seguramente hay otra copia del\n'
      + 'programa abierta. Cierrala y vuelve a intentarlo. Si no la encuentras, borra\n'
      + 'la carpeta .browser-profile (se vuelve a crear sola; tendras que entrar otra vez).')
  }
  throw new Error(`No se pudo abrir ningun navegador (${channels.join(', ')}). Instala Edge o Chrome, o define RB_EXECUTABLE_PATH. Causa: ${lastErr?.message}`)
}

/** Quien esta logueado en el perfil de navegador guardado (y con que limites). */
export async function describeSession(context) {
  try {
    const res = await context.request.get(`${BASE}/api/me`, { timeout: 20000 })
    if (!res.ok()) return { anonymous: true, text: 'anonima (sin login) — cola gratuita' }
    const user = (await res.json())?.user
    if (!user || (!user.username && !user.email)) return { anonymous: true, text: 'anonima (sin login) — cola gratuita' }
    const who = user.username || user.email
    const tier = user.patreonTitle ? `premium: ${user.patreonTitle}` : 'sin premium'
    // concurrentSimLimit solo aparece cuando un admin de Raidbots impone un tope
    // a esa cuenta; no es el cupo normal, asi que solo se enseña si lo hay.
    const limit = user.concurrentSimLimit
    const tope = limit ? ` — tope de ${limit} sim(s) a la vez` : ''
    return { anonymous: false, user: who, concurrentSimLimit: limit, text: `${who} — ${tier}${tope}` }
  } catch {
    return { anonymous: true, text: 'no se pudo comprobar (¿sin internet?)' }
  }
}

/** Login por API. La cookie queda en el perfil, asi que solo hace falta una vez. */
export async function login(context, { email, password }) {
  const res = await context.request.post(`${BASE}/api/login`, {
    data: { email, password },
    headers: { 'Content-Type': 'application/json' },
    timeout: 30000,
  })
  if (res.ok()) return { ok: true, session: await describeSession(context) }
  const message = res.status() === 401
    ? 'email o contraseña incorrectos'
    : `Raidbots devolvio HTTP ${res.status()}`
  return { ok: false, message }
}

/** Cierra sesion en este PC: borra cookies del perfil y credenciales guardadas. */
export async function logout(context) {
  await context.clearCookies()
  forgetAccount()
}

/** Si la sesion guardada no vale, entra con las credenciales que haya. */
export async function ensureLogin(context, session) {
  if (!session.anonymous) return session
  const account = readAccount()
  if (!account) return session
  log(`  entrando con las credenciales guardadas (${account.from})...`)
  const result = await login(context, account)
  if (!result.ok) {
    log(`  no se pudo entrar: ${result.message} — se sigue en anonimo`)
    return session
  }
  log(`  Cuenta de Raidbots: ${result.session.text}`)
  return result.session
}

// ---------------------------------------------------------------- web de Raidbots

/**
 * Click sobre un elemento de la UI identificado por su texto exacto.
 * La cabecera es sticky y tapa parte de la pagina: si intercepta el click,
 * se dispara el evento directamente sobre el elemento.
 */
async function clickOption(page, text) {
  const target = page.getByText(text, { exact: true }).first()
  await target.waitFor({ state: 'visible', timeout: 30000 })
  await target.scrollIntoViewIfNeeded()
  await page.evaluate(() => window.scrollBy(0, -200))
  await page.waitForTimeout(300)
  try {
    await target.click({ timeout: 8000 })
  } catch {
    await target.evaluate((el) => el.click())
  }
  await page.waitForTimeout(1200)
}

async function setCheckbox(page, name, wanted) {
  const input = page.locator(`input[type=checkbox][name="${name}"]`).first()
  await input.waitFor({ state: 'attached', timeout: 30000 })
  const current = await input.evaluate((el) => el.checked)
  if (current !== wanted) {
    await page.locator(`label:has(input[type=checkbox][name="${name}"])`).first().click()
    await page.waitForTimeout(400)
  }
  const after = await input.evaluate((el) => el.checked)
  if (after !== wanted) throw new Error(`No se pudo poner la casilla "${name}" a ${wanted}`)
}

/*
 * Nota para el yo del futuro: NO descomentar la linea "# loot_spec=..." del
 * export del addon. Raidbots la rechaza ("Invalid commands (not valid Raidbots
 * options)") y deja de dejarte enviar el sim. Ademas no hace falta: el loot spec
 * sigue solo a la spec del personaje que se carga, comprobado cargando
 * assassination -> subtlety -> assassination sobre el mismo perfil.
 */

/** Carga el personaje pegando el SimC en el editor (CodeMirror). */
export async function loadCharacter(page, simc) {
  await page.goto(DROPTIMIZER_URL, { waitUntil: 'domcontentloaded', timeout: 90000 })
  const editor = page.locator('[data-testid="simc-editor"] .cm-content')
  if (!(await editor.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'SIMC ADDON' }).click()
  }
  await editor.waitFor({ state: 'visible', timeout: 30000 })
  // focus() en vez de click(): el editor puede quedar tapado por la cabecera sticky.
  await editor.evaluate((el) => el.focus())
  const focused = await page.evaluate(() => !!document.activeElement?.closest('.cm-content'))
  if (!focused) throw new Error('No se pudo enfocar el editor SimC')
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(simc)
  // Con el personaje cargado aparece la seccion de fuentes de loot.
  // Ojo: el DOM pone "Sources"; las mayusculas son solo CSS.
  await page.getByText(/^sources$/i).first().waitFor({ state: 'visible', timeout: 60000 })
  await page.waitForTimeout(1500)
}

/**
 * Version de SimulationCraft con la que corre el sim (panel "Simulation Options").
 * nightly (nuestro defecto) = build del dia, lo mas al dia; weekly = build semanal
 * estable, que es el defecto de Raidbots; latest = ultimo commit. Se fija siempre: el perfil de navegador recuerda la
 * eleccion anterior y no queremos que dependa de lo que se hizo la vez pasada.
 */
export async function setSimcVersion(page, version = 'nightly') {
  const select = page.locator('select[name="simcVersion"]')
  if (!(await select.count())) {
    // El panel viene plegado; hay que abrirlo para que exista el <select>.
    await page.getByText(/^Simulation Options/i).first().click()
    await select.waitFor({ state: 'attached', timeout: 15000 })
  }
  await select.selectOption(version)
  await page.waitForTimeout(300)
  const applied = await select.inputValue()
  if (applied !== version) throw new Error(`No se pudo poner SimC Version en "${version}" (quedo en "${applied}")`)
  return applied
}

/** Aplica fuente + dificultad/nivel + "Upgrade up to" + casillas. */
export async function applyProfile(page, profile) {
  await clickOption(page, profile.source)
  for (const step of profile.select || []) await clickOption(page, step)

  // El desplegable "Upgrade up to" es un react-select con un input oculto upgradeLevel.
  const container = page.locator('div:has(> input[type=hidden][name="upgradeLevel"])').last()
  await container.waitFor({ state: 'visible', timeout: 30000 })
  await container.scrollIntoViewIfNeeded()
  await page.evaluate(() => window.scrollBy(0, -200))
  const options = page.locator('[id*="-option-"]')
  try {
    await container.locator('[class*="-control"]').first().click({ timeout: 10000 })
    await options.first().waitFor({ state: 'visible', timeout: 5000 })
  } catch {
    // react-select tambien abre el menu con la flecha abajo sobre su input.
    await container.locator('[role="combobox"]').first().evaluate((el) => el.focus())
    await page.keyboard.press('ArrowDown')
    await options.first().waitFor({ state: 'visible', timeout: 10000 })
  }
  await page.waitForTimeout(500)
  const labels = await options.allInnerTexts()
  if (labels.length < 2) throw new Error('El desplegable "Upgrade up to" no ofrecio ninguna opcion de upgrade')

  let index
  if (profile.upgrade === 'max' || profile.upgrade == null) {
    index = 1 // 0 = "Base level, no upgrades"; 1 = el 6/6 del track activo
  } else {
    const wanted = String(profile.upgrade).replace(/\s+/g, ' ').trim()
    index = labels.findIndex((l) => l.replace(/\s+/g, ' ').trim().startsWith(wanted))
    if (index === -1) {
      throw new Error(`"${wanted}" no esta entre las opciones (${labels.map((l) => l.replace(/\s+/g, ' ')).join(' / ')})`)
    }
  }
  const chosen = labels[index].replace(/\s+/g, ' ').trim()
  await options.nth(index).click()
  await page.waitForTimeout(600)

  const level = await page.locator('input[type=hidden][name="upgradeLevel"]').first().inputValue()
  if (level === '0') throw new Error('El nivel de upgrade se quedo en "Base level, no upgrades"')

  await setCheckbox(page, 'upgradeEquipped', profile.upgradeEquipped !== false)
  await setCheckbox(page, 'smartHighPrecision', profile.highPrecision !== false)
  return { upgradeLabel: chosen, upgradeLevel: level }
}

/** Pulsa RUN DROPTIMIZER y captura el simId de la respuesta de /sim. */
async function submit(page) {
  const responsePromise = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/sim',
    { timeout: 120000 },
  )
  await page.getByRole('button', { name: 'RUN DROPTIMIZER' }).click()
  const response = await responsePromise
  const raw = await response.text()
  if (!response.ok()) throw new Error(`Raidbots rechazo el sim (HTTP ${response.status()}): ${raw.slice(0, 200)}`)
  let data
  try { data = JSON.parse(raw) } catch { throw new Error(`Respuesta inesperada de /sim: ${raw.slice(0, 200)}`) }
  const simId = data.simId || data.id
  if (!simId) throw new Error(`La respuesta de /sim no trae simId: ${raw.slice(0, 200)}`)
  return { simId, url: `${BASE}/simbot/report/${simId}` }
}

/** Raidbots limita los sims simultaneos por cuenta y lo dice con este mensaje. */
const TOO_MANY_SIMS = /too many sims/i

/**
 * Lanza el sim reintentando. Si el rechazo es por limite de sims simultaneos no
 * es un fallo: es cola. Se espera poco y muchas veces, sin llenar la pantalla.
 * Cualquier otro error se reintenta pocas veces y acaba propagandose.
 */
export async function submitWithRetry(page, { tag }) {
  let lastError
  let queuedNotice = false
  for (let i = 1; i <= 30; i++) {
    try {
      return await submit(page)
    } catch (e) {
      lastError = e
      // Si el navegador se ha muerto, reintentar no arregla nada: mejor decirlo.
      if (/has been closed|Target (page|closed)|crashed/i.test(e.message)) {
        throw new Error('el navegador se cerro a mitad del envio (¿otra copia del programa abierta?)')
      }
      const queued = TOO_MANY_SIMS.test(e.message)
      // Errores de verdad: 3 intentos. Cola: hasta 30 (unos 15 minutos).
      if (!queued && i >= 3) break
      if (queued) {
        if (!queuedNotice) { log(`${tag} en cola: la cuenta ya tiene otros sims corriendo, esperando hueco...`); queuedNotice = true }
        await sleep(30_000)
      } else {
        log(`${tag} rechazado (${e.message.slice(0, 120)}) — reintento ${i + 1}/3 en 60s`)
        await sleep(60_000)
      }
    }
  }
  throw lastError
}

/** Espera a que el job termine consultando /api/job/<simId>. */
export async function waitForJob(context, simId, { timeoutMin, tag }) {
  const deadline = Date.now() + timeoutMin * 60_000
  let last = null
  while (Date.now() < deadline) {
    const res = await context.request.get(`${BASE}/api/job/${encodeURIComponent(simId)}`, { timeout: 30000 })
    if (res.ok()) {
      const body = await res.json()
      const state = body?.job?.state || null
      const retries = body?.retriesRemaining ?? 0
      if (state !== last) { log(`${tag} · ${state}`); last = state }
      if (state === 'complete') return 'complete'
      if ((state === 'failed' || state === 'cancelled') && retries <= 0) return state
    }
    await sleep(5000)
  }
  return 'timeout'
}

// ---------------------------------------------------------------- ejecucion

/** Construye la lista de tareas: un personaje x un perfil = un sim. */
export function buildTasks(characters, profiles) {
  const tasks = []
  for (const { simc, character } of characters) {
    for (const profile of profiles) {
      tasks.push({
        simc,
        profile,
        tag: `[${character.name || '?'} · ${profile.key}]`,
        entry: {
          character: character.name,
          class: character.class,
          spec: character.spec,
          realm: character.realm,
          region: character.region,
          profileKey: profile.profileKey,
          profile: profile.key,
          label: profile.label,
          simId: null,
          url: null,
          state: null,
          upgradeLabel: null,
          simcVersion: null,
          submittedAt: null,
          finishedAt: null,
          error: null,
        },
      })
    }
  }
  return tasks
}

/** Lanza las tareas con N pestañas en paralelo. Devuelve las entradas de resultado. */
export async function runTasks(context, firstPage, tasks, { workers = 1, dryRun = false, noWait = false, timeoutMin = 25, simcVersion = 'nightly' } = {}) {
  const results = tasks.map((t) => t.entry)
  let next = 0

  const worker = async (id) => {
    const page = id === 0 ? firstPage : await context.newPage()
    while (true) {
      const i = next++
      if (i >= tasks.length) break
      const { simc, tag, entry, profile } = tasks[i]
      log(`${tag} ${profile.label}`)
      try {
        await loadCharacter(page, simc)
        const applied = await applyProfile(page, profile)
        entry.upgradeLabel = applied.upgradeLabel
        entry.simcVersion = await setSimcVersion(page, simcVersion)
        log(`${tag} config: ${profile.source} / ${(profile.select || []).join(' / ')} / upgrade ${applied.upgradeLabel} / SimC ${entry.simcVersion}`)

        if (dryRun) { entry.state = 'dry-run'; continue }

        const { simId, url } = await submitWithRetry(page, { tag })
        entry.simId = simId
        entry.url = url
        entry.submittedAt = stamp()
        entry.state = 'submitted'
        log(`${tag} ${url}`)

        if (!noWait) {
          entry.state = await waitForJob(context, simId, { timeoutMin, tag })
          entry.finishedAt = stamp()
          if (entry.state !== 'complete') log(`${tag} ¡atencion! estado final: ${entry.state}`)
        }
      } catch (e) {
        entry.state = entry.state || 'error'
        entry.error = e.message
        log(`${tag} ERROR: ${e.message}`)
      }
    }
    if (id !== 0) await page.close()
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.min(workers, tasks.length)) }, (_, i) => worker(i)))
  return results
}

/** Escribe out/<fecha>.json + out/urls.txt e imprime el resumen. */
export function writeResults(outDir, results, { noWait = false } = {}) {
  fs.mkdirSync(outDir, { recursive: true })
  const outJson = path.join(outDir, `droptimizers-${stamp().replace(/:/g, '')}.json`)
  fs.writeFileSync(outJson, JSON.stringify(results, null, 2))

  const ok = results.filter((r) => r.url && (r.state === 'complete' || noWait))
  const urlsTxt = path.join(outDir, 'urls.txt')
  fs.writeFileSync(urlsTxt, ok.map((r) => r.url).join('\n') + (ok.length ? '\n' : ''))

  log('\n================ RESULTADO ================')
  for (const r of results) {
    const mark = r.state === 'complete' ? 'OK ' : r.state === 'submitted' || r.state === 'dry-run' ? '...' : '!! '
    log(`${mark} ${r.character || '?'} · ${r.label}`)
    log(`    ${r.url || r.error || r.state}`)
  }
  log('\n--- URLs listas para copiar ---')
  for (const r of ok) log(r.url)
  log(`\nJSON: ${outJson}`)
  log(`URLs: ${urlsTxt}`)
  return { outJson, urlsTxt, ok }
}
