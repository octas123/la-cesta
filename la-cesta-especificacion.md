# La Cesta — especificación técnica v1

App de recetas y lista de la compra para dos personas con datos compartidos.
Documento de partida para la implementación con Claude Code.

---

## 1. Qué es y qué no es

**Objetivo**: guardar recetas y, seleccionando cuáles se van a cocinar, obtener una lista de la compra consolidada, ordenada según el recorrido real del supermercado, que funcione con el móvil en la mano y sin depender de la cobertura.

**Dentro de la v1**
- Alta, edición y consulta de recetas
- Escalado por raciones
- Tabla maestra de ingredientes canónicos
- Generación de la cesta a partir de recetas seleccionadas
- Orden de secciones configurable por supermercado
- Despensa de básicos
- Marca de huerto con temporada
- Importación por pegado de JSON generado en el chat
- Funcionamiento sin conexión

**Fuera de la v1, pero el esquema ya lo contempla**
- Importación desde blogs (`fuente.tipo = "blog"`)
- Importación desde vídeo (`fuente.tipo = "video"`)
- Planificador semanal de menús (campo `fecha` en `menu`, nullable)
- Fotos de recetas

**Descartado explícitamente**
- Inventario real de despensa. Solo dos clases: básico o no.
- Entrevista al generar la cesta. Todo lo que no es básico se sugiere siempre.
- Cualquier llamada a un modelo en tiempo de ejecución. La inteligencia está en la ingesta.

---

## 2. Principio de arquitectura

> Toda la normalización ocurre en la ingesta. La app solo suma, agrupa y tacha.

Cuando una receta entra —desde el chat hoy, desde un blog mañana— llega ya con cada línea de ingrediente vinculada a un ingrediente canónico, con su unidad convertible y su sección de supermercado. La app nunca tiene que adivinar que "cebolleta" y "cebolla tierna" son lo mismo.

Consecuencias: sin API en runtime, coste cero, arranque instantáneo y funcionamiento offline real.

---

## 3. Stack

| Pieza | Elección | Motivo |
|---|---|---|
| Front | Archivo `index.html` único, sin dependencias | Mismo patrón que calistenia, ya probado |
| Publicación | GitHub Pages, repo público | Gratis; no hay secretos en el código |
| Almacén local | `localStorage` + Service Worker | Fuente de verdad para la UI |
| Sincronización | Supabase REST | Proyecto propio, no el de calistenia |
| Auth | Una cuenta compartida | RLS de una sola política |
| Backup | GitHub Action semanal | Vuelca a JSON y además evita la pausa por inactividad |

### Local-first, en concreto

La app **siempre lee de `localStorage`** y pinta al instante. La red es una tarea de fondo que puede fallar sin que se note. Nunca hay una pantalla de carga esperando a Supabase.

El **Service Worker es obligatorio**, no opcional: sin él la app no abre siquiera sin conexión, que es justo el escenario del sótano del súper. Cachea `index.html` y responde desde caché primero.

Cuándo migrar a IndexedDB: cuando entren fotos, o al pasar de unas 200 recetas. Con 100 recetas de ~4 KB se ocupan 400 KB de los ~5 MB de `localStorage`, así que hay margen de sobra en v1.

---

## 4. Modelo de datos

### 4.1 `ingredientes` — tabla maestra canónica

El corazón del sistema. Sin ella la cesta no puede sumar cantidades entre recetas.

```sql
create table ingredientes (
  id            text primary key,        -- slug: 'ajo', 'pechuga_pollo'
  nombre        text not null,           -- 'Ajo'
  seccion       text not null,           -- FK lógica a secciones.nombre
  es_basico     boolean default false,   -- despensa: no aparece en la cesta
  hay_en_casa   boolean default true,    -- solo relevante si es_basico
  del_huerto    boolean default false,
  meses         int[],                   -- [6,7,8,9] temporada; null = todo el año
  unidad_base   text not null,           -- 'g' | 'ml' | 'ud'
  unidad_compra text not null,           -- cómo se compra: 'kg','ud','manojo','l'
  compra_min    numeric,                 -- redondeo: 1 cabeza de ajo, no 9 g
  equivalencias jsonb default '{}',      -- {"diente":3,"cabeza":40,"tbsp":9}
  alias         text[] default '{}',     -- para emparejar en importaciones futuras
  updated_at    timestamptz default now(),
  borrada       boolean default false
);
```

**`equivalencias` es lo que hace posible la consolidación.** Convierte cualquier unidad que aparezca en una receta a `unidad_base`. Ejemplo con el ajo (`unidad_base: 'g'`):

```json
{ "diente": 3, "cabeza": 40, "tsp": 3, "tbsp": 9 }
```

