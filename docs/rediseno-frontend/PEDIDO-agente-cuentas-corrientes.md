# Pedido para el agente de cuentas corrientes / cobros

**De:** sesión del rediseño frontend (rama `rediseno-frontend`).
**Fecha:** 08/10/2026.

## La definición del dueño (08/10/2026)

Hay **dos lugares distintos** para la plata. Cada uno tiene su función:

| Dónde | Pantalla | Para qué |
|---|---|---|
| **CLIENTES → Cobros** | `/pagos-clientes` (se llega también con "Registrar pago" desde el pedido y desde la cuenta corriente) | El **administrativo de la oficina le cobra al cliente**: el pedido que retira en el momento, o pedidos y comprobantes anteriores. Es la pantalla de cobro de mostrador. **Se queda y hay que reacondicionarla.** |
| **FINANZAS → Caja del día** | `/caja` | La **planilla de todos los movimientos de dinero**: cobros recibidos, ajustes, pagos a proveedores, gastos y transferencias. **No es de Clientes.** Ahí también se confirman los pagos pendientes y se controlan las rendiciones. |

En la rama del rediseño ya está hecho:
- El menú de Clientes muestra **"Cobros"** (`/pagos-clientes`). Caja está solo en Finanzas.
- La pantalla se llama **"Cobros"** y la pestaña activa queda en la URL (`?tab=nuevo|historial|rendicion`).
- `?cliente_id=` sigue preseleccionando el cliente, igual que antes.

> Reglas del dueño (no negociables):
> - **No duplicar** funciones ni pantallas: reutilizar los componentes y APIs que ya existen.
> - **No romper** la app del chofer ni la del vendedor: comparten `components/pagos/*` y varias APIs.
> - En la base, **todo es dato de prueba**, salvo los **comprobantes fiscales**, que no se tocan nunca.
> - Correr `npm run typecheck:movil` antes de commitear (ver `MOBILE.md` §14).
> - Explicarle al dueño en palabras simples qué cambia. No programa, así que no puede revisar código.
> - Si algo cambia la lógica de cobro (estados, confirmación, imputación), **proponerlo primero y esperar el OK**.

---

## 1. Reacondicionar CLIENTES → Cobros (`/pagos-clientes`)

Lo que ya tiene, y hay que **conservar**:
- Cobro a un cliente imputando comprobantes, incluidos los pedidos "sin facturar (anticipo)".
- Cobro a cuenta.
- Varios métodos en un mismo recibo, incluido el **depósito con varios ítems**.
- **Retenciones**, con `RetencionForm`. Es el único lugar del sistema donde se cargan.
- Foto de cheque o transferencia con OCR.
- 10% contado.
- **Cobro conjunto** de varios clientes (caso Tandil).
- Historial con **recibo PDF**, ver imputaciones, confirmar y anular.
- Ver las **fotos adjuntas** del pago (`pago_comprobantes`).

Para pensar con el dueño y acomodar (proponer antes de cambiar lógica):

1. **Flujo de mostrador.** Hoy el botón dice *"Registrar pago (queda pendiente de verificación)"*. En la oficina el cliente paga en el momento y la plata entra a caja ahí mismo. ¿Debe quedar pendiente igual, o confirmarse en el acto contra la caja que corresponda? (`/caja` confirma con `components/caja/confirmar-dialog.tsx` → `PATCH /api/pagos/[id]/confirmar`.) **Decisión del dueño.**
2. **Volver al pedido.** Cuando se llega desde "Registrar pago" del pedido (`app/clientes-pedidos/page.tsx`, panel del pedido), después de cobrar conviene ofrecer volver al pedido. El "atrás" del navegador ya funciona.
3. **Pestaña "Rendición de viajes".** Las rendiciones son plata de choferes y vendedores, así que corresponden a **Finanzas**. `/caja` ya tiene "Controlar rendición" (`components/caja/controlar-rendicion.tsx`), y `/finanzas/pendiente-rendir` lista los viajes por rendir. Proponer al dueño sacar esta pestaña de Cobros, o moverla.
4. **Historial.** Que sirva para el administrativo: filtrar por cliente y por fecha, y el recibo a mano.
5. **Estilo.** Usar el sistema visual del rediseño:
   - `app/megasur-tema.css`;
   - `components/ficha/ficha.tsx` (`Campo`, `Campos`, secciones);
   - `components/ui/carga-progreso.tsx` para las esperas, en lugar de redondeles.
   - Mirar la ficha de artículo o proveedor como ejemplo.

