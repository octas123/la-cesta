// Pruebas del escalado de recetas y de la validación de importación
// de La Cesta.
//
// No forman parte de la app (que sigue viviendo entera en index.html):
// son una herramienta de desarrollo. Extraen el bloque marcado como
// "LÓGICA PURA RECETAS" dentro del <script> de index.html —sin DOM,
// sin fetch, sin localStorage— y lo ejecutan en un contexto de Node
// aislado.
//
// Ejecutar con:  node pruebas-recetas.js

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function extraerLogicaPura(){
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf-8");
  const script = html.split("<script>")[1].split("</script>")[0];

  const marcaInicio = "// === INICIO LÓGICA PURA RECETAS";
  const marcaFin = "// === FIN LÓGICA PURA RECETAS";
  const inicio = script.indexOf(marcaInicio);
  const fin = script.indexOf(marcaFin);
  if(inicio === -1 || fin === -1){
    throw new Error("No se encontraron los marcadores de lógica pura de recetas en index.html.");
  }

  const bloque = script.slice(inicio, fin);
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(
    bloque +
    "\nthis.formatearNumero = formatearNumero;" +
    "\nthis.escalarNumeroEnTexto = escalarNumeroEnTexto;" +
    "\nthis.escalarLineaIngrediente = escalarLineaIngrediente;" +
    "\nthis.escalarPasoTexto = escalarPasoTexto;" +
    "\nthis.normalizarParaComparar = normalizarParaComparar;" +
    "\nthis.validarImportacion = validarImportacion;" +
    "\nthis.opcionesUnidadPara = opcionesUnidadPara;" +
    "\nthis.calcularMedida = calcularMedida;" +
    "\nthis.extraerReferenciasIngredientes = extraerReferenciasIngredientes;" +
    "\nthis.validarLineasIngredientesForm = validarLineasIngredientesForm;" +
    "\nthis.validarPasosForm = validarPasosForm;" +
    "\nthis.filtrarRecetasActivas = filtrarRecetasActivas;" +
    "\nthis.filasMenuDeReceta = filasMenuDeReceta;" +
    "\nthis.formatearCantidadMostrada = formatearCantidadMostrada;",
    sandbox
  );
  return sandbox;
}

const {
  formatearNumero, escalarNumeroEnTexto, escalarLineaIngrediente,
  escalarPasoTexto, normalizarParaComparar, validarImportacion,
  opcionesUnidadPara, calcularMedida, extraerReferenciasIngredientes,
  validarLineasIngredientesForm, validarPasosForm,
  filtrarRecetasActivas, filasMenuDeReceta, formatearCantidadMostrada
} = extraerLogicaPura();

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
  const iguales = JSON.stringify(real) === JSON.stringify(esperado);
  assert(iguales, mensaje + " (esperado " + JSON.stringify(esperado) + ", obtenido " + JSON.stringify(real) + ")");
}

// ==============================================================
// Caso 1 — formateo de números en español
// ==============================================================
console.log("\n-- Caso 1: formateo de números --");
assertIgual(formatearNumero(4), "4", "entero sin decimales");
assertIgual(formatearNumero(1.5), "1,5", "decimal con coma, no con punto");
assertIgual(formatearNumero(0.25), "0,25", "dos decimales sin recortar de más");
assertIgual(formatearNumero(2.0), "2", "un entero disfrazado de decimal se muestra limpio");

// ==============================================================
// Caso 2 — escalado a raciones no enteras (sección 10 de la spec)
// ==============================================================
console.log("\n-- Caso 2: escalado de una línea de ingrediente --");

// 8 contramuslos a 4 raciones -> 6 raciones (factor 1.5) -> 12 contramuslos.
let linea = { id: "0001", texto: "8 contramuslos de pollo sin piel (unos 150 g cada uno)", cantidad: 8, unidad: null };
let escalada = escalarLineaIngrediente(linea, 1.5);
assertIgual(escalada.cantidadEscalada, 12, "la cantidad numérica se escala por el factor");
assertIgual(
  escalada.textoEscalado,
  "12 contramuslos de pollo sin piel (unos 150 g cada uno)",
  "el texto se reescala sustituyendo solo el número, conservando el resto de la frase"
);

