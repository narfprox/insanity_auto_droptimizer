#!/usr/bin/env node
/**
 * Lanza en Raidbots los droptimizers de un personaje a partir de su string SimC
 * y devuelve las URLs de los reports ya terminados, listas para copiar.
 *
 * Sin argumentos abre un menu; con argumentos va directo:
 *   node run.mjs --simc simc/narf.simc
 *   node run.mjs --profiles raid-heroic,raid-mythic
 *   node run.mjs --login
 *
 * Ver README.md para el resto de flags.
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  HERE, IS_PACKAGED, SIMC_DIR, BASE,
  log, prompt, promptHidden, parseSimc, simcFileName, readClipboard, looksLikeSimc,
  loadConfig, saveConfig, loadProfiles,
  readAccount, saveAccount, launchContext, describeSession, login, logout, ensureLogin,
  readWowutils, saveWowutils, forgetWowutils, checkWowutils, importDroptimizers,
  importableFrom, latestResultsFile,
  buildTasks, runTasks, writeResults,
} from './lib.mjs'

// ---------------------------------------------------------------- args

const args = process.argv.slice(2)
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`)
  if (i === -1) return fallback
  const next = args[i + 1]
  return next && !next.startsWith('--') ? next : true
}
const has = (name) => args.includes(`--${name}`)

const opts = {
  simc: flag('simc'),
  profiles: flag('profiles'),
  out: flag('out', path.join(HERE, 'out')),
  headed: has('headed') || has('login'),
  login: has('login'),
  dryRun: has('dry-run'),
  noWait: has('no-wait'),
  concurrency: flag('concurrency'),
  import: has('import'),
  simcVersion: flag('simc-version'),
  ui: has('ui'),
  timeoutMin: Number(flag('timeout-min', 25)),
  help: has('help') || has('h'),
  // Al abrirlo con doble clic no hay argumentos: se abre el menu.
  menu: has('menu') || args.length === 0,
  pause: has('pause') || (IS_PACKAGED && !has('no-pause')),
}

if (opts.help) {
  const readme = path.join(HERE, 'README.md')
  console.log(fs.existsSync(readme) ? fs.readFileSync(readme, 'utf8') : 'Ver README.md')
  process.exit(0)
}

const allProfiles = loadProfiles()

// ---------------------------------------------------------------- comunes

/** Perfiles activos: los elegidos por CLI, los guardados en config o todos. */
function selectedProfiles() {
  const keys = typeof opts.profiles === 'string'
    ? opts.profiles.split(',').map((s) => s.trim())
    : loadConfig().profiles
  const porDefecto = allProfiles.filter((p) => p.default !== false)
  if (!keys || !keys.length) return porDefecto
  const chosen = keys.map((k) => allProfiles.find((p) => p.key === k)).filter(Boolean)
  return chosen.length ? chosen : porDefecto
}

function simcFilesFromDisk() {
  if (typeof opts.simc === 'string') return [path.resolve(opts.simc)]
  return fs.existsSync(SIMC_DIR)
    ? fs.readdirSync(SIMC_DIR).filter((f) => f.endsWith('.simc')).map((f) => path.join(SIMC_DIR, f))
    : []
}

function readCharacters(files) {
  return files.map((file) => {
    const simc = fs.readFileSync(file, 'utf8')
    return { simc, file, character: parseSimc(simc) }
  })
}

/**
 * Cuantas pestañas trabajan a la vez. Por defecto "auto": todas las tareas de
 * golpe, con tope 5. Si solo hay 2 perfiles seleccionados, van esos 2 en
 * paralelo. Si la cuenta no da para tanto, Raidbots va rechazando y cada
 * pestaña espera su hueco: el limite real lo marca Raidbots, no una config.
 */
const MAX_WORKERS = 5

function resolveWorkers(taskCount) {
  const raw = typeof opts.concurrency === 'string' && opts.concurrency !== 'true'
    ? opts.concurrency
    : loadConfig().concurrency || 'auto'
  const workers = raw === 'auto' ? MAX_WORKERS : Math.max(1, Number(raw) || 1)
  return Math.max(1, Math.min(workers, taskCount))
}

