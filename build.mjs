#!/usr/bin/env node
/**
 * Empaqueta run.mjs en un unico Droptimizer.exe (Node SEA) que no necesita
 * ni Node ni npm en el PC de destino: usa el Edge/Chrome ya instalado.
 *
 *   npm run build
 *
 * Deja en dist/:
 *   Droptimizer.exe   <- el programa
 *   simc/             <- carpeta donde pegan sus .simc
 *   LEEME.txt
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
fs.mkdirSync(path.join(DIST, 'simc'), { recursive: true })

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
fs.copyFileSync(path.join(HERE, 'profiles.json'), path.join(DIST, 'profiles.json'))

// La cuenta compartida viaja como fichero al lado del .exe (no dentro del binario):
// asi se cambia la contraseña sin recompilar nada.
const account = path.join(HERE, 'raidbots-account.json')
if (fs.existsSync(account)) {
  fs.copyFileSync(account, path.join(DIST, 'raidbots-account.json'))
  console.log('     cuenta de la guild incluida en dist/ (¡el zip lleva credenciales!)')
} else {
  fs.copyFileSync(path.join(HERE, 'raidbots-account.example.json'), path.join(DIST, 'raidbots-account.example.json'))
  console.log('     sin raidbots-account.json: el .exe ira en anonimo')
}
fs.writeFileSync(path.join(DIST, 'LEEME.txt'), `DROPTIMIZERS DE INSANITY
=======================

COMO SE USA
-----------
1. En el juego escribe  /simc  y copia el texto (Ctrl+C).
2. Doble clic en Droptimizer.exe
3. Elige la opcion 1 (Pegar mi SimC y lanzar) y pulsa Enter: coge el texto del
   portapapeles solo, te dice que personaje ha detectado y lanza los sims.
4. Al terminar tienes las URLs en pantalla y en out\\urls.txt

La primera vez te pide el email y la contraseña de la cuenta de Raidbots de la
guild. Se guardan en este PC y ya no vuelve a preguntar. Si te equivocas o
cambia la contraseña: opcion 4 del menu (Cuenta de Raidbots).

Si prefieres ir en anonimo, deja el email en blanco y pulsa Enter: funciona
igual, solo que la cola de Raidbots es mas lenta.

MENU
----
  1) Pegar mi SimC y lanzar        <- lo normal
  2) Lanzar los SimC guardados     <- para varios personajes de golpe
  3) Elegir que perfiles lanzar    <- Normal / HC / Mythic / M+ / Vault
  4) Opciones                      <- sims en paralelo y version de SimC
  5) Subir a WoWUtils              <- sube las URLs al grupo
  6) Cuenta de Raidbots            <- entrar, cambiar o cerrar sesion
  0) Salir

SIMS EN PARALELO
----------------
Por defecto se lanzan todos los perfiles a la vez (hasta 5), asi la tanda dura
lo que dure el sim mas largo. El limite de verdad lo pone Raidbots: una cuenta
solo puede tener unos cuantos sims corriendo a la vez. Si te pasas no se pierde
nada, esa pestaña espera su turno y entra cuando queda hueco. En la opcion 4
puedes bajarlo si prefieres ir mas suave.

SUBIR A WOWUTILS
----------------
Al terminar te pregunta si quieres subir las URLs al grupo. La primera vez te
pide la API key del grupo (Group settings -> API sharing) y el id del grupo, que
sale en la URL de wowutils.com. Se guardan y ya no vuelve a preguntar.
Tambien esta la opcion 5 del menu para subir la ultima tanda cuando quieras.

REQUISITOS
----------
Tener instalado Microsoft Edge o Google Chrome. Nada mas: no hace falta
instalar Node, ni npm, ni descargar navegadores.

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
