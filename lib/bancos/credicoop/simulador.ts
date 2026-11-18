/**
 * Simulador de la API Empresas de Credicoop: contesta como el banco (mismas rutas, mismos campos
 * y mismos códigos de error que la documentación), sin salir a internet. Sirve para:
 *   - la batería de tests (mobile/packages/core/test/credicoop.test.ts);
 *   - probar las pantallas mientras no haya credenciales (variable CREDICOOP_SIMULADOR=1).
 *
 * NO es el banco: nada de lo que pasa acá mueve plata. Las operaciones hechas contra el simulador
 * quedan marcadas como tales en el sistema (ambiente = "simulador").
 *
 * Comportamiento:
 *   - toda operación con firma queda "Enviada a la firma";
 *   - un idOrigen repetido se rechaza (APIE-x003 / 4011), como en el banco;
 *   - `firmar(idOrigen)` / `rechazar(idOrigen, motivo)` hacen lo que haría una persona con el
 *     token en Banca Internet Empresa;
 *   - con `firmaSolaAlConsultar: n`, la operación pasa sola a firmada en la consulta número n
 *     (para probar las pantallas sin nadie que firme).
 */
import type { FetchBanco } from "./cliente"
import { RUTAS } from "./nucleo"

type Tipo = "transferencia" | "echeq" | "gestion" | "vep"
interface OperacionSimulada {
  tipo: Tipo; idOperacion: number; idOrigen: string; pedido: any; estado: string; motivo?: string; consultas: number; creada: string
}

export interface OpcionesSimulador {
  /** La operación se firma sola en la consulta número n (0 = nunca) */
  firmaSolaAlConsultar?: number
  /** Para probar un corte: el próximo envío se "pierde" (el banco lo recibe pero no contesta) */
  cortarProximoEnvio?: boolean
  ahora?: () => Date
}

const FINAL_OK: Record<Tipo, string> = { transferencia: "Enviada a Banco Destino", echeq: "Aceptada", gestion: "Aceptada", vep: "Aceptada" }
const DUPLICADO: Record<Tipo, string> = { transferencia: "APIE-0003", echeq: "APIE-1003", gestion: "APIE-2003", vep: "APIE-4011" }

