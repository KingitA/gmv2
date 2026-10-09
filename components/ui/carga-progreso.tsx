'use client'

// Espera "trabajando": en vez de un redondel girando, una barra que avanza y
// mensajes que van cambiando, para que se note que el sistema está haciendo algo.
// La barra es estimada (avanza rápido al principio y se frena cerca del final);
// cuando el trabajo termina, el que la usa simplemente deja de mostrarla.

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

export const MENSAJES = {
  general: ['Conectando con la base…', 'Buscando los datos…', 'Ordenando la información…', 'Armando la pantalla…', 'Ya casi está…'],
  pedidos: ['Buscando pedidos…', 'Sumando totales…', 'Revisando estados y prioridades…', 'Cruzando clientes y vendedores…', 'Ordenando por fecha…', 'Ya casi está…'],
  clientes: ['Buscando clientes…', 'Leyendo direcciones y localidades…', 'Calculando puntajes…', 'Ordenando por nombre…', 'Ya casi está…'],
  importarPedido: [
    'Leyendo archivo…', 'Reconociendo el formato…', 'Descifrando cantidades…', 'Obteniendo SKUs…',
    'Buscando artículos en el catálogo…', 'Aplicando listas y descuentos del cliente…', 'Cargando artículos al pedido…', 'Últimos controles…',
  ],
  comprobantes: ['Calculando importes…', 'Aplicando IVA y percepciones…', 'Numerando comprobantes…', 'Generando el PDF…', 'Ya casi está…'],
  viajes: ['Buscando viajes…', 'Ubicando zonas y choferes…', 'Contando pedidos y bultos…', 'Armando el calendario…'],
  fichaCliente: ['Buscando el cliente…', 'Leyendo listas y descuentos…', 'Revisando su cuenta corriente…', 'Trayendo sus últimos pedidos…', 'Ya casi está…'],
  vencimientos: ['Buscando vencimientos…', 'Sumando lo que sale por día…', 'Revisando cheques y transferencias…', 'Armando el calendario…'],
  ordenesCompra: ['Buscando la orden de compra…', 'Trayendo artículos y cantidades…', 'Revisando comprobantes del proveedor…', 'Ya casi está…'],
  cuentaCorriente: ['Buscando movimientos…', 'Sumando debe y haber…', 'Calculando el saldo…', 'Ordenando por fecha…', 'Ya casi está…'],
  tablas: ['Buscando los registros…', 'Ordenando la tabla…', 'Armando la lista…', 'Ya casi está…'],
  articulos: ['Buscando artículos…', 'Leyendo precios y proveedores…', 'Ordenando el catálogo…', 'Ya casi está…'],
  devoluciones: ['Buscando devoluciones…', 'Trayendo artículos y cantidades…', 'Cruzando con los pedidos…', 'Ya casi está…'],
  pagos: ['Buscando órdenes de pago…', 'Sumando importes y retenciones…', 'Revisando comprobantes…', 'Ya casi está…'],
  finanzas: ['Buscando cuentas y cajas…', 'Sumando saldos…', 'Revisando movimientos…', 'Ya casi está…'],
  ocrComprobante: ['Subiendo el archivo…', 'Leyendo el comprobante…', 'Reconociendo importes e impuestos…', 'Ya casi está…'],
} as const

interface Props {
  mensajes?: readonly string[]
  /** Texto fijo arriba de los mensajes (opcional). */
  titulo?: string
  /** Versión chica para dentro de una fila o tarjeta. */
  compacto?: boolean
  /** Progreso real 0-100 si se conoce; si no, se estima. */
  progreso?: number
  className?: string
}

export function CargaProgreso({ mensajes = MENSAJES.general, titulo, compacto, progreso, className }: Props) {
  const [paso, setPaso] = useState(0)
  const [estimado, setEstimado] = useState(4)

  useEffect(() => {
    const t = setInterval(() => setPaso(p => p + 1), 1700)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (progreso != null) return
    // Se acerca al 95% cada vez más despacio (nunca llega solo al 100%)
    const t = setInterval(() => setEstimado(e => e + (95 - e) * 0.06), 300)
    return () => clearInterval(t)
  }, [progreso])

  // Avanza por los mensajes y se queda en el último (no vuelve a empezar)
  const msg = mensajes[Math.min(paso, mensajes.length - 1)]
  const pct = Math.max(2, Math.min(100, progreso ?? estimado))

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn('normal-case', compacto ? 'w-full space-y-1.5' : 'mx-auto w-full max-w-md space-y-3 px-6 py-10 text-center', className)}
    >
      {titulo && !compacto && <div className="text-sm font-semibold text-slate-700">{titulo}</div>}
      <div className={cn('relative overflow-hidden rounded-full bg-slate-200', compacto ? 'h-1.5' : 'h-2')}>
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-blue-600 transition-[width] duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
        <div
          className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/50 to-transparent"
          style={{ animation: 'carga-brillo 1.4s linear infinite' }}
        />
      </div>
      <div className={cn('text-slate-500', compacto ? 'text-[11px]' : 'text-xs')}>{msg}</div>
    </div>
  )
}
