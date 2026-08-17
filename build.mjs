#!/usr/bin/env node
/**
 * Empaqueta run.mjs en un unico Droptimizer.exe (Node SEA) que no necesita
 * ni Node ni npm en el PC de destino: usa el Edge/Chrome ya instalado.
 *
 *   npm run build
 *
 * Deja en dist/:
 *   Droptimizer.exe   <- el programa
 *   LEEME.txt
 *   datos/            <- todo lo demas: media, perfiles, y lo que se genere al usarlo
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import esbuild from 'esbuild'
import pngToIco from 'png-to-ico'
import { inject } from 'postject'
import { rcedit } from 'rcedit'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BUILD = path.join(HERE, '.build')
const DIST = path.join(HERE, 'dist')
const EXE = path.join(DIST, 'Droptimizer.exe')
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' })

fs.rmSync(BUILD, { recursive: true, force: true })
fs.rmSync(EXE, { force: true })
fs.mkdirSync(BUILD, { recursive: true })
const DATOS = path.join(DIST, 'datos')
const MEDIA = path.join(DATOS, 'media')
fs.mkdirSync(MEDIA, { recursive: true })

// 1. Un solo fichero CommonJS con run.mjs + playwright-core dentro.
console.log('1/4  bundling...')

// playwright-core referencia chromium-bidi (protocolo BiDi de Firefox). No viene
// instalado y nosotros lanzamos Chromium por CDP, asi que se sustituye por un modulo vacio.
const stub = path.join(BUILD, 'stub.cjs')
fs.writeFileSync(stub, 'module.exports = new Proxy({}, { get: () => undefined })\n')
const stubBidi = {
  name: 'stub-chromium-bidi',
  setup(build) {
    build.onResolve({ filter: /^chromium-bidi(\/|$)/ }, () => ({ path: stub }))
  },
}

// playwright-core hace require(<ruta>/package.json) en runtime para leer su version.
// Dentro de un .exe no hay node_modules, asi que se le devuelve el dato ya resuelto.
const pw = (f) => JSON.parse(fs.readFileSync(path.join(HERE, 'node_modules/playwright-core', f), 'utf8'))
const embeddedJson = {
  'package.json': { name: 'playwright-core', version: pw('package.json').version },
  'browsers.json': pw('browsers.json'),
}
const requireShim = `
{
  const __realRequire = require
  const __embedded = ${JSON.stringify(embeddedJson)}
  require = (id) => {
    if (typeof id === 'string') {
      const base = id.split(/[\\\\/]/).pop()
      if (__embedded[base]) return __embedded[base]
    }
    return __realRequire(id)
  }
}
`

await esbuild.build({
  plugins: [stubBidi],
  banner: { js: requireShim },
  entryPoints: [path.join(HERE, 'run.mjs')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: path.join(BUILD, 'bundle.cjs'),
  loader: { '.json': 'json' },
  // playwright-core carga estos por ruta en runtime; no van al bundle.
  external: ['electron', 'ws', 'chokidar', 'bufferutil', 'utf-8-validate'],
  logLevel: 'warning',
})

// 2. Blob de SEA.
console.log('2/4  blob SEA...')
fs.writeFileSync(path.join(BUILD, 'sea-config.json'), JSON.stringify({
  main: path.join(BUILD, 'bundle.cjs'),
  output: path.join(BUILD, 'sea-prep.blob'),
  disableExperimentalSEAWarning: true,
}, null, 2))
run(process.execPath, ['--experimental-sea-config', path.join(BUILD, 'sea-config.json')])

// 3. Copia de node.exe + icono del pulpo + inyeccion del blob.
console.log('3/4  icono e inyeccion en el ejecutable...')
fs.copyFileSync(process.execPath, EXE)

// El icono se pone ANTES del blob: postject respeta los recursos ya existentes.
const logo = [
  path.join(HERE, 'assets', 'pulpo.png'),
  path.join(HERE, '..', '..', 'data', 'insanity_logo', 'pulpo_500x500.png'),
].find((f) => fs.existsSync(f))
if (process.platform === 'win32' && logo) {
  try {
    const ico = path.join(BUILD, 'droptimizer.ico')
    fs.writeFileSync(ico, await pngToIco(logo))
    await rcedit(EXE, {
      icon: ico,
      'version-string': {
        CompanyName: 'Insanity - Sanguino (EU)',
        FileDescription: 'Droptimizers de Raidbots para Insanity',
        ProductName: 'Insanity Droptimizer',
        LegalCopyright: 'Insanity',
      },
    })
  } catch (e) { console.log(`     (sin icono: ${e.message})`) }
}

try {
  // La firma de node.exe deja de ser valida al inyectar; si esta signtool, se quita antes.
  run('signtool', ['remove', '/s', EXE])
} catch { console.log('     (sin signtool: se inyecta sobre el binario firmado)') }
await inject(EXE, 'NODE_SEA_BLOB', fs.readFileSync(path.join(BUILD, 'sea-prep.blob')), {
  sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
})

// 4. Extras que acompañan al .exe.
console.log('4/4  extras...')
fs.copyFileSync(path.join(HERE, 'profiles.json'), path.join(DATOS, 'profiles.json'))
// El icono de la ventana de la interfaz grafica...
if (logo) fs.copyFileSync(logo, path.join(MEDIA, 'pulpo.png'))
// ...y todos los didop-* que haya en assets/, sean gif o video.
const assets = path.join(HERE, 'assets')
if (fs.existsSync(assets)) {
  const didops = fs.readdirSync(assets).filter((f) => /^didop-[\w-]+\.(gif|mp4|webm)$/i.test(f))
  for (const f of didops) fs.copyFileSync(path.join(assets, f), path.join(MEDIA, f))
  console.log(`     ${didops.length} didop(s): ${didops.join(', ')}`)
}

/*
 * La cuenta puede viajar como fichero dentro de datos/ (no dentro del binario),
 * pero NUNCA por defecto: un build normal no debe llevar credenciales, que es lo
 * que acaba subido a una release publica. Hay que pedirlo a proposito:
 *
 *   node build.mjs --con-cuenta
 */