## 2. Formularios de cobro duplicados: `/caja` vs Cobros

`/caja` tiene su propio formulario de cobro, `components/caja/registrar-cobro.tsx` (la barra de arriba de la caja). Cobros tiene el suyo. **Son dos formularios para la misma acción**, y además tienen diferencias:
- La caja **no** tiene retenciones, ni depósito con varios ítems, ni cobro conjunto, ni link al recibo.
- La caja **sí** tiene el redondeo y la opción "dejar a cuenta" más a mano.

**Proponer al dueño una sola forma de cobrar.** Por ejemplo:
- La barra de la caja abre o lleva a Cobros.
- O ambas usan los mismos componentes.

Así no se mantienen dos formularios que se van separando.
- Hay un aviso en `components/caja/registrar-cobro.tsx` (~206): *"Los depósitos con varios ítems se cargan desde Pagos Clientes"*. Cambiar "Pagos Clientes" por "Cobros".
- `app/api/mostrador/venta/route.ts` (~177, y el comentario ~27) dice *"…Cobrar desde Pagos Clientes."*. Cambiar "Pagos Clientes" por "Cobros".

## 3. Pantallas a eliminar (cuando el dueño dé el OK)

- **`/revision-pagos`**: `/caja` ya cubre listar, confirmar y rechazar pagos, el color blanco/negro del cheque y la imputación (en dos pasos, con "Imputar"). Solo se pierde el botón **"Confirmar todos"** (`POST /api/pagos/confirmar-lote`). Preguntarle al dueño si lo quiere en `/caja` antes de borrar.
- **`/cobranzas/nueva`**: es la misma acción que el **cobro conjunto** de Cobros (las dos usan `POST /api/cobranzas`). Nada navega a esta pantalla. Antes de borrarla, verificar que el cobro conjunto de Cobros tenga todo lo que tiene esta:
  - cheque compartido;
  - color del cheque manual;
  - "a cuenta (extra)" por cliente;
  - "registrar sin confirmar".

  Si a Cobros le falta algo, se lo agrega primero.

Al borrar:
1. Borrar `app/revision-pagos/` y `app/cobranzas/`. **`app/pagos-clientes/` NO se borra**, es Cobros.
2. Si quedan componentes sin uso, verificarlo con grep antes de borrarlos. **No borrar** `components/pagos/*`: lo usan Cobros, caja, chofer y vendedor.
3. **No borrar APIs.** Por ejemplo, `/api/pagos/confirmar-lote` puede quedar sin uso; eso se decide aparte con el dueño.
4. Limpiar las referencias:
   - `lib/navegacion.ts`: prefijos `/revision-pagos` y `/cobranzas`.
   - `components/layout/document-title.tsx`.
   - `components/layout/sidebar.tsx`: ya no se usa en el rediseño, se puede borrar.
5. Correr `npm run typecheck:movil -- --actualizar-base` si bajó la base, y commitear el JSON.

## 4. Coordinación con el rediseño
- La rama `rediseno-frontend` todavía no está en main. Si este trabajo arranca antes del merge, partir de `main` y avisar, porque el rediseño también tocó:
  - `app/pagos-clientes/page.tsx`: nombre "Cobros" y pestaña en la URL;
  - `app/clientes-pedidos/page.tsx`;
  - `app/clientes/[id]/cuenta-corriente/page.tsx`;
  - `lib/navegacion.ts`;
  - `components/finanzas/*`.
- Para guardar estado en la URL sin recargar la página: `useUrlParams` / `useUrlState` en `lib/hooks/use-url-state.ts`.
- Actualización en vivo entre usuarios: `useRealtime` en `lib/hooks/use-realtime.ts`. La migración `20261007_realtime_erp.sql` agrega `pagos_clientes`, `pagos_detalle`, `imputaciones` y `kardex_contable`.