// Factor 1 (mismas raciones que raciones_base): el texto no cambia.
escalada = escalarLineaIngrediente(linea, 1);
assertIgual(escalada.textoEscalado, linea.texto, "factor 1 deja el texto igual");

// Raciones no enteras: 4 dientes de ajo a 3/4 (factor 0.75) -> 3 dientes.
linea = { id: "0002", texto: "4 dientes de ajo picados", cantidad: 4, unidad: null };
escalada = escalarLineaIngrediente(linea, 0.75);
assertIgual(escalada.cantidadEscalada, 3, "0.75 de factor da un número entero limpio");
assertIgual(escalada.textoEscalado, "3 dientes de ajo picados", "el texto refleja el nuevo número de dientes");

// Escalado que no cae en un entero: debe usar coma decimal, no punto.
linea = { id: "0004", texto: "4 cucharadas de aceite de oliva virgen extra", cantidad: 4, unidad: "tbsp" };
escalada = escalarLineaIngrediente(linea, 1.5);
assertIgual(escalada.cantidadEscalada, 6, "4 * 1.5 = 6");
assertIgual(escalada.textoEscalado, "6 cucharadas de aceite de oliva virgen extra", "sustituye 4 por 6");

// Un número que no aparece de forma exacta en el texto (caso raro,
// p.ej. una redacción distinta): nunca se antepone nada, se deja el
// texto original intacto.
linea = { id: "0099", texto: "un pellizco de sal", cantidad: 1, unidad: "tsp" };
escalada = escalarLineaIngrediente(linea, 2);
assertIgual(escalada.textoEscalado, "un pellizco de sal", "sin coincidencia numérica, el texto queda intacto, sin anteponer nada");

// ==============================================================
// Caso 3 — sustitución de {id} en los pasos
// ==============================================================
console.log("\n-- Caso 3: placeholders {id} en los pasos --");

const lineasPorId = {
  "0001": { id: "0001", texto: "8 contramuslos de pollo sin piel (unos 150 g cada uno)", cantidad: 8 },
  "0002": { id: "0002", texto: "4 dientes de ajo picados", cantidad: 4 }
};
let textoPaso = escalarPasoTexto("Añade {0001} al bol junto con {0002} y remueve.", lineasPorId, 1.5);
assertIgual(
  textoPaso,
  "Añade 12 contramuslos de pollo sin piel (unos 150 g cada uno) al bol junto con 6 dientes de ajo picados y remueve.",
  "cada {id} se sustituye por su línea de ingrediente ya escalada"
);

// Un id que no existe en el mapa se deja tal cual, en vez de reventar.
textoPaso = escalarPasoTexto("Añade {0099} al bol.", lineasPorId, 1);
assertIgual(textoPaso, "Añade {0099} al bol.", "un id sin línea asociada se conserva sin sustituir");

// ==============================================================
// Caso 4 — validación de importación (sección 7 de la spec)
// ==============================================================
console.log("\n-- Caso 4: validación de un bloque de importación --");

const ingredientesExistentes = [
  { id: "ajo", nombre: "Ajo", alias: ["ajos"] },
  { id: "sal", nombre: "Sal fina", alias: ["sal de mesa"] }
];

// 4a) Importación válida: ingrediente nuevo + receta que solo referencia
// ids ya disponibles (uno existente, uno nuevo).
let payload = {
  version: 1,
  ingredientes_nuevos: [
    { id: "pimienta_jamaica", nombre: "Pimienta de Jamaica molida", seccion: "Especias", unidad_base: "g", unidad_compra: "ud" }
  ],
  recetas: [
    { titulo: "Receta de prueba", ingredientes: [{ ing_id: "ajo" }, { ing_id: "pimienta_jamaica" }] }
  ]
};
let resultado = validarImportacion(payload, ingredientesExistentes);
assertIgual(resultado.ok, true, "importación válida: sin errores");
assertIgual(resultado.ingredientesNuevos.length, 1, "el ingrediente nuevo se acepta");
assertIgual(resultado.errores.length, 0, "sin errores cuando todos los ing_id existen");

