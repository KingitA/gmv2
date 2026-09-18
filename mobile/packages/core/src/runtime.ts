import type { AppMovil } from "@gm/contrato"
import { Auth } from "./auth/auth"
import { abrirDb, kvGet, kvSet, type Db } from "./db/idb"
import { uuidv4 } from "./emitter"
import { Api } from "./net/api"
import { crearAlmacenSeguro } from "./platform/almacen-seguro"
import { alCambiarPrimerPlano } from "./platform/ciclo-vida"
import { crearConectividad, type Conectividad } from "./platform/conectividad"
import { Outbox } from "./sync/outbox"
import { Reloj } from "./sync/reloj"
import { Replica } from "./sync/replica"
import { Sincronizador, type DefDataset } from "./sync/sincronizador"

export interface ConfigApp {
  app: AppMovil
  /** URL del ERP (VITE_API_BASE). Ej: https://gmv2.vercel.app */
  apiBase: string
  /** versionName del APK (lo inyecta el build) */
  version: string
  datasets: DefDataset[]
  /**
   * true (default): los datasets dependen del usuario ⇒ al ingresar otro usuario se
   * limpia la réplica del anterior. false: todos ven lo mismo (depósito) ⇒ el cambio
   * de turno no re-descarga nada.
   */
  replicaPorUsuario?: boolean
}

export interface Runtime {
  config: ConfigApp
  db: Db
  deviceId: string
  api: Api
  auth: Auth
  replica: Replica
  outbox: Outbox
  sync: Sincronizador
  reloj: Reloj
  red: Conectividad
  /** Cierra sesión. Falla si hay operaciones sin enviar (nunca se pierden datos). */
  salir(): Promise<void>
  /**
   * Cambio de turno en un equipo compartido: vuelve al login SIEMPRE. Si el que se
   * va tiene operaciones sin enviar, su sesión queda aparcada y el outbox las
   * termina de enviar con ella (Auth.aparcar); si no, es un logout normal.
   */
  cambiarUsuario(): Promise<void>
}

/** Forma de `resultado.replica` que devuelven los handlers del outbox (parche de réplica). */
interface ParcheReplica {
  dataset: string
  upserts?: Array<{ id: string; [k: string]: unknown }>
  deletes?: string[]
}

/**
 * Arma el runtime de una app. Todo lo que necesita la UI para arrancar SIN RED
 * sale de IndexedDB y del almacén seguro: esta función no hace ningún request.
 */
export async function crearRuntime(config: ConfigApp): Promise<Runtime> {
  const db = await abrirDb(`gm-${config.app}`)
  let deviceId = await kvGet<string>(db, "deviceId")
  if (!deviceId) {
    deviceId = uuidv4()
    await kvSet(db, "deviceId", deviceId)
  }
  const red = await crearConectividad()
  const reloj = new Reloj(db)
  await reloj.cargar()

  const api = new Api({ base: config.apiBase.replace(/\/+$/, ""), deviceId, appVersion: config.version })
  const auth = new Auth(api, crearAlmacenSeguro(`gm.${config.app}`), config.app)
  const replica = new Replica(db, api)
  const outbox = new Outbox(
    db,
    api,
    {
      app: config.app,
      deviceId,
      appVersion: config.version,
      usuarioActual: () => auth.sesion?.user.id ?? null,
      tokenDe: (uid, forzar) => auth.tokenAparcado(uid, forzar),
    },
    reloj.ahora,
  )
  const sync = new Sincronizador(api, replica, outbox, red, reloj, { datasets: config.datasets })

  await Promise.all([auth.iniciar(), replica.cargarMetas(), outbox.iniciar()])

  // El servidor devuelve las filas ya actualizadas al aplicar una operación: se
  // vuelcan a la réplica ANTES de marcarla enviada (Outbox O9).
  const declarados = new Set(config.datasets.map((d) => d.nombre))
  outbox.onAplicado(async (item) => {
    const parches = (item.resultado as { replica?: ParcheReplica[] } | null)?.replica
    if (!Array.isArray(parches)) return
    for (const p of parches) {
      if (p && declarados.has(p.dataset)) await replica.parchear(p.dataset, p.upserts ?? [], p.deletes ?? [])
    }
  })

  // Un rechazo significa que el servidor tiene otra verdad: re-leer ya.
  // Y las sesiones aparcadas que ya no tienen nada pendiente se descartan.
  let rechazadosVistos = outbox.contadores.rechazados
  let limpiando = false
  outbox.suscribir(() => {
    const c = outbox.contadores
    if (c.rechazados > rechazadosVistos && red.online) void sync.todo()
    rechazadosVistos = c.rechazados
    if (c.enviando || limpiando) return
    limpiando = true
    void (async () => {
      try {
        const aparcadas = await auth.aparcadas()
        if (aparcadas.length) {
          const conPendientes = await outbox.usuariosConPendientes()
          for (const u of aparcadas) if (!conPendientes.has(u.id)) await auth.descartarAparcada(u.id, true)
        }
      } finally {
        limpiando = false
      }
    })()
  })

  // Otro usuario en el mismo equipo: la réplica del anterior no le corresponde
  auth.suscribir(() => {
    const uid = auth.sesion?.user.id
    if (!uid) {
      sync.detener()
      return
    }
    void (async () => {
      const previo = await kvGet<string>(db, "ultimoUsuario")
      if (previo && previo !== uid && config.replicaPorUsuario !== false) for (const d of config.datasets) await replica.limpiar(d.nombre)
      await kvSet(db, "ultimoUsuario", uid)
      sync.iniciar()
    })()
  })
  if (auth.estado === "autenticado") sync.iniciar()
  alCambiarPrimerPlano((activo) => sync.setPrimerPlano(activo))

  return {
    config, db, deviceId, api, auth, replica, outbox, sync, reloj, red,
    async salir() {
      if (outbox.contadores.pendientes > 0) {
        throw new Error(`Hay ${outbox.contadores.pendientes} operación(es) sin enviar. Conectate a internet y esperá a que se envíen antes de salir.`)
      }
      await auth.salir()
    },
    async cambiarUsuario() {
      const uid = auth.sesion?.user.id
      if (uid && (await outbox.usuariosConPendientes()).has(uid)) await auth.aparcar()
      else await auth.salir()
    },
  }
}
