# Estado consolidado del sistema — 19/10/2026

Relevamiento de todas las carpetas `gmv2-*` del escritorio, de las ramas de GitHub y de la base de producción (consulta de solo lectura). Este documento junta en un solo lugar qué está hecho, qué quedó pendiente y dónde está cada cosa.

El traspaso para los agentes de las apps está en [`docs/PENDIENTES-APPS.md`](PENDIENTES-APPS.md).

---

## 1. Cómo están armadas las carpetas (lo más importante)

Las carpetas del escritorio **no son copias separadas**, salvo una. Siete son *worktrees*: ventanas distintas al **mismo** repositorio, que vive en `gmv2-nuevo`. Cada una muestra una rama distinta, pero todos los commits van al mismo lugar y a GitHub.

| Carpeta | Qué es | Rama que muestra | ¿Tiene algo que no esté en `main`? |
|---|---|---|---|
| `gmv2-nuevo` | Repositorio principal | `main` (actualizado a GitHub, 8d572ae) | No |
| `gmv2-vendedor` | Worktree de gmv2-nuevo | `apk-vendedor` | No (todo mergeado) |
| `gmv2-chofer` | Worktree de gmv2-nuevo | `apk-chofer` | No |
| `gmv2-busquedas` | Worktree de gmv2-nuevo | `mobile-md-formatos` | No |
| `gmv2-frontend` | Worktree de gmv2-nuevo | `fix-ficha-articulo` | No |
| `gmv2-viajes` | Worktree de gmv2-nuevo | `viajes-calendario-mes` | No |
| `gmv2-cerebro` | Worktree de gmv2-nuevo | `jarvis-calendario` | No |
| `gmv2-cc` | Worktree de gmv2-nuevo | `cuentas-corrientes-auditoria` | No (es el mismo commit que `main`) |
| `gmv2-clone` | Copia **independiente** y vieja (09/06/2026) | `main` de junio | No: su último commit ya está en `main` |

Resultado:
- **No se perdió código.** Todas las ramas de GitHub están mergeadas en `main`.
- Ninguna carpeta tiene cambios sin guardar (solo archivos de configuración local `.claude/`).
- Todos los `.md` (MOBILE.md, docs/…) ya están en `main`. El problema real no es que haya varias copias, sino que la información quedó **repartida en muchos documentos** y algunos tienen renglones desactualizados (ver §5).

### Cosas sueltas que encontré

1. **Rama local `apk-deposito`** (solo en esta PC, nunca subida): tiene un commit del 21/09, "CAJA: sobrante en el cobro". **Ya está en `main`** con otro número (8c7d3f1). No hay que hacer nada; se puede borrar la rama cuando quieras.
2. **Cambio guardado aparte (stash) del 26/08** en gmv2-nuevo: cambia la zona de 2 localidades en `20260724_curacion_localidades_v3.sql` (GONZALES CHAVES: JUAREZ → NECOCHEA; VILLALONGA: VIEDMA-PATAGONES → VILLARINO). Nunca se aplicó. **Decisión tuya**: si esas zonas están bien hoy en el sistema, se descarta.
3. **`gmv2-clone`** tiene 4 scripts sueltos (`db-analysis*.js`) con **la contraseña de la base escrita adentro** en texto plano. No están en GitHub (bien), pero conviene borrar esa carpeta entera: está vieja y no aporta nada.
4. En `gmv2-nuevo` hay archivos tuyos sin subir: `docs/marca/`, `tablero-pagos-caja-v6.html`, PDFs y TXT de retenciones de ganancias, y tu agregado a `CLAUDE.md` (lo de llamarte Juan). No los toqué.

---

## 2. Qué está en producción (`main`) — por área

| Área | Estado | Último hito |
|---|---|---|
| Fundación de las apps (motor offline, precios, login de equipos) | En main y validada | 18/09 |
| App Depósito | En main; APK **v0.2.3** (22/09) en el NuStar | Mes de prueba |
| App Vendedor | En main; APK **v0.3.1** (14/10) en el NuStar | Freije probando |
| App Chofer | En main; APK **v0.2.2** (01/10) en el NuStar | Pasada final superada 01/10 |
| Viajes / hoja de ruta / calendario del mes | En main | 15/10 |
| Cheques: foto + OCR + BCRA | En main; ya va en la APK vendedor 0.3.0+ | 23/09 |
| Precios y descuentos (condiciones congeladas, contado, mercadería por cupo) | En main | 07/10 |
| Rediseño del ERP (Cobros, Caja, Clientes, Artículos, Playroom) | En main | 09/10 |
| Búsquedas y filtros | En main | 09/10 |
| Formatos fecha / moneda / CUIT + códigos únicos | En main | 14/10 |
| Jarvis (cerebro de Playroom) + calendario de viajes | En main | 15/10 |
| Cuentas corrientes, etapas 1 a 4 | En main | 19/10 |
| Selección/exportación del extracto de cuenta corriente | En main | 19/10 |
| Artículos dados de baja: matching sin bajas, reactivar desde Artículos/Depósito, historial de quién | En main (570cc2c); app Depósito falta APK | 20/10 |