/** nightly por defecto; weekly es el defecto de Raidbots, latest el ultimo commit. */
function resolveSimcVersion() {
  const raw = typeof opts.simcVersion === 'string' ? opts.simcVersion : loadConfig().simcVersion
  return ['weekly', 'nightly', 'latest'].includes(raw) ? raw : 'nightly'
}

/** Lanza una tanda y escribe los resultados. */
async function launch(context, page, characters, profiles) {
  const tasks = buildTasks(characters, profiles)
  const workers = resolveWorkers(tasks.length)
  log(`\n${tasks.length} sim(s), ${workers === 1 ? 'de uno en uno' : `${workers} en paralelo`}`)
  log('Esto tarda unos minutos. Puedes minimizar la ventana.\n')

  const results = await runTasks(context, page, tasks, {
    workers,
    dryRun: opts.dryRun,
    noWait: opts.noWait,
    timeoutMin: opts.timeoutMin,
    simcVersion: resolveSimcVersion(),
  })
  writeResults(opts.out, results, { noWait: opts.noWait })
  return results
}

// ---------------------------------------------------------------- cuenta

/** Pide email + contraseña y entra. Devuelve la sesion resultante. */
async function loginWizard(context) {
  log('\n--- Cuenta de Raidbots ---')
  log('Se guarda en este PC para no volver a pedirtela.\n')
  for (let intento = 1; intento <= 3; intento++) {
    const email = await prompt('EMAIL: ')
    if (!email) return null
    const password = await promptHidden('PASS:  ')
    if (!password) return null

    log('\nEntrando...')
    const result = await login(context, { email, password })
    if (result.ok) {
      const guardar = (await prompt('¿Guardar la contraseña para renovar la sesion sola? [S/n]: ')).toLowerCase()
      if (guardar !== 'n') {
        saveAccount({ email, password })
        log('Credenciales guardadas en raidbots-account.json (al lado del programa).')
      }
      log(`Listo: ${result.session.text}`)
      return result.session
    }
    log(`No se pudo entrar: ${result.message}`)
  }
  return null
}

async function accountMenu(context, session) {
  while (true) {
    log('\n--- Cuenta ---')
    log(`Ahora mismo: ${session.text}`)
    log('  1) Entrar / cambiar de cuenta')
    log('  2) Cerrar sesion en este PC (borra cookies y credenciales)')
    log('  0) Volver')
    const opcion = await prompt('> ')
    if (opcion === '1') {
      const nueva = await loginWizard(context)
      if (nueva) session = nueva
    } else if (opcion === '2') {
      await logout(context)
      session = await describeSession(context)
      log('Sesion cerrada.')
    } else return session
  }
}

// ---------------------------------------------------------------- menu

/** Coge el SimC del portapapeles, lo valida y lo guarda en simc/. */
async function simcFromClipboard() {
  log('\nEn el juego escribe  /simc  y copia el texto (Ctrl+C).')
  await prompt('Cuando lo tengas copiado, pulsa Enter... ')

  const text = readClipboard()
  if (!looksLikeSimc(text)) {
    log('El portapapeles no parece un export del addon SimC (falta la linea de clase/nombre).')
    return null
  }
  const character = parseSimc(text)
  log(`\nDetectado: ${character.name} · ${character.spec} · ${character.realm} (${character.class})`)
  const ok = (await prompt('¿Es correcto? [S/n]: ')).toLowerCase()
  if (ok === 'n') return null

  fs.mkdirSync(SIMC_DIR, { recursive: true })
  const file = path.join(SIMC_DIR, simcFileName(character))
  fs.writeFileSync(file, text)
  log(`Guardado en simc/${path.basename(file)}`)
  return { simc: text, file, character }
}

async function profilesMenu() {
  const config = loadConfig()
  const active = new Set(config.profiles?.length
    ? config.profiles
    : allProfiles.filter((p) => p.default !== false).map((p) => p.key))
  while (true) {
    log('\n--- Perfiles a lanzar ---')
    allProfiles.forEach((p, i) => log(`  ${i + 1}) [${active.has(p.key) ? 'x' : ' '}] ${p.label}`))
    log('  0) Guardar y volver')
    const opcion = await prompt('Numero para activar/desactivar > ')
    if (opcion === '0' || opcion === '') {
      saveConfig({ ...config, profiles: [...active] })
      log(`Guardado: ${active.size} perfil(es) activos.`)
      return
    }
    const p = allProfiles[Number(opcion) - 1]
    if (p) active.has(p.key) ? active.delete(p.key) : active.add(p.key)
  }
}

