// Pruebas del motor de sincronización de La Cesta.
//
// No forman parte de la app (que sigue viviendo entera en index.html):
// son una herramienta de desarrollo. Extraen el bloque marcado como
// "LÓGICA PURA" dentro del <script> de index.html —sin DOM, sin fetch,
// sin localStorage— y lo ejecutan en un contexto de Node aislado.
//
// Ejecutar con:  node pruebas-sync.js

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function extraerLogicaPura(){
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf-8");
  const script = html.split("<script>")[1].split("</script>")[0];

  const marcaInicio = "// === INICIO LÓGICA PURA";
  const marcaFin = "// === FIN LÓGICA PURA";
  const inicio = script.indexOf(marcaInicio);
  const fin = script.indexOf(marcaFin);
  if(inicio === -1 || fin === -1){
    throw new Error("No se encontraron los marcadores de lógica pura en index.html.");
  }

  const bloque = script.slice(inicio, fin);
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(
    bloque + "\nthis.aplicarMargen = aplicarMargen;" +
    "\nthis.calcularMarca = calcularMarca;" +
    "\nthis.fusionarFilas = fusionarFilas;" +
    "\nthis.decidirSubida = decidirSubida;" +
    "\nthis.MARGEN_SYNC_MS = MARGEN_SYNC_MS;",
    sandbox
  );
  return sandbox;
}

const { aplicarMargen, calcularMarca, fusionarFilas, decidirSubida, MARGEN_SYNC_MS } = extraerLogicaPura();

// ------------------------------------------------------------
// Arnés mínimo
// ------------------------------------------------------------
let fallos = 0;
function assert(cond, mensaje){
  if(!cond){
    fallos++;
    console.error("FALLO: " + mensaje);
  }else{
    console.log("OK: " + mensaje);
  }
}
function assertIgual(real, esperado, mensaje){
  assert(real === esperado, mensaje + " (esperado " + esperado + ", obtenido " + real + ")");
}

const iso = (s) => new Date(s).toISOString();

// ==============================================================
// Caso 1 — fila editada offline que se sube tarde
// ==============================================================
console.log("\n-- Caso 1: fila editada offline, subida tarde --");

// El dispositivo sincroniza y recibe dos filas: la marca pasa a ser
// el updated_at más alto recibido (09:55), no la hora del reloj.
let marca = calcularMarca(
  [{ updated_at: iso("2026-08-16T09:50:00Z") }, { updated_at: iso("2026-08-16T09:55:00Z") }],
  null
);
assertIgual(marca, iso("2026-08-16T09:55:00Z"), "la marca toma el updated_at más alto recibido");

// Una sincronización posterior que no trae filas nuevas (sondeo en
// vacío) NO debe adelantar la marca al reloj local. Antes del arreglo,
// el código hacía setLastSync(new Date().toISOString()) en cada
// sincronización, aunque remotas viniera vacío.
const marcaTrasSondeoVacio = calcularMarca([], marca);
assertIgual(marcaTrasSondeoVacio, marca, "un sondeo sin filas nuevas no adelanta la marca");

// Mientras tanto, el otro móvil edita una fila sin cobertura a las
// 09:58 (updated_at lo pone el cliente) y no la sube hasta más tarde.
const filaTardia = { id: "c", updated_at: iso("2026-08-16T09:58:00Z") };

// Con la marca correcta (09:55, nunca adelantada por sondeos vacíos)
// y el margen de seguridad, la próxima consulta pide "updated_at > 09:50",
// así que la fila tardía (09:58) SÍ entra.
const umbralCorrecto = aplicarMargen(marcaTrasSondeoVacio, MARGEN_SYNC_MS);
assertIgual(umbralCorrecto, iso("2026-08-16T09:50:00Z"), "el margen resta 5 minutos a la marca");
assert(
  new Date(filaTardia.updated_at) > new Date(umbralCorrecto),
  "con la marca corregida, la fila tardía (09:58) pasa el filtro updated_at=gt." + umbralCorrecto
);

// Comprobación negativa: si la marca se hubiera adelantado al reloj
// local en el sondeo vacío (comportamiento anterior, simulado aquí a
// mano con un reloj 10 minutos por delante), la misma fila se pierde
// para siempre porque su updated_at queda por detrás incluso del
// umbral con margen.
const marcaAntiguaBuggy = iso("2026-08-16T10:05:00Z"); // "ahora" simulado del sondeo vacío
const umbralBuggy = aplicarMargen(marcaAntiguaBuggy, MARGEN_SYNC_MS);
assert(
  new Date(filaTardia.updated_at) <= new Date(umbralBuggy),
  "con la marca basada en el reloj (comportamiento anterior), la fila tardía se habría perdido"
);

