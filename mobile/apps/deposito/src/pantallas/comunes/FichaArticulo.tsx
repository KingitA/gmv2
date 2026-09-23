import { useCallback, useState } from "react"
import { useLocation, useNavigate, useSearchParams } from "react-router"
import { useOnline } from "@gm/core"
import { Hoja } from "@gm/core/ui"
import { eansDe } from "../../datos/busqueda"
import { useArticulos } from "../../datos/hooks"
import { C } from "../../ui"

/**
 * Ficha del artículo: la abre el operario tocando el renglón (picking o recepción)
 * para identificar la mercadería cuando la descripción no alcanza. Es un overlay =
 * entrada de historial: el botón atrás la cierra y no sale de la pantalla (MOBILE.md §8).
 *
 * Los datos salen de la réplica local (`deposito_articulos`), así que la ficha abre
 * sin señal. La FOTO es lo único que viaja por red: el bucket es público y el WebView
 * la cachea, pero un artículo que nunca se vio con WiFi no la muestra offline.
 */

const PARAM = "ficha"

export interface DatosFicha {
  id: string
  descripcion?: string | null
  sku?: string | null
  marca?: string | null
  unidades_por_bulto?: number | null
  imagen_url?: string | null
  ean13?: string[] | string | null
}

/** Devuelve `abrir(articuloId)`: agrega ?ficha=<id> a la URL actual (push). */
export function useAbrirFicha() {
  const navigate = useNavigate()
  const location = useLocation()
  return useCallback(
    (articuloId: string) => {
      const n = new URLSearchParams(location.search)
      n.set(PARAM, articuloId)
      navigate({ pathname: location.pathname, search: `?${n}` }, { state: { overlay: true } })
    },
    [navigate, location.pathname, location.search],
  )
}

/** true si la ficha está abierta (para que el lector no deje la ficha en el historial). */
export function useFichaAbierta() {
  const [sp] = useSearchParams()
  return sp.get(PARAM) !== null
}

/**
 * Hoja con la ficha. Se monta en la pantalla y se muestra sola cuando hay ?ficha=<id>.
 * `respaldo`: datos del renglón para un artículo que no esté en el catálogo replicado
 * (p. ej. uno recibido fuera de la OC o dado de baja después de armarse el pedido).
 */
export function FichaArticulo({ respaldo }: { respaldo?: (articuloId: string) => DatosFicha | undefined }) {
  const [sp] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { indice } = useArticulos()
  const id = sp.get(PARAM)

  const cerrar = useCallback(() => {
    if ((location.state as { overlay?: boolean } | null)?.overlay) navigate(-1)
    else {
      const n = new URLSearchParams(location.search)
      n.delete(PARAM)
      navigate({ pathname: location.pathname, search: n.size ? `?${n}` : "" }, { replace: true })
    }
  }, [navigate, location.pathname, location.search, location.state])

  if (!id) return null
  const delCatalogo = indice.porId.get(id)
  const a: DatosFicha = delCatalogo ?? respaldo?.(id) ?? { id }

  return (
    <Hoja abierta onCerrar={cerrar} titulo="Artículo">
      <Foto url={a.imagen_url} clave={id} />
      <div style={{ fontSize: 20, fontWeight: 800, color: C.text, lineHeight: 1.3, margin: "14px 0 12px" }}>
        {a.descripcion || "Artículo sin descripción"}
      </div>
      <Dato etiqueta="SKU" valor={a.sku} mono />
      <Dato etiqueta="Marca" valor={a.marca} />
      <Dato etiqueta="Unidades por bulto" valor={a.unidades_por_bulto != null ? String(a.unidades_por_bulto) : null} />
      <Dato etiqueta="EAN" valor={eansDe(a).join(" · ") || null} mono />
      {!delCatalogo && (
        <div style={{ marginTop: 12, fontSize: 13, color: C.sub }}>
          Este artículo no está en el catálogo descargado en el equipo: se muestran los datos del pedido.
        </div>
      )}
    </Hoja>
  )
}

function Dato({ etiqueta, valor, mono }: { etiqueta: string; valor?: string | null; mono?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, padding: "9px 0", borderBottom: `1px solid ${C.border}` }}>
      <span style={{ color: C.sub, fontSize: 14 }}>{etiqueta}</span>
      <span style={{ color: valor ? C.text : C.light, fontSize: 16, fontWeight: valor ? 700 : 400, fontFamily: mono && valor ? "monospace" : undefined, textAlign: "right", minWidth: 0, wordBreak: "break-word" }}>
        {valor || "—"}
      </span>
    </div>
  )
}

/** Foto del artículo. Sin señal (o sin foto cargada) muestra el motivo, nunca un roto. */
function Foto({ url, clave }: { url?: string | null; clave: string }) {
  const online = useOnline()
  const [estado, setEstado] = useState<"cargando" | "ok" | "error">("cargando")
  const marco: React.CSSProperties = {
    height: 190, borderRadius: 14, background: C.bg, border: `1px solid ${C.border}`,
    display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", position: "relative",
  }
  if (!url) {
    return (
      <div style={marco}>
        <div style={{ textAlign: "center", color: C.light }}>
          <div style={{ fontSize: 40 }}>📦</div>
          <div style={{ fontSize: 14, marginTop: 6 }}>Sin foto cargada</div>
        </div>
      </div>
    )
  }
  return (
    <div style={marco}>
      <img
        key={clave}
        src={url}
        alt=""
        onLoad={() => setEstado("ok")}
        onError={() => setEstado("error")}
        style={{ maxHeight: "100%", maxWidth: "100%", objectFit: "contain", display: estado === "ok" ? "block" : "none" }}
      />
      {estado !== "ok" && (
        <div style={{ textAlign: "center", color: C.light, padding: 12 }}>
          {estado === "cargando" ? (
            <div style={{ fontSize: 14 }}>Cargando foto…</div>
          ) : (
            <>
              <div style={{ fontSize: 34 }}>📷</div>
              <div style={{ fontSize: 14, marginTop: 6 }}>
                {online ? "No se pudo cargar la foto" : "Sin señal: la foto se ve al volver el WiFi"}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
