// Tipos del registro de mutaciones (separados de handlers.ts para que los
// handlers de cada app los importen sin ciclo). Contrato: ver handlers.ts.

import type { MutacionOutbox } from "../contrato"
import type { SesionMobile } from "../sesion"

export class RechazoNegocio extends Error {
  /** datos: detalle para la app (p. ej. los artículos sin precio), viaja en la respuesta */
  constructor(message: string, public codigo?: string, public datos?: Record<string, unknown>) {
    super(message)
  }
}

export interface CtxOutbox {
  request: Request
  supabase: any
  admin: any
  sesion: SesionMobile
}

export interface HandlerDef<P = any> {
  tipo: string
  /** Roles que pueden ejecutarla (admin siempre) */
  roles: string[]
  /** Validación de forma; devolver string = rechazo definitivo */
  validar?(payload: P): string | null
  aplicar(ctx: CtxOutbox, m: MutacionOutbox<P>): Promise<unknown>
}