Así "3 dientes de ajo" de una receta y "1 cucharada de ajo picado" de otra suman 18 g, y `compra_min: 40` los convierte en "1 cabeza de ajo".

**`compra_min` evita el ridículo** de una lista que pide 18 g de ajo o 0,4 limones.

### 4.2 `recetas`

El cuerpo de la receta va en `jsonb` porque se edita como una unidad. Solo los ingredientes canónicos necesitan tabla propia.

```sql
create table recetas (
  id              uuid primary key default gen_random_uuid(),
  titulo          text not null,
  descripcion     text,
  raciones_base   int not null default 4,
  tiempo_prep     int,                   -- minutos
  tiempo_coccion  int,
  dificultad      text,                  -- 'facil' | 'media' | 'dificil'
  etiquetas       text[] default '{}',
  fuente          jsonb default '{"tipo":"chat"}',
  ingredientes    jsonb not null,        -- ver 4.3
  pasos           jsonb not null,        -- ver 4.4
  notas           text,
  favorita        boolean default false,
  veces_cocinada  int default 0,
  ultima_vez      date,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  borrada         boolean default false
);
```

### 4.3 Línea de ingrediente

```json
{
  "id": "0001",
  "texto": "4 pechugas de pollo enteras (unos 180 g cada una)",
  "cantidad": 4,
  "unidad": null,
  "ing_id": "pechuga_pollo",
  "med_cantidad": 720,
  "med_unidad": "g",
  "opcional": false,
  "grupo": null
}
```

- `texto` es lo que se muestra al cocinar. Se escala multiplicando `cantidad`.
- `med_cantidad` / `med_unidad` es lo que consume la cesta, ya convertido a la unidad base del ingrediente. Se calcula en la ingesta, no en la app.
- `unidad` en `null` significa contable ("4 pechugas", "3 dientes"), y el sustantivo va dentro de `texto`.
- `grupo` permite separar bloques dentro de una receta: `"Para el adobo"`, `"Para la salsa"`.
- `opcional: true` hace que aparezca en la cesta marcado como opcional, no que desaparezca.

### 4.4 Paso

```json
{
  "orden": 1,
  "titulo": "Salmuera",
  "texto": "Disuelve {0003} en {0002} y sumerge {0001}...",
  "tiempo_s": 1800,
  "ingredientes_ref": ["0001", "0002", "0003"]
}
```

Las llaves `{id}` se sustituyen por la cantidad escalada al renderizar. `tiempo_s` habilita un temporizador; se omite en pasos sin espera.

### 4.5 `menu` — recetas seleccionadas para la compra

```sql
create table menu (
  id         uuid primary key default gen_random_uuid(),
  receta_id  uuid not null,
  raciones   int not null,
  fecha      date,                       -- null en v1; el planificador lo usará
  updated_at timestamptz default now(),
  borrada    boolean default false
);
```

### 4.6 `lista` — la cesta activa

**Una fila por artículo. Esto no es negociable.** Es la diferencia con el modelo de calistenia: dos personas tachan artículos distintos a la vez en el súper y ambos cambios deben sobrevivir.

```sql
create table lista (
  ing_id      text primary key,
  cantidad    numeric not null,
  unidad      text not null,
  texto       text not null,             -- '1 cabeza de ajo'
  comprado    boolean default false,
  manual      boolean default false,     -- añadido a mano, no viene de receta
  opcional    boolean default false,
  origen      jsonb default '[]',        -- [{receta_id, titulo, cantidad}]
  updated_at  timestamptz default now(),
  borrada     boolean default false
);
```

`origen` permite responder a "¿por qué está el cilantro en la lista?" tocando el artículo. Es barato y evita compras a ciegas.

### 4.7 `secciones` — recorrido del supermercado

```sql
create table secciones (
  id            uuid primary key default gen_random_uuid(),
  supermercado  text not null default 'Mercadona',
  nombre        text not null,
  orden         int not null,
  updated_at    timestamptz default now(),
  borrada       boolean default false
);
```

Orden por defecto al instalar, pensado para España y para que lo pesado entre primero y los huevos no acaben aplastados:

1. Antes de salir (huerto) — pseudo-sección, siempre primera
2. Frutería
3. Panadería
4. Charcutería y quesos
5. Carnicería
6. Pescadería
7. Conservas y legumbres
8. Pasta, arroz y harinas
9. Aceites, vinagres y salsas
10. Especias
11. Desayuno y dulces
12. Bebidas
13. Huevos y lácteos
14. Congelados
15. Droguería

**Reordenables arrastrando.** El orden exacto varía entre tiendas; se configura una vez en la primera compra real y queda fijo. La tabla admite varios supermercados desde el principio porque el coste ahora es cero.