// ---------------------------------------------------------------- WoWUtils

/** Pide key + grupo si no estan guardados, y comprueba que funcionan. */
async function wowutilsWizard() {
  log('\n--- WoWUtils ---')
  log('Subir a WoWUtils es opcional: sirve para cualquier grupo, no solo el de la guild.')
  log('Hacen falta dos cosas, que te da un admin del grupo:')
  log('  · la API key  (Group settings → API sharing)')
  log('  · el id del grupo, que sale en la URL:')
  log('    wowutils.com/viserio-cooldowns/groups/<ID>')
  log('Se guardan solo en este PC. Enter en blanco para cancelar.\n')

  const apiKey = await promptHidden('API KEY: ')
  if (!apiKey) return null
  const groupId = await prompt('GROUP ID: ')
  if (!groupId) return null

  log('\nComprobando...')
  const check = await checkWowutils({ apiKey, groupId })
  if (!check.ok) {
    log(`No vale: ${check.message}`)
    return null
  }
  saveWowutils({ apiKey, groupId })
  log(`Conectado al grupo "${check.name}" (quedan ${check.remaining ?? '?'} pts). Guardado.`)
  return { apiKey, groupId }
}

/** Sube a WoWUtils los droptimizers terminados que se le pasen. */
async function uploadToWowutils(items) {
  if (!items.length) {
    log('\nNo hay droptimizers terminados que subir.')
    return
  }
  let creds = readWowutils()
  if (!creds) {
    log('\nWoWUtils no esta configurado todavia.')
    creds = await wowutilsWizard()
    if (!creds) return
  }
  log(`\nSubiendo ${items.length} droptimizer(s) al grupo — ${items.length * 5} pts del presupuesto:`)
  const { done, failed } = await importDroptimizers(items, { ...creds, dryRun: opts.dryRun })
  log(`\nSubidos: ${done.length}${failed.length ? ` · fallidos: ${failed.length}` : ''}`)
  if (failed.length) log('Los fallidos se pueden reintentar con la opcion 5 del menu.')
}

/**
 * Pregunta si subir lo que se acaba de simular. Subir a WoWUtils es opcional:
 * a quien no tenga configurada la key no se le pregunta cada vez, solo se le
 * recuerda que existe la opcion.
 */
async function offerUpload(results) {
  const items = importableFrom(results)
  if (!items.length || opts.noWait) return
  if (!readWowutils()) {
    log('\n(Si tienes la API key de un grupo de WoWUtils, la opcion 5 del menu sube estas URLs solo.)')
    return
  }
  const respuesta = (await prompt(`\n¿Subir estos ${items.length} droptimizer(s) a WoWUtils? [S/n]: `)).toLowerCase()
  if (respuesta === 'n') return
  await uploadToWowutils(items)
}

async function wowutilsMenu() {
  const creds = readWowutils()
  const file = latestResultsFile(opts.out)
  log('\n--- WoWUtils ---')
  log(`Configuracion: ${creds ? `grupo ${creds.groupId} (${creds.from})` : 'sin configurar'}`)
  log(`Ultimos resultados: ${file ? path.basename(file) : 'ninguno'}`)
  log('  1) Subir los ultimos droptimizers')
  log('  2) Configurar / cambiar la API key y el grupo')
  log('  3) Borrar la configuracion de este PC')
  log('  0) Volver')
  const opcion = await prompt('> ')

  if (opcion === '1') {
    if (!file) { log('\nNo hay resultados todavia: lanza antes una tanda.'); return }
    await uploadToWowutils(importableFrom(JSON.parse(fs.readFileSync(file, 'utf8'))))
  } else if (opcion === '2') {
    await wowutilsWizard()
  } else if (opcion === '3') {
    forgetWowutils()
    log('Configuracion de WoWUtils borrada.')
  }
}

// ---------------------------------------------------------------- menu

