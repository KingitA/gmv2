# Pedido para el agente de cuentas corrientes / caja

**De:** sesión del rediseño frontend (rama `rediseno-frontend`).
**Fecha:** 08/10/2026.
**Objetivo:** poder **eliminar** tres pantallas viejas de cobranzas: `/pagos-clientes`, `/revision-pagos` y `/cobranzas/nueva`. Hoy todo el día a día se maneja desde **`/caja`** (decisión del dueño), pero esas pantallas todavía tienen funciones que `/caja` no tiene. Hay que **pasar esas funciones a `/caja`**. Recién entonces se borran.

> Reglas del dueño (no negociables):
> - **No duplicar** funciones: reutilizar los componentes y APIs que ya existen (abajo está cuáles).
> - **No romper** la app del chofer ni la del vendedor: comparten `components/pagos/*` y varias APIs.
> - En la base, **todo es dato de prueba**, salvo los **comprobantes fiscales**, que no se tocan nunca.
> - Correr `npm run typecheck:movil` antes de commitear (ver `MOBILE.md` §14).
> - Avisar al dueño qué cambió en palabras simples. No programa, así que no puede revisar código.

---

## 1. Lo que `/caja` NO tiene y hay que agregar

Referencias con `archivo:línea`, tomadas de la rama `rediseno-frontend` el 08/10/2026. Pueden correrse unas líneas.

### 1.1 Retenciones en el cobro — **la más importante**
- **Hoy:** solo se cargan en `/pagos-clientes`, con `RetencionForm` (`app/pagos-clientes/page.tsx` ~796). Se mandan como `retenciones` en el `POST /api/pagos-clientes` (~340).
- **En `/caja`:** `components/caja/registrar-cobro.tsx` no manda `retenciones` en su payload (~415-441). **Hoy no hay ningún otro lugar del sistema para cargar retenciones de IIBB, Ganancias o IVA.**
- **Hacer:** sumar las retenciones a `RegistrarCobro`, usando el mismo campo `retenciones` del `POST /api/pagos-clientes`.
- **Ojo:** el "cargar archivo" de `RetencionForm` no hace OCR. Solo agrega una fila vacía (`components/pagos/RetencionForm.tsx` ~57-59).

### 1.2 Depósito con varios ítems
- **Hoy:** `MetodoPagoForm` → `DepositoItemsForm`, en `/pagos-clientes`.
- **En `/caja`:** "Otro método" (`registrar-cobro.tsx` ~297, ~583) cubre efectivo, transferencia, echeq y cheque, pero no el depósito con varios ítems. La propia caja manda a la pantalla vieja con este aviso: `registrar-cobro.tsx` ~206, *"Los depósitos con varios ítems se cargan desde Pagos Clientes"*.
- **Hacer:** soportar el depósito con varios ítems en `RegistrarCobro` y sacar ese aviso.

### 1.3 Cobro a varios clientes (cheque compartido, "caso Tandil")
- **Hoy:** el modo multi-cliente de `/pagos-clientes` (`clientesExtra` ~74/209 → `POST /api/cobranzas` ~270) y `/cobranzas/nueva` (misma API, ~116). Esta última permite cheque compartido, color de cheque manual, "a cuenta (extra)" por cliente, y confirmar o "registrar sin confirmar".
- **En `/caja`:** `RegistrarCobro` acepta un solo `cliente` (~63, ~488).
- **Hacer:** agregar el cobro a varios clientes en `/caja`, por `POST /api/cobranzas` (`lib/cobranzas/crear.ts` es el camino de creación). La app del chofer ya lo tiene (`lib/cobranzas/cobro-conjunto`): reutilizar esa lógica.

### 1.4 Recibo en PDF
- **Hoy:** el link al recibo aparece después de registrar y en el historial de `/pagos-clientes` (~507, ~1354): `GET /api/pagos-clientes/[id]/recibo`. También está en la cuenta corriente (`app/clientes/[id]/cuenta-corriente/page.tsx` ~772).
- **En `/caja`:** no hay link al recibo.
- **Hacer:** botón "Recibo" en la fila del cobro y en el aviso después de registrar.

### 1.5 Ver las fotos adjuntas del pago
- **Hoy:** solo `/pagos-clientes` lee `pago_comprobantes` (~552), que son las fotos de cheques y transferencias.
- **Hacer:** un visor de fotos en el detalle del cobro en `/caja`. El bucket `comprobantes` es privado: firmar las URLs al servir. Ver `firmarDocumentosRecepcion` y la memoria del proyecto sobre el bucket privado.

### 1.6 Entrar a `/caja` con el cliente ya elegido (`?cliente_id=`)
- **Hoy:** dos botones "Registrar pago" llevan a `/pagos-clientes?cliente_id=…`:
  - `app/clientes-pedidos/page.tsx` ~1736 (panel del pedido)
  - `app/clientes/[id]/cuenta-corriente/page.tsx` ~506
