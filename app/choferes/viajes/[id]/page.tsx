import { redirect } from 'next/navigation';
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { PedidoItem } from "@/components/viajes/pedido-item";
import type { Viaje, Pedido } from "@/lib/types";

const ArrowLeftIcon = () => (
  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
  </svg>
);

const CalendarIcon = () => (
  <svg className="h-5 w-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
  </svg>
);

const TruckIcon = () => (
  <svg className="h-5 w-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6 0a1 1 0 001 1h4a1 1 0 001-1m-6 0h6" />
  </svg>
);

const DollarSignIcon = () => (
  <svg className="h-6 w-6 text-primary shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const InfoIcon = () => (
  <svg className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

export default async function ViajeDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: choferes } = await supabase
    .from('usuarios')
    .select(`
      id,
      nombre,
      email,
      usuarios_roles!inner(
        roles!inner(nombre)
      )
    `)
    .eq('usuarios_roles.roles.nombre', 'chofer')
    .eq('estado', 'activo')
    .limit(1);

  if (!choferes || choferes.length === 0) {
    redirect("/choferes/viajes");
  }

  const choferId = choferes[0].id;

  const { data: viaje, error: viajeError } = await supabase
    .from('viajes')
    .select('*')
    .eq('id', id)
    .eq('chofer_id', choferId)
    .single();

  if (viajeError || !viaje) {
    redirect("/choferes/viajes");
  }

  // Obtener pedidos del viaje
  const { data: pedidos, error: pedidosError } = await supabase
    .from('pedidos')
    .select(`
      id,
      numero_pedido,
      fecha,
      estado,
      total,
      bultos,
      observaciones,
      clientes (
        id,
        nombre,
        razon_social,
        direccion,
        telefono,
        localidad
      )
    `)
    .eq('viaje_id', id)
    .order('numero_pedido', { ascending: true });

  // Obtener saldos anteriores para cada pedido
  const pedidosConSaldo: Pedido[] = await Promise.all((pedidos || []).map(async (pedido: any) => {
    console.log('[v0] Pedido:', pedido.numero_pedido, 'Estado original:', pedido.estado);

    const cliente = Array.isArray(pedido.clientes) ? pedido.clientes[0] : pedido.clientes;

    // Calcular saldo anterior
    const { data: comprobantes } = await supabase
      .from('comprobantes_venta')
      .select('saldo_pendiente')
      .eq('cliente_id', cliente?.id)
      .neq('pedido_id', pedido.id)
      .gt('saldo_pendiente', 0);

    const saldoAnterior = comprobantes?.reduce((sum, c) => sum + (Number(c.saldo_pendiente) || 0), 0) || 0;

    const pedidoConSaldo = {
      id: pedido.id,
      numero_pedido: pedido.numero_pedido,
      fecha: pedido.fecha,
      estado: pedido.estado, // Ya no forzamos el tipo
      cliente_id: cliente?.id || '',
      cliente_nombre: cliente?.nombre || cliente?.razon_social || 'Sin nombre',
      direccion: cliente?.direccion,
      telefono: cliente?.telefono,
      localidad: cliente?.localidad,
      bultos: pedido.bultos || 0,
      saldo_anterior: saldoAnterior,
      saldo_actual: Number(pedido.total) || 0,
      total: saldoAnterior + (Number(pedido.total) || 0),
      observaciones: pedido.observaciones,
    };

    console.log('[v0] Pedido procesado:', pedido.numero_pedido, 'Estado final:', pedidoConSaldo.estado);

    return pedidoConSaldo;
  }));

  // Obtener resumen de pagos
  const { data: pagos } = await supabase
    .from('viajes_pagos')
    .select('monto, forma_pago')
    .eq('viaje_id', id);

  const totalEfectivo = pagos?.filter(p => p.forma_pago === 'efectivo').reduce((sum, p) => sum + (Number(p.monto) || 0), 0) || 0;
  const cantidadCheques = pagos?.filter(p => p.forma_pago === 'cheque').length || 0;
  const cantidadTransferencias = pagos?.filter(p => p.forma_pago === 'transferencia').length || 0;
  const totalCobrado = pagos?.reduce((sum, p) => sum + (Number(p.monto) || 0), 0) || 0;

  const dineroTotalGastos =
    (Number(viaje.dinero_nafta) || 0) +
    (Number(viaje.gastos_peon) || 0) +
    (Number(viaje.gastos_hotel) || 0) +
    (Number(viaje.gastos_adicionales) || 0);

  const estadoConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
    pendiente: { label: 'Pendiente', variant: 'secondary' },
    asignado: { label: 'Asignado', variant: 'default' },
    en_curso: { label: 'En Curso', variant: 'default' },
    completado: { label: 'Completado', variant: 'outline' },
    cancelado: { label: 'Cancelado', variant: 'destructive' },
  };

  const estadoNormalizado = viaje.estado?.toString().toLowerCase().trim() || 'pendiente';
  const config = estadoConfig[estadoNormalizado] || {
    label: viaje.estado || 'Sin estado',
    variant: 'secondary' as const
  };

  const puedeRealizarOperaciones = estadoNormalizado === 'asignado' || estadoNormalizado === 'en_curso';
  console.log('[v0] Estado del viaje:', estadoNormalizado, 'Puede realizar operaciones:', puedeRealizarOperaciones);

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 to-accent/5">
      {/* Header */}
      <header className="bg-card border-b border-border shadow-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <Link href="/choferes/viajes">
              <Button variant="ghost" size="icon">
                <ArrowLeftIcon />
              </Button>
            </Link>
            <div className="flex-1">
              <h1 className="text-xl font-bold line-clamp-1">{viaje.nombre}</h1>
              <p className="text-sm text-muted-foreground">
                {pedidosConSaldo.length} pedidos
              </p>
            </div>
            <Badge variant={config.variant}>
              {config.label}
            </Badge>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-6 space-y-6 pb-24">
        <Card className="shadow-md">
          <CardContent className="p-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-3">
                <CalendarIcon />
                <div>
                  <p className="text-xs text-muted-foreground">Fecha</p>
                  <p className="font-bold text-base">
                    {new Date(viaje.fecha).toLocaleDateString('es-AR')}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <TruckIcon />
                <div>
                  <p className="text-xs text-muted-foreground">Vehículo</p>
                  <p className="font-bold text-base">{viaje.vehiculo}</p>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t">
              <div className="flex items-center gap-3 bg-primary/5 p-4 rounded-lg">
                <DollarSignIcon />
                <div className="flex-1">
                  <p className="text-sm text-muted-foreground font-medium">Dinero para gastos</p>
                  <p className="text-3xl font-bold text-primary">
                    ${dineroTotalGastos.toLocaleString('es-AR')}
                  </p>
                </div>
              </div>
            </div>

            {viaje.observaciones && (
              <div className="pt-4 border-t">
                <div className="flex items-start gap-2">
                  <InfoIcon />
                  <div>
                    <p className="text-xs text-muted-foreground mb-1 font-medium">Observaciones</p>
                    <p className="text-sm">{viaje.observaciones}</p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Tabla de Pedidos */}
        <div>
          <h2 className="text-xl font-bold mb-4">Pedidos del Viaje</h2>

          {!puedeRealizarOperaciones && (
            <Card className="shadow-md mb-4 bg-muted/50">
              <CardContent className="py-4">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <InfoIcon />
                  <p className="text-sm font-medium">
                    Viaje finalizado. No se pueden registrar operaciones.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {pedidosConSaldo.length === 0 ? (
            <Card className="shadow-md">
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground">No hay pedidos en este viaje</p>
              </CardContent>
            </Card>
          ) : (
            <Card className="shadow-md overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-muted">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase">Cliente</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase">Dirección</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold uppercase">Bultos</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase">Saldo Ant.</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase">Saldo Act.</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold uppercase">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {pedidosConSaldo.map((pedido) => (
                      <tr key={pedido.id} className="hover:bg-muted/50 transition-colors">
                        <td className="px-4 py-4">
                          <div>
                            <p className="font-bold text-base">{pedido.cliente_nombre}</p>
                            <p className="text-xs text-muted-foreground">#{pedido.numero_pedido}</p>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <div>
                            <p className="text-sm">{pedido.direccion || 'Sin dirección'}</p>
                            {pedido.localidad && (
                              <p className="text-xs text-muted-foreground">{pedido.localidad}</p>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-4 text-center">
                          <span className="font-bold text-lg">{pedido.bultos}</span>
                        </td>
                        <td className="px-4 py-4 text-right">
                          <span className="font-bold text-base">
                            ${pedido.saldo_anterior.toLocaleString('es-AR')}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-right">
                          <span className="font-bold text-base">
                            ${pedido.saldo_actual.toLocaleString('es-AR')}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          {puedeRealizarOperaciones ? (
                            <div className="flex items-center justify-center gap-2">
                              <Link href={`/choferes/viajes/${id}/devolucion?pedido=${pedido.id}`}>
                                <Button variant="outline" size="sm" className="whitespace-nowrap">
                                  Generar Devolución
                                </Button>
                              </Link>
                              <Link href={`/choferes/viajes/${id}/pago?pedido=${pedido.id}`}>
                                <Button variant="default" size="sm" className="whitespace-nowrap">
                                  Imputar Pago
                                </Button>
                              </Link>
                            </div>
                          ) : (
                            <div className="flex items-center justify-center">
                              <span className="text-xs text-muted-foreground">-</span>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
