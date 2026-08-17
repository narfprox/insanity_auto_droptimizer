/** La ventana de la aplicacion: una sola pagina, sin dependencias externas. */
export const PAGINA = /* html */ `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Droptimizer · Insanity</title>
<link rel="icon" href="/icono.png">
<style>
  :root {
    --fondo: #16151c; --panel: #1e1d27; --panel2: #262533; --borde: #343143;
    --texto: #e8e6f0; --suave: #9b97ae; --morado: #a970ff; --morado2: #7d4ee0;
    --verde: #3fb950; --rojo: #f85149; --ambar: #d29922;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--fondo); color: var(--texto);
    font: 14px/1.5 "Segoe UI", system-ui, sans-serif;
  }
  header {
    display: flex; align-items: center; gap: 12px; padding: 14px 20px;
    background: linear-gradient(90deg, #2a1f45, #1e1d27); border-bottom: 1px solid var(--borde);
  }
  header h1 { font-size: 16px; margin: 0; letter-spacing: .12em; text-transform: uppercase; }
  header .cuenta { margin-left: auto; color: var(--suave); font-size: 13px; }
  main { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 16px 20px 24px; }
  .panel { background: var(--panel); border: 1px solid var(--borde); border-radius: 10px; padding: 16px; }
  .panel h2 {
    font-size: 12px; text-transform: uppercase; letter-spacing: .1em;
    color: var(--suave); margin: 0 0 12px;
  }
  textarea {
    width: 100%; height: 190px; resize: vertical; background: var(--panel2); color: var(--texto);
    border: 1px solid var(--borde); border-radius: 8px; padding: 10px;
    font: 12px/1.45 Consolas, monospace;
  }
  textarea:focus, input:focus, select:focus { outline: 2px solid var(--morado2); outline-offset: -1px; }
  .personaje { margin-top: 8px; font-size: 13px; color: var(--suave); min-height: 20px; }
  .personaje b { color: var(--morado); }
  label.check { display: flex; align-items: center; gap: 9px; padding: 5px 0; cursor: pointer; }
  label.check input { accent-color: var(--morado); width: 16px; height: 16px; }
  .fila { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
  .fila span { color: var(--suave); min-width: 108px; font-size: 13px; }
  select, input[type=text], input[type=password], input[type=email] {
    background: var(--panel2); color: var(--texto); border: 1px solid var(--borde);
    border-radius: 7px; padding: 7px 9px; font: inherit; flex: 1;
  }
  button {
    background: var(--morado2); color: #fff; border: 0; border-radius: 8px;
    padding: 10px 16px; font: 600 14px "Segoe UI", sans-serif; cursor: pointer;
  }
  button:hover { background: var(--morado); }
  button:disabled { background: #3a3648; color: #77738a; cursor: not-allowed; }
  button.sec { background: transparent; border: 1px solid var(--borde); color: var(--texto); }
  button.sec:hover { border-color: var(--morado); background: #241f33; }
  #lanzar { width: 100%; margin-top: 14px; padding: 13px; font-size: 15px; }
  #consola {
    background: #121118; border: 1px solid var(--borde); border-radius: 8px; padding: 10px;
    height: 190px; overflow-y: auto; font: 12px/1.5 Consolas, monospace; color: #b9b4cc;
    white-space: pre-wrap; word-break: break-word;
  }
  .res { display: flex; align-items: center; gap: 10px; padding: 7px 0; border-bottom: 1px solid #2a2735; }
  .res:last-child { border-bottom: 0; }
  .res .et { flex: 1; }
  .res a { color: var(--morado); text-decoration: none; font: 12px Consolas, monospace; }
  .res a:hover { text-decoration: underline; }
  .pin { font-size: 11px; padding: 2px 7px; border-radius: 20px; background: #2c2a38; color: var(--suave); }
  .pin.ok { background: rgba(63,185,80,.15); color: var(--verde); }
  .pin.mal { background: rgba(248,81,73,.15); color: var(--rojo); }
  .aviso { color: var(--ambar); font-size: 13px; }
  dialog {
    background: var(--panel); color: var(--texto); border: 1px solid var(--borde);
    border-radius: 12px; padding: 20px; width: 380px;
  }
  dialog::backdrop { background: rgba(0,0,0,.6); }
  .ancho { grid-column: 1 / -1; }
</style>
</head>
<body>
<header>
  <h1>Droptimizer · Insanity</h1>
  <div class="cuenta" id="cuenta">comprobando cuenta…</div>
  <button class="sec" id="btnCuenta">Cuenta</button>
  <button class="sec" id="btnWow">WoWUtils</button>
</header>

<main>
  <section class="panel">
    <h2>1 · Tu personaje</h2>
    <textarea id="simc" placeholder="Escribe /simc en el juego, copia el texto y pégalo aquí (Ctrl+V)"></textarea>
    <div class="personaje" id="personaje"></div>
  </section>

  <section class="panel">
    <h2>2 · Qué lanzar</h2>
    <div id="perfiles"></div>
    <div class="fila">
      <span>En paralelo</span>
      <select id="concurrency">
        <option value="auto">Todos a la vez (hasta 5)</option>
        <option value="1">De uno en uno</option>
        <option value="2">2 a la vez</option>
        <option value="3">3 a la vez</option>
      </select>
    </div>
    <div class="fila">
      <span>Versión SimC</span>
      <select id="simcVersion">
        <option value="nightly">Nightly (build del día)</option>
        <option value="weekly">Weekly (semanal estable)</option>
        <option value="latest">Latest (último commit)</option>
      </select>
    </div>
    <button id="lanzar">Lanzar droptimizers</button>
  </section>

  <section class="panel">
    <h2>Progreso</h2>
    <div id="consola">Listo cuando quieras.</div>
  </section>

  <section class="panel">
    <h2>Resultados</h2>
    <div id="resultados" style="color:var(--suave)">Aún no hay nada.</div>
    <div class="fila" style="margin-top:14px">
      <button class="sec" id="btnCopiar">Copiar todas las URLs</button>
      <button id="btnSubir">Subir a WoWUtils</button>
    </div>
  </section>
</main>

<dialog id="dlgCuenta">
  <h2 style="margin-top:0">Cuenta de Raidbots</h2>
  <p style="color:var(--suave);font-size:13px">
    Se guarda en este PC. Sin cuenta también funciona, pero la cola gratuita es más lenta.
  </p>
  <div class="fila"><span>Email</span><input type="email" id="email"></div>
  <div class="fila"><span>Contraseña</span><input type="password" id="pass"></div>
  <label class="check" style="margin-top:10px">
    <input type="checkbox" id="guardar" checked> Recordar la contraseña
  </label>
  <div class="fila" style="justify-content:flex-end">
    <button class="sec" onclick="dlgCuenta.close()">Cancelar</button>
    <button id="btnEntrar">Entrar</button>
  </div>
</dialog>

<dialog id="dlgWow">
  <h2 style="margin-top:0">WoWUtils</h2>
  <p style="color:var(--suave);font-size:13px">
    Opcional. La API key y el id del grupo te los da un admin del grupo
    (Group settings → API sharing).
  </p>
  <div class="fila"><span>API key</span><input type="password" id="apiKey"></div>
  <div class="fila"><span>Grupo</span><input type="text" id="groupId"></div>
  <div class="fila" style="justify-content:flex-end">
    <button class="sec" onclick="dlgWow.close()">Cancelar</button>
    <button id="btnGuardarWow">Comprobar y guardar</button>
  </div>
</dialog>

<script>
const $ = (id) => document.getElementById(id)
const api = async (ruta, cuerpo) => {
  const res = await fetch(ruta, cuerpo
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) }
    : {})
  const datos = await res.json()
  if (!res.ok) throw new Error(datos.error || 'error')
  return datos
}
const escribir = (texto) => {
  const c = $('consola')
  if (c.dataset.limpio !== '1') { c.textContent = ''; c.dataset.limpio = '1' }
  c.textContent += texto + '\\n'
  c.scrollTop = c.scrollHeight
}

let urls = []

function pintarResultados(resultados) {
  urls = resultados.filter((r) => r.url).map((r) => r.url)
  const caja = $('resultados')
  if (!resultados.length) { caja.textContent = 'Aún no hay nada.'; return }
  caja.innerHTML = ''
  for (const r of resultados) {
    const fila = document.createElement('div')
    fila.className = 'res'
    const estado = r.state === 'complete' ? 'ok' : r.state === 'error' ? 'mal' : ''
    fila.innerHTML = '<span class="pin ' + estado + '">' + (r.state || '—') + '</span>'
      + '<span class="et">' + r.label + '</span>'
      + (r.url ? '<a href="' + r.url + '" target="_blank">abrir report</a>' : '')
    caja.appendChild(fila)
  }
}

async function cargar() {
  const e = await api('/api/estado')
  $('cuenta').textContent = e.sesion.texto
  $('concurrency').value = e.config.concurrency
  $('simcVersion').value = e.config.simcVersion
  $('btnSubir').disabled = !e.wowutils
  $('btnSubir').title = e.wowutils ? '' : 'Configura antes la API key en el botón WoWUtils'
  $('perfiles').innerHTML = ''
  for (const p of e.perfiles) {
    const l = document.createElement('label')
    l.className = 'check'
    l.innerHTML = '<input type="checkbox" value="' + p.key + '"' + (p.activo ? ' checked' : '') + '>' + p.label
    $('perfiles').appendChild(l)
  }
  pintarResultados(e.resultados || [])
}

const perfilesElegidos = () =>
  [...document.querySelectorAll('#perfiles input:checked')].map((i) => i.value)

$('simc').addEventListener('input', () => {
  const texto = $('simc').value
  const clase = texto.match(/^(death_knight|demon_hunter|druid|evoker|hunter|mage|monk|paladin|priest|rogue|shaman|warlock|warrior)="?([^"\\n]+)"?/m)
  const spec = texto.match(/^spec=(\\w+)/m)
  $('personaje').innerHTML = clase
    ? 'Detectado: <b>' + clase[2] + '</b> · ' + (spec ? spec[1] : '?') + ' (' + clase[1].replace('_', ' ') + ')'
    : (texto.trim() ? '<span class="aviso">Eso no parece un export del addon SimC</span>' : '')
})

$('lanzar').onclick = async () => {
  const perfiles = perfilesElegidos()
  if (!perfiles.length) return alert('Elige al menos un perfil')
  await api('/api/perfiles', { perfiles })
  await api('/api/opciones', { concurrency: $('concurrency').value, simcVersion: $('simcVersion').value })
  $('consola').dataset.limpio = '0'
  await api('/api/lanzar', { simc: $('simc').value, perfiles })
}

$('btnCopiar').onclick = () => {
  if (!urls.length) return
  navigator.clipboard.writeText(urls.join('\\n'))
  $('btnCopiar').textContent = '¡Copiadas!'
  setTimeout(() => { $('btnCopiar').textContent = 'Copiar todas las URLs' }, 1500)
}

$('btnSubir').onclick = async () => {
  $('btnSubir').disabled = true
  try {
    const r = await api('/api/subir', {})
    escribir('Subidos a WoWUtils: ' + r.subidos + (r.fallidos ? ' · fallidos: ' + r.fallidos : ''))
  } catch (e) { escribir('Error subiendo: ' + e.message) }
  $('btnSubir').disabled = false
}

$('btnCuenta').onclick = () => $('dlgCuenta').showModal()
$('btnWow').onclick = () => $('dlgWow').showModal()

$('btnEntrar').onclick = async () => {
  try {
    const r = await api('/api/login', {
      email: $('email').value, password: $('pass').value, guardar: $('guardar').checked,
    })
    $('cuenta').textContent = r.texto
    $('dlgCuenta').close()
  } catch (e) { alert('No se pudo entrar: ' + e.message) }
}

$('btnGuardarWow').onclick = async () => {
  try {
    const r = await api('/api/wowutils', { apiKey: $('apiKey').value, groupId: $('groupId').value })
    alert('Conectado al grupo "' + r.grupo + '" (quedan ' + r.puntos + ' pts)')
    $('dlgWow').close()
    $('btnSubir').disabled = false
  } catch (e) { alert('No vale: ' + e.message) }
}

const eventos = new EventSource('/api/eventos')
eventos.onmessage = (ev) => {
  const d = JSON.parse(ev.data)
  if (d.tipo === 'log') escribir(d.texto)
  if (d.tipo === 'error') { escribir('ERROR: ' + d.mensaje); alert(d.mensaje) }
  if (d.tipo === 'resultados') pintarResultados(d.resultados)
  if (d.tipo === 'estado') {
    $('lanzar').disabled = d.corriendo
    $('lanzar').textContent = d.corriendo ? 'Simulando…' : 'Lanzar droptimizers'
    if (d.corriendo && d.personaje) escribir('Lanzando ' + d.personaje)
  }
}

cargar()
</script>
</body>
</html>`