const account = path.join(HERE, 'raidbots-account.json')
const conCuenta = process.argv.includes('--con-cuenta')
if (conCuenta && fs.existsSync(account)) {
  fs.copyFileSync(account, path.join(DATOS, 'raidbots-account.json'))
  console.log('     ¡ATENCION! la cuenta va dentro: este ZIP lleva credenciales, no lo subas a GitHub')
} else {
  fs.rmSync(path.join(DATOS, 'raidbots-account.json'), { force: true })
  fs.copyFileSync(path.join(HERE, 'raidbots-account.example.json'), path.join(DATOS, 'raidbots-account.example.json'))
  console.log(fs.existsSync(account)
    ? '     sin credenciales (hay una cuenta guardada, pero hace falta --con-cuenta)'
    : '     sin credenciales: cada uno entra con la suya')
}
fs.writeFileSync(path.join(DIST, 'LEEME.txt'), `DROPTIMIZERS DE INSANITY
=======================

COMO SE USA
-----------
1. En el juego escribe  /simc  y copia el texto (Ctrl+C).
2. Doble clic en Droptimizer.exe: se abre la ventana con botones.
3. Pega el SimC en el cuadro de la izquierda, marca los perfiles que quieras
   y dale a "Lanzar droptimizers".
4. Al terminar tienes las URLs como enlaces, con un boton para copiar cada una
   y otro para copiarlas todas. Tambien quedan en out\\urls.txt

Al cerrar la ventana se cierra el programa.

QUE ES LA CARPETA datos\
-----------------------
Ahi va todo lo que el programa necesita y todo lo que genera, para no llenarte
la carpeta de ficheros sueltos:

  datos\media\        los gifs y el icono (cambialos si quieres)
  datos\profiles.json que perfiles de droptimizer existen
  datos\simc\         los SimC que vas pegando, uno por personaje y spec
  datos\out\          los resultados: urls.txt y el detalle en JSON
  datos\navegador\    la sesion de Raidbots (por eso no pide login cada vez)
  datos\ventana\      datos internos de la ventana

Si vienes de una version anterior, la primera vez ordena solo lo que tuvieras
suelto: no pierdes ni la sesion ni la configuracion.

Para usar la cuenta de Raidbots de la guild: boton "Cuenta" arriba a la derecha.
Se guarda en este PC y no vuelve a preguntar. Sin cuenta tambien funciona, solo
que la cola gratuita de Raidbots es mas lenta.

MENU DE CONSOLA (para quien lo prefiera)
---------------------------------------
Droptimizer.exe --menu
  1) Pegar mi SimC y lanzar        <- lo normal
  2) Lanzar los SimC guardados     <- para varios personajes de golpe
  3) Elegir que perfiles lanzar    <- Normal / HC / Mythic / M+ / Vault
  4) Opciones                      <- sims en paralelo y version de SimC (nightly)
  5) Subir a WoWUtils              <- sube las URLs al grupo
  6) Cuenta de Raidbots            <- entrar, cambiar o cerrar sesion
  7) Abrir la interfaz con botones <- la ventana con botones
  0) Salir

SIMS EN PARALELO
----------------
Por defecto se lanzan todos los perfiles a la vez (hasta 5), asi la tanda dura
lo que dure el sim mas largo. El limite de verdad lo pone Raidbots: una cuenta
solo puede tener unos cuantos sims corriendo a la vez. Si te pasas no se pierde
nada, esa pestaña espera su turno y entra cuando queda hueco. En la opcion 4
puedes bajarlo si prefieres ir mas suave.

SUBIR A WOWUTILS (opcional)
---------------------------
Si tienes la API key de un grupo de WoWUtils, la opcion 5 te la pide una vez y
luego sube las URLs solo: al acabar cada tanda te pregunta si quieres subirlas.
La key y el id del grupo te los da un admin del grupo (Group settings -> API
sharing). Si no tienes key, no pasa nada: el programa te deja igual las URLs
para copiarlas a mano y no te vuelve a preguntar.

REQUISITOS
----------
Tener instalado Google Chrome. Nada mas: no hace falta instalar Node, ni npm,
ni descargar navegadores.

Si no tienes Chrome funciona con Edge, pero Windows 11 mete las pestañas de Edge
en el Alt+Tab y veras entradas sueltas con la miniatura en blanco. Se quitan en
Configuracion -> Sistema -> Multitarea -> Alt+Tab -> "Solo ventanas abiertas".

DESDE TERMINAL (opcional)
-------------------------
   Droptimizer.exe --profiles raid-heroic,raid-mythic
   Droptimizer.exe --simc simc\\narf.simc
   Droptimizer.exe --concurrency auto      (varios sims a la vez, si la cuenta lo permite)
   Droptimizer.exe --headed                (ver el navegador trabajando)
   Droptimizer.exe --login                 (entrar a mano en el navegador)
`)

const mb = (fs.statSync(EXE).size / 1024 / 1024).toFixed(0)
console.log(`\nListo: ${EXE} (${mb} MB)`)
console.log('Comprime la carpeta dist/ y repartela.')
