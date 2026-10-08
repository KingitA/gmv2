# Lista de chequeo — rediseño CLIENTES / PROVEEDORES / AJUSTES

Para revisar antes de pasar a producción (main). Marcá cada punto con ✅ o anotá lo que veas.
Preview: el último link que te pasé (cada cambio usa la **base real**: lo que imprimas, factures o subas a un viaje es de verdad).

---

## 0. Antes de empezar (5 minutos, una sola vez)

En Supabase → **SQL Editor** → pegar el texto de cada archivo → **Run**. No cambian ni borran datos.

- [ ] **Actualización en vivo**: https://github.com/KingitA/gmv2/blob/rediseno-frontend/supabase/migrations/20261007_realtime_erp.sql
- [ ] **Fecha de entrega (pedidos sueltos)**: https://github.com/KingitA/gmv2/blob/rediseno-frontend/supabase/migrations/20261008_pedidos_fecha_entrega.sql

---

## 1. General (en la PC y en el celular)

- [ ] Arriba aparecen las pestañas **Clientes · Proveedores · Artículos · Finanzas · Playroom · Ajustes**; en el celular, abajo.
- [ ] Al iniciar sesión entra directo a **Clientes → Pedidos y viajes**.
- [ ] El ícono de arriba a la derecha tiene App Depósito / App Vendedores / Cerrar sesión.
- [ ] Colores Megasur, letra nueva y textos en minúscula normal. Los datos de las tablas siguen en mayúscula.
- [ ] En el celular se puede hacer **zoom** con los dedos en el ERP (en las apps de depósito/chofer/vendedor sigue bloqueado).
- [ ] **Atrás** del navegador: abrir un pedido y volver; cambiar filtros, ir a otra pantalla y volver (los filtros se mantienen).
- [ ] **En vivo** (con dos PCs o una PC y el celular): cargar o imprimir un pedido en una y verlo aparecer solo en la otra; lo mismo con un vencimiento.
- [ ] Recorrer rápido pantallas que NO se rediseñaron (Caja, Finanzas, Artículos, Comprobantes, Órdenes de compra/pago, Cuenta corriente) para ver que nada quedó desacomodado con los colores y la letra nueva. **Mandame captura de lo raro.**
- [ ] Probar con el **zoom del navegador** que use cada uno (90 %, 110 %, 125 %) y en las distintas pantallas de la oficina.

## 2. CLIENTES → Pedidos y viajes

**Calendario**
- [ ] Semana actual arriba; botón **Mes**, flechas, **Hoy**, **Ocultar**.
- [ ] Click en un viaje → su hoja de ruta. Volver con atrás.
- [ ] Arrastrar un viaje a otro día → cambia la fecha.
- [ ] "+" de un día → Programar viaje con esa fecha.
- [ ] En el celular se ve como agenda (un día por fila).

**Lista y filtros**
- [ ] Por defecto: Pendiente + Impreso de los últimos 30 días.
- [ ] Filtros: estados (botones), vendedor, zona, prioridad, con/sin viaje, desde/hasta (la ✕ saca el límite). "Limpiar filtros".
- [ ] Ordenar tocando los títulos (N°, fecha, cliente, total, prioridad).
- [ ] Cambiar la prioridad desde la fila; ver que el depósito la reciba como siempre.
- [ ] Click en un pedido → abre el panel de siempre. Probar **todas** sus acciones: Generar, Vista previa, Imprimir, Repreciar, Registrar pago, Editar pedido, Eliminar, cambiar estado, asignar viaje, ver comprobantes/remitos.
- [ ] Link a un pedido viejo (ej. desde la ficha o la cuenta corriente de un cliente) → lo abre aunque tenga más de 30 días.

**Selección y arrastre** (usar pedidos/viajes de prueba)
- [ ] Marcar varios → barra abajo con cantidad, total y bultos.
- [ ] Barra: **Subir a un viaje**, **Crear viaje** (lo programa y sube los marcados), **Prioridad**, Quitar selección.
- [ ] Arrastrar UN pedido a un día sin viaje → queda "Para el dd/mm" (sin viaje). Se ve "1 suelto · ZONA" en el calendario.
- [ ] Arrastrar OTRO de la misma zona al mismo día → **pregunta si programar el viaje con los dos** o dejarlo suelto. *(lo que reportaste ayer)*
- [ ] Arrastrar a un día donde ya hay un viaje de esa zona → ofrece subirlos al viaje.
- [ ] Arrastrar sobre un viaje de otra zona → pregunta antes.
- [ ] Pedidos de zonas distintas a un día → quedan sueltos, nunca se juntan solos.
- [ ] Tocar "N sueltos · ZONA" → la lista muestra esos pedidos. La ✕ de "Para el dd/mm" le saca la fecha.

