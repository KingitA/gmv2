"use client"

import { useState, useEffect } from "react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

interface Props {
  value: string        // ISO: YYYY-MM-DD or ""
  onChange: (v: string) => void   // emits ISO: YYYY-MM-DD or ""
  placeholder?: string
  className?: string
  disabled?: boolean
}

function isoToDisplay(iso: string): string {
  if (!iso) return ""
  const parts = iso.split("-")
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
  const [d, m, y] = parts.map(Number)
  const f = new Date(Date.UTC(y, m - 1, d))
  if (f.getUTCFullYear() !== y || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) return ""
  return `${parts[2]}-${parts[1]}-${parts[0]}`
}

export function DateInputAR({ value, onChange, placeholder = "DD/MM/AAAA", className, disabled }: Props) {
  const [display, setDisplay] = useState(() => isoToDisplay(value))

  // Sincroniza con el valor externo SOLO si difiere de lo que hay escrito: mientras se tipea una
  // fecha incompleta el valor emitido es "" y no tiene que borrar lo tipeado (pasaba al editar una
  // fecha ya cargada: el primer retroceso vaciaba el campo).
  useEffect(() => {
    setDisplay((actual) => (displayToISO(actual) === value ? actual : isoToDisplay(value)))
  }, [value])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = autoFormat(e.target.value)
    setDisplay(formatted)
    onChange(displayToISO(formatted))
  }

  return (
    <Input
      type="text"
      inputMode="numeric"
      placeholder={placeholder}
      value={display}
      onChange={handleChange}
      maxLength={10}
      disabled={disabled}
      className={cn(className)}
    />
  )
}
