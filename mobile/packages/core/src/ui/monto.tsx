import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { numero, parseMonto, redondear } from "@gm/formato"

// MONTO CON PUNTOS DE MILES MIENTRAS SE ESCRIBE (P2-30, 29/10/2026; vale para las 3 apps).
// "3784286" se ve "3.784.286" al tipear; la coma separa los centavos ("3.784.286,5").
// Reglas de docs/FORMATOS.md: campo de texto (nunca type="number"), el número sale de
// parseMonto del texto argentino, nunca de parseFloat.

/**
 * Formatea lo tipeado: los puntos los pone el campo (los que escribe el usuario se ignoran),
 * la COMA separa decimales (máximo `decimales`; con 0 no hay coma). Sin ceros a la izquierda.
 */
export function mascaraMonto(texto: string, decimales = 2): string {
  // Sin decimales la coma no significa nada: se ignora (los dígitos siguen)
  const limpio = texto.replace(decimales > 0 ? /[^\d,]/g : /\D/g, "")
  const coma = limpio.indexOf(",")
  const conComa = decimales > 0 && coma >= 0
  const entera = (coma >= 0 ? limpio.slice(0, coma) : limpio).replace(/,/g, "")
  const dec = conComa ? limpio.slice(coma + 1).replace(/,/g, "").slice(0, decimales) : ""
  let ent = entera.replace(/^0+(?=\d)/, "")
  if (!ent && conComa) ent = "0"
  const conPuntos = ent.replace(/\B(?=(\d{3})+(?!\d))/g, ".")
  return conComa ? `${conPuntos},${dec}` : conPuntos
}

/**
 * Lo que tipeó el usuario respecto del texto anterior. Un "." recién tipeado (teclados que
 * no tienen coma) es la coma decimal si todavía no hay una; cualquier otro punto es de miles.
 */
export function entradaMonto(anterior: string, nuevo: string, cursor: number): string {
  const tipeoUnPunto = nuevo.length === anterior.length + 1 && nuevo[cursor - 1] === "." && !nuevo.includes(",")
  return tipeoUnPunto ? `${nuevo.slice(0, cursor - 1)},${nuevo.slice(cursor)}` : nuevo
}

/** Posición del cursor en `formateado` que deja a su derecha los mismos dígitos y coma que había. */
export function cursorMonto(crudo: string, cursor: number, formateado: string): number {
  const significativos = (s: string) => s.replace(/[^\d,]/g, "").length
  let derecha = significativos(crudo.slice(cursor))
  let i = formateado.length
  while (i > 0 && derecha > 0) {
    i--
    if (/[\d,]/.test(formateado[i]!)) derecha--
  }
  // Antes del punto de miles, no después
  while (i > 0 && formateado[i - 1] === ".") i--
  return i
}

/**
 * Campo de monto en pesos (o cantidad con decimales) con los puntos de miles y la coma de
 * centavos A LA VISTA mientras se escribe. Mismo contrato que el MontoInput de las apps:
 * `onCambio` al salir del campo o con Enter (con `enVivo`, también en cada tecla).
 * Sin foco se ve "1.500,00".
 */
export function CampoMonto({ valor, onCambio, className = "", placeholder = "0", decimales = 2, enVivo = false, autoFocus, ariaLabel }: {
  valor: number
  onCambio: (n: number) => void
  className?: string
  placeholder?: string
  decimales?: number
  enVivo?: boolean
  autoFocus?: boolean
  ariaLabel?: string
}) {
  const mostrar = (v: number) => (v ? numero(v, decimales) : "")
  const [texto, setTexto] = useState(() => mostrar(valor))
  const editando = useRef(false)
  const mostrado = useRef(valor) // número que representa `texto`
  const ref = useRef<HTMLInputElement>(null)
  const cursorPendiente = useRef<number | null>(null)

  // Sin foco, el texto sigue al valor de afuera (incluido el que corrige el padre: tope, mínimo)
  useEffect(() => {
    if (!editando.current && mostrado.current !== valor) { mostrado.current = valor; setTexto(mostrar(valor)) }
  })
  // Reubica el cursor después de reformatear (si no, salta al final)
  useLayoutEffect(() => {
    const c = cursorPendiente.current
    if (c != null && ref.current && document.activeElement === ref.current) ref.current.setSelectionRange(c, c)
    cursorPendiente.current = null
  }, [texto])

  const numeroDe = (t: string) => Math.max(0, redondear(parseMonto(t) ?? 0, decimales))
  const confirmar = () => {
    editando.current = false
    const n = numeroDe(texto)
    mostrado.current = n
    setTexto(mostrar(n))
    onCambio(n)
  }

  return (
    <input
      ref={ref}
      value={texto}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      autoFocus={autoFocus}
      aria-label={ariaLabel}
      placeholder={placeholder}
      onFocus={(e) => { editando.current = true; e.target.select() }}
      onChange={(e) => {
        const cursor = e.target.selectionStart ?? e.target.value.length
        const crudo = entradaMonto(texto, e.target.value, cursor)
        const nuevo = mascaraMonto(crudo, decimales)
        cursorPendiente.current = cursorMonto(crudo, cursor, nuevo)
        setTexto(nuevo)
        if (enVivo) { const n = numeroDe(nuevo); mostrado.current = n; onCambio(n) }
      }}
      onBlur={confirmar}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur() } }}
      className={className}
    />
  )
}
