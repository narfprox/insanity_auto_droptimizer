# Droptimizers automáticos de Raidbots

Pega el string de `/simc`, y esto lanza en [Raidbots](https://www.raidbots.com/simbot/droptimizer)
toda tu tanda de droptimizers y te devuelve las URLs de los reports **ya terminados**,
listas para copiar o para importarlas en [WoWUtils / Viserio Cooldowns](https://wowutils.com).

Hecho para la guild **Insanity** (Sanguino-EU), pero sirve para cualquiera: los perfiles son
un JSON que se edita sin tocar código.

## Descarga (Windows, sin instalar nada)

Coge el ZIP de la [última release](../../releases/latest), descomprime y doble clic en
`Droptimizer.exe`. No necesita Node, ni npm, ni descargar navegadores: usa el **Microsoft Edge
o Google Chrome** que ya tienes instalado.

```
1. En el juego:  /simc   y copia el texto (Ctrl+C)
2. Doble clic en Droptimizer.exe
3. Opción 1 → lee tu SimC del portapapeles y lanza los sims
4. Al acabar tienes las URLs en pantalla y en out\urls.txt
```

La primera vez pide el email y la contraseña de tu cuenta de Raidbots (se guardan en tu PC y
no vuelve a preguntar). Se puede dejar en blanco y funciona igual, solo que la cola gratuita
de Raidbots es más lenta.

```
==========================================
   INSANITY · DROPTIMIZERS DE RAIDBOTS
==========================================
Cuenta:   tu-cuenta — premium: Champion — 3 sim(s) a la vez
Perfiles: 5 de 5 (raid-normal, raid-heroic, raid-mythic, mplus-10, mplus-vault-10)

  1) Pegar mi SimC y lanzar   (lo coge del portapapeles)
  2) Lanzar los SimC guardados en la carpeta simc/
  3) Elegir que perfiles lanzar
  4) Opciones (sims en paralelo, version de SimC)
  5) Subir a WoWUtils
  6) Cuenta de Raidbots (entrar / cambiar / cerrar sesion)
  0) Salir
```

### Sims en paralelo (por defecto)

Cada sim va en su propia pestaña y **de fábrica salen todos a la vez**, con tope 5. Si solo
tienes 2 perfiles seleccionados, van esos 2 en paralelo. Así la tanda dura lo que dure el sim
más largo en vez de la suma de todos.

El tope real lo pone Raidbots, no esta herramienta: una cuenta solo puede tener un número
limitado de sims corriendo a la vez y contesta *"You are running too many sims at once"*.
Cuando eso pasa **no se pierde el sim**: esa pestaña espera hueco y lo reintenta cada 30 s
hasta 15 minutos. Se puede bajar en la opción 4 o con `--concurrency 1`.

### Versión de SimulationCraft

Raidbots ofrece `weekly` (build semanal estable, su defecto), `nightly` (build del día) y
`latest` (último commit). Esta herramienta usa **`nightly` por defecto**, para que los sims
salgan con el modelo más al día, y la fija **siempre de forma explícita** para que no dependa
de lo que quedara elegido la vez anterior. Se cambia en la opción 4 del menú o con
`--simc-version weekly`.

### Subir a WoWUtils desde el propio programa (opcional)

**Es una función opcional y sirve para cualquier grupo de WoWUtils, no solo el de una guild
concreta.** Si no configuras nada, el programa hace su trabajo y te deja las URLs; no te
molesta con ello.

Si tienes (o te pasan) la API key de un grupo, la opción **5** del menú la pide una vez, la
valida contra la API, la guarda en `wowutils-account.json` y a partir de ahí: al terminar cada
tanda te pregunta si subir las URLs, y desde esa misma opción puedes subir la última tanda
cuando quieras.

Los datos que hacen falta los da un admin del grupo: la key está en *Group settings → API
sharing* y el id del grupo sale en la URL `wowutils.com/viserio-cooldowns/groups/<ID>`.

Cada import cuesta 5 puntos del presupuesto por hora del grupo; si se agota, espera al reset en
vez de encadenar errores. Los `profileKey` que manda (`normal-max`, `heroic-max`, `mythic-max`,
`mplus-drops`, `mplus-vault`) los normaliza WoWUtils, y si alguno no le gustara se reintenta sin
él para que lo deduzca del propio report.

> ⚠️ La API key da acceso de **lectura y escritura a todo el grupo**, y WoWUtils solo tiene una
> key por grupo (no hay keys por persona). Por eso el programa **nunca la trae dentro**: la pone
> quien la tiene. Compártela solo con quien quieras que pueda escribir en el grupo; si se te va
> de las manos, se regenera en *Group settings → API sharing*.

## Desde el código

```powershell
npm install
node run.mjs                                     # menú
node run.mjs --simc simc/narf.simc               # directo, un personaje
node run.mjs --profiles raid-heroic,raid-mythic
npm run build                                    # genera dist/Droptimizer.exe
```

| Flag | Qué hace |
|------|----------|
| `--simc <ruta>` | Un fichero SimC concreto en vez de toda la carpeta `simc/` |
| `--profiles a,b` | Solo esos perfiles (claves de `profiles.json`) |
| `--menu` | Fuerza el menú aunque haya otros flags |
| `--login` | Abre el navegador para entrar a mano en Raidbots |
| `--headed` | Muestra el navegador en vez de ir en silencio |
| `--dry-run` | Configura todo pero **no** lanza los sims |
| `--no-wait` | Envía los sims y devuelve las URLs sin esperar a que terminen |
| `--concurrency <n\|auto>` | Sims simultáneos. `auto` (defecto) = todos a la vez, hasta 5 |
| `--simc-version <v>` | `nightly` (defecto), `weekly` o `latest` |
| `--import` | Al terminar, sube las URLs a WoWUtils |
| `--timeout-min <n>` | Minutos máximos de espera por sim (por defecto 25) |

## Perfiles

| Clave | Fuente | Selección | Upgrade up to |
|-------|--------|-----------|---------------|
| `raid-normal` | Season 2 Raids | Normal | Champion 6/6 |
| `raid-heroic` | Season 2 Raids | Heroic | Hero 6/6 |
| `raid-mythic` | Season 2 Raids | Mythic | Myth 6/6 |
| `mplus-10` | Mythic+ Dungeons | Mythic 10 | Hero 6/6 |
| `mplus-vault-10` | Mythic+ Dungeons | +10 Vault | Myth 6/6 |

Todos con **Upgrade All Equipped Gear to the Same Level** y **High Precision**.

`"upgrade": "max"` significa *el 6/6 del track que corresponda a esa dificultad*, así que los
ilvl los resuelve Raidbots solo y **al cambiar de season no hay que tocar nada**. También vale
fijarlo: `"upgrade": "321"` o `"upgrade": "318Hero 5/6"`.

Un perfil es literalmente los textos que pulsarías en la web:

```json
{
  "key": "raid-heroic",
  "label": "Raid Heroic — Hero 6/6",
  "profileKey": "heroic-max",
  "source": "Season 2 Raids",
  "select": ["Heroic"],
  "upgrade": "max",
  "upgradeEquipped": true,
  "highPrecision": true
}
```

## Importar en WoWUtils (opcional)

Lo normal es hacerlo desde el menú (opción 5) o con `--import`. Para automatizar también está
el CLI:

```powershell
node import.mjs --dry-run     # ver qué se enviaría
node import.mjs               # sube el último out/droptimizers-*.json
```

Las credenciales salen del `wowutils-account.json` que deja el menú, o de un `.env` al lado:

```
WOWUTILS_API_KEY=wowutils_live_...
WOWUTILS_GROUP_ID=...
```

## Cómo funciona

No usa ninguna API privada de Raidbots: **pulsa los mismos botones que pulsarías tú**, con
Playwright sobre el navegador que ya tienes. Pega el SimC en el editor, elige fuente,
dificultad y nivel de upgrade, marca las casillas, le da a *RUN DROPTIMIZER*, se queda con el
`simId` de la respuesta y consulta `/api/job/<simId>` hasta que el report está listo.

El `.exe` se genera con esbuild (bundle) + [Node SEA](https://nodejs.org/api/single-executable-applications.html)
(mete el bundle dentro de una copia de `node.exe`) + `postject`. Como al inyectar el blob la
firma de `node.exe` deja de ser válida, **Windows SmartScreen puede avisar de "editor
desconocido"** la primera vez: *Más información* → *Ejecutar de todas formas*.

No lances tandas masivas en paralelo: la cola de Raidbots es un recurso compartido y de verdad.

## Aviso sobre las credenciales

Si guardas la contraseña, va en `raidbots-account.json` **en texto plano**, al lado del
programa. Cifrarla con una clave metida en el propio binario sería un candado con la llave
puesta, así que no se hace. Si repartes el ZIP con ese fichero dentro, estás repartiendo la
cuenta: hazlo solo por canales privados y que esa cuenta no comparta contraseña con nada tuyo.

## Licencia

MIT — ver [LICENSE](LICENSE).
