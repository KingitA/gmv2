import { useEffect, useRef, type ReactNode } from "react"
import { esQrOUrl, lecturaError, lecturaOk, useLector } from "@gm/core"
import { leerCantidad } from "../../datos/cantidad"
import { eansDe, lineaInfo, padEan13, sufijoMarca, type Buscable } from "../../datos/busqueda"
import { C, useCampoSinRafaga, useTecladoAbierto } from "../../ui"

/**
 * Pantalla de cantidad (en la web: el "modal" que reemplaza toda la vista). Es una
 * RUTA: atrás vuelve a la lista sin guardar nada.
 *
 * Sin tocar la pantalla: el primer escaneo abre esta pantalla; un SEGUNDO escaneo
 * del mismo artículo confirma la cantidad que está en el campo. Escanear otro
 * artículo acá no hace nada (beep de error): primero hay que resolver este.
 *
 * `exigirCantidad` (picking P2-16; recepción desde el 30/10): el campo arranca vacío y no se confirma nada
 * hasta que el operario escribe lo que contó. Ni el botón ni el segundo escaneo
 * cargan lo pedido (o lo de la OC) solos: así nadie aprieta Confirmar sin contar.
 *
 * Con el teclado abierto (P2-17) la pantalla queda a la mitad: se esconden la
 * cabecera grande y "Volver al scanner" (queda `resumenTeclado`, una línea) para
 * que Confirmar / Faltante entren arriba del teclado.
 */
export function PanelCantidad({ articulo, titulo, cabecera, resumenTeclado, etiquetaInput, ayudaInput, inicial, exigirCantidad = false, onConfirmar, onFaltante, onVolverBuscar, mostrar }: {
  articulo: Buscable & { unidades_por_bulto?: number | null }
  titulo: string
  cabecera: ReactNode
  /** Versión de una línea de la cabecera, para cuando el teclado está abierto */
  resumenTeclado?: ReactNode
  etiquetaInput: string
  ayudaInput?: string
  inicial: string
  exigirCantidad?: boolean
  onConfirmar: (cantidad: number) => void
  onFaltante: () => void
  onVolverBuscar: () => void
  mostrar: (m: string, t?: "ok" | "err") => void
}) {
  const { valor, cambiar, restaurar } = useCampoSinRafaga(inicial, 130)
  const montadoAt = useRef(Date.now())
  const hecho = useRef(false)
  const botones = useRef<HTMLDivElement>(null)
  const teclado = useTecladoAbierto()
  const vacio = !valor.trim()
  const bloqueado = exigirCantidad && vacio

  // El teclado terminó de abrir: los botones a la vista (el contenedor scrollea)
  useEffect(() => {
    if (teclado) botones.current?.scrollIntoView({ block: "end" })
  }, [teclado])

  const una = (fn: () => void) => () => {
    if (hecho.current) return // doble toque / doble lectura: una sola operación
    hecho.current = true
    fn()
  }
  /** null = no se confirma (vacía con exigirCantidad, o inválida: se avisa y se limpia el campo). */
  const cantidadValida = (txt: string): number | null => {
    const n = leerCantidad(txt, exigirCantidad)
    if (n === "vacia") {
      mostrar("Escribí la cantidad que contaste antes de confirmar", "err")
      return null
    }
    if (n === "invalida") {
      cambiar("")
      mostrar("Esa cantidad no es válida (¿se leyó un código en el campo?). Cargala de nuevo.", "err")
      return null
    }
    return n
  }
  const confirmar = () => {
    if (bloqueado) return
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
      const n = cantidadValida(cantidad)
      if (n === null) { lecturaError(); return }
      lecturaOk()
      una(() => onConfirmar(n))()
    },
  })

  return (
    <div style={{ padding: teclado ? 12 : 20, display: "flex", flexDirection: "column", gap: teclado ? 10 : 14 }}>
      <div style={{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: 20, padding: teclado ? "10px 14px" : 20 }}>
        {!teclado && <div style={{ fontSize: 12, color: C.light, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>{titulo}</div>}
        <div style={{ fontSize: teclado ? 16 : 20, fontWeight: 800, color: C.text, lineHeight: 1.3, ...(teclado ? { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } : {}) }}>
          {articulo.descripcion}{sufijoMarca(articulo)}
        </div>
        {!teclado && <div style={{ fontSize: 14, color: C.sub, fontFamily: "monospace", marginTop: 8 }}>{lineaInfo(articulo)}</div>}
        {teclado && resumenTeclado}
      </div>
      {!teclado && cabecera}
      <div style={{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: 20, padding: teclado ? 12 : 18 }}>
        <div style={{ color: C.sub, fontSize: 14, marginBottom: teclado ? 6 : 10 }}>{etiquetaInput}</div>
        <input
          type="text" inputMode="decimal" value={valor} autoFocus
          placeholder={exigirCantidad ? "?" : undefined}
          onChange={(e) => cambiar(e.target.value)}
          onFocus={(e) => e.target.select()}
          style={{ width: "100%", background: C.bg, color: C.text, fontSize: teclado ? 36 : 48, fontWeight: 800, textAlign: "center", borderRadius: 16, padding: teclado ? 10 : 16, border: `2px solid ${C.border}`, outline: "none", boxSizing: "border-box" }}
        />
        {ayudaInput && !teclado && <div style={{ color: C.light, fontSize: 13, marginTop: 8, textAlign: "center" }}>{ayudaInput}</div>}
      </div>
      <div ref={botones} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <button
          onClick={confirmar} disabled={bloqueado}
          style={{ background: bloqueado ? "#e5e7eb" : C.green, color: bloqueado ? C.light : "#fff", fontWeight: 800, fontSize: 20, padding: teclado ? 16 : 20, borderRadius: 20, border: "none" }}
        >
          ✓ Confirmar
        </button>
        <button onClick={una(onFaltante)} style={{ background: C.red, color: "#fff", fontWeight: 800, fontSize: 20, padding: teclado ? 16 : 20, borderRadius: 20, border: "none" }}>✕ Faltante</button>
      </div>
      {!teclado && (
        <button onClick={onVolverBuscar} style={{ background: C.white, color: C.sub, fontWeight: 600, padding: 16, borderRadius: 18, border: `1.5px solid ${C.border}`, fontSize: 16 }}>
          ← Volver al scanner
        </button>
      )}
    </div>
  )
}
