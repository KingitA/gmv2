/**
 * Catálogo único de categorías de vencimientos/gastos (vencimientos.tipo).
 * Definido con el usuario el 28-07-2026. El VEP es un MEDIO de pago, no una
 * categoría — por eso no existe como tipo.
 *
 * `egreso`: categoría de egresos_generales/kardex al saldar la cuota desde
 * el extracto (Sueldos y el costo laboral separados de Impuestos; Socios va
 * a OTROS porque los retiros no son gasto operativo).
 */
export const CATEGORIAS_GASTO: { value: string; label: string; egreso: string }[] = [
  { value: "factura",         label: "Factura de proveedor",                          egreso: "OPERATIVO" },
  { value: "sueldos",         label: "Sueldos",                                       egreso: "SUELDOS" },
  { value: "cargas_sociales", label: "Cargas sociales (931, sindicatos, OS, ART)",    egreso: "IMPUESTOS" },
  { value: "impuestos",       label: "Impuestos (IVA, IIBB, CM, municipal, SICORE)",  egreso: "IMPUESTOS" },
  { value: "servicios",       label: "Servicios (luz, expensas, teléfono, web)",      egreso: "OPERATIVO" },
  { value: "honorarios",      label: "Honorarios (contador, programador)",            egreso: "OPERATIVO" },
  { value: "seguros",         label: "Seguros (vida, flota)",                         egreso: "OPERATIVO" },
  { value: "vehiculos",       label: "Vehículos (gastos extra de flota)",             egreso: "OPERATIVO" },
  { value: "socios",          label: "Socios (adelantos / participaciones)",          egreso: "OTROS" },
  { value: "otro",            label: "Otro gasto",                                    egreso: "OTROS" },
]

export const labelCategoria = (tipo?: string | null) =>
  CATEGORIAS_GASTO.find((c) => c.value === tipo)?.label ?? tipo ?? "—"

export const egresoDeCategoria = (tipo?: string | null) =>
  CATEGORIAS_GASTO.find((c) => c.value === tipo)?.egreso ?? "OPERATIVO"
