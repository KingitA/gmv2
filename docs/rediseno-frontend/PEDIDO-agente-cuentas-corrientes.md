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

1. **Flujo de mostrador.** DECIDIDO (dueño, 08/10): el cobro de la oficina **queda pendiente de verificación**, como hoy. No cambiar.
2. **Volver al pedido.** Cuando se llega desde "Registrar pago" del pedido (`app/clientes-pedidos/page.tsx`, panel del pedido), después de cobrar conviene ofrecer volver al pedido. El "atrás" del navegador ya funciona.
3. **Pestaña "Rendición de viajes".** DECIDIDO (dueño, 08/10): las rendiciones de choferes y viajantes van en **/caja** (ya se ven ahí). Sacar esta pestaña de Cobros, verificando antes que /caja (`controlar-rendicion.tsx`) haga todo lo que hace esta pestaña.
4. **Historial.** Que sirva para el administrativo: filtrar por cliente y por fecha, y el recibo a mano.
5. **Estilo.** Usar el sistema visual del rediseño:
   - `app/megasur-tema.css`;
   - `components/ficha/ficha.tsx` (`Campo`, `Campos`, secciones);
   - `components/ui/carga-progreso.tsx` para las esperas, en lugar de redondeles.
   - Mirar la ficha de artículo o proveedor como ejemplo.

## 2. Dos sectores, dos funciones (DECIDIDO por el dueño, 08/10)

**Son dos sectores distintos y NO se unifican:**
- **Cobros (CLIENTES)** lo usa quien **atiende gente** en el mostrador o la oficina: **ingresa** el pago. Todo lo que se ingresa ahí queda **pendiente de verificación**.
- **Caja (FINANZAS)** lo usa quien **ve los números** y decide qué hacer con la plata: **verifica** (confirma o rechaza) lo que ingresó el otro sector, controla rendiciones y mueve la plata.

**Cómo funciona (en palabras del dueño):** la compañera de atención al público entrega el pedido, cobra y registra el pago en Cobros. Le deja la plata en el escritorio a Finanzas. Finanzas cuenta que esté lo que ella registró (por ejemplo, un cheque y $ 10 en efectivo). Si está bien, aprieta el botón de verificado y la plata entra a la caja. **Esto ya funciona así:** los pagos pendientes aparecen en la planilla de `/caja` con su botón Confirmar o Rechazar. **No hace falta una bandeja nueva ni un circuito tipo rendición.** Si el cliente quiere el recibo en el momento, Finanzas lo confirma ahí mismo y sale el recibo.

La **barra de cobro de Caja se queda** como está: es para la plata que le llega directo a Finanzas.

Qué hacer:
1. **Cobros tiene que ser tan cómodo como la barra de Caja**, que el dueño considera bien armada. Traer a Cobros lo que la barra tiene y Cobros no, **reutilizando el código de la barra** (`components/caja/registrar-cobro.tsx`) en lugar de escribirlo de nuevo:
   - pegar una captura con Ctrl+V para el OCR;
   - los carteles "falta plata → ajuste por redondeo o dejar saldo" y "sobra plata → ajustar o dejar a cuenta" (con el tope de `lib/cobranzas/ajuste.ts`);
   - el resumen de la cuenta con el switch Facturados / Todos;
   - el aviso de deudor del BCRA con todos los titulares del cheque.

   Lo que se ingresa en Cobros **sigue quedando pendiente**, incluso el efectivo. Mostrarle al dueño la lista exacta antes de empezar.
2. Verificar que en la planilla de `/caja` se distinga bien un cobro de mostrador pendiente: quién lo registró, el cliente y el detalle de cada renglón (cheque nº, efectivo). Así Finanzas puede contar contra eso antes de apretar Confirmar. Si falta algún dato, proponerlo.
3. Textos que todavía dicen "Pagos Clientes" y deben decir "Cobros":
   - `components/caja/registrar-cobro.tsx` (~206): *"Los depósitos con varios ítems se cargan desde Pagos Clientes"*.
   - `app/api/mostrador/venta/route.ts` (~177, y el comentario ~27).

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
