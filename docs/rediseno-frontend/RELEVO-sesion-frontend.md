# Relevo — sesión de rediseño del frontend (para la próxima sesión)

> Escrito el 20/10/2026 al cerrar la sesión. Leelo entero antes de tocar nada.
> Las memorias de `C:\Users\INTEL PC1\.claude\projects\C--Users-INTEL-PC1-Desktop-gmv2-nuevo\memory\`
> siguen valiendo; las más importantes para este trabajo son `rediseno-frontend-estado.md`,
> `rediseno-solo-frontend.md`, `bash-heredoc-windows.md`, `db-readonly-conexion.md` y `feedback-idioma-espanol.md`.

## 1. Quién sos y cómo hablarle al dueño

- Sos el **diseñador del frontend** del ERP de Megasur. Tu objetivo es que el sistema sea **fácil, intuitivo y práctico** para gente que no es técnica (administrativos, finanzas, depósito), en la PC y en el celular.
- El dueño es **Juan** (Juan Cruz Rossi). **Siempre** dirigite a él como **"Juan"** en algún momento de cada respuesta (está en `CLAUDE.md`).
- **Siempre en español rioplatense.** Nunca en inglés, ni siquiera después de una compactación.
- Juan **no programa**. Explicale en palabras simples qué cambió, qué tiene que probar y qué tiene que decidir. Nada de nombres de archivos ni jerga en lo que le decís, salvo que lo pida.
- Le gusta: pantallas limpias, **poco texto**, nada de "ayudas" fijas que molestan todos los días (si hace falta explicar algo, que sea un globito al pasar el mouse), información de un vistazo, que todo entre al 100 % de zoom.
- Le molesta: pantallas grandes con mucho espacio, tarjetas y chips por todos lados, texto "tipo Word", que se pierdan funciones al reorganizar.
- Forma de trabajo que funciona con él:
  1. relevás la pantalla (código + datos reales) y le proponés qué cambiarías, por prioridad;
  2. si es algo grande o nuevo, le armás una **maqueta HTML** (`docs/rediseno-frontend/maquetas/`) y se la mandás;
  3. él decide y vos construís;
  4. le pasás el **preview de Vercel** y le decís honestamente qué viste y qué no pudiste ver;
  5. **solo con su OK explícito** ("pasalo a main", "sí, pasalo") se pasa a producción.
- Cuando dice "pasalo a producción directamente", vale para ESE cambio, no para los siguientes.

## 2. Reglas que no se rompen

- **Solo frontend.** No cambiar cálculos de precios ni lógica de negocio. El precio base y el contado vienen de la importación de artículos. Si algo necesita lógica nueva, proponelo y esperá el OK.
- **No duplicar funciones** y **no perder ninguna** al reorganizar: antes de sacar o borrar una pantalla, hacé el inventario de lo que hace y mostrale a Juan adónde fue a parar cada cosa.
- **Nunca borrar pantallas sin OK.** Las que no se usan se sacan del menú y se borran cuando él dice.
- **Comprobantes fiscales: no se tocan nunca.** Artículos, proveedores y clientes son datos reales. Todo lo demás de la base es dato de prueba.
- **Formatos** (`docs/FORMATOS.md`, obligatorio): fechas `dd/mm/aaaa`, plata `$1.000,32`, CUIT `xx-xxxxxxxx-x`. Solo los helpers de `lib/formato` (`fecha`, `moneda`, `hoyISO`, `sumarDiasISO`, `parseMonto`…) y los inputs `InputMonto`, `DateInputAR`/`FechaInput`, `InputCUIT`. Prohibido `type="number"`, `type="date"`, `toLocaleString`, `toFixed` en pantalla.
- **Antes de cada commit:** `node scripts/typecheck-movil.mjs` (incluye el control de formatos). Todo archivo nuevo se agrega a `scripts/typecheck-movil.alcance.json`. Además, `next build` completo antes de pasar a main.
- **No ingresar contraseñas.** Juan inicia sesión él mismo en el navegador.
- **No pushear a main sin OK.** Antes de pasar a main: traer lo último de main (otras sesiones suben cosas todo el tiempo), resolver los choques, typecheck + build, y recién ahí pushear.

## 3. Cómo se trabaja en esta máquina (trampas conocidas)

- **Worktree del rediseño:** `C:\Users\INTEL PC1\Desktop\gmv2-frontend`. Para cada trabajo, una rama nueva desde `origin/main` (`git checkout -B <rama> origin/main`). La carpeta `gmv2-nuevo` es la de Juan: no se toca.
- `node_modules` del worktree son **junctions** a gmv2-nuevo: **nunca** borrarlos.
- **Build:** `node node_modules/next/dist/bin/next build --webpack`. Si falla con `WasmHash ... reading 'length'`, es la caché de webpack: `rm -rf .next/cache` y volver a compilar.
- **Dev server:** debe correr con cwd = worktree, si no Tailwind no ve las clases. Configuración `erp-rediseno` en `gmv2-nuevo/.claude/launch.json` (puerto 3100), que usa `scratchpad/run-next-rediseno.cjs` (si el scratchpad se borró, recrearlo: un `spawn` de `next dev --webpack -p 3100` con cwd del worktree).
- **Bash en Windows:** heredocs con apóstrofes se rompen. Para editar, escribí un script `.mjs` con Write en el scratchpad y corrélo con node, normalizando `\r\n` → `\n` y volviendo a CRLF al guardar. El tool Edit preserva CRLF.
- **Base de solo lectura:** usuario del pooler `claude_readonly.<project ref>`; script `scratchpad/db.mjs` con `pg` de `%APPDATA%/npm/node_modules/pg`. Para probar consultas como el servidor: supabase-js con la service key de `.env.local`, **solo SELECT**.
- **Preview de Vercel:** se saca con la API pública de GitHub (`/repos/KingitA/gmv2/deployments?sha=…` → statuses → `environment_url`). No hay `gh` ni `vercel` CLI. Cada preview pide login (lo hace Juan).
- **Navegador:** Claude in Chrome a veces está en otra PC, minimizado o con la pestaña en segundo plano (las capturas fallan o el layout mide 0). `get_page_text` suele funcionar igual. Si no podés ver la pantalla, decíselo a Juan y pedile que la mire.

## 4. De qué trata el sistema

ERP de **Megasur** (Compañía de Higiene Total SRL, Bahía Blanca): distribuidora mayorista de perfumería, limpieza y bazar. Next.js 16 + React 19 + Tailwind 4 + Supabase, desplegado en Vercel. Además del ERP web hay apps (vendedor, chofer y depósito) en `mobile/`, y un "cerebro" de IA (**Jarvis/Megasur**) en Playroom, que lo hace otra sesión.

**Navegación (rediseño ya en producción):** pestañas arriba (Clientes, Proveedores, Artículos, Finanzas, Playroom, Ajustes), cada una con sus accesos debajo (`lib/navegacion.ts`). La paleta Megasur está en `app/megasur-tema.css` (familias azul, cian, ámbar, éxito, alerta, error y neutro), con letra Archivo. Las esperas se muestran con una **barra con mensajes** (`CargaProgreso`), nunca con un redondel.

## 5. Lo que hicimos (todo en producción)

- **Rediseño base:** pestañas, estilo Megasur, URL real en cada vista, modales arreglados, actualización en vivo (Realtime) y barras de carga.
- **Clientes:**
  - Pedidos y viajes: calendario semana/mes, filtros, selección con sumas, arrastre a días o viajes y pedidos sueltos.
  - **Ficha de cliente por secciones**, con "Nuevo cliente" en la misma ficha y la segmentación por proveedor o marca dentro del cuadro de lista y descuentos.
  - **Cobros**, la pantalla donde la oficina ingresa un cobro, que queda pendiente hasta que Finanzas lo confirma en Caja.
  - La lista de clientes ancha, sin cortes.
- **Proveedores:** Pagos y vencimientos (calendario con arrastre y OP); ahora **solo pagos a proveedores**.
- **Artículos:**
  - Tabla de ancho fijo, que no se pisa con el zoom.
  - Precios con formato, letra legible y vista guardada por usuario.
  - La ficha ya no se cae con nombres vacíos en los catálogos.
  - **IVA C. / IVA V. se dejan con +, ½ y 0**: decisión de Juan, no cambiarlo.
- **Playroom:**
  - Tablero de tarjetas a elección, con catálogo de 22 indicadores.
  - Megasur siempre abierto al costado, con "Fijar en el tablero".
  - Informes en claro e informe **Preparación por empleado**.
  - El cerebro lo hace otra sesión, con el contrato `docs/rediseno-frontend/PEDIDO-agente-cerebro-playroom.md` y `lib/playroom/bloques.ts`.
- **Finanzas (lo último, 20/10, en main b5a55ae):**
  - **Panel:**
    - Encabezado en una línea, con el aviso de cobros por verificar en Caja.
    - 4 tarjetas de saldos: efectivo, bancos, cheques al día/30/31-60/+60 y bolsa. El saldo se cambia tocándolo (queda quién, cuándo y por qué).
    - "Ver gráfico" con la evolución de saldos.
    - Calendario de pagos de la semana con un solo botón **"Filtros"** (tipo, forma de pago, etc.) y al costado **solo los atrasados**.
    - "¿Llego a pagar?" en 3 cuadros; suma la plata por rendir como entrada de efectivo.
  - **Cheques:**
    - Resumen blanco/negro/echeq por vencimiento.
    - Filtros completos.
    - **Carga manual** (`POST /api/cheques/manual`, con origen), que es la novedad.
    - Importar Excel igual que antes, y cheque propio emitido.
    - Depositar, acreditar, rechazar y debitado.
  - **Menú de Finanzas:** Panel, Caja del día, Cheques, Conciliación, Cierre de caja, Cuentas, Control de cuentas corrientes y Tablero de tesorería.

## 6. Pendiente

1. **Borrar pantallas que ya no se usan** (están fuera del menú; esperar el OK de Juan):
   - `/finanzas/pendiente-rendir` (Rendiciones): Caja ya hace todo lo suyo: cotejar, rechazar, confirmar, segunda firma e historial en "Por rendir".
   - `/finanzas/egresos` y `/finanzas/bancos`: están vacías ("en desarrollo").
2. **Conciliación bancaria:** rehacerla "con captura de pantalla nomás", en una sesión aparte (Juan lo pidió así).
3. **Celular cómodo en todas las pantallas:** sesión aparte. Por ejemplo, Artículos como tarjetas en el teléfono.
4. **Tablero de tesorería:** sigue en el menú porque tiene datos que no están en otro lado (antigüedad de deuda, últimos cierres, costo de cheques). En algún momento, decidir con Juan si eso pasa al Panel o a Playroom.
5. **Subcategoría sin nombre** en Ajustes → Categorías → LIMPIEZA DE PISOS: Juan tiene que borrarla o nombrarla. La ficha ya no se cae, pero el dato está sucio.
6. **Playroom:** cuando la sesión del cerebro avise que terminó `/api/playroom/resumen-del-dia`, `/api/playroom/novedades` y `/api/playroom/recalcular`, conectar lo que haga falta y probar juntos.
7. **Datos que hay que saber:**
   - La cartera de cheques y las rendiciones casi no tienen uso real todavía.
   - El margen bruto da alto porque a muchos artículos les falta el costo.
   - El stock casi no está cargado.
   - Los montos de Bancos que dan negativo en "¿Llego a pagar?" **están bien cargados** (Juan lo confirmó).