// 4b) Rechazo total: una receta referencia un ing_id que no existe ni
// en la base ni en ingredientes_nuevos. Es el "fallo grave" descrito
// en la sección 7.1: no debe colarse una receta que la cesta no
// pueda sumar.
payload = {
  version: 1,
  ingredientes_nuevos: [],
  recetas: [
    { titulo: "Receta rota", ingredientes: [{ ing_id: "ingrediente_inventado" }] }
  ]
};
resultado = validarImportacion(payload, ingredientesExistentes);
assertIgual(resultado.ok, false, "un ing_id inexistente rechaza la importación entera");
assert(resultado.errores.length > 0, "se reporta al menos un error explicando el motivo");

// 4c) Colisión de id en ingredientes_nuevos: se avisa y se ignora el
// duplicado, pero no rompe la importación (el id ya está disponible
// vía el existente).
payload = {
  version: 1,
  ingredientes_nuevos: [
    { id: "ajo", nombre: "Ajo (duplicado)", seccion: "Frutería", unidad_base: "g", unidad_compra: "ud" }
  ],
  recetas: [
    { titulo: "Receta con ajo", ingredientes: [{ ing_id: "ajo" }] }
  ]
};
resultado = validarImportacion(payload, ingredientesExistentes);
assertIgual(resultado.ok, true, "colisión de id en ingredientes_nuevos no rechaza la importación");
assertIgual(resultado.ingredientesNuevos.length, 0, "el ingrediente duplicado no se añade de nuevo");
assertIgual(resultado.ingredientesDuplicados, ["ajo"], "el duplicado queda registrado");
assert(resultado.avisos.some(function(a){ return a.indexOf("ajo") !== -1; }), "se avisa de la colisión de id");

// 4d) Nombre parecido a uno ya existente: avisa (duplicado
// divergente, sección 7.1) pero no bloquea la importación.
payload = {
  version: 1,
  ingredientes_nuevos: [
    { id: "sal_fina_marina", nombre: "Sal fina", seccion: "Especias", unidad_base: "g", unidad_compra: "ud" }
  ],
  recetas: []
};
resultado = validarImportacion(payload, ingredientesExistentes);
assertIgual(resultado.ok, true, "un nombre parecido no rechaza la importación");
assert(resultado.avisos.some(function(a){ return a.indexOf("Sal fina") !== -1; }), "se avisa de un nombre que se parece a uno existente");

// 4e) Receta sin título: error de validación.
payload = { version: 1, ingredientes_nuevos: [], recetas: [{ ingredientes: [] }] };
resultado = validarImportacion(payload, ingredientesExistentes);
assertIgual(resultado.ok, false, "una receta sin título se rechaza");

// ==============================================================
// Caso 5 — cálculo de med_cantidad a partir de las equivalencias
// ==============================================================
console.log("\n-- Caso 5: cálculo de la medida (formulario de edición) --");

const ajo = { id: "ajo", nombre: "Ajo", unidad_base: "g", equivalencias: { diente: 4, cabeza: 45 } };

// 5a) Unidad = unidad base: factor 1, sin inventar nada.
let medida = calcularMedida(ajo, 100, "g");
assertIgual(medida, { ok: true, med_cantidad: 100, med_unidad: "g" }, "unidad = unidad_base usa factor 1");

// 5b) Unidad presente en equivalencias: se multiplica por el factor.
medida = calcularMedida(ajo, 3, "diente");
assertIgual(medida, { ok: true, med_cantidad: 12, med_unidad: "g" }, "3 dientes * 4 g/diente = 12 g");

// 5c) Unidad ausente de equivalencias: no inventa un número, avisa.
medida = calcularMedida(ajo, 2, "cup");
assertIgual(medida.ok, false, "unidad sin equivalencia definida: ok=false");
assert(medida.motivo && medida.motivo.indexOf("cup") !== -1, "el aviso menciona la unidad sin resolver");

// 5d) Sin ingrediente seleccionado: tampoco inventa nada.
medida = calcularMedida(null, 2, "g");
assertIgual(medida.ok, false, "sin ingrediente canónico: ok=false");

