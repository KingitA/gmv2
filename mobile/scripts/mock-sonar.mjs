// Hacer sonar un equipo perdido en los mocks del ERP (20/11/2026). Ver MOBILE.md →
// "Hacer sonar un equipo".
//   POST /api/mobile/dispositivos/token          { app, token } → { ok: true }
//   GET  /api/mobile/dispositivos                 equipos de depósito (este + 2 de mentira)
//   POST /api/mobile/dispositivos/:id/sonar       { app } → { ok, mensaje } (el "sin-token" contesta 409)
//   POST /api/mobile/dispositivos/:id/detener     { app }
//   GET  /__mock/sonar                            lo que se pidió (token recibido y órdenes)

const registro = { tokens: {}, ordenes: [] }

export function atenderSonar(url, req, json, body) {
  const p = url.pathname
  if (p === "/__mock/sonar") return json(200, registro), true
  if (p === "/api/mobile/dispositivos/token" && req.method === "POST") {
    registro.tokens[req.headers["x-device-id"] || "?"] = body?.token || null
    return json(200, { ok: true }), true
  }
  if (p === "/api/mobile/dispositivos" && req.method === "GET") {
    const este = req.headers["x-device-id"] || "este-equipo"
    const hace = (min) => new Date(Date.now() - min * 60_000).toISOString()
    return json(200, {
      equipos: [
        { device_id: este, app: "deposito", usuario: "Vos", ultimo_contacto_at: hace(0), motivo: registro.tokens[este] ? null : "Todavía no actualizó la app (o no dio permiso de avisos).", tiene_token: !!registro.tokens[este], es_este: true },
        { device_id: "a1b2c3d4-0000-4000-8000-000000000001", app: "deposito", usuario: "Carlos", ultimo_contacto_at: hace(12), motivo: null, es_este: false },
        { device_id: "sin-token", app: "deposito", usuario: "Marta", ultimo_contacto_at: hace(60 * 26), motivo: "Todavía no actualizó la app (o no dio permiso de avisos).", es_este: false },
      ],
    }), true
  }
  const m = p.match(/^\/api\/mobile\/dispositivos\/([^/]+)\/(sonar|detener)$/)
  if (m && req.method === "POST") {
    const [, id, accion] = m
    registro.ordenes.push({ id: decodeURIComponent(id), accion, app: body?.app, at: new Date().toISOString() })
    if (id === "sin-token") return json(409, { ok: false, resultado: "sin_token", mensaje: "Todavía no actualizó la app (o no dio permiso de avisos)." }), true
    return json(200, {
      ok: true,
      resultado: "enviado",
      mensaje: accion === "sonar" ? "Listo: el equipo va a sonar en unos segundos (hasta 60 s o hasta que lo apaguen)." : "Listo: se mandó la orden de apagar.",
    }), true
  }
  return false
}
