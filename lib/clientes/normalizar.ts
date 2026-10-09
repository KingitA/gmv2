// Forma única de los valores de clientes que se cargan por varias puertas (ficha web,
// app del vendedor, importación de Excel). Antes convivían "Responsable Inscripto" y
// "responsable inscripto", "Regular" y "REGULAR", y la app del vendedor ofrecía
// "Monotributista", que determinarTipoFactura() no reconoce (busca "monotributo").
// Los valores canónicos son los del selector de la ficha (app/clientes/[id]).

export const CONDICIONES_IVA = ["Responsable Inscripto", "Monotributo", "Sujeto Exento", "Consumidor Final", "No Categorizado"] as const

export function normalizarCondicionIva(v: string | null | undefined): string | null {
    const c = (v ?? "").toString().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim()
    if (!c) return null
    if (c.includes("responsable inscri")) return "Responsable Inscripto"
    if (c.includes("monotribut")) return "Monotributo"
    if (c.includes("exento")) return "Sujeto Exento"
    if (c.includes("consumidor final")) return "Consumidor Final"
    if (c.includes("no categoriz")) return "No Categorizado"
    return (v ?? "").toString().trim()
}

/** Nivel inicial de un cliente nuevo (la lista y la importación usan "Regular"). */
export const NIVEL_INICIAL = "Regular"