// 5e) Opciones de unidad: la base primero, luego las claves de equivalencias.
assertIgual(opcionesUnidadPara(ajo), ["g", "diente", "cabeza"], "las opciones son la base y las claves de equivalencias, sin inventar ninguna");
assertIgual(opcionesUnidadPara(null), [], "sin ingrediente, no hay opciones de unidad");

// ==============================================================
// Caso 6 — referencias {id} y validación de líneas del formulario
// ==============================================================
console.log("\n-- Caso 6: referencias de pasos y validación del formulario de edición --");

assertIgual(
  extraerReferenciasIngredientes("Añade {0001} y {0002}, luego otra vez {0001}."),
  ["0001", "0002"],
  "extrae ids únicos en orden de aparición, sin duplicar {0001}"
);
assertIgual(extraerReferenciasIngredientes("Sin referencias aquí."), [], "sin llaves, ninguna referencia");

const ingredientesDisponibles = [
  { id: "ajo", nombre: "Ajo", unidad_base: "g", equivalencias: { diente: 4 } }
];

// 6a) Fila completa y válida.
let resForm = validarLineasIngredientesForm(
  [{ id: "0001", ing_id: "ajo", texto: "4 dientes de ajo", cantidad: 4, unidad: "diente", med_cantidad: 16, med_unidad: "g" }],
  ingredientesDisponibles
);
assertIgual(resForm.errores.length, 0, "línea completa y resuelta: sin errores");
assertIgual(resForm.lineas.length, 1, "la línea válida se conserva");

// 6b) Fila completamente vacía (añadida y no rellenada): se ignora, no da error.
resForm = validarLineasIngredientesForm(
  [{ id: "0002", ing_id: null, texto: "", cantidad: null, unidad: null }],
  ingredientesDisponibles
);
assertIgual(resForm.errores.length, 0, "una fila vacía no genera error");
assertIgual(resForm.lineas.length, 0, "una fila vacía no se guarda");

// 6c) Ingrediente elegido pero sin unidad resuelta: bloquea con aviso, no guarda un número inventado.
resForm = validarLineasIngredientesForm(
  [{ id: "0003", ing_id: "ajo", texto: "2 tazas de ajo", cantidad: 2, unidad: "cup", med_cantidad: null, med_unidad: null, medidaError: "'cup' no tiene equivalencia definida para Ajo." }],
  ingredientesDisponibles
);
assertIgual(resForm.errores.length, 1, "unidad sin equivalencia: un error");
assertIgual(resForm.lineas.length, 0, "no se guarda la línea con medida sin resolver");

// 6d) Línea ya importada, sin tocar en esta sesión (unidad null pero
// med_cantidad ya calculado en la importación original): debe
// conservarse tal cual, sin exigir que el usuario reelija la unidad.
resForm = validarLineasIngredientesForm(
  [{ id: "0004", ing_id: "ajo", texto: "3 dientes de ajo picados", cantidad: 3, unidad: null, med_cantidad: 12, med_unidad: "g" }],
  ingredientesDisponibles
);
assertIgual(resForm.errores.length, 0, "línea importada sin tocar: no exige reelegir unidad");
assertIgual(resForm.lineas[0].med_cantidad, 12, "conserva el med_cantidad original de la importación");

// 6e) Falta elegir ingrediente: error explícito, nunca se acepta un ing_id vacío.
resForm = validarLineasIngredientesForm(
  [{ id: "0005", ing_id: null, texto: "algo", cantidad: 1, unidad: "g" }],
  ingredientesDisponibles
);
assertIgual(resForm.errores.length, 1, "sin ingrediente elegido: un error");

// 6f) Pasos: fila vacía se ignora, ingredientes_ref se deriva del texto.
let resPasos = validarPasosForm([
  { orden: 2, titulo: "", texto: "Añade {0001} y remueve.", tiempo_s: 60 },
  { orden: null, titulo: "", texto: "", tiempo_s: null }
]);
assertIgual(resPasos.errores.length, 0, "pasos válidos: sin errores");
assertIgual(resPasos.pasos.length, 1, "la fila de paso vacía se descarta");
assertIgual(resPasos.pasos[0].ingredientes_ref, ["0001"], "ingredientes_ref se deriva del texto, no de un campo aparte");