export function crearSimuladorCredicoop(opciones: OpcionesSimulador = {}) {
  const ahora = opciones.ahora ?? (() => new Date())
  const operaciones = new Map<string, OperacionSimulada>()
  const tokens = new Set<string>()
  let siguiente = 33288400
  let pedidos = 0
  let cortar = opciones.cortarProximoEnvio === true

  const json = (status: number, cuerpo: unknown) => ({ status, text: async () => JSON.stringify(cuerpo) })
  const error = (codigo: string, descripcion: string, status = 400) => json(status, { codigo: Number(codigo.slice(5)), descripcion, errores: [{ codigo, descripcion, orden: 0 }] })
  const fechaEmision = () => ({ formatter: "yyyy-MM-dd'T'HH:mm:ss.SSS", value: ahora().toISOString().slice(0, 23) })

  function registrar(tipo: Tipo, pedido: any) {
    const idOrigen = String(pedido?.idOrigen ?? "")
    if (!idOrigen || idOrigen.length > 36) return { fallo: error(`APIE-${tipo === "transferencia" ? "0001" : tipo === "echeq" ? "1001" : tipo === "gestion" ? "2001" : "4001"}`, "Parámetros inválidos") }
    if (operaciones.has(idOrigen)) return { fallo: error(DUPLICADO[tipo], "Ya existe una operación con el mismo idOrigen") }
    const op: OperacionSimulada = { tipo, idOperacion: ++siguiente, idOrigen, pedido, estado: "Enviada a la firma", consultas: 0, creada: ahora().toISOString() }
    operaciones.set(idOrigen, op)
    return { op }
  }

  function vista(op: OperacionSimulada) {
    const base = { idOperacion: op.idOperacion, idOrigen: op.idOrigen, fechaEmision: fechaEmision(), estadoOperacion: { descripcion: op.estado, ...(op.motivo ? { motivo: op.motivo } : {}) } }
    if (op.tipo === "transferencia") return { data: { numeroAdherente: op.pedido.numeroAdherente, ...base, fechaPago: op.pedido.fechaPago, cbuCuentaDebito: op.pedido.cbuCuentaDebito, beneficiarios: (op.pedido.beneficiarios ?? []).map((b: any) => ({ estado: { descripcion: op.estado }, ...b })) } }
    if (op.tipo === "echeq") return { data: { numeroAdherente: op.pedido.numeroAdherente, ...base, cbuCuentaDebito: op.pedido.cbuCuentaDebito, echeqs: (op.pedido.echeqs ?? []).map((c: any, i: number) => ({ estado: { descripcion: op.estado === "Aceptada" ? "Aceptada" : "Confeccionada" }, idCheque: op.estado === "Aceptada" ? `SIM${op.idOperacion}${i}` : null, numeroOrden: String(i), ...c })) } }
    if (op.tipo === "vep") return { data: { ...base, cbuCuentaDebito: op.pedido.cbuCuentaDebito, numeroVep: op.pedido.veps?.[0]?.numeroVep } }
    return { data: { ...base, cbuCuenta: op.pedido.cbuCuenta } }
  }

  const buscar = (q: URLSearchParams) => {
    const idOrigen = q.get("idOrigen"), idOperacion = q.get("idOperacion")
    return idOrigen ? operaciones.get(idOrigen) : [...operaciones.values()].find((o) => String(o.idOperacion) === idOperacion)
  }

  const fetch: FetchBanco = async (url, init) => {
    pedidos++
    const u = new URL(url)
    const ruta = u.pathname
    const cuerpo = init.body && init.headers["Content-Type"] === "application/json" ? JSON.parse(init.body) : null

    // ── token ──
    if (ruta.endsWith("/protocol/openid-connect/token")) {
      const f = new URLSearchParams(init.body ?? "")
      if (f.get("grant_type") !== "client_credentials" || f.get("client_assertion_type") !== "urn:ietf:params:oauth:client-assertion-type:jwt-bearer" || (f.get("client_assertion") ?? "").split(".").length !== 3) {
        return json(401, { error: "invalid_client", error_description: "Client authentication with signed JWT failed" })
      }
      const tk = `sim-${tokens.size + 1}-${f.get("scope")}`
      tokens.add(tk)
      return json(200, { access_token: tk, expires_in: 1800, refresh_expires_in: 0, token_type: "Bearer", "not-before-policy": 0, scope: f.get("scope") })
    }
    const tk = (init.headers.Authorization ?? "").replace(/^Bearer /, "")
    if (!tokens.has(tk)) return json(401, { codigo: 30, descripcion: "AccessToken no válido" })
    const permiso = (scope: string) => tk.endsWith(`-${scope}`)

    // ── cuentas y movimientos ──
    if (ruta === RUTAS.cuentas) {
      if (!permiso("cuentas")) return json(403, { codigo: 30, descripcion: "AccessToken no válido" })
      return json(200, { clarifCuentas: [
        { nroCuenta: "191-008-1234567/8", denominacionCuenta: "CTA CTE SIMULADA", saldo: 700099.28, tipoCuenta: "CC", moneda: "ARS", CBU: "1910081234567892233196" },
        { nroCuenta: "191-008-7654321/0", denominacionCuenta: "CAJA DE AHORRO SIMULADA", saldo: "1500.00", tipoCuenta: "CA", moneda: "ARS", CBU: "1910087654321092233190" },
      ] })
    }
    if (/^\/api\/cuentas\/v2\/.+\/movimientos$/.test(ruta)) {
      const desde = u.searchParams.get("fechaDesde") ?? "", hasta = u.searchParams.get("fechaHasta") ?? ""
      if (!/^\d{8}$/.test(desde) || !/^\d{8}$/.test(hasta)) return json(400, { codigo: 1, descripcion: "Parámetros inválidos" })
      // Las transferencias firmadas en el simulador aparecen como débitos del día
      const hechas = [...operaciones.values()].filter((o) => o.tipo === "transferencia" && o.estado === FINAL_OK.transferencia)
      return json(200, { consMovCtas: [
        { fecha: hasta, descripcion: "ENCABEZADO", indDBCR: "", monto: "700099.28", nroComprobante: "", codOperativo: "", saldo: "700099.28", idTransaccion: "" },
        ...hechas.flatMap((o) => (o.pedido.beneficiarios ?? []).map((b: any, i: number) => ({
          fecha: hasta, descripcion: `TRANSF. INMEDIATA A ${b.nombre}`, indDBCR: "DB", monto: b.monto, nroComprobante: String(o.idOperacion), codOperativo: "0791", saldo: "0.00", idTransaccion: `SIM-${o.idOperacion}-${i}`,
        }))),
        { fecha: desde, descripcion: "TRANSFERENCIA RECIBIDA DE UN CLIENTE", indDBCR: "CR", monto: "125000.50", nroComprobante: "000123", codOperativo: "0792", saldo: "700099.28", idTransaccion: "SIM-CR-1" },
        { fecha: desde, descripcion: "IMPUESTO LEY 25413 DEBITO", indDBCR: "DB", monto: "750.00", nroComprobante: "000124", codOperativo: "0055", saldo: "574348.78", idTransaccion: "SIM-DB-1" },
      ] })
    }

    // ── envíos con firma ──
    const envios: Array<[string, Tipo, string]> = [
      [RUTAS.transferir, "transferencia", "transferenciasConFirma"], [RUTAS.emitirEcheq, "echeq", "echeqConFirma"],
      [RUTAS.gestionEcheq, "gestion", "echeqConFirma"], [RUTAS.pagarVep, "vep", "vepConFirma"],
    ]
    for (const [r, tipo, scope] of envios) {
      if (init.method === "POST" && ruta === r) {
        if (!permiso(scope)) return json(403, { codigo: 30, descripcion: "AccessToken no válido" })
        if (tipo === "transferencia") {
          const bs = cuerpo?.beneficiarios ?? []
          if (!bs.length) return error("APIE-0005", "Sin Beneficiarios")
          if (bs.some((b: any) => !/^\d{22}$/.test(String(b.cbuCvu)))) return error("APIE-0015", "CBU/CVU no válido")
          if (bs.some((b: any) => !/^\d+\.\d{2}$/.test(String(b.monto)))) return error("APIE-0016", "Monto no válido")
          if (bs.some((b: any) => !/^\d{11}$/.test(String(b.cui)))) return error("APIE-0018", "CUIT/CUIL de beneficiario no válido")
        }
        if (tipo === "vep" && (cuerpo?.veps ?? []).length !== 1) return error("APIE-4027", "Solo un VEP por request")
        const { op, fallo } = registrar(tipo, cuerpo)
        if (fallo) return fallo
        if (cortar) { cortar = false; throw new Error("conexión cortada (simulada)") }   // el banco la recibió, pero no llegó la respuesta
        const v = vista(op!) as any
        if (tipo === "vep") return json(200, { data: { idOrigen: op!.idOrigen, operaciones: [{ idOperacion: op!.idOperacion, fechaEmision: fechaEmision(), cbuCuentaDebito: cuerpo.cbuCuentaDebito, estadoOperacion: { descripcion: op!.estado }, numeroVep: cuerpo.veps[0].numeroVep }] } })
        return json(200, v)
      }
    }

    // ── consultas ──
    const consultas: Array<[string, Tipo]> = [[RUTAS.consultaTransferencia, "transferencia"], [RUTAS.consultaEcheq, "echeq"], [RUTAS.consultaPagoVep, "vep"]]
    for (const [r, tipo] of consultas) {
      if (init.method === "GET" && ruta === r) {
        const op = buscar(u.searchParams)
        if (!op || op.tipo !== tipo) return error(tipo === "transferencia" ? "APIE-0026" : tipo === "echeq" ? "APIE-1025" : "APIE-4024", "Id de operación no válido")
        op.consultas++
        if (opciones.firmaSolaAlConsultar && op.consultas >= opciones.firmaSolaAlConsultar && op.estado === "Enviada a la firma") op.estado = FINAL_OK[op.tipo]
        return json(200, vista(op))
      }
    }

    // ── listados ──
    if (init.method === "POST" && ruta === RUTAS.listarEcheqs) {
      const recibidos = cuerpo?.filtro?.gestion === "RECIBIDOS"
      // Un e-cheq endosado y firmado ya no figura ACTIVO
      const endosados = new Set([...operaciones.values()].filter((o) => o.tipo === "gestion" && o.pedido.accion === "ENDOSAR" && o.estado === FINAL_OK.gestion).flatMap((o) => (o.pedido.echeqs ?? []).map((c: any) => c.idCheque)))
      const todos = recibidos ? [
        { chequeId: "JWV9J0JWAAM2QMD", numeroCheque: "00603430", cmc7completo: "19134335611012340603430010005", estado: endosados.has("JWV9J0JWAAM2QMD") ? "ACTIVO-PENDIENTE" : "ACTIVO", bancoCodigo: "191", bancoNombre: "BANCO CREDICOOP", caracter: "A LA ORDEN", fechaPago: { formatter: "yyyy-MM-dd'T'HH:mm:ss", value: "2026-12-10T00:00:00" }, monto: "250000.00", emisorCuit: "30712345678", emisorRazonSocial: "CLIENTE SIMULADO SA", moneda: "ARS" },
      ] : []
      const num = String(cuerpo?.filtro?.numeroCheque ?? "")
      const idPedido = String(cuerpo?.filtro?.idCheque ?? "")
      const filtrados = todos.filter((c) => (!num || c.numeroCheque.endsWith(num.replace(/^0+/, "")) || c.numeroCheque === num) && (!idPedido || c.chequeId === idPedido))
      return json(200, { data: { numeroAdherente: cuerpo?.numeroAdherente, idOrigen: cuerpo?.idOrigen, echeqs: filtrados, totalCheques: filtrados.length } })
    }
    if (init.method === "POST" && ruta === RUTAS.listarVeps) {
      const pagados = new Set([...operaciones.values()].filter((o) => o.tipo === "vep" && o.estado === FINAL_OK.vep).map((o) => String(o.pedido.veps[0].numeroVep)))
      const veps = [
        { numeroVep: 55366315, descripcion: "IVA - Declaración jurada mensual", concepto: "DECLARACION JURADA", subconcepto: "DECLARACION JURADA", periodoFiscal: "10/2026", fechaVencimiento: "20/11/26 - 23:59:00", monto: "1850000.00", moneda: "ARS", cuitOriginante: "30541234501", cuitContribuyente: "30541234501" },
        { numeroVep: 55366399, descripcion: "SICORE - Retenciones", concepto: "PAGO A CUENTA", subconcepto: "PAGO A CUENTA", periodoFiscal: "11/2026", fechaVencimiento: "24/11/26 - 23:59:00", monto: "42750.50", moneda: "ARS", cuitOriginante: "30541234501", cuitContribuyente: "30541234501" },
      ].map((v) => ({ estado: pagados.has(String(v.numeroVep)) ? "PAGADO" : "PENDIENTE_PAGO", ...v }))
      const filtro = cuerpo?.filtro?.estado
      const lista = veps.filter((v) => !filtro || v.estado === filtro)
      return json(200, { data: { numeroAdherente: cuerpo?.numeroAdherente, idOrigen: cuerpo?.idOrigen, veps: lista, totalVeps: lista.length } })
    }

    return json(404, { codigo: 1, descripcion: `Ruta desconocida: ${init.method} ${ruta}` })
  }

  return {
    fetch,
    /** Lo que haría una persona con el token en Banca Internet Empresa */
    firmar(idOrigen: string) { const op = operaciones.get(idOrigen); if (op) op.estado = FINAL_OK[op.tipo]; return !!op },
    rechazar(idOrigen: string, motivo = "Fondos insuficientes") { const op = operaciones.get(idOrigen); if (op) { op.estado = "Rechazada"; op.motivo = motivo } return !!op },
    cortarProximoEnvio() { cortar = true },
    operacion: (idOrigen: string) => operaciones.get(idOrigen) ?? null,
    get pedidos() { return pedidos },
    get cantidad() { return operaciones.size },
  }
}

export type SimuladorCredicoop = ReturnType<typeof crearSimuladorCredicoop>
