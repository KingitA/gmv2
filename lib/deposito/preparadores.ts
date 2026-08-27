/**
 * Quién preparó qué — registro por renglón en `picking_items` (tabla existente).
 *
 * Reglas:
 *  - Un pedido lo pueden preparar VARIAS personas (cada una con su sesión de picking).
 *  - Un renglón lo prepara UNA sola: el primero que lo escanea se lo queda; si otro
 *    intenta escanear el mismo artículo, se rechaza ("Ya lo preparó X"). Solo el
 *    que lo tomó puede corregirlo o devolverlo a pendiente (eso lo libera).
 *  - Al finalizar el pedido, los preparadores quedan en kardex.preparadores_ids.
 */

export interface PreparadorRenglon {
  usuario_id: string | null
  usuario_nombre: string
  cantidad_preparada: number
  estado: string
  fecha_escaneo: string | null
}

export interface ResumenPreparador {
  usuario_id: string | null
  nombre: string
  renglones: number
  desde: string | null
  hasta: string | null
}

export interface PreparadoresPedido {
  porRenglon: Record<string, PreparadorRenglon>
  resumen: ResumenPreparador[]
}

/** Usuario logueado con nombre legible (tabla usuarios > email). */
export async function getUsuarioActual(supabase: any): Promise<{ id: string | null; nombre: string; email: string }> {
  const { data: { user } } = await supabase.auth.getUser()
  const email = user?.email || "deposito@sistema"
  let nombre = email.split("@")[0]
  if (user?.id) {
    const { data: u } = await supabase.from("usuarios").select("nombre").eq("id", user.id).maybeSingle()
    if (u?.nombre) nombre = u.nombre
  }
  return { id: user?.id || null, nombre, email }
}

/** Sesión de picking del usuario para este pedido (una por persona); la crea si no existe. */
export async function getOCrearSesion(
  supabase: any,
  pedidoId: string,
  usuario: { id: string | null; email: string },
): Promise<{ id: string; nueva: boolean }> {
  let q = supabase
    .from("picking_sesiones")
    .select("id")
    .eq("pedido_id", pedidoId)
    .eq("estado", "EN_PROGRESO")
  q = usuario.id ? q.eq("usuario_id", usuario.id) : q.eq("usuario_email", usuario.email)
  const { data: existente } = await q.limit(1).maybeSingle()
  if (existente?.id) return { id: existente.id, nueva: false }

  const { data: creada, error } = await supabase
    .from("picking_sesiones")
    .insert({ pedido_id: pedidoId, usuario_id: usuario.id, usuario_email: usuario.email, estado: "EN_PROGRESO" })
    .select("id")
    .single()
  if (error || !creada) throw new Error(`Error creando sesión de picking: ${error?.message}`)
  return { id: creada.id, nueva: true }
}

/** Mapa renglón → preparador + resumen por persona, para un pedido. */
export async function getPreparadoresPedido(supabase: any, pedidoId: string): Promise<PreparadoresPedido> {
  const { data } = await supabase
    .from("picking_items")
    .select("pedido_detalle_id, usuario_id, usuario_nombre, cantidad_preparada, estado, fecha_escaneo, pedidos_detalle!inner(pedido_id)")
    .eq("pedidos_detalle.pedido_id", pedidoId)

  const porRenglon: Record<string, PreparadorRenglon> = {}
  const porUsuario = new Map<string, ResumenPreparador>()
  for (const r of (data || []) as any[]) {
    porRenglon[r.pedido_detalle_id] = {
      usuario_id: r.usuario_id ?? null,
      usuario_nombre: r.usuario_nombre || "Operario",
      cantidad_preparada: Number(r.cantidad_preparada || 0),
      estado: r.estado,
      fecha_escaneo: r.fecha_escaneo ?? null,
    }
    const k = r.usuario_id || r.usuario_nombre || "?"
    const cur = porUsuario.get(k) || { usuario_id: r.usuario_id ?? null, nombre: r.usuario_nombre || "Operario", renglones: 0, desde: null, hasta: null }
    cur.renglones += 1
    if (r.fecha_escaneo) {
      if (!cur.desde || r.fecha_escaneo < cur.desde) cur.desde = r.fecha_escaneo
      if (!cur.hasta || r.fecha_escaneo > cur.hasta) cur.hasta = r.fecha_escaneo
    }
    porUsuario.set(k, cur)
  }
  return { porRenglon, resumen: [...porUsuario.values()].sort((a, b) => (a.desde || "").localeCompare(b.desde || "")) }
}
