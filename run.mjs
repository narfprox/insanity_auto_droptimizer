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
  concurrency: flag('concurrency', '1'),
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
  if (!keys || !keys.length) return allProfiles
  const chosen = keys.map((k) => allProfiles.find((p) => p.key === k)).filter(Boolean)
  return chosen.length ? chosen : allProfiles
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

/** Lanza una tanda y escribe los resultados. */
async function launch(context, page, characters, profiles, session) {
  const tasks = buildTasks(characters, profiles)
  const workers = opts.concurrency === 'auto'
    ? Math.max(1, session.concurrentSimLimit || 1)
    : Math.max(1, Number(opts.concurrency) || 1)
  log(`\n${tasks.length} sim(s), ${Math.min(workers, tasks.length)} en paralelo`)
  log('Esto tarda unos minutos. Puedes minimizar la ventana.\n')

  const results = await runTasks(context, page, tasks, {
    workers,
    dryRun: opts.dryRun,
    noWait: opts.noWait,
    timeoutMin: opts.timeoutMin,
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
  const active = new Set((config.profiles && config.profiles.length ? config.profiles : allProfiles.map((p) => p.key)))
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

async function mainMenu(context, page, session) {
  while (true) {
    const profiles = selectedProfiles()
    log('\n==========================================')
    log('   INSANITY · DROPTIMIZERS DE RAIDBOTS')
    log('==========================================')
    log(`Cuenta:   ${session.text}`)
    log(`Perfiles: ${profiles.length} de ${allProfiles.length} (${profiles.map((p) => p.key).join(', ')})`)
    log('')
    log('  1) Pegar mi SimC y lanzar   (lo coge del portapapeles)')
    log('  2) Lanzar los SimC guardados en la carpeta simc/')
    log('  3) Elegir que perfiles lanzar')
    log('  4) Cuenta de Raidbots (entrar / cambiar / cerrar sesion)')
    log('  0) Salir')
    const opcion = await prompt('> ')

    if (opcion === '1') {
      const entry = await simcFromClipboard()
      if (entry) await launch(context, page, [entry], profiles, session)
    } else if (opcion === '2') {
      const files = simcFilesFromDisk()
      if (!files.length) { log('\nNo hay ficheros .simc en la carpeta simc/.'); continue }
      log(`\n${files.length} fichero(s): ${files.map((f) => path.basename(f)).join(', ')}`)
      await launch(context, page, readCharacters(files), profiles, session)
    } else if (opcion === '3') {
      await profilesMenu()
    } else if (opcion === '4') {
      session = await accountMenu(context, session)
    } else if (opcion === '0' || opcion === '') {
      return
    }
  }
}

// ---------------------------------------------------------------- main

async function main() {
  fs.mkdirSync(opts.out, { recursive: true })
  const context = await launchContext({ headless: !opts.headed })
  context.setDefaultTimeout(60000)
  const page = context.pages()[0] || (await context.newPage())

  try {
    // --login: entrar a mano en el navegador (por si falla el login por API).
    if (opts.login) {
      await page.goto(`${BASE}/simbot/droptimizer`, { waitUntil: 'domcontentloaded' })
      log('\nInicia sesion en la ventana del navegador (boton LOGIN, arriba a la izquierda).')
      await prompt('Cuando hayas entrado, pulsa Enter aqui para guardar la sesion... ')
      log(`Sesion guardada: ${(await describeSession(context)).text}`)
      return 0
    }

    let session = await describeSession(context)
    session = await ensureLogin(context, session)

    if (opts.menu) {
      // Primera vez sin credenciales: se piden antes de nada.
      if (session.anonymous && !readAccount()) {
        log('\nPrimera vez por aqui. Entra con la cuenta de Raidbots de la guild.')
        log('(Enter en blanco para seguir en anonimo: funciona, pero la cola es mas lenta.)')
        const nueva = await loginWizard(context)
        if (nueva) session = nueva
      }
      await mainMenu(context, page, session)
      return 0
    }

    log(`\nCuenta de Raidbots: ${session.text}`)
    if (session.anonymous) log('  (para entrar con tu cuenta, ejecuta el programa sin argumentos y usa el menu)')

    const files = simcFilesFromDisk()
    if (!files.length) {
      log('\nNo hay ficheros .simc. Pega el string del addon SimC en simc/<nombre>.simc')
      return 1
    }
    const results = await launch(context, page, readCharacters(files), selectedProfiles(), session)
    const failed = results.filter((r) => r.state !== 'complete' && r.state !== 'dry-run' && !(opts.noWait && r.url))
    return failed.length ? 1 : 0
  } finally {
    await context.close()
  }
}

// Sin top-level await: asi se puede empaquetar como ejecutable (Node SEA usa CommonJS).
main()
  .catch((e) => {
    console.error(`\nERROR: ${e.message}`)
    return 1
  })
  .then(async (code) => {
    // En el menu el usuario ya ha elegido salir; solo se pausa si algo fallo.
    if (opts.pause && (!opts.menu || code !== 0)) await prompt('\nPulsa Enter para cerrar... ')
    process.exit(code)
  })
