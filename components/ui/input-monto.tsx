"use client"

// Campo ÚNICO para montos, precios, porcentajes y cantidades con decimales.
// Se escribe en formato argentino ("1.500,50"; "1.500" = mil quinientos; "1,5" =
// uno y medio) y al salir del campo se muestra formateado. Nunca usar
// <input type="number"> para plata: el navegador toma "1.500" como 1,5.
// Reglas en lib/formato (parseMonto / numero). Ver docs/FORMATOS.md.

import * as React from "react"
import { Input } from "@/components/ui/input"
import { numero, parseMonto } from "@/lib/formato"
import { cn } from "@/lib/utils"

type Base = Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "type" | "defaultValue">

export interface InputMontoProps extends Base {
  /** Valor actual (number; también acepta string numérico de estados viejos). null/"" = vacío. */
  value: number | string | null | undefined
  /** Se llama en cada cambio con el número entendido (null si está vacío o no se entiende). */
  onChange: (valor: number | null) => void
  /** Decimales al mostrar (2 para plata; 0 para cantidades enteras). */
  decimales?: number
  /** Muestra "$" adelante. */
  pesos?: boolean
  /** Muestra "%" atrás. */
  porciento?: boolean
  /** No acepta negativos (se descarta el signo). */
  soloPositivos?: boolean
}

const aNumero = (v: number | string | null | undefined): number | null => {
  if (v == null || v === "") return null
  if (typeof v === "number") return Number.isFinite(v) ? v : null
  // string de un estado viejo: puede ser "1500.5" (máquina) o "1.500,5" (tipeado)
  const n = Number(v)
  return Number.isFinite(n) ? n : parseMonto(v)
}

export const InputMonto = React.forwardRef<HTMLInputElement, InputMontoProps>(function InputMonto(
  { value, onChange, decimales = 2, pesos, porciento, soloPositivos, className, onBlur, onFocus, placeholder, min, max, ...props },
  ref,
) {
  const mostrar = React.useCallback(
    (n: number | null) => (n == null ? "" : numero(n, decimales === 2 ? 2 : 0, decimales)),
    [decimales],
  )
  const [texto, setTexto] = React.useState(() => mostrar(aNumero(value)))
  const editando = React.useRef(false)

  // Sincroniza con el valor de afuera cuando no se está escribiendo
  React.useEffect(() => {
    if (!editando.current) setTexto(mostrar(aNumero(value)))
  }, [value, mostrar])

  const cambiar = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = e.target.value.replace(soloPositivos ? /[^\d.,]/g : /[^\d.,-]/g, "")
    setTexto(t)
    const n = parseMonto(t)
    onChange(n == null ? null : soloPositivos ? Math.abs(n) : n)
  }

  const input = (
    <Input
      ref={ref}
      {...props}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={texto}
      placeholder={placeholder ?? (decimales > 0 ? "0,00" : "0")}
      onChange={cambiar}
      onFocus={(e) => { editando.current = true; onFocus?.(e) }}
      onBlur={(e) => {
        editando.current = false
        // min / max (ej. descuento hasta 100): al salir del campo se acota el valor
        let n = parseMonto(texto)
        if (n != null) {
          const lo = min != null && min !== "" ? Number(min) : null
          const hi = max != null && max !== "" ? Number(max) : null
          const acotado = lo != null && n < lo ? lo : hi != null && n > hi ? hi : n
          if (acotado !== n) { n = acotado; onChange(n) }
        }
        setTexto(mostrar(n))
        onBlur?.(e)
      }}
      className={cn("text-right tabular-nums no-uppercase", pesos && "pl-6", porciento && "pr-7", className)}
    />
  )
  if (!pesos && !porciento) return input
  return (
    <div className="relative">
      {pesos && <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>}
      {input}
      {porciento && <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>}
    </div>
  )
})