---

## 3. Migraciones de Supabase — verificadas contra la base

Revisé las 191 migraciones de `supabase/migrations/` buscando en la base los objetos que crea cada una (tablas, columnas, funciones, índices, triggers).

**Aplicadas:** todas las de septiembre y octubre, incluidas las de apps, viajes, formatos, códigos, Jarvis, calendario y cuentas corrientes 1 a 4. Las que solo cambian datos también dejaron rastro (por ejemplo, `20261009b` unificó las subcategorías y `20261019b` dejó 17 cuentas de empleado marcadas y 13 vendedores vinculados).

**NO aplicadas (2, de agosto):**

| Migración | Qué hace | ¿Importa? |
|---|---|---|
| `20260827_picking_preparadores.sql` | Índice que impide que **dos personas preparen el mismo renglón** a la vez (y otros 2 índices). | **Sí.** El código de depósito (web y APK) cuenta con ese índice para frenar el doble picking ("Ya lo preparó X"). Hoy esa traba en la base no existe; solo está la del código. **Aplicarla.** Antes de aplicarla, correr el control de abajo. |
| `20260826_v_articulos_ventas.sql` | Vista con las ventas de cada artículo en 180 días. | Menor. La app vendedor ordena por "más vendidos" con esto; sin la vista, ese orden queda neutro (no rompe nada). Aplicarla cuando quieras. |

Control antes de aplicar `20260827_picking_preparadores.sql` (si devuelve filas, avisame antes de aplicar, porque el índice fallaría):

```sql
select pedido_detalle_id, count(*) from picking_items
group by 1 having count(*) > 1;
```

**Aplicada y verificada (20/10, cuentas corrientes):** `20261020b_cheques_un_papel.sql`. Agrega el estado de cheque EN_VERIFICACION, los triggers de "un cheque = un papel" y el nuevo `cheque_rechazar`. Aplicarla **antes** de desplegar el código de esa fecha: el código del servidor ya crea el cheque compartido.

**Aplicadas y verificadas (20/10, artículos dados de baja):** `20261020_pedidos_articulo_real.sql` (pedido 001831 pasó de "062216" dado de baja a "62216") y `20261020b_articulos_bajas.sql` (tabla `articulos_estado_historial`, RPC `articulo_cambiar_estado`, trigger `trg_articulos_estado_historial` y `match_articulos` solo activos).

**Instalada pero sin ejecutar (a propósito):** `20261020_cc_puesta_a_cero.sql`. Deja listas las funciones de puesta a cero de cuentas corrientes; **no borra nada sola**. Se ejecuta el día del corte (ver §4).

**Instaladas a medias por diseño (no hay que hacer nada):** `20260427_kardex_precio_bruto` (columna que el sistema no usa), `20260515_kardex_v3_reorder` y `20260730_comisiones_kardex_sync` (reemplazadas por migraciones posteriores).

**Nunca volver a correr:** `20260811_reset_datos_prueba.sql` y `20260811_fix_billetera_fantasma.sql` (borran o corrigen datos de una vez).

---

## 4. Pendientes por área

### Para vos (decisiones o acciones)
1. Aplicar `20260827_picking_preparadores.sql` (con el control de arriba) y, si querés, `20260826_v_articulos_ventas.sql`.
2. **Fecha de corte de cuentas corrientes.** Ese día, en orden: `SELECT * FROM cc_puesta_a_cero_simulacro();` → `SELECT cc_puesta_a_cero('PONER A CERO');` → cargar la apertura en `/apertura` → saldos de caja y bancos → `/personal` "Poner al día". Las comisiones de comprobantes viejos se liquidan en el sistema viejo.
3. ~~Vincular cuentas del personal~~ **Hecho 19/10**: las 17 cuentas quedaron vinculadas (`20261019b`, más Gabriel Aman en el cliente 8); Pereyra Horacio quedó inactivo. Ningún vendedor con comisión ni ningún chofer o empleado de depósito queda sin cuenta.
4. Decidir el stash de localidades (§1, punto 2).
5. Rediseño, decisiones abiertas: ¿un solo botón de guardar en la ficha de cliente? ¿borrar el Dashboard viejo? OK para borrar "Revisión de pagos" y "Cobranza nueva".
6. CUIT con dígito inválido a corregir a mano: MAXIKIOSCO GUIDI, WALE'S, SEBILLE (proveedor), un cheque.
7. Jarvis: verificar que `CRON_SECRET` exista en Vercel (si no, la revisión de las 8:00 no corre); clasificar el resto del catálogo con el botón (≈ USD 0,12); revisar la parada de Li Yutao del viaje ALTO VALLE 16/10 ("cobrar lo anterior" marcado).
8. Depósito, tarea aparte: depurar ~1.189 pedidos `impreso` viejos (hay propuesta escrita en MOBILE.md §17; no se toca sin tu OK).

