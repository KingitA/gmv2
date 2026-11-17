/**
 * Ajuste ÚNICO del envío de órdenes de compra por mail: de qué cuenta salen, si está encendido
 * el MODO PRUEBA y a qué dirección van las pruebas. Vive en una fila de la base
 * (`compras_envio_ajustes`, migración 20261117n); no en el navegador ni en el código.
 *
 * Decisión de Juan (17/11/2026): «megasur.proveedores@gmail.com es la cuenta, ojo igual, si
 * hacemos pruebas con mails reales de los proveedores nos puede llegar una compra con la que
 * estamos haciendo pruebas. Todos los mails de prueba deben salir de
 * megasur.proveedores@gmail.com a juancruzrossi072@gmail.com, cuando pasemos a producción se
 * pasan a los mail que corresponde.»
 *
 * FALLA SEGURA: si la fila no se puede leer (falta la migración, error de la base, datos
 * inválidos) NO se envía nada. Nunca se cae a "mandar al proveedor".
 * Solo servidor.
 */
import { mailValido, type AjustesEnvio } from "@/lib/compras/mail-orden"
import { MIGRACION_OC } from "@/lib/compras/orden-compra"

/** Frase exacta que hay que mandar para APAGAR el modo prueba (confirmación explícita). */
export const CONFIRMACION_APAGAR_PRUEBA = "A partir de ahora los mails van a los proveedores reales"

export type LecturaAjustesEnvio =
  | { ok: true; ajustes: AjustesEnvio; actualizado_at: string | null; actualizado_por: string | null }
  | { ok: false; motivo: string }

export async function leerAjustesEnvio(supabase: any): Promise<LecturaAjustesEnvio> {
  try {
    const { data, error } = await supabase.from("compras_envio_ajustes").select("cuenta_envio, modo_prueba, mail_prueba, actualizado_at, actualizado_por").limit(1).maybeSingle()
    if (error || !data) {
      return { ok: false, motivo: `No se pudo leer el ajuste de envío de órdenes (falta aplicar la migración ${MIGRACION_OC}, o hubo un error de la base). Por seguridad no se envía ningún mail hasta que se pueda leer.` }
    }
    const cuenta = String(data.cuenta_envio || "").trim().toLowerCase()
    const prueba = String(data.mail_prueba || "").trim().toLowerCase()
    // cualquier valor que no sea exactamente `false` cuenta como modo prueba
    const modoPrueba = data.modo_prueba !== false
    if (!mailValido(cuenta)) return { ok: false, motivo: "La cuenta de envío de órdenes configurada no es un mail válido. Por seguridad no se envía nada: corregila en el ajuste de envío." }
    if (modoPrueba && !mailValido(prueba)) return { ok: false, motivo: "El modo prueba está encendido pero la dirección de prueba no es un mail válido. Por seguridad no se envía nada: corregila en el ajuste de envío." }
    let nombre: string | null = null
    if (data.actualizado_por) {
      const { data: u } = await supabase.from("usuarios").select("nombre").eq("id", data.actualizado_por).maybeSingle()
      nombre = (u as any)?.nombre ?? null
    }
    return { ok: true, ajustes: { cuenta_envio: cuenta, modo_prueba: modoPrueba, mail_prueba: prueba }, actualizado_at: data.actualizado_at ?? null, actualizado_por: nombre }
  } catch {
    return { ok: false, motivo: "No se pudo leer el ajuste de envío de órdenes. Por seguridad no se envía ningún mail." }
  }
}

/** Cómo conectar la cuenta de envío cuando no está conectada (texto para la pantalla). */
export const comoConectarCuenta = (cuenta: string) =>
  `La cuenta ${cuenta} no está conectada al sistema. Para conectarla: entrá a Gmail con ${cuenta} en este navegador, abrí el asistente del sistema, tocá "Conectar Gmail", elegí esa cuenta y aceptá todos los permisos que pide Google. Después volvé a abrir esta ventana.`
