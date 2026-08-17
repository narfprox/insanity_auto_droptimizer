// Prueba correcta: cargar personaje Y seleccionar fuente, dos veces seguidas,
// sobre el MISMO perfil persistente (como hace el programa en dos tandas).
import fs from 'node:fs'
import { chromium } from 'playwright-core'
import { loadCharacter, applyProfile, loadProfiles } from './lib.mjs'

const subtlety = fs.readFileSync('C:/Users/Narf/Downloads/Droptimizer-Insanity-v1.7.0/datos/simc/narf-subtlety.simc', 'utf8')
const assassination = fs.readFileSync('./simc/narf.simc', 'utf8')
const perfil = loadProfiles().find((p) => p.key === 'raid-heroic')
const PERFIL = 'C:/Users/Narf/AppData/Local/Temp/perfil-dos-' + Date.now()

const estado = (page) => page.evaluate(() => {
  const t = document.body.innerText
  return {
    lootSpec: (t.match(/Loot Spec: ([\w ]+)/) || [])[1] || '(ninguno)',
    ficha: (t.match(/\n(\d+ [\w']+ [\w' ]+ Rogue)\n/) || [])[1] || '?',
  }
})

const tanda = async (page, simc, etiqueta) => {
  await loadCharacter(page, simc)
  await applyProfile(page, perfil)
  console.log(etiqueta, '->', JSON.stringify(await estado(page)))
}

const context = await chromium.launchPersistentContext(PERFIL, { headless: true, channel: 'chrome', viewport: { width: 1500, height: 1000 } })
const page = context.pages()[0] || (await context.newPage())
try {
  await tanda(page, assassination, '1) assassination')
  await tanda(page, subtlety, '2) subtlety     ')
  await tanda(page, assassination, '3) assassination')
} catch (e) {
  console.log('ERROR:', e.message.split('\n')[0])
} finally {
  await context.close().catch(() => {})
  fs.rmSync(PERFIL, { recursive: true, force: true })
}