### Correcciones de servidor
Las tres primeras las hizo la sesión de cuentas corrientes el 20/10. Están en `main` y la migración `20261020b_cheques_un_papel.sql` está aplicada:
1. ~~Un cheque = un papel~~ **Hecho.** El cobro conjunto del chofer y el cobro a varios clientes del vendedor dejan UNA fila en cartera por el total (`lib/cobranzas/cheque-compartido.ts`); cada cliente tiene su parte vinculada. Las billeteras y la hoja de ruta cuentan ese cheque una sola vez. Si rebota, la nota de débito va entera al cliente que lo entregó.
2. ~~Riesgo de cobro doble en la app chofer~~ **Hecho en el servidor.** La cuenta de cobro del chofer trae `en_cobro` por comprobante (`lib/cobranzas/en-cobro.ts`, misma fórmula que el vendedor). La APK actual ya lo usa: no hace falta compilar para esto.
3. ~~Cheques de cobros pendientes en cartera / anular cheque compartido~~ **Hecho.** El cheque de un cobro sin confirmar queda EN_VERIFICACION (fuera de cartera y de la proyección de caja; pestaña "En verificación" en Cheques) y pasa a EN_CARTERA al confirmarse. Anular el cobro de un cliente no anula un cheque que otro sigue usando. La cabecera `cobranzas` queda anulada cuando se anulan todos sus pagos.
4. Seguridad: `ai_emails`, `ai_email_attachments` y `ai_classifications` tienen acceso público total. Arreglar cuando se retome el lector de mails.
5. Pantalla de administración de equipos (`mobile_dispositivos`, revocar) y de alertas de integridad.

### Ya resuelto (aparecía como pendiente en notas viejas)
- Bug de `cobranza_anular` que anulaba el 10 % de otro pago: corregido en la v7 (01/10, aplicada).
- Barrido de fechas `type="date"` del ERP: hecho dentro de Formatos (14/10).
- Foto de cheques en la APK vendedor: incluida desde la v0.3.0.
- Migraciones de formatos, códigos, búsquedas, realtime, en_revisión, Jarvis y calendario: todas aplicadas.

---

## 5. Documentación: dónde está cada cosa

| Documento | Para qué | Estado |
|---|---|---|
| `CLAUDE.md` | Reglas generales para cualquier agente | Al día |
| `MOBILE.md` | Fuente de verdad de las 3 apps (motor offline, precios, build) | Al día; corregí hoy 3 renglones viejos (§10 migración de depósito, §15 estado del chofer, §18 cheques) |
| `docs/PENDIENTES-APPS.md` | **Nuevo**: lo que cada agente de app tiene que hacer ahora | Nuevo |
| `docs/CUENTAS-CORRIENTES-APPS.md` | Cambios de cuentas corrientes que tocan las apps (detalle técnico) | Al día |
| `docs/AUDITORIA-CUENTAS-CORRIENTES.md` | Hallazgos y reglas tuyas de cuentas corrientes | Al día |
| `docs/FORMATOS.md` | Reglas de fecha, moneda y CUIT | Al día |
| `docs/playroom-cerebro/BITACORA.md` | Diario y pendientes de Jarvis | Al día |
| `docs/rediseno-frontend/PLAN.md`, `CHECKLIST.md` | Rediseño del ERP y decisiones abiertas | Al día |
| `mobile/apps/*/CHANGELOG.md` | Historial de versiones de cada APK | Al día |
| `PLAN_FIXES_*.md`, `*_CRM*.md` (raíz) | Planes de marzo–junio | **Viejos**: sirven como historia, no como guía |

---

## 6. Recomendación para que no vuelva a pasar

- Las carpetas worktree no son el problema: son la forma correcta de que varios agentes trabajen a la vez sin pisarse. El problema es cerrar cada trabajo **dejando la nota en el documento del área** y en `docs/PENDIENTES-APPS.md` si toca las apps.
- Cuando una rama ya está en `main` y no hay más trabajo, la carpeta se puede cerrar. Hoy **las 7 worktrees tienen todo en main**: se pueden quitar cuando ningún agente las esté usando (`git worktree remove <carpeta>`, desde gmv2-nuevo). Borrar `gmv2-clone` también.