async function concurrencyMenu() {
  const config = loadConfig()
  log('\n--- Sims a la vez ---')
  log('Raidbots limita cuantos sims puede tener corriendo una cuenta a la vez.')
  log('Si te pasas, las pestañas de sobra esperan su turno solas (no fallan).')
  log('  1) Todos a la vez (hasta 5) — por defecto')
  log('  2) De uno en uno            (lo mas prudente)')
  log('  3) 2 a la vez')
  log('  4) 3 a la vez')
  log('  0) Volver sin cambiar')
  const opcion = await prompt('> ')
  const valores = { 1: 'auto', 2: '1', 3: '2', 4: '3' }
  const elegido = valores[opcion]
  if (!elegido) return
  saveConfig({ ...config, concurrency: elegido })
  log(`Guardado: ${elegido === 'auto' ? 'todos a la vez (hasta 5)' : `${elegido} a la vez`}.`)
}

async function simcVersionMenu() {
  const config = loadConfig()
  log('\n--- Version de SimulationCraft ---')
  log('  1) Nightly  build del dia, lo mas al dia — por defecto')
  log('  2) Weekly   build semanal estable (el defecto de Raidbots)')
  log('  3) Latest   ultimo commit')
  log('  0) Volver sin cambiar')
  const opcion = await prompt('> ')
  const valores = { 1: 'nightly', 2: 'weekly', 3: 'latest' }
  const elegido = valores[opcion]
  if (!elegido) return
  saveConfig({ ...config, simcVersion: elegido })
  log(`Guardado: SimC ${elegido}.`)
}

async function optionsMenu() {
  while (true) {
    const config = loadConfig()
    log('\n--- Opciones ---')
    log(`Sims a la vez:    ${(config.concurrency || 'auto') === 'auto' ? 'todos a la vez (hasta 5)' : config.concurrency}`)
    log(`Version de SimC:  ${config.simcVersion || 'nightly'}`)
    log('  1) Cambiar cuantos sims a la vez')
    log('  2) Cambiar la version de SimC')
    log('  0) Volver')
    const opcion = await prompt('> ')
    if (opcion === '1') await concurrencyMenu()
    else if (opcion === '2') await simcVersionMenu()
    else return
  }
}

async function mainMenu(session) {
  while (true) {
    const profiles = selectedProfiles()
    log('\n==========================================')
    log('   INSANITY · DROPTIMIZERS DE RAIDBOTS')
    log('==========================================')
    const workers = resolveWorkers(profiles.length)
    log(`Cuenta:   ${session.text}`)
    log(`Perfiles: ${profiles.length} de ${allProfiles.length} (${profiles.map((p) => p.key).join(', ')})`)
    log(`En paralelo: ${workers === 1 ? 'de uno en uno' : `${workers} a la vez`} · SimC ${resolveSimcVersion()}`)
    log('')
    log('  1) Pegar mi SimC y lanzar   (lo coge del portapapeles)')
    log('  2) Lanzar los SimC guardados en la carpeta simc/')
    log('  3) Elegir que perfiles lanzar')
    log('  4) Opciones (sims en paralelo, version de SimC)')
    log('  5) Subir a WoWUtils')
    log('  7) Abrir la interfaz con botones')
    log('  6) Cuenta de Raidbots (entrar / cambiar / cerrar sesion)')
    log('  0) Salir')
    const opcion = await prompt('> ')

    // El navegador solo se abre para la accion concreta y se cierra al volver
    // al menu: asi no queda ningun proceso suelto mientras se piensa que hacer.
    if (opcion === '1') {
      const entry = await simcFromClipboard()
      if (entry) await withBrowser(async ({ context, page }) => offerUpload(await launch(context, page, [entry], profiles)))
    } else if (opcion === '2') {
      const files = simcFilesFromDisk()
      if (!files.length) { log('\nNo hay ficheros .simc en la carpeta simc/.'); continue }
      log(`\n${files.length} fichero(s): ${files.map((f) => path.basename(f)).join(', ')}`)
      const characters = readCharacters(files)
      await withBrowser(async ({ context, page }) => offerUpload(await launch(context, page, characters, profiles)))
    } else if (opcion === '3') {
      await profilesMenu()
    } else if (opcion === '4') {
      await optionsMenu()
    } else if (opcion === '5') {
      await wowutilsMenu()
    } else if (opcion === '7') {
      const { arrancarUI } = await import('./ui.mjs')
      log('\nAbriendo la ventana... (el programa se cierra al cerrarla)')
      await arrancarUI({})
      return
    } else if (opcion === '6') {
      session = await withBrowser(({ context }) => accountMenu(context, session))
    } else if (opcion === '0' || opcion === '') {
      return
    }
  }
}

