"use client"

// Campo ÚNICO para CUIT / CUIL. Se puede tipear o pegar de cualquier forma
// ("20123456789", "20.12345678.9", "20 12345678 9") y siempre entrega
// "xx-xxxxxxxx-x". Si el dígito verificador no coincide muestra el error abajo.
// "00-00000000-0" se acepta como "sin CUIT" (se guarda vacío).
// Reglas en lib/formato (normalizarCuit / errorCuit). Ver docs/FORMATOS.md.

import * as React from "react"
import { Input } from "@/components/ui/input"
import { formatCUIT } from "@/lib/format"
import { errorCuit } from "@/lib/formato"
import { cn } from "@/lib/utils"

interface InputCUITProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> {
  value: string | null | undefined
  /** Valor con guiones a medida que se escribe ("20-12345678-9" al completar). */
  onChange: (value: string) => void
  /** Muestra el error de validación debajo del campo (por defecto sí). */
  mostrarError?: boolean
}

export function InputCUIT({ value, onChange, mostrarError = true, className, onBlur, ...props }: InputCUITProps) {
  const [tocado, setTocado] = React.useState(false)
  const texto = formatCUIT(value ?? "")
  const digitos = texto.replace(/\D/g, "").length
  const error = mostrarError && (tocado || digitos === 11) ? errorCuit(texto) : null

  return (
    <div>
      <Input
        {...props}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={texto}
        onChange={(e) => onChange(formatCUIT(e.target.value))}
        onBlur={(e) => { setTocado(true); onBlur?.(e) }}
        maxLength={20}
        placeholder={props.placeholder ?? "20-12345678-9"}
        aria-invalid={error ? true : undefined}
        className={cn("tabular-nums no-uppercase", error && "border-red-400 focus-visible:ring-red-300", className)}
      />
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}

export { InputCUIT as InputCuit }
