# La Cesta — reglas del proyecto

App de recetas y lista de la compra para dos personas.
La especificación completa está en `la-cesta-especificacion.md`. **Léela antes de escribir código.**

---

## Reglas permanentes

### No ejecutar git

Nunca. Ni `add`, ni `commit`, ni `push`, ni `status`.

Al escribir en esta carpeta montada de Windows, git crea ficheros de bloqueo
(`.git/HEAD.lock`, `.git/index.lock`) que luego no se pueden borrar por permisos,
y el repositorio queda atascado. Ya ocurrió una vez en el proyecto de calistenia.

El reparto es: Claude edita y verifica, el usuario publica desde CMD.

### No tocar supabase.sql

Ya está ejecutado y verificado contra el proyecto real de Supabase.
Si el esquema necesitara cambiar, proponer el SQL de migración en la conversación
y esperar a que el usuario lo ejecute. Nunca darlo por aplicado.

### Un solo fichero

Toda la app vive en `index.html`: CSS, HTML y un bloque `<script>`.
Sin dependencias externas, sin paso de compilación, sin gestor de paquetes.

### Parar al final de cada fase

Las fases están en la sección 11 de la especificación. Al terminar una, parar y
avisar. No empezar la siguiente sin que el usuario lo pida.

---

## Detalles técnicos que ya han causado problemas

**Cabeceras de Supabase.** La clave publicable (`sb_publishable_...`) no es un JWT
y va **solo** en la cabecera `apikey`. Ponerla en `Authorization: Bearer` provoca
un rechazo. En `Authorization` va el token de sesión del usuario tras el login,
que sí es un JWT.

**URL del proyecto.** Se guarda como base (`https://xxxxx.supabase.co`), sin
`/rest/v1` ni barra final. La app la limpia al guardarla, porque la autenticación
cuelga de `/auth/v1/` y no de `/rest/v1/`.

**Secciones.** Consultar siempre ordenando por `orden, nombre`. Solo por `orden`
deja el desempate indefinido y los dos móviles pintarían la lista en distinto orden.

**Sincronización fila a fila.** Nunca por blob ni por tabla. Dos personas tachando
artículos distintos a la vez en el súper deben conservar ambos cambios.

**`updated_at` lo escribe el cliente**, no un trigger. Un cambio hecho sin cobertura
debe conservar su marca original para que un cambio posterior desde el otro móvil gane.

**`.gitattributes`** contiene `* text=auto eol=lf`. No quitarlo: sin él, cada cambio
aparece como el fichero entero modificado por el conflicto CRLF entre Windows y Linux.

---

## Verificación

No hay navegador en el entorno de ejecución. Para comprobar la lógica, extraer el
JavaScript del HTML y ejecutarlo en Node con un DOM simulado:

```bash
python3 -c "
src = open('index.html', encoding='utf-8').read()
js = src.split('<script>',1)[1].rsplit('</script>',1)[0]
open('/tmp/app.js','w',encoding='utf-8').write(js)"
node --check /tmp/app.js
```

Para ver la maquetación real hace falta Claude in Chrome contra la URL publicada.
En calistenia eso destapó tres defectos que no se veían leyendo el código.

---

## Publicación (la hace el usuario)

```cmd
cd %USERPROFILE%\Documents\la-cesta
git add -A
git commit -m "mensaje"
git push
```

GitHub Pages cachea unos 10 minutos. Para ver el cambio antes, abrir la URL con
un parámetro cualquiera: `https://octas123.github.io/la-cesta/?v=2`
