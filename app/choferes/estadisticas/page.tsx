export const dynamic = 'force-dynamic'
import { redirect } from 'next/navigation';
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, TrendingUp, Package, MapPin, Moon, DollarSign, CheckCircle } from 'lucide-react';
import Link from "next/link";

export default async function EstadisticasPage() {
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
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary/5 to-accent/5 flex items-center justify-center">
        <Card className="max-w-md mx-auto">
          <CardHeader>
            <CardTitle>No hay choferes disponibles</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">No se encontraron choferes en el sistema.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const choferId = choferes[0].id;

  // Obtener mes actual
  const now = new Date();
  const mesActual = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const primerDiaMes = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const ultimoDiaMes = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();

  const { data: viajes } = await supabase
    .from('viajes')
    .select(`
      id,
      estado,
      gastos_hotel,
      zona_id,
      zonas (
        nombre
      )
    `)
    .eq('chofer_id', choferId)
    .gte('fecha', primerDiaMes)
    .lte('fecha', ultimoDiaMes);

  const totalViajes = viajes?.length || 0;
  const viajesFinalizados = viajes?.filter(v => v.estado === 'finalizado').length || 0;
  const pernoctadas = viajes?.filter(v => v.gastos_hotel > 0).length || 0;

  // Obtener pedidos entregados
  const viajesIds = viajes?.map(v => v.id) || [];
  const { count: pedidosEntregados } = await supabase
    .from('pedidos')
    .select('*', { count: 'exact', head: true })
    .in('viaje_id', viajesIds.length > 0 ? viajesIds : [''])
    .eq('estado', 'entregado');

  // Obtener total facturado
  const { data: pedidos } = await supabase
    .from('pedidos')
    .select('total')
    .in('viaje_id', viajesIds.length > 0 ? viajesIds : ['']);

  const totalFacturado = pedidos?.reduce((sum, p) => sum + (Number(p.total) || 0), 0) || 0;

  // Obtener total cobrado
  const { data: pagos } = await supabase
    .from('viajes_pagos')
    .select('monto')
    .in('viaje_id', viajesIds.length > 0 ? viajesIds : ['']);

  const totalCobrado = pagos?.reduce((sum, p) => sum + (Number(p.monto) || 0), 0) || 0;

  // Zonas visitadas
  const zonasUnicas = new Set(viajes?.map(v => {
    const zona = Array.isArray(v.zonas) ? v.zonas[0] : v.zonas;
    return (zona as any)?.nombre;
  }).filter(Boolean));
  const kilometrosEstimados = totalViajes * 250; // Estimación

  const stats = [
    {
      icon: Package,
      label: "Total de Viajes",
      value: totalViajes,
      suffix: "",
      color: "text-primary",
      bgColor: "bg-primary/10",
    },
    {
      icon: CheckCircle,
      label: "Viajes Finalizados",
      value: viajesFinalizados,
      suffix: "",
      color: "text-success",
      bgColor: "bg-success/10",
    },
    {
      icon: MapPin,
      label: "Kilómetros Recorridos",
      value: kilometrosEstimados,
      suffix: " km",
      color: "text-accent",
      bgColor: "bg-accent/10",
    },
    {
      icon: Moon,
      label: "Pernoctadas",
      value: pernoctadas,
      suffix: "",
      color: "text-purple-600",
      bgColor: "bg-purple-100",
    },
    {
      icon: DollarSign,
      label: "Total Facturado",
      value: `$${totalFacturado.toLocaleString('es-AR')}`,
      suffix: "",
      color: "text-primary",
      bgColor: "bg-primary/10",
    },
    {
      icon: CheckCircle,
      label: "Pedidos Entregados",
      value: pedidosEntregados || 0,
      suffix: "",
      color: "text-success",
      bgColor: "bg-success/10",
    },
    {
      icon: DollarSign,
      label: "Total Cobrado",
      value: `$${totalCobrado.toLocaleString('es-AR')}`,
      suffix: "",
      color: "text-accent",
      bgColor: "bg-accent/10",
    },
    {
      icon: MapPin,
      label: "Zonas Visitadas",
      value: zonasUnicas.size,
      suffix: "",
      color: "text-primary",
      bgColor: "bg-primary/10",
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 to-accent/5">
      {/* Header */}
      <header className="bg-card border-b border-border shadow-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <Link href="/choferes/dashboard">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div className="flex-1">
              <h1 className="text-xl font-bold">Estadísticas</h1>
              <p className="text-sm text-muted-foreground">
                {new Date().toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}
              </p>
            </div>
            <Badge variant="outline" className="shrink-0">
              Mes Actual
            </Badge>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-6 space-y-6">
        {/* Resumen */}
        <Card className="shadow-md bg-gradient-to-br from-primary/10 to-accent/10 border-primary/20">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Resumen del Período
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 text-center">
              <div>
                <p className="text-3xl font-bold text-primary">{totalViajes}</p>
                <p className="text-sm text-muted-foreground mt-1">Viajes Totales</p>
              </div>
              <div>
                <p className="text-3xl font-bold text-success">{viajesFinalizados}</p>
                <p className="text-sm text-muted-foreground mt-1">Finalizados</p>
              </div>
            </div>
            {totalViajes > 0 && (
              <div className="mt-4 pt-4 border-t">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Tasa de Finalización</span>
                  <span className="font-bold text-success">
                    {Math.round((viajesFinalizados / totalViajes) * 100)}%
                  </span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Grid de Estadísticas */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {stats.map((stat, index) => {
            const Icon = stat.icon;
            return (
              <Card key={index} className="shadow-md">
                <CardContent className="pt-6">
                  <div className="flex items-start gap-4">
                    <div className={`p-3 rounded-full ${stat.bgColor} shrink-0`}>
                      <Icon className={`h-6 w-6 ${stat.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-muted-foreground mb-1">
                        {stat.label}
                      </p>
                      <p className={`text-2xl font-bold ${stat.color} truncate`}>
                        {stat.value}{stat.suffix}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Zonas visitadas */}
        {zonasUnicas.size > 0 && (
          <Card className="shadow-md">
            <CardHeader>
              <CardTitle className="text-lg">Zonas Visitadas</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {Array.from(zonasUnicas).map((zona, index) => (
                  <Badge key={index} variant="secondary" className="text-sm">
                    {zona}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Información adicional */}
        <Card className="shadow-md border-accent/20">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-full bg-accent/10">
                <TrendingUp className="h-5 w-5 text-accent" />
              </div>
              <div className="flex-1">
                <p className="font-semibold mb-1">Rendimiento</p>
                <p className="text-sm text-muted-foreground">
                  {totalViajes > 0
                    ? `Has completado ${viajesFinalizados} de ${totalViajes} viajes este mes, con un promedio de ${Math.floor((pedidosEntregados || 0) / (viajesFinalizados || 1))} pedidos por viaje.`
                    : "No hay viajes registrados este mes."}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

