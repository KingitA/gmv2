"use client"

// Campo ÚNICO de fecha: siempre dd/mm/aaaa (nunca mm/dd), sin depender del idioma
// del navegador como <input type="date">. Emite "AAAA-MM-DD" (lo que se guarda en
// columnas date) o "" mientras está incompleta. Al salir del campo entiende formas
// cortas: "9/10/26", "9-10-2026", "091026". Reglas en lib/formato (parseFecha).
// Ver docs/FORMATOS.md.

import { useState, useEffect } from "react"
import { Input } from "@/components/ui/input"
import { parseFecha } from "@/lib/formato"
import { cn } from "@/lib/utils"

interface Props {
  value: string | null | undefined        // ISO: YYYY-MM-DD or ""
  onChange: (v: string) => void   // emits ISO: YYYY-MM-DD or ""
  placeholder?: string
  className?: string
  disabled?: boolean
  id?: string
  name?: string
  required?: boolean
  autoFocus?: boolean
  min?: string                    // ISO: fechas anteriores se marcan como error
  max?: string                    // ISO: fechas posteriores se marcan como error
}

function isoToDisplay(iso: string | null | undefined): string {
  if (!iso) return ""
  const parts = iso.slice(0, 10).split("-")
  if (parts.length !== 3) return iso
  const [y, m, d] = parts
  return `${d}/${m}/${y}`
}

function autoFormat(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8)
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
}

function displayToISO(display: string): string {
  const parts = display.split("/")
  if (parts.length !== 3 || parts[0].length !== 2 || parts[1].length !== 2 || parts[2].length !== 4) return ""
  // Fecha imposible (31/02, mes 13…): no se emite — antes pasaba tal cual y el servidor la corría de mes
  return parseFecha(display) ?? ""
}

export function DateInputAR({ value, onChange, placeholder = "dd/mm/aaaa", className, disabled, min, max, ...rest }: Props) {
  const [display, setDisplay] = useState(() => isoToDisplay(value))
  const [error, setError] = useState<string | null>(null)

  // Sincroniza con el valor externo SOLO si difiere de lo que hay escrito: mientras se tipea una
  // fecha incompleta el valor emitido es "" y no tiene que borrar lo tipeado (pasaba al editar una
  // fecha ya cargada: el primer retroceso vaciaba el campo).
  useEffect(() => {
    setDisplay((actual) => (displayToISO(actual) === (value || "") ? actual : isoToDisplay(value)))
  }, [value])

  const fueraDeRango = (iso: string) =>
    (min && iso < min) ? `No puede ser anterior al ${isoToDisplay(min)}` :
    (max && iso > max) ? `No puede ser posterior al ${isoToDisplay(max)}` : null

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Si pegan "2026-10-09" o "9/10/26", se respeta; si tipean dígitos, máscara dd/mm/aaaa
    const raw = e.target.value
    const formatted = /[-.]/.test(raw) || raw.length < display.length ? raw : autoFormat(raw)
    setDisplay(formatted)
    setError(null)
    onChange(displayToISO(formatted))
  }

  const handleBlur = () => {
    if (!display.trim()) { setError(null); return }
    const iso = parseFecha(display)
    if (!iso) { setError("Fecha inválida: escribila como dd/mm/aaaa"); onChange(""); return }
    setDisplay(isoToDisplay(iso))
    setError(fueraDeRango(iso))
    onChange(iso)
  }

  return (
    <div>
      <Input
        {...rest}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={placeholder}
        value={display}
        onChange={handleChange}
        onBlur={handleBlur}
        maxLength={10}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        className={cn("tabular-nums", error && "border-red-400", className)}
      />
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}

/** Mismo campo con nombre en castellano para código nuevo. */
export { DateInputAR as InputFecha }