// ==============================================================
// Caso 7 — borrado lógico de una receta (nunca DELETE)
// ==============================================================
console.log("\n-- Caso 7: receta borrada que no reaparece tras sincronizar --");

// Tras pulsar "Eliminar", la receta queda local con borrada=true (no se
// borra la fila: un DELETE no se podría sincronizar al otro móvil).
// El listado debe excluirla de inmediato.
let recetasLocales = [
  { id: "r1", titulo: "Receta A", borrada: false },
  { id: "r2", titulo: "Receta B (recién borrada)", borrada: true }
];
assertIgual(
  filtrarRecetasActivas(recetasLocales).map(function(r){ return r.id; }),
  ["r1"],
  "el listado activo excluye la receta recién marcada borrada=true"
);

// El siguiente ciclo de sincronización baja del servidor exactamente
// esa misma fila (ya subida con borrada=true y un updated_at nuevo):
// sigue sin reaparecer, no vuelve a "borrada=false" por arte de magia.
let recetasTrasSincronizar = [
  { id: "r1", titulo: "Receta A", borrada: false, updated_at: "2026-08-19T09:00:00Z" },
  { id: "r2", titulo: "Receta B (recién borrada)", borrada: true, updated_at: "2026-08-19T09:05:00Z" }
];
assert(
  !filtrarRecetasActivas(recetasTrasSincronizar).some(function(r){ return r.id === "r2"; }),
  "tras sincronizar, la receta borrada sigue sin aparecer en el listado"
);

// El borrado también marca las filas de "menu" que apuntan a esa
// receta, para no dejar huecos de menú apuntando a una receta que ya
// no se lista. Una fila ya borrada de antes no se toca de nuevo.
let menu = [
  { id: "m1", receta_id: "r2", borrada: false },
  { id: "m2", receta_id: "r1", borrada: false },
  { id: "m3", receta_id: "r2", borrada: true }
];
assertIgual(
  filasMenuDeReceta(menu, "r2").map(function(m){ return m.id; }),
  ["m1"],
  "solo se marcan las filas de menu de esa receta que aún no estaban borradas"
);
assertIgual(
  filasMenuDeReceta(menu, "r1").map(function(m){ return m.id; }),
  ["m2"],
  "no se tocan filas de menu de otras recetas"
);

// ==============================================================
// Caso 8 — fracciones en el texto (ASCII y unicode), factor no entero
// ==============================================================
console.log("\n-- Caso 8: fracciones ASCII y unicode en el texto --");

// Bug reproducido con 5 raciones (factor 1,25): "1/2 cucharadita de
// canela" salía como "0,63 × 1/2 cucharadita...". La fracción ASCII
// debe reconocerse, convertirse a decimal, escalarse y mostrarse como
// un solo número, sin anteponer nada.
linea = { id: "0010", texto: "1/2 cucharadita de canela", cantidad: 0.5, unidad: "tsp" };
escalada = escalarLineaIngrediente(linea, 1.25);
assertIgual(escalada.cantidadEscalada, 0.625, "el valor exacto interno no se redondea: 0,5 * 1,25 = 0,625");
assertIgual(escalada.textoEscalado, "3/4 cucharadita de canela", "la fracción ASCII se detecta, se escala y se sustituye por un solo número");
assert(escalada.textoEscalado.indexOf("×") === -1, "nunca antepone el factor con ×");

// La misma fracción escrita en unicode (½) se reconoce igual.
linea = { id: "0011", texto: "½ cucharadita de canela", cantidad: 0.5, unidad: "tsp" };
escalada = escalarLineaIngrediente(linea, 1.25);
assertIgual(escalada.textoEscalado, "3/4 cucharadita de canela", "la fracción unicode ½ se reconoce igual que la ASCII 1/2");

// Otra fracción unicode (¼), con un factor que la deja en un número
// entero limpio.
linea = { id: "0012", texto: "¼ de cucharadita de pimienta", cantidad: 0.25, unidad: "tsp" };
escalada = escalarLineaIngrediente(linea, 2);
assertIgual(escalada.textoEscalado, "1/2 de cucharadita de pimienta", "¼ escalado por 2 dobla a 1/2, como fracción legible");