**Botones de arriba**
- [ ] **Importar pedido**: subir archivo + buscar cliente (la lista de clientes se ve entera y se puede bajar con la barra). Ver la barra "Leyendo archivo… Descifrando cantidades…" mientras importa.
- [ ] **Mostrador** abre lo de siempre. **Programar viaje** abre el formulario.

**Otras pantallas de Clientes** (chips de arriba): Viajes, Fichas de clientes, Comprobantes, Revisión de devoluciones, **Cobros** (ex "Pagos de clientes": pestañas Nuevo cobro / Historial / Rendición; "atrás" vuelve a la misma pestaña), Viajantes, Transportes. Caja ya no está acá: está en Finanzas.
- [ ] Viajes: igual que antes (calendario del mes + lista).
- [ ] Fichas de clientes: ya no dice "No hay clientes" mientras carga.
- [ ] Cuenta corriente: el número de pedido abre el pedido.

## 3. PROVEEDORES → Pagos y vencimientos

- [ ] Vista **Semana** por defecto (flechas, Hoy); **Meses** muestra la vista de siempre.
- [ ] Arrastrar un pago a otro día → cambia la fecha. *(ya lo probaste ✅)*
- [ ] ✓ en un pago de proveedor → aviso de "pagado sin OP" con opción Generar OP. *(ya lo probaste ✅)* Con "Saldados" prendido se ve la etiqueta "sin OP".
- [ ] Pagar con **cheque** (✓ del calendario o "Marcar pagado" del formulario) → pregunta si fue con cheques de terceros o propios.
- [ ] **Formulario único** (Nuevo pago, lápiz de un pago, "Nuevo vencimiento" de la lista, y en Finanzas "Nuevo gasto" y editar un pago):
  - [ ] Crear un pago de proveedor y un gasto que se repite todos los meses.
  - [ ] Monto: probar "1.234,50" y "1234.50" → debajo dice "= $ 1.234,50".
  - [ ] Editar: Eliminar, Recalcular desde ficha, Generar OP, Pagado sin OP / Marcar pagado.
- [ ] Botones **Orden de compra** (abre el formulario directo) y **Orden de pago**.
- [ ] Lista de vencimientos abajo: filtros, ✓ (con aviso si es de proveedor), $ (OP), ✗.
- [ ] Fichas de proveedores: abrir uno, ver las secciones, guardar un cambio chico y verificar que quedó. Botón **Abrir ficha fiscal**.

## 4. ARTÍCULOS

- [ ] Abrir la ficha de un artículo: secciones Identificación / Proveedor y compra / Clasificación / Precios de venta / Depósito y empaque, índice al costado (arriba en celular).
- [ ] Guardar un cambio chico y verificar. Crear uno nuevo de prueba (SKU + descripción).
- [ ] "Gestionar descuentos" abre el modal de siempre.
- [ ] Precio base y base contado: mismos campos que antes (no calcula nada nuevo).

## 5. AJUSTES

- [ ] Una sola pantalla con todo agrupado: Personas (usuarios y roles, vendedores, portal), Logística, Comercial, Artículos, Fiscal y bancos. Cada tarjeta abre su pantalla de siempre.

---

## 6. Decisiones pendientes (no bloquean el pase a main)

1. **Ficha de cliente**: tiene 3 botones de guardar (datos / condiciones / segmentación) porque guardan cosas distintas. ¿Unificamos en uno? (toca cómo se guarda → necesita tu OK).
2. ~~Pagos de clientes y Revisión de pagos~~ — RESUELTO 08/10: Pagos de clientes pasa a ser **Cobros** (Clientes); Revisión de pagos y Cobranza nueva las borra el agente de cuentas corrientes cuando des el OK.
3. ~~Caja en Clientes~~ — RESUELTO 08/10: Caja quedó solo en Finanzas.
4. **Dashboard** viejo: salió del menú. ¿Lo borramos?
5. Próximas etapas (otro día): Artículos, Finanzas y Playroom por dentro; ficha de cliente por secciones; quitar los redondeles de carga que quedan en pantallas viejas.

## 7. Pase a producción (lo hago yo cuando me des el OK)

1. Traer lo último de main y verificar que no haya choques con otras sesiones.
2. Compilación completa + chequeo de tipos.
3. Merge a main → Vercel publica solo.
4. Si algo sale mal: se revierte el merge en un minuto y producción vuelve a como estaba.
