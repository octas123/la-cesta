-- ============================================================
-- La Cesta — esquema completo de Supabase
-- Ejecutar UNA VEZ en el SQL Editor del proyecto.
-- ============================================================
--
-- Nota sobre updated_at: lo escribe el CLIENTE, no un trigger.
-- Es deliberado. Si un móvil edita sin cobertura a las 10:00 y
-- sincroniza a las 10:30, esa marca debe seguir siendo las 10:00
-- para que un cambio posterior hecho desde el otro móvil gane.
-- Con un trigger de servidor, el que llega tarde pisaría al bueno.
-- El DEFAULT de abajo solo cubre inserciones manuales desde el panel.
--
-- ============================================================


-- ------------------------------------------------------------
-- 1. Ingredientes canónicos
-- ------------------------------------------------------------
create table if not exists ingredientes (
  id            text primary key,
  nombre        text not null,
  seccion       text not null,
  es_basico     boolean not null default false,
  hay_en_casa   boolean not null default true,
  del_huerto    boolean not null default false,
  meses         int[],
  unidad_base   text not null default 'g',       -- 'g' | 'ml' | 'ud'
  unidad_compra text not null default 'ud',
  compra_min    numeric,
  equivalencias jsonb not null default '{}'::jsonb,
  alias         text[] not null default '{}',
  updated_at    timestamptz not null default now(),
  borrada       boolean not null default false
);

create index if not exists ix_ingredientes_updated on ingredientes (updated_at);


-- ------------------------------------------------------------
-- 2. Recetas
-- ------------------------------------------------------------
create table if not exists recetas (
  id             uuid primary key default gen_random_uuid(),
  titulo         text not null,
  descripcion    text,
  raciones_base  int not null default 4,
  tiempo_prep    int,
  tiempo_coccion int,
  dificultad     text,
  etiquetas      text[] not null default '{}',
  fuente         jsonb not null default '{"tipo":"chat"}'::jsonb,
  ingredientes   jsonb not null default '[]'::jsonb,
  pasos          jsonb not null default '[]'::jsonb,
  notas          text,
  favorita       boolean not null default false,
  veces_cocinada int not null default 0,
  ultima_vez     date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  borrada        boolean not null default false
);

create index if not exists ix_recetas_updated on recetas (updated_at);


-- ------------------------------------------------------------
-- 3. Menú — recetas seleccionadas para la próxima compra
-- ------------------------------------------------------------
create table if not exists menu (
  id         uuid primary key default gen_random_uuid(),
  receta_id  uuid not null,
  raciones   int not null default 4,
  fecha      date,                       -- null en v1
  updated_at timestamptz not null default now(),
  borrada    boolean not null default false
);

create index if not exists ix_menu_updated on menu (updated_at);


-- ------------------------------------------------------------
-- 4. Lista — la cesta activa
-- ------------------------------------------------------------
-- UNA FILA POR ARTÍCULO. No es negociable: dos personas tachando
-- cosas distintas a la vez en el súper deben conservar ambos cambios.
create table if not exists lista (
  ing_id     text primary key,
  cantidad   numeric not null default 0,
  unidad     text not null default 'ud',
  texto      text not null,
  comprado   boolean not null default false,
  manual     boolean not null default false,
  opcional   boolean not null default false,
  origen     jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  borrada    boolean not null default false
);

create index if not exists ix_lista_updated on lista (updated_at);


-- ------------------------------------------------------------
-- 5. Secciones — recorrido del supermercado
-- ------------------------------------------------------------
create table if not exists secciones (
  id           uuid primary key default gen_random_uuid(),
  supermercado text not null default 'Mercadona',
  nombre       text not null,
  orden        int not null,
  updated_at   timestamptz not null default now(),
  borrada      boolean not null default false
);

create index if not exists ix_secciones_updated on secciones (updated_at);


-- ============================================================
-- SEGURIDAD
-- ============================================================
-- Cuenta compartida: cualquier usuario autenticado tiene acceso
-- total. La clave publicable es visible en el código fuente de
-- GitHub Pages, así que el acceso anónimo debe quedar cerrado.

alter table ingredientes enable row level security;
alter table recetas      enable row level security;
alter table menu         enable row level security;
alter table lista        enable row level security;
alter table secciones    enable row level security;

drop policy if exists acceso_autenticado on ingredientes;
drop policy if exists acceso_autenticado on recetas;
drop policy if exists acceso_autenticado on menu;
drop policy if exists acceso_autenticado on lista;
drop policy if exists acceso_autenticado on secciones;

create policy acceso_autenticado on ingredientes
  for all to authenticated using (true) with check (true);
create policy acceso_autenticado on recetas
  for all to authenticated using (true) with check (true);
create policy acceso_autenticado on menu
  for all to authenticated using (true) with check (true);
create policy acceso_autenticado on lista
  for all to authenticated using (true) with check (true);
create policy acceso_autenticado on secciones
  for all to authenticated using (true) with check (true);


