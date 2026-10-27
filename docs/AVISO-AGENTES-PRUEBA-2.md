# AVISO PARA TODOS LOS AGENTES — Segunda prueba integral de salida

**Desde:** ____/10/2026 a las ____ hs (la hora de inicio la anota la sesión de la prueba en `docs/PRUEBA-INTEGRAL-SALIDA-2.md`).
**Hasta:** que Juan avise que terminó.

Juan va a recorrer de punta a punta la salida de mercadería sobre la **base de producción**, con todo puesto a cero: apertura del sistema viejo → app vendedor → app depósito → ERP y viaje → app chofer → rendiciones → billeteras, cuentas y comisiones. Los controles se hacen **al peso**: cualquier dato que entre a la base y no sea de la prueba los rompe.

## Mientras dure la prueba

1. **No prueben nada en la base de producción.** Nada de crear clientes, pedidos, cobros, comprobantes, devoluciones, viajes, rendiciones ni movimientos de caja "para ver si anda". Usen el mock del ERP, tests o una base local. (El 27/10 a las 11:06 un agente creó el cliente 3 "TEST-R1 REFACTURAR" con un pedido, comprobantes y un cobro en producción: eso es justo lo que no puede pasar.)
2. **No pasen a main** cambios que toquen la salida (pedidos, comprobantes, viajes, cobros, devoluciones, rendiciones, billeteras, comisiones, cuentas corrientes, `/apertura`, apps) sin el OK de Juan. Si es urgente, avisen en la sesión de la prueba.
3. **No apliquen migraciones** en Supabase sin el OK de Juan.
4. **No instalen APKs en el NuStar** ni le borren datos: lo está usando la prueba.
5. **Clientes de la prueba — no tocar:** 199, 1190, 556 y los clientes "PRUEBA" con códigos 90029 a 90034. Las cuentas de Juan Cruz Rossi (vendedor, chofer y cuenta personal 194) también son de la prueba.
6. **Nunca se emite un comprobante fiscal** en la prueba. Si su código toca generar, anular, notas de crédito o débito, el 10 % contado o devoluciones, avisen antes de pasarlo a main.

## Cómo les llegan los problemas

Cada problema que aparezca va con número (P2-01, P2-02, …) a la tabla de `docs/PRUEBA-INTEGRAL-SALIDA-2.md` y, con su dueño, al traspaso de siempre: `docs/PENDIENTES-ERP-SALIDA.md` o `docs/PENDIENTES-APPS-SALIDA.md`. Trabajen en su rama; nada pasa a main sin el OK de Juan.

Gracias.
