/**
 * Quién carga / cambia / marca pagado un vencimiento (migración 20261105_jarvis_quien_hizo).
 *
 * Las rutas usan la clave de servicio, así que la base no sabe quién es el
 * usuario: se lo mandamos en `creado_por` / `actualizado_por` y el disparador
 * lo pasa a `pagado_por` y al historial.
 *
 * Mientras la migración no esté aplicada esas columnas no existen: la escritura
 * se reintenta sin ellas, así nunca se frena un pago por esto.
 */
type Resp = { data: any; error: any }

const columnaFaltante = (e: unknown) => {
  const c = (e as { code?: string })?.code
  return c === "PGRST204" || c === "42703"
}

export async function conResponsable(
  escribir: (extra: Record<string, string>) => PromiseLike<Resp>,
  extra: Record<string, string>,
): Promise<Resp> {
  const r = await escribir(extra)
  if (r.error && columnaFaltante(r.error)) return escribir({})
  return r
}