// Fracción ASCII en una unidad sin regla de redondeo especial (p.ej.
// "taza"): se detecta y escala igual, mostrada como decimal.
linea = { id: "0013", texto: "3/4 de taza de arroz", cantidad: 0.75, unidad: "cup" };
escalada = escalarLineaIngrediente(linea, 2);
assertIgual(escalada.textoEscalado, "1,5 de taza de arroz", "fracción ASCII 3/4 detectada y escalada aunque la unidad no tenga redondeo especial");

// Si de verdad no hay ningún número (ni entero, ni decimal, ni
// fracción) que corresponda a la cantidad, se deja el texto intacto:
// nunca se inventa ni se antepone nada.
linea = { id: "0014", texto: "un pellizco de sal", cantidad: 1, unidad: "tsp" };
escalada = escalarLineaIngrediente(linea, 1.25);
assertIgual(escalada.textoEscalado, "un pellizco de sal", "sin ningún número que escalar (ni siquiera en fracción), el texto queda intacto");

// ==============================================================
// Caso 9 — redondeo útil para cocinar (no el valor exacto)
// ==============================================================
console.log("\n-- Caso 9: redondeo útil para cocinar por familia de unidad --");

// Contables (unidad null): al 0,5 más cercano.
assertIgual(formatearCantidadMostrada(3.75, null), "4", "3,75 dientes redondea a 4");
assertIgual(formatearCantidadMostrada(1.25, null), "1,5", "1,25 chiles redondea a 1,5");
// Nunca por debajo de 0,5, aunque el resultado exacto sea menor.
assertIgual(formatearCantidadMostrada(0.2, null), "0,5", "un contable nunca se muestra por debajo de 0,5");

// Cucharadas/cucharaditas: a cuartos, como fracción legible.
assertIgual(formatearCantidadMostrada(0.5, "tbsp"), "1/2", "0,5 cucharada se expresa como 1/2");
assertIgual(formatearCantidadMostrada(0.75, "tsp"), "3/4", "0,75 cucharadita se expresa como 3/4");
assertIgual(formatearCantidadMostrada(1.25, "tsp"), "1 1/4", "1,25 cucharaditas se expresa como número mixto 1 1/4");

// Gramos/mililitros: entero por encima de 10, un decimal por debajo.
assertIgual(formatearCantidadMostrada(15, "g"), "15", "por encima de 10 g, entero");
assertIgual(formatearCantidadMostrada(7.5, "ml"), "7,5", "por debajo de 10 ml, un decimal");

// Integración: 2 dientes de ajo a factor 1,25 (5 raciones desde base
// 4) redondea a 2,5 dientes para mostrar, conservando el valor exacto
// (2,5) para med_cantidad.
linea = { id: "0015", texto: "2 dientes de ajo picados", cantidad: 2, unidad: null };
escalada = escalarLineaIngrediente(linea, 1.25);
assertIgual(escalada.cantidadEscalada, 2.5, "el valor exacto interno es 2,5, sin redondear");
assertIgual(escalada.textoEscalado, "2,5 dientes de ajo picados", "2,5 ya es múltiplo de 0,5: se muestra tal cual");

// Integración con factor 0,75: 2 cucharadas de aceite a 0,75 -> 1,5,
// que ya es múltiplo de 0,25 y se expresa como número mixto.
linea = { id: "0016", texto: "2 cucharadas de aceite de oliva", cantidad: 2, unidad: "tbsp" };
escalada = escalarLineaIngrediente(linea, 0.75);
assertIgual(escalada.cantidadEscalada, 1.5, "el valor exacto interno es 1,5");
assertIgual(escalada.textoEscalado, "1 1/2 cucharadas de aceite de oliva", "1,5 cucharadas se muestra como número mixto 1 1/2");

// ------------------------------------------------------------
console.log("\n" + (fallos === 0 ? "Todas las pruebas pasaron." : fallos + " prueba(s) fallida(s)."));
process.exit(fallos === 0 ? 0 : 1);