---

## 5. Algoritmo de la cesta

Entrada: filas de `menu`. Salida: filas de `lista`.

1. Por cada receta, factor de escala `raciones / raciones_base`.
2. Por cada línea de ingrediente, `med_cantidad × factor`.
3. Agrupar por `ing_id` y sumar. Las unidades ya coinciden porque todas son `unidad_base`.
4. **Descartar** los que tengan `es_basico = true` y `hay_en_casa = true`.
5. **Separar** los `del_huerto` cuyo mes actual esté en `meses` → sección "Antes de salir".
6. Redondear hacia arriba al múltiplo de `compra_min` y expresar en `unidad_compra`.
7. Agrupar por `seccion` y ordenar según `secciones.orden`.
8. Conservar `comprado` de los artículos que ya estuvieran en la lista y no hayan cambiado de cantidad.

El paso 8 importa: regenerar la lista a mitad de la compra no debe destachar lo que ya está en el carro.

### Reglas de la despensa

- `es_basico = true` → nunca se sugiere.
- Todo lo demás → siempre se sugiere. Sin preguntas.
- Al cocinar, botón de "se me ha acabado" que pone `hay_en_casa = false`. Vuelve a `true` al marcarlo comprado.
- Si un mismo ingrediente se desmarca de la lista tres veces seguidas sin comprarlo, la app propone pasarlo a básico. Solo propone; no lo hace sola.

---

## 6. Sincronización

Cada fila lleva `updated_at` y `borrada`. **Nunca se borra en duro**: un borrado físico no puede sincronizarse a otro dispositivo.

**Bajada**: pedir filas con `updated_at > ultima_sync` de cada tabla.
**Subida**: enviar las filas locales con `pendiente = true` en la cola.
**Resolución**: gana el `updated_at` más alto, **fila a fila**, nunca por tabla ni por blob.

**Cuándo sincroniza**: al arrancar, al volver desde el multitarea (con margen de 30 s), y al guardar. Si falla, la cola queda pendiente y se reintenta. La UI nunca se bloquea esperando.

**Deriva de reloj**: dos móviles pueden ir desfasados unos segundos. Para una lista de la compra es irrelevante. Si algún día importa, usar `now()` del servidor en la escritura.

### Claves de Supabase — atención

Las claves nuevas (`sb_publishable_...`) **rechazan la cabecera `Authorization: Bearer`** porque no son un JWT; solo admiten `apikey`. Las antiguas (`anon`, empiezan por `eyJ`) admiten ambas, **pero quedan obsoletas a finales de 2026**. Usar las nuevas desde el principio y enviar solo `apikey`.

La clave y la URL las introduce el usuario en Ajustes y se guardan en cada dispositivo, como en calistenia. El repo es público y no contiene secretos.

### Seguridad

Una cuenta compartida (mismo correo y contraseña para los dos). RLS activo con una única política:

```sql
alter table recetas enable row level security;
create policy "acceso_autenticado" on recetas
  for all to authenticated using (true) with check (true);
```

Repetir en las cinco tablas. Nada de acceso anónimo: la clave publicable es visible en el código fuente, y sin sesión autenticada cualquiera podría escribir.

**Cambio de PostgREST**: los proyectos creados después del 30 de mayo de 2026 exigen `grant` explícitos de Postgres para el acceso vía API. Incluirlos en `supabase.sql` desde el principio.

---

## 7. Traspaso desde el chat

Formato de pegado en la v1. Un único bloque JSON con la receta y **cualquier ingrediente canónico nuevo que introduzca**:

```json
{
  "version": 1,
  "ingredientes_nuevos": [
    {
      "id": "pimienta_jamaica",
      "nombre": "Pimienta de Jamaica molida",
      "seccion": "Especias",
      "es_basico": false,
      "unidad_base": "g",
      "unidad_compra": "ud",
      "compra_min": 1,
      "equivalencias": { "tsp": 2, "tbsp": 6 },
      "alias": ["allspice", "pimienta dulce"]
    }
  ],
  "recetas": [ { "...": "objeto receta completo" } ]
}
```

La app valida, avisa de colisiones de `id` y muestra una vista previa antes de guardar. Si un `ing_id` referenciado no existe ni en la base ni en `ingredientes_nuevos`, se rechaza la importación entera en lugar de guardar una receta que la cesta no sabrá sumar.

**Aceptar tanto pegado como subida de archivo `.json`.** En el móvil, copiar cien líneas de un bloque de código es inviable.

Migración a escritura directa vía MCP cuando el esquema esté estable.

### 7.1 Reglas de slug — obligatorias