// El merge en sí conserva la fila tardía al fusionarla como cualquier
// otra remota nueva.
const localesSinFilaTardia = [{ id: "a", updated_at: iso("2026-08-16T09:50:00Z") }];
const fusion = fusionarFilas("id", localesSinFilaTardia, [filaTardia]);
assert(
  fusion.some((f) => f.id === "c" && f.updated_at === filaTardia.updated_at),
  "la fila tardía queda incorporada tras fusionar la respuesta del servidor"
);

// ==============================================================
// Caso 2 — dos dispositivos editando la misma fila con marcas distintas
// ==============================================================
console.log("\n-- Caso 2: mismo artículo editado en los dos móviles --");

// 2a) El cambio local es más reciente que el remoto: se sube.
let pendientes = [{ ing_id: "ajo", comprado: true, updated_at: iso("2026-08-16T10:10:00Z"), _dirty: true }];
let remotas = { ajo: { ing_id: "ajo", comprado: false, updated_at: iso("2026-08-16T10:05:00Z") } };
let decision = decidirSubida("ing_id", pendientes, remotas);
assertIgual(decision.aSubir.length, 1, "local más nuevo: se incluye en aSubir");
assertIgual(Object.keys(decision.resueltosConRemoto).length, 0, "local más nuevo: no se descarta");

// 2b) El cambio remoto es más reciente (el otro móvil tachó el mismo
// artículo después): el local se descarta y se conserva el remoto.
pendientes = [{ ing_id: "cebolla", comprado: true, updated_at: iso("2026-08-16T10:00:00Z"), _dirty: true }];
remotas = { cebolla: { ing_id: "cebolla", comprado: false, updated_at: iso("2026-08-16T10:07:00Z") } };
decision = decidirSubida("ing_id", pendientes, remotas);
assertIgual(decision.aSubir.length, 0, "remoto más nuevo: no se sube el cambio local");
assertIgual(
  decision.resueltosConRemoto.cebolla.comprado,
  false,
  "remoto más nuevo: el artículo se queda con el valor del servidor, no con el local"
);

// 2c) Empate exacto de updated_at: gana el remoto (ya persistido),
// evitando una escritura innecesaria.
pendientes = [{ ing_id: "sal", comprado: true, updated_at: iso("2026-08-16T10:00:00Z"), _dirty: true }];
remotas = { sal: { ing_id: "sal", comprado: false, updated_at: iso("2026-08-16T10:00:00Z") } };
decision = decidirSubida("ing_id", pendientes, remotas);
assertIgual(decision.aSubir.length, 0, "empate de updated_at: no se sube (gana el remoto)");

// 2d) Fila local nueva que todavía no existe en el servidor: se sube
// igualmente (no hay remoto con el que comparar).
pendientes = [{ ing_id: "pimenton", comprado: true, updated_at: iso("2026-08-16T10:00:00Z"), _dirty: true }];
decision = decidirSubida("ing_id", pendientes, {});
assertIgual(decision.aSubir.length, 1, "fila local sin equivalente remoto: se sube igualmente");

// 2e) La misma resolución debe cumplirse en el merge de bajada
// (defensa adicional si dos sincronizaciones se solapan): una fila
// local marcada _dirty y más nueva que la remota sobrevive a la
// fusión; si no es más nueva, la pisa el remoto.
let filas = fusionarFilas(
  "ing_id",
  [{ ing_id: "ajo", comprado: true, updated_at: iso("2026-08-16T10:10:00Z"), _dirty: true }],
  [{ ing_id: "ajo", comprado: false, updated_at: iso("2026-08-16T10:05:00Z") }]
);
assertIgual(filas[0].comprado, true, "fusión: local _dirty y más nuevo sobrevive al bajar cambios");

filas = fusionarFilas(
  "ing_id",
  [{ ing_id: "cebolla", comprado: true, updated_at: iso("2026-08-16T10:00:00Z"), _dirty: true }],
  [{ ing_id: "cebolla", comprado: false, updated_at: iso("2026-08-16T10:07:00Z") }]
);
assertIgual(filas[0].comprado, false, "fusión: remoto más nuevo pisa al local _dirty al bajar cambios");

// ------------------------------------------------------------
console.log("\n" + (fallos === 0 ? "Todas las pruebas pasaron." : fallos + " prueba(s) fallida(s)."));
process.exit(fallos === 0 ? 0 : 1);
