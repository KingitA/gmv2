// Frontera del paquete de precios ISOMÓRFICO (alias `@gm/pricing` en mobile/).
// Solo se exportan módulos puros: sin DB, sin next/*, sin React, sin imports
// fuera de lib/pricing. mobile/packages/core/test/pricing-boundary.test.ts lo
// verifica. lib/pricing.ts, pricing-engine.ts y cargar-insumos.ts NO son parte.
export * from "./calculator"
export * from "./formula-evaluator"
export * from "./segmento"
export * from "./calcular-precio-pedido"
export * from "./resolver"
export * from "./motor"
export * from "./vigencia"