- **En `/caja`:** solo lee `fecha` y `tab` de la URL (`app/caja/page.tsx` ~228-234). `RegistrarCobro` no tiene un prop para arrancar con un cliente.
- **Hacer:**
  - Que `/caja?cliente_id=…` abra el registro de cobro con ese cliente.
  - Cambiar los dos `href` a `/caja?cliente_id=…`.
  - Usar el helper `useUrlParams` de `lib/hooks/use-url-state.ts` (rama del rediseño). Usa el historial nativo y no recarga la página.

### 1.7 (Menor) Viajes por rendir y "Confirmar todos"
- La pestaña "Rendición de viajes" de `/pagos-clientes` (~387, ~1073) lista los viajes en rendición con link a `/viajes/[id]/rendicion`. Eso ya existe en `/finanzas/pendiente-rendir` (~374): **no hace falta pasarlo**, alcanza con confirmarlo con el dueño.
- El botón "Confirmar todos" de `/revision-pagos` (`POST /api/pagos/confirmar-lote`) no está en `/caja`. Lo más parecido es confirmar una rendición entera o "Cerrar el día". **Preguntar al dueño** si lo quiere en `/caja` (es riesgoso confirmar todo a ciegas).

### 1.8 Mensajes que mandan a la pantalla vieja
- `components/caja/registrar-cobro.tsx` ~206: el aviso del depósito multi-ítem (se va con el punto 1.2).
- `app/api/mostrador/venta/route.ts` ~177 (y el comentario ~27): "…Cobrar desde Pagos Clientes." → cambiar a Caja.

---

## 2. Lo que `/caja` YA cubre (no rehacer)
- Cobro a un cliente imputado a comprobantes, y cobro a cuenta: `registrar-cobro.tsx` con `ComprobantesSelector` ~745.
- Foto de cheque o transferencia con OCR, más el chip BCRA: `registrar-cobro.tsx` ~158, ~625.
- 10% contado: ~734.
- Confirmar o rechazar pagos pendientes, y elegir blanco/negro del cheque: `components/caja/confirmar-dialog.tsx`.
- Imputar después: `components/caja/imputar-pago.tsx`.
- Anular un cobro confirmado: `app/caja/page.tsx` ~209, ~336-359.
- Controlar una rendición completa: `components/caja/controlar-rendicion.tsx`.

---

## 3. Cuando todo lo anterior esté en `/caja`: borrar
1. Borrar `app/pagos-clientes/`, `app/revision-pagos/` y `app/cobranzas/`.
2. Borrar los componentes que quedan sin uso (verificar con grep antes de borrar):
   - `components/pagos/ClienteSearchCombobox.tsx`
   - `components/pagos/MetodoPagoForm.tsx`
   - `components/pagos/DepositoItemsForm.tsx`
   - `components/pagos/RetencionForm.tsx` (si `/caja` no lo reutiliza)
   - `components/pagos/ResumenPago.tsx`
3. **NO borrar** estos componentes, porque los comparten chofer, vendedor y caja:
   - `components/pagos/ComprobantesSelector.tsx`
   - `BcraDeudorChip.tsx`, `foto-cheque.tsx`, `aviso-inline.tsx`, `AvisosBcraGlobal.tsx`
4. **NO borrar APIs.** Algunas quedan sin uso en la web (`/api/pagos-clientes/rendiciones-resumen`, `/api/pagos/confirmar-lote`, `GET /api/pagos-clientes`), pero:
   - `POST /api/pagos-clientes`, `/ocr`, `/[id]/recibo`, `/[id]/anular` y `/api/pagos/[id]/confirmar` los usan caja, mostrador y las apps.
   - Si alguna API realmente quedara muerta, se decide aparte con el dueño.
5. Limpiar referencias:
   - `lib/navegacion.ts`: prefijos `/pagos-clientes`, `/revision-pagos` y `/cobranzas` de la pestaña Clientes (rama del rediseño).
   - `components/layout/document-title.tsx`: títulos de esas rutas.
   - `components/layout/sidebar.tsx`: ya está sin uso en la rama del rediseño, se puede borrar.
6. `npm run typecheck:movil -- --actualizar-base` (la base baja porque se borra `app/pagos-clientes/page.tsx`) y commitear el JSON.

---

## 4. Coordinación con el rediseño
- La rama `rediseno-frontend` todavía no está en main. Si este trabajo arranca antes del merge, partir de `main` y avisar: los archivos `app/clientes-pedidos/page.tsx`, `app/clientes/[id]/cuenta-corriente/page.tsx` y `lib/navegacion.ts` también cambiaron en el rediseño (hay que mezclar con cuidado).
- El rediseño usa el estilo visual Megasur (`app/megasur-tema.css`) y piezas de formulario en `components/ficha/ficha.tsx` (`Campo`, `Campos`). Usarlas para que lo nuevo de `/caja` se vea igual.
- Para las esperas: `components/ui/carga-progreso.tsx`, una barra con mensajes en lugar de un redondel que gira.