-- ============================================================
-- PERMISOS EXPLÍCITOS DE POSTGREST
-- ============================================================
-- Obligatorio en proyectos creados después del 30/05/2026.
-- Sin esto, la API devuelve error de permisos aunque RLS esté bien.
-- A 'anon' se le da acceso al esquema pero NINGÚN permiso de tabla:
-- así el acceso sin sesión queda bloqueado de raíz.

grant usage on schema public to anon, authenticated;

grant select, insert, update, delete
  on ingredientes, recetas, menu, lista, secciones
  to authenticated;

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;


-- ============================================================
-- DATOS SEMILLA — secciones (recorrido por defecto)
-- ============================================================
-- Reordenables desde Ajustes. Este orden asume que lo pesado entra
-- primero y que huevos y pan no acaben aplastados al fondo.

insert into secciones (supermercado, nombre, orden) values
  ('Mercadona', 'Antes de salir',           1),
  ('Mercadona', 'Frutería',                 2),
  ('Mercadona', 'Panadería',                3),
  ('Mercadona', 'Charcutería y quesos',     4),
  ('Mercadona', 'Carnicería',               5),
  ('Mercadona', 'Pescadería',               6),
  ('Mercadona', 'Conservas y legumbres',    7),
  ('Mercadona', 'Pasta, arroz y harinas',   8),
  ('Mercadona', 'Aceites, vinagres y salsas', 9),
  ('Mercadona', 'Especias',                10),
  ('Mercadona', 'Desayuno y dulces',       11),
  ('Mercadona', 'Bebidas',                 12),
  ('Mercadona', 'Huevos y lácteos',        13),
  ('Mercadona', 'Congelados',              14),
  ('Mercadona', 'Droguería',               15)
on conflict do nothing;


-- ============================================================
-- DATOS SEMILLA — despensa básica
-- ============================================================
-- es_basico = true  →  nunca aparece en la cesta, salvo que se
-- marque hay_en_casa = false desde la app al acabarse.
--
-- AVISO SOBRE LAS EQUIVALENCIAS: son valores de partida razonables,
-- no medidas verificadas de tu cocina. Las de volumen a peso varían
-- bastante según la molienda y lo colmada que vaya la cuchara.
-- Si una cantidad te sale rara en la cesta, corrígela aquí.

insert into ingredientes
  (id, nombre, seccion, es_basico, unidad_base, unidad_compra, compra_min, equivalencias, alias) values

  ('aceite_oliva', 'Aceite de oliva virgen extra', 'Aceites, vinagres y salsas', true,
   'ml', 'l', 1, '{"tsp":5,"tbsp":15,"cup":240}', '{"aceite","AOVE"}'),

  ('vinagre', 'Vinagre', 'Aceites, vinagres y salsas', true,
   'ml', 'l', 1, '{"tsp":5,"tbsp":15}', '{}'),

  ('sal', 'Sal fina', 'Especias', true,
   'g', 'ud', 1, '{"tsp":6,"tbsp":18,"pinch":0.4}', '{"sal de mesa"}'),

  ('sal_gruesa', 'Sal gruesa', 'Especias', true,
   'g', 'ud', 1, '{"tsp":5,"tbsp":15}', '{"sal marina"}'),

  ('pimienta_negra', 'Pimienta negra', 'Especias', true,
   'g', 'ud', 1, '{"tsp":2,"tbsp":6}', '{}'),

  ('pimenton', 'Pimentón', 'Especias', true,
   'g', 'ud', 1, '{"tsp":2,"tbsp":6}', '{"pimentón dulce","pimentón de La Vera"}'),

  ('oregano', 'Orégano seco', 'Especias', true,
   'g', 'ud', 1, '{"tsp":1,"tbsp":3}', '{}'),

  ('comino', 'Comino molido', 'Especias', true,
   'g', 'ud', 1, '{"tsp":2,"tbsp":6}', '{}'),

  ('canela', 'Canela molida', 'Especias', true,
   'g', 'ud', 1, '{"tsp":2,"tbsp":6}', '{}'),

  ('laurel', 'Laurel', 'Especias', true,
   'ud', 'ud', 1, '{}', '{"hoja de laurel"}'),

  ('azucar', 'Azúcar', 'Desayuno y dulces', true,
   'g', 'kg', 1, '{"tsp":4,"tbsp":12,"cup":200}', '{}'),

  ('harina', 'Harina de trigo', 'Pasta, arroz y harinas', true,
   'g', 'kg', 1, '{"tsp":3,"tbsp":8,"cup":120}', '{}'),

  ('arroz', 'Arroz', 'Pasta, arroz y harinas', true,
   'g', 'kg', 1, '{"cup":185}', '{}'),

  ('ajo', 'Ajo', 'Frutería', true,
   'g', 'ud', 40, '{"diente":4,"cabeza":45,"tsp":3,"tbsp":9}', '{"ajos"}'),

  ('cebolla', 'Cebolla', 'Frutería', true,
   'g', 'kg', 150, '{"ud":150}', '{"cebollas"}')

on conflict (id) do nothing;


-- ============================================================
-- COMPROBACIÓN
-- ============================================================
-- Debe devolver 15 secciones y 15 ingredientes básicos.
select
  (select count(*) from secciones)    as secciones,
  (select count(*) from ingredientes) as ingredientes;
