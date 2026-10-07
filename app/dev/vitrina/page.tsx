// Vitrina de componentes del rediseño — SOLO en desarrollo local (next dev).
// En producción responde 404 y el middleware no la libera (ver lib/supabase/middleware.ts).
// Sirve para revisar pantallas/modales con datos de ejemplo sin iniciar sesión.
import { notFound } from "next/navigation"
import { VitrinaCliente } from "./vitrina-cliente"

export default function Vitrina() {
  if (process.env.NODE_ENV !== "development") notFound()
  return <VitrinaCliente />
}