El fallo grave no es la colisión de `id`, que la app detecta. Es el **duplicado divergente**: generar `pollo_pechuga` cuando ya existe `pechuga_pollo`. No da error, y la cesta deja de sumar las dos recetas, pidiendo el doble de producto sin que nada avise.

Reglas deterministas para que el mismo ingrediente produzca siempre el mismo slug:

- Minúsculas, sin acentos ni `ñ`, separador guion bajo.
- **Singular** siempre: `tomate`, nunca `tomates`.
- **Sustantivo primero, modificador después**: `pechuga_pollo`, `pimienta_jamaica`, `aceite_oliva`.
- Sin artículos ni preposiciones: `pimienta_jamaica`, no `pimienta_de_jamaica`.
- Variedad separada solo si se compra por separado. `tomate` y `tomate_pera` sí; `tomate_maduro` no.

Ante la duda, la prueba es: *¿esto lo cojo de una estantería distinta?* Si no, es el mismo ingrediente.

### 7.2 Exportar vocabulario

Ajustes incluye **"Exportar vocabulario"**, que genera una lista compacta de los `ing_id` existentes con su nombre:

```json
{ "ajo": "Ajo", "pechuga_pollo": "Pechuga de pollo", "...": "..." }
```

Ese archivo vive en el conocimiento del proyecto de Claude y se actualiza de vez en cuando. Sin él, las reglas de slug ayudan pero no garantizan nada.

Complementariamente, al importar la app compara el `nombre` y los `alias` de cada ingrediente nuevo contra los existentes y **avisa si se parecen**, en lugar de crearlo en silencio.

---

## 8. Pantallas

1. **Recetas** — listado con buscador, filtro por etiqueta y favoritas.
2. **Receta** — ingredientes escalables por raciones, pasos con temporizador, botón "cocinada hoy" y "se me acabó".
3. **Menú** — selección de recetas con sus raciones. Es lo que alimenta la cesta.
4. **Cesta** — agrupada por sección, tachable, con añadido manual y contador de pendientes. Es la pantalla que se usa de pie y con una mano: objetivos grandes, sin diálogos de confirmación.
5. **Ajustes** — claves de Supabase, orden de secciones arrastrable, gestión de básicos y de huerto, importar (pegado o archivo), exportar copia completa y exportar vocabulario.

---

## 9. Flujo de publicación

**Claude no ejecuta `git`.** Al escribir en la carpeta montada de Windows, git deja ficheros de bloqueo que luego no puede borrar y el repositorio queda atascado. Ya ocurrió en calistenia.

El reparto es: Claude edita y verifica; el usuario ejecuta desde CMD:

```cmd
cd %USERPROFILE%\Documents\la-cesta
git add -A
git commit -m "mensaje"
git push
```

Incluir un `.gitattributes` con `* text=auto eol=lf` desde el primer commit. Sin él, cada cambio aparece como el fichero entero modificado por el conflicto CRLF.

GitHub Pages cachea unos 10 minutos: para ver el cambio antes, abrir la URL con un parámetro (`?v=2`).

---

## 10. Verificación

Mismo banco de pruebas que en calistenia: extraer el JavaScript del HTML y ejecutarlo en Node con un DOM simulado.

Casos que deben cubrirse sí o sí:

- Consolidación con unidades mixtas (dientes + cucharadas + gramos del mismo ingrediente)
- Escalado a raciones no enteras
- Redondeo por `compra_min`
- Básicos excluidos, y reincorporados cuando `hay_en_casa = false`
- Huerto dentro y fuera de temporada
- Regenerar la lista conservando lo ya tachado
- Sincronización con dos clientes tocando artículos distintos a la vez
- Sincronización con dos clientes tocando el mismo artículo (gana el más reciente)
- Borrado lógico propagándose
- Arranque sin conexión

No hay navegador en el entorno de ejecución. Para comprobar la maquetación real hay que usar Claude in Chrome contra la URL publicada; en calistenia eso destapó tres defectos que no se veían en el código.

---

## 11. Fases

**Fase 1 — Esqueleto.** `supabase.sql` con las cinco tablas, RLS, grants y datos semilla de secciones. `index.html` con Ajustes, sincronización y listado de recetas vacío. Objetivo: que sincronice antes de que haya nada que sincronizar.

**Fase 2 — Recetas.** Alta, edición, vista de cocina con escalado y temporizadores, importación por pegado. Cargar las dos recetas de pollo a la brasa como semilla real.

**Fase 3 — Cesta.** Menú, algoritmo de consolidación, agrupación por secciones, tachado.

**Fase 4 — Pulido.** Service Worker, orden de secciones arrastrable, despensa, huerto, Action de backup.

Cada fase debe quedar publicada y usable antes de empezar la siguiente.
