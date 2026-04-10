// =====================================================
// Formula Evaluator — Sistema de Precios GM
// =====================================================
// Evalúa fórmulas de texto para calcular precios de sublistas.
//
// Variables disponibles en fórmulas:
//   Base        = precio_base del artículo
//   BaseContado = precio_base_contado del artículo
//   + cualquier código de sublista ya calculado (para cascada)
//
// Operaciones soportadas: +  -  *  /  ( )
// Decimales: con , o . (ambos aceptados)
//
// Ejemplos válidos:
//   "Base/1.11"
//   "Base*1.21"
//   "(Base*1.12)*1.1"
//   "bahia_sin_iva*1.21"
//   "Base*0,95"    ← coma decimal argentina, se normaliza
// =====================================================

// ─── Definición de sublistas ──────────────────────────

export const SUBLISTA_CODIGOS = [
  "bahia_presupuesto",
  "bahia_final",
  "bahia_sin_iva",
  "bahia_con_iva",
  "neco_presupuesto",
  "neco_final",
  "neco_sin_iva",
  "neco_con_iva",
  "viajante",
] as const

export type SublistaCodigo = typeof SUBLISTA_CODIGOS[number]

export const SUBLISTA_META: Record<SublistaCodigo, {
  label: string
  grupo: "bahia" | "neco" | "viajante"
}> = {
  bahia_presupuesto: { label: "Presupuesto", grupo: "bahia"    },
  bahia_final:       { label: "Final",       grupo: "bahia"    },
  bahia_sin_iva:     { label: "Sin IVA",     grupo: "bahia"    },
  bahia_con_iva:     { label: "Con IVA",     grupo: "bahia"    },
  neco_presupuesto:  { label: "Presupuesto", grupo: "neco"     },
  neco_final:        { label: "Final",       grupo: "neco"     },
  neco_sin_iva:      { label: "Sin IVA",     grupo: "neco"     },
  neco_con_iva:      { label: "Con IVA",     grupo: "neco"     },
  viajante:          { label: "Viajante",    grupo: "viajante" },
}

// ─── Evaluador seguro de una fórmula ─────────────────

/**
 * Evalúa una fórmula de texto con las variables dadas.
 * Retorna null si la fórmula es inválida, tiene variables sin resolver,
 * o produjo un resultado no numérico/infinito.
 */
export function evaluarFormula(
  formula: string,
  vars: Record<string, number>,
): number | null {
  if (!formula || formula.trim() === "") return null

  try {
    // 1. Normalizar separador decimal argentino (coma → punto)
    let expr = formula.trim().replace(/,/g, ".")

    // 2. Reemplazar variables: ordenar de más largo a más corto para evitar
    //    partial matches (ej: "bahia_sin_iva" antes de "bahia")
    const varNames = Object.keys(vars).sort((a, b) => b.length - a.length)

    for (const name of varNames) {
      const val = vars[name]
      if (val == null || isNaN(val)) continue

      // Usar lookahead/lookbehind negativo para respetar word boundaries con "_"
      // Esto evita que "Base" reemplace parte de "BaseContado" (aunque el orden
      // largo-primero ya lo protege, esta es una segunda capa de defensa)
      const safePattern = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      const regex = new RegExp(
        `(?<![a-zA-Z0-9_])${safePattern}(?![a-zA-Z0-9_])`,
        "gi",
      )
      expr = expr.replace(regex, String(val))
    }

    // 3. Validar que solo queden caracteres seguros (números, operadores, paréntesis)
    //    Si queda alguna letra, es una variable sin resolver → null
    if (!/^[\d\s+\-*/().]+$/.test(expr)) {
      return null
    }

    // 4. Evaluar con new Function en modo estricto
    //    No captura ninguna variable del scope externo → seguro
    // eslint-disable-next-line no-new-func
    const result = new Function(`"use strict"; return (${expr})`)()

    if (typeof result !== "number" || !isFinite(result) || isNaN(result)) {
      return null
    }

    return Math.round(result * 100) / 100
  } catch {
    return null
  }
}

// ─── Calculador de todos los precios de un artículo ──

/**
 * Calcula los precios de todas las sublistas para un artículo,
 * resolviendo dependencias en cascada (múltiples pasadas).
 *
 * Ej: si neco_presupuesto = "bahia_presupuesto*1.12",
 * primero se resuelve bahia_presupuesto, luego neco_presupuesto.
 *
 * Las dependencias circulares quedan como null (no producen error).
 */
export function calcularPreciosConFormulas(
  base: number,
  baseContado: number,
  formulas: Record<string, string>,
): Record<string, number | null> {
  const resultados: Record<string, number | null> = {}

  // Inicializar todos como null
  for (const codigo of SUBLISTA_CODIGOS) {
    resultados[codigo] = null
  }

  // Variables base siempre disponibles
  const varsBase: Record<string, number> = {
    Base:        base,
    BaseContado: baseContado,
  }

  // Resolver con múltiples pasadas para manejar dependencias en cascada.
  // En el peor caso (cadena lineal de N), se necesitan N pasadas.
  // El break temprano evita trabajo inútil y cierra referencias circulares.
  const MAX_ITER = SUBLISTA_CODIGOS.length + 1

  for (let iter = 0; iter < MAX_ITER; iter++) {
    let resueltoEnEstaPasada = 0

    for (const codigo of SUBLISTA_CODIGOS) {
      if (resultados[codigo] !== null) continue  // ya resuelto

      const formula = formulas[codigo]
      if (!formula || formula.trim() === "") continue

      // Construir variables: base + sublistas ya calculadas
      const vars: Record<string, number> = { ...varsBase }
      for (const [k, v] of Object.entries(resultados)) {
        if (v !== null) vars[k] = v
      }

      const val = evaluarFormula(formula, vars)
      if (val !== null) {
        resultados[codigo] = val
        resueltoEnEstaPasada++
      }
    }

    // Si no se resolvió nada en esta pasada, no hay más que resolver
    if (resueltoEnEstaPasada === 0) break
  }

  return resultados
}