// ---------------------------------------------------------------- navegador

/*
 * El navegador se abre solo cuando hace falta y se cierra en cuanto termina la
 * accion. Mientras el menu esta en pantalla no hay ningun proceso de Edge vivo,
 * asi que no se queda nada colgado ni bloqueando la carpeta .browser-profile.
 */
let open = null

async function withBrowser(fn) {
  if (!open) {
    const context = await launchContext({ headless: !opts.headed })
    context.setDefaultTimeout(60000)
    open = { context, page: context.pages()[0] || (await context.newPage()) }
  }
  try {
    return await fn(open)
  } finally {
    await closeBrowser()
  }
}

async function closeBrowser() {
  if (!open) return
  const { context } = open
  open = null
  await context.close().catch(() => { /* si ya estaba cerrado, da igual */ })
}

// Ctrl+C o cerrar la ventana matan el proceso sin pasar por los finally: sin
// esto, Edge se queda vivo agarrando la carpeta del perfil.
let cerrando = false
for (const senal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  process.on(senal, () => {
    if (cerrando) return
    cerrando = true
    log('\nCerrando el navegador...')
    closeBrowser().finally(() => process.exit(130))
  })
}

// ---------------------------------------------------------------- main

async function main() {
  fs.mkdirSync(opts.out, { recursive: true })

  // Interfaz grafica: ventana propia con botones, sin consola de por medio.
  if (opts.ui) {
    const { arrancarUI } = await import('./ui.mjs')
    await arrancarUI({})
    return 0
  }

  // --login: entrar a mano en el navegador (por si falla el login por API).
  if (opts.login) {
    return withBrowser(async ({ context, page }) => {
      await page.goto(`${BASE}/simbot/droptimizer`, { waitUntil: 'domcontentloaded' })
      log('\nInicia sesion en la ventana del navegador (boton LOGIN, arriba a la izquierda).')
      await prompt('Cuando hayas entrado, pulsa Enter aqui para guardar la sesion... ')
      log(`Sesion guardada: ${(await describeSession(context)).text}`)
      return 0
    })
  }

  if (opts.menu) {
    let session = await withBrowser(async ({ context }) => {
      const actual = await ensureLogin(context, await describeSession(context))
      // Primera vez sin credenciales: se piden antes de nada.
      if (actual.anonymous && !readAccount()) {
        log('\nPrimera vez por aqui. Entra con tu cuenta de Raidbots.')
        log('(Enter en blanco para seguir en anonimo: funciona, pero la cola es mas lenta.)')
        return (await loginWizard(context)) || actual
      }
      return actual
    })
    await mainMenu(session)
    return 0
  }

  const files = simcFilesFromDisk()
  if (!files.length) {
    log('\nNo hay ficheros .simc. Pega el string del addon SimC en simc/<nombre>.simc')
    return 1
  }
  const characters = readCharacters(files)

  const results = await withBrowser(async ({ context, page }) => {
    const session = await ensureLogin(context, await describeSession(context))
    log(`\nCuenta de Raidbots: ${session.text}`)
    if (session.anonymous) log('  (para entrar con tu cuenta, ejecuta el programa sin argumentos y usa el menu)')
    return launch(context, page, characters, selectedProfiles())
  })

  if (opts.import) {
    if (!readWowutils()) log('\n--import: falta la configuracion de WoWUtils (variables de entorno o wowutils-account.json).')
    else await uploadToWowutils(importableFrom(results))
  }
  const failed = results.filter((r) => r.state !== 'complete' && r.state !== 'dry-run' && !(opts.noWait && r.url))
  return failed.length ? 1 : 0
}

// Sin top-level await: asi se puede empaquetar como ejecutable (Node SEA usa CommonJS).
main()
  .catch((e) => {
    console.error(`\nERROR: ${e.message}`)
    return 1
  })
  .then(async (code) => {
    await closeBrowser()
    // En el menu el usuario ya ha elegido salir; solo se pausa si algo fallo.
    if (opts.pause && (!opts.menu || code !== 0)) await prompt('\nPulsa Enter para cerrar... ')
    process.exit(code)
  })
