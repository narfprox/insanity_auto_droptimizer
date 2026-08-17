/**
 * Interfaz grafica: un servidor local + una ventana de aplicacion.
 *
 * No es una web: el servidor solo escucha en 127.0.0.1 y la ventana se abre con
 * el modo --app de Chrome, sin barra de direcciones ni pestañas, con su propio
 * icono en la barra de tareas. Se usa el navegador que ya esta instalado en vez
 * de arrastrar un motor grafico propio (Electron son +150 MB).
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import {
  HERE, SIMC_DIR, log, setLogger, parseSimc, simcFileName, looksLikeSimc,
  loadConfig, saveConfig, loadProfiles,
  launchContext, describeSession, login, logout, ensureLogin, readAccount,
  readWowutils, saveWowutils, checkWowutils, importDroptimizers, importableFrom,
  latestResultsFile, buildTasks, runTasks, writeResults,
} from './lib.mjs'
import { PAGINA } from './ui-page.mjs'

const MAX_WORKERS = 5

// ---------------------------------------------------------------- estado

const clientes = new Set()   // conexiones SSE abiertas
let corriendo = false

// Al abrir la ventana se recupera la ultima tanda de disco: asi los enlaces
// siguen ahi despues de cerrar el programa, y se pueden subir a WoWUtils.
let ultimosResultados = (() => {
  try {
    const fichero = latestResultsFile(path.join(HERE, 'out'))
    return fichero ? JSON.parse(fs.readFileSync(fichero, 'utf8')) : []
  } catch { return [] }
})()

const emitir = (tipo, datos) => {
  const mensaje = `data: ${JSON.stringify({ tipo, ...datos })}\n\n`
  for (const c of clientes) c.write(mensaje)
}

// ---------------------------------------------------------------- acciones

async function conNavegador(fn) {
  const context = await launchContext({ headless: true })
  context.setDefaultTimeout(60000)
  const page = context.pages()[0] || (await context.newPage())
  try {
    return await fn({ context, page })
  } finally {
    await context.close().catch(() => {})
  }
}

async function estado() {
  const config = loadConfig()
  const perfiles = loadProfiles()
  // Sin nada guardado manda el perfil: los que traen "default": false salen sin marcar.
  const activos = config.profiles?.length
    ? config.profiles
    : perfiles.filter((p) => p.default !== false).map((p) => p.key)
  const sesion = await conNavegador(async ({ context }) => ensureLogin(context, await describeSession(context)))
  return {
    sesion: { texto: sesion.text, anonima: sesion.anonymous },
    perfiles: perfiles.map((p) => ({ ...p, activo: activos.includes(p.key) })),
    config: {
      concurrency: config.concurrency || 'auto',
      simcVersion: config.simcVersion || 'nightly',
    },
    wowutils: !!readWowutils(),
    resultados: ultimosResultados,
    simcGuardados: fs.existsSync(SIMC_DIR)
      ? fs.readdirSync(SIMC_DIR).filter((f) => f.endsWith('.simc'))
      : [],
  }
}

async function lanzar({ simc, perfiles }) {
  if (corriendo) throw new Error('Ya hay una tanda en marcha')
  if (!looksLikeSimc(simc)) throw new Error('Eso no parece un export del addon SimC')

  const character = parseSimc(simc)
  fs.mkdirSync(SIMC_DIR, { recursive: true })
  fs.writeFileSync(path.join(SIMC_DIR, simcFileName(character)), simc)

  const todos = loadProfiles()
  const elegidos = todos.filter((p) => perfiles.includes(p.key))
  if (!elegidos.length) throw new Error('No has elegido ningun perfil')

  const config = loadConfig()
  const bruto = config.concurrency || 'auto'
  const workers = bruto === 'auto' ? MAX_WORKERS : Math.max(1, Number(bruto) || 1)

  corriendo = true
  emitir('estado', { corriendo: true, personaje: `${character.name} · ${character.spec}` })

  // El progreso de la libreria se manda al panel de la ventana.
  setLogger((...m) => {
    const texto = m.join(' ')
    console.log(texto)
    emitir('log', { texto })
  })

  try {
    const resultados = await conNavegador(async ({ context, page }) => {
      const tareas = buildTasks([{ simc, character }], elegidos)
      return runTasks(context, page, tareas, {
        workers: Math.min(workers, tareas.length),
        timeoutMin: 25,
        simcVersion: config.simcVersion || 'nightly',
      })
    })
    ultimosResultados = resultados
    writeResults(path.join(HERE, 'out'), resultados)
    emitir('resultados', { resultados })
    return resultados
  } finally {
    corriendo = false
    setLogger(null)
    emitir('estado', { corriendo: false })
  }
}

// ---------------------------------------------------------------- servidor

const rutas = {
  'GET /api/estado': () => estado(),

  'POST /api/lanzar': async (body) => {
    lanzar(body).catch((e) => emitir('error', { mensaje: e.message }))
    return { ok: true }
  },

  'POST /api/perfiles': (body) => {
    saveConfig({ ...loadConfig(), profiles: body.perfiles })
    return { ok: true }
  },

  'POST /api/opciones': (body) => {
    const config = loadConfig()
    if (body.concurrency) config.concurrency = body.concurrency
    if (body.simcVersion) config.simcVersion = body.simcVersion
    saveConfig(config)
    return { ok: true }
  },

  'POST /api/login': async (body) => {
    const resultado = await conNavegador(({ context }) => login(context, body))
    if (!resultado.ok) throw new Error(resultado.message)
    if (body.guardar) {
      const { saveAccount } = await import('./lib.mjs')
      saveAccount({ email: body.email, password: body.password })
    }
    return { texto: resultado.session.text }
  },

  'POST /api/logout': async () => {
    await conNavegador(({ context }) => logout(context))
    return { ok: true }
  },

  'POST /api/wowutils': async (body) => {
    const comprobacion = await checkWowutils(body)
    if (!comprobacion.ok) throw new Error(comprobacion.message)
    saveWowutils(body)
    return { grupo: comprobacion.name, puntos: comprobacion.remaining }
  },

  'POST /api/subir': async () => {
    const credenciales = readWowutils()
    if (!credenciales) throw new Error('Falta configurar la API key de WoWUtils')
    const items = importableFrom(ultimosResultados)
    if (!items.length) throw new Error('No hay droptimizers terminados que subir')
    setLogger((...m) => emitir('log', { texto: m.join(' ') }))
    try {
      const { done, failed } = await importDroptimizers(items, credenciales)
      return { subidos: done.length, fallidos: failed.length }
    } finally { setLogger(null) }
  },
}

function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    let datos = ''
    req.on('data', (c) => { datos += c; if (datos.length > 2e6) req.destroy() })
    req.on('end', () => { try { resolve(datos ? JSON.parse(datos) : {}) } catch (e) { reject(e) } })
  })
}

export async function arrancarUI({ puerto = 0, abrir = true } = {}) {
  const servidor = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')

    // El icono de la ventana y de la barra de tareas: el pulpo de la guild.
    if (url.pathname === '/icono.png') {
      const icono = [path.join(HERE, 'assets', 'pulpo.png'), path.join(HERE, 'pulpo.png')]
        .find((f) => fs.existsSync(f))
      if (!icono) return res.writeHead(404).end()
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=86400' })
      return res.end(fs.readFileSync(icono))
    }

    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      return res.end(PAGINA)
    }

    if (url.pathname === '/api/eventos') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      res.write(': conectado\n\n')
      clientes.add(res)
      req.on('close', () => clientes.delete(res))
      return
    }

    const clave = `${req.method} ${url.pathname}`
    const manejador = rutas[clave]
    if (!manejador) {
      res.writeHead(404).end('no existe')
      return
    }
    try {
      const cuerpo = req.method === 'POST' ? await leerCuerpo(req) : {}
      const datos = await manejador(cuerpo)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(datos ?? {}))
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message }))
    }
  })

  await new Promise((r) => servidor.listen(puerto, '127.0.0.1', r))
  const direccion = `http://127.0.0.1:${servidor.address().port}`
  log(`Interfaz en ${direccion}`)

  if (!abrir) return { direccion, servidor }

  const ventana = abrirVentana(direccion)
  if (!ventana) {
    log('No encuentro Chrome ni Edge para abrir la ventana.')
    log(`Abre esta direccion a mano en tu navegador: ${direccion}`)
    return { direccion, servidor }
  }
  // Cuando el usuario cierra la ventana, se acaba el programa.
  await new Promise((resolve) => ventana.on('exit', resolve))
  servidor.close()
  return { direccion, servidor }
}

/** Abre la ventana de aplicacion con el navegador instalado (sin pestañas ni barra). */
function abrirVentana(direccion) {
  const candidatos = [
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env['PROGRAMFILES(X86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${process.env.PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`,
  ]
  const exe = candidatos.find((f) => f && fs.existsSync(f))
  if (!exe) return null

  return spawn(exe, [
    `--app=${direccion}`,
    `--user-data-dir=${path.join(HERE, '.ui-profile')}`, // perfil aparte: no toca tu navegador
    '--window-size=1180,860',
    '--no-first-run',
    '--no-default-browser-check',
  ], { detached: false, stdio: 'ignore' })
}
