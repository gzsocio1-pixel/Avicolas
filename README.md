# Control de Galeras

Panel de control avícola: parvadas, pesos y mortalidad por galera (con descarte y muerte natural),
reporte semanal, cierre y liquidación Cargill en córdobas (revisada contra las tablas de pago y el banco),
costos por parvada, facturas de energía, detalle de pagos, flujo mensual, resultados anuales e importación desde Excel.

Funciona con **Node.js** y guarda los datos en **PostgreSQL**. Cada persona entra con su usuario
y contraseña.

---

## Guía rápida: de GitHub a Render

### Paso 1. Subir el proyecto a GitHub (una sola vez)

1. Entra a <https://github.com> e inicia sesión (o crea una cuenta).
2. Arriba a la derecha toca **+** → **New repository**.
3. Nombre: `control-de-galeras`. Marca **Private** (privado). Toca **Create repository**.
4. En la página que aparece, toca el enlace **uploading an existing file**.
5. Descomprime el archivo `control-de-galeras.zip` en tu computadora. Abre la carpeta y
   **arrastra todo su contenido** (archivos y carpetas `lib`, `public`, `scripts`) a la página de GitHub.
6. Abajo toca **Commit changes**.

> **No subas a GitHub** el archivo de respaldo (`respaldo-control-de-galeras.json`): tiene tus datos
> de dinero. Ese archivo se carga después, directamente en el panel.

### Paso 2. Publicarlo en Render (una sola vez)

1. Entra a <https://render.com> y crea tu cuenta **con el botón de GitHub**.
2. En Render toca **New** → **Blueprint**.
3. Elige el repositorio `control-de-galeras` y toca **Connect**.
4. Render lee el archivo `render.yaml` y te pide dos datos:
   - **ADMIN_USER**: tu usuario, por ejemplo `juancarlos`.
   - **ADMIN_PASSWORD**: una contraseña de 8 caracteres o más.
5. Toca **Apply**. Render crea la base de datos y el sitio. Tarda unos 5 minutos.
6. Cuando diga **Live**, abre el enlace que termina en `.onrender.com`.

### Paso 3. Cargar tus datos

1. Entra con el usuario y contraseña del paso anterior.
2. Toca **Usuarios** (arriba a la derecha) → **Restaurar desde respaldo…**
3. Elige el archivo `respaldo-control-de-galeras.json`. En segundos aparecen tus 31 parvadas,
   pagos, costos y flujo mensual.

### Paso 4. Agregar a tu equipo

En **Usuarios** → **Agregar usuario**. Hay tres permisos:

| Permiso | Qué puede hacer |
|---|---|
| Administrador | Todo, más manejar usuarios y respaldos |
| Editor | Ver, capturar semanas, cierres, pagos e importar Excel |
| Solo lectura | Solo ver el panel |

Entrega la contraseña inicial y pide que cada quien la cambie en **Mi cuenta**.
En **Usuarios** también ves quién cambió qué y cuándo.

---

## Actualizar a una versión nueva (si ya lo tienes en Render)

1. En GitHub abre tu repositorio `control-de-galeras` y toca **Add file** → **Upload files**.
2. Arrastra el contenido del zip nuevo (archivos y carpetas). GitHub reemplaza los que tengan el mismo nombre.
3. Toca **Commit changes**. Render publica la versión nueva solo, en unos 3 a 5 minutos.
4. Entra al panel → **Usuarios** → **Restaurar desde respaldo…** y elige el respaldo nuevo
   (`respaldo-control-de-galeras.json`). Así cargas las liquidaciones, facturas de energía y semanas nuevas.
   Restaurar reemplaza los documentos que trae el respaldo y no borra los demás.

## Uso diario

- **Actualizar con Excel:** pestaña **Importar Excel**. Sube el Comparativo y/o el Flujo ASI,
  revisa la lista de cambios y toca **Guardar**.
- **Respaldo:** una vez al mes, en **Usuarios** → **Descargar respaldo**. Guárdalo fuera de GitHub.
- **Cambios al programa:** si alguien modifica los archivos en GitHub, Render publica la nueva
  versión solo, en unos minutos. Tus datos no se tocan: viven en la base de datos.
- **Olvidé mi contraseña de administrador:** en Render abre el servicio → **Shell** y escribe
  `npm run crear-admin -- juancarlos "nueva-contraseña-larga"`.

## Costos aproximados en Render

| Parte | Plan | Precio aproximado |
|---|---|---|
| Base de datos PostgreSQL | basic-256mb | unos US$6–7 al mes |
| Sitio web | free | US$0 (se duerme tras 15 minutos sin uso; la primera carga tarda ~1 minuto) |
| Sitio web | starter | unos US$7 al mes (siempre encendido) |

Para cambiar el plan del sitio: en Render → el servicio → **Settings** → **Instance Type**.
Revisa los precios vigentes en <https://render.com/pricing>.

---

## Para el equipo técnico

- Requiere Node.js 18 o más reciente. Única dependencia: `pg`.
- `npm install` y luego `npm start`. Sin `DATABASE_URL`, guarda los datos en `data/datos-locales.json`
  (solo para pruebas).
- Variables: `DATABASE_URL`, `SESSION_SECRET`, `ADMIN_USER`, `ADMIN_PASSWORD`, `PORT` (Render la pone sola).
  Ver `.env.example`.
- Tablas (se crean solas al iniciar): `docs` (colección, id, datos JSON), `users`, `changes` (bitácora), `meta`.
- Colecciones: `flocks` (parvadas), `years` (resultado anual), `payments` (pagos por mes),
  `cashflow` (flujo mensual), `energy` (facturas de energía).
- `public/index.html` es el panel; `public/shim.js` lo conecta con la API (`/api/data`, `/api/doc/…`,
  `/api/batch`, `/api/admin/…`).
- El lector de Excel funciona dentro del navegador, sin librerías externas.
- Contraseñas con scrypt; sesión en cookie firmada (HttpOnly, 14 días). Cambiar la contraseña cierra
  las sesiones anteriores.
