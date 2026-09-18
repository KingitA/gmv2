import { useRef, type ReactNode } from "react"
import { esQrOUrl, lecturaError, lecturaOk, useLector } from "@gm/core"
import { eansDe, lineaInfo, padEan13, sufijoMarca, type Buscable } from "../../datos/busqueda"
import { C, useCampoSinRafaga } from "../../ui"

/**
 * Pantalla de cantidad (en la web: el "modal" que reemplaza toda la vista). Es una
 * RUTA: atrás vuelve a la lista sin guardar nada.
 *
 * Sin tocar la pantalla: el primer escaneo abre esta pantalla con la cantidad
 * pedida; un SEGUNDO escaneo del mismo artículo confirma esa cantidad. Escanear
 * otro artículo acá no hace nada (beep de error): primero hay que resolver este.
 */
export function PanelCantidad({ articulo, titulo, cabecera, etiquetaInput, inicial, onConfirmar, onFaltante, onVolverBuscar, mostrar }: {
  articulo: Buscable & { unidades_por_bulto?: number | null }
  titulo: string
  cabecera: ReactNode
  etiquetaInput: string
  inicial: string
  onConfirmar: (cantidad: number) => void
  onFaltante: () => void
  onVolverBuscar: () => void
  mostrar: (m: string, t?: "ok" | "err") => void
}) {
  const { valor, cambiar, restaurar } = useCampoSinRafaga(inicial, 130)
  const montadoAt = useRef(Date.now())
  const hecho = useRef(false)
  const una = (fn: () => void) => () => {
    if (hecho.current) return // doble toque / doble lectura: una sola operación
    hecho.current = true
    fn()
  }
  /** Una cantidad de 7+ cifras no es una cantidad: es un código que el lector tipeó en el campo. */
  const cantidadValida = (txt: string): number | null => {
    const n = parseFloat(txt) || 0
    if (n < 0 || n >= 1_000_000) {
      cambiar("")
      mostrar("Esa cantidad no es válida (¿se leyó un código en el campo?). Cargala de nuevo.", "err")
      return null
    }
    return n
  }
  const confirmar = () => {
    const n = cantidadValida(valor)
    if (n !== null) una(() => onConfirmar(n))()
  }

  useLector({
    ignorarConInputEnfocado: false, // el campo de cantidad tiene foco: la ráfaga no debe quedar tipeada ahí
    // Acá nadie tipea 8 cifras seguidas a mano: se puede ser más tolerante con lectores lentos
    minLength: 8,
    maxInterKeyMs: 110,
    onCodigo: (codigo) => {
      const cantidad = restaurar() // la ráfaga se tipeó en el campo: volver a lo que había
      if (esQrOUrl(codigo)) { lecturaError(); return }
      const codigos = new Set([...eansDe(articulo), articulo.codigo_bulto || ""].filter(Boolean).flatMap((c) => [c, padEan13(c)]))
      if (!codigos.has(codigo) && !codigos.has(padEan13(codigo))) {
        lecturaError()
        mostrar("Ese código es de otro artículo. Confirmá o volvé antes de escanear otro.", "err")
        return
      }
      // Rebote del gatillo apenas se abrió la pantalla: ignorar
      if (Date.now() - montadoAt.current < 900) return
      lecturaOk()
      const n = cantidadValida(cantidad)
      if (n !== null) una(() => onConfirmar(n))()
    },
  })

  return (
    <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: 20, padding: 20 }}>
        <div style={{ fontSize: 12, color: C.light, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>{titulo}</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: C.text, lineHeight: 1.3 }}>{articulo.descripcion}{sufijoMarca(articulo)}</div>
        <div style={{ fontSize: 14, color: C.sub, fontFamily: "monospace", marginTop: 8 }}>{lineaInfo(articulo)}</div>
      </div>
      {cabecera}
      <div style={{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: 20, padding: 18 }}>
        <div style={{ color: C.sub, fontSize: 14, marginBottom: 10 }}>{etiquetaInput}</div>
        <input
          type="number" inputMode="decimal" value={valor} autoFocus
          onChange={(e) => cambiar(e.target.value)}
          onFocus={(e) => e.target.select()}
          style={{ width: "100%", background: C.bg, color: C.text, fontSize: 48, fontWeight: 800, textAlign: "center", borderRadius: 16, padding: 16, border: `2px solid ${C.border}`, outline: "none", boxSizing: "border-box" }}
        />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <button onClick={confirmar} style={{ background: C.green, color: "#fff", fontWeight: 800, fontSize: 20, padding: 20, borderRadius: 20, border: "none" }}>✓ Confirmar</button>
        <button onClick={una(onFaltante)} style={{ background: C.red, color: "#fff", fontWeight: 800, fontSize: 20, padding: 20, borderRadius: 20, border: "none" }}>✕ Faltante</button>
      </div>
      <button onClick={onVolverBuscar} style={{ background: C.white, color: C.sub, fontWeight: 600, padding: 16, borderRadius: 18, border: `1.5px solid ${C.border}`, fontSize: 16 }}>
        ← Volver al scanner
      </button>
    </div>
  )
}
