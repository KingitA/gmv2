export const dynamic = 'force-dynamic'
import { createClient } from "@/lib/supabase/server";
import { ViajeCard } from "@/components/viajes/viaje-card";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from 'lucide-react';
import Link from "next/link";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Viaje } from "@/lib/types";

export default async function ViajesPage() {
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

  console.log('[v0] Choferes encontrados:', choferes?.length || 0);

  // Si no hay choferes, mostrar mensaje
  if (!choferes || choferes.length === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary/5 to-accent/5">
        <header className="bg-card border-b border-border shadow-sm sticky top-0 z-10">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center gap-3">
              <Link href="/choferes/dashboard">
                <Button variant="ghost" size="icon">
                  <ArrowLeft className="h-5 w-5" />
                </Button>
              </Link>
              <div>
                <h1 className="text-xl font-bold">Mis Viajes</h1>
              </div>
            </div>
          </div>
        </header>
        <main className="container mx-auto px-4 py-6">
          <div className="text-center py-12">
            <p className="text-muted-foreground">No se encontraron choferes en el sistema</p>
            <p className="text-sm text-muted-foreground mt-2">Por favor, contacta al administrador</p>
          </div>
        </main>
      </div>
    );
  }

  const choferId = choferes[0].id;
  console.log('[v0] Fetching viajes for chofer:', choferId, '-', choferes[0].nombre);

  // Obtener todos los viajes del chofer
  const { data: viajes, error } = await supabase
    .from('viajes')
    .select(`
      id,
      nombre,
      fecha,
      estado,
      chofer_id,
      vehiculo,
      dinero_nafta,
      gastos_peon,
      gastos_hotel,
      gastos_adicionales,
      observaciones,
      created_at
    `)
    .eq('chofer_id', choferId)
    .order('fecha', { ascending: false });

  if (error) {
    console.error('[v0] Error fetching viajes:', error);
  }

  console.log('[v0] Viajes found:', viajes?.length || 0);

  // Contar pedidos por viaje
  const viajesConDatos: Viaje[] = await Promise.all((viajes || []).map(async (viaje) => {
    const { count } = await supabase
      .from('pedidos')
      .select('*', { count: 'exact', head: true })
      .eq('viaje_id', viaje.id);

    const { data: pedidos } = await supabase
      .from('pedidos')
      .select('total')
      .eq('viaje_id', viaje.id);

    const totalFacturado = pedidos?.reduce((sum, p) => sum + (Number(p.total) || 0), 0) || 0;

    return {
      ...viaje,
      pedidos_count: count || 0,
      total_facturado: totalFacturado,
    };
  }));

  const activos = viajesConDatos.filter(v => v.estado === 'asignado' || v.estado === 'en_curso');
  const completados = viajesConDatos.filter(v => v.estado === 'completado');
  const cancelados = viajesConDatos.filter(v => v.estado === 'cancelado');

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
            <div>
              <h1 className="text-xl font-bold">Mis Viajes</h1>
              <p className="text-sm text-muted-foreground">
                {activos.length} viajes activos
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-6">
        <Tabs defaultValue="activos" className="space-y-4">
          <TabsList className="grid w-full grid-cols-3 touch-optimized">
            <TabsTrigger value="activos">
              Activos ({activos.length})
            </TabsTrigger>
            <TabsTrigger value="completados">
              Completados ({completados.length})
            </TabsTrigger>
            <TabsTrigger value="cancelados">
              Cancelados ({cancelados.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="activos" className="space-y-4">
            {activos.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground">No hay viajes activos</p>
                <p className="text-sm text-muted-foreground mt-2">Los viajes asignados o en curso aparecerán aquí</p>
              </div>
            ) : (
              activos.map((viaje) => (
                <ViajeCard key={viaje.id} viaje={viaje} />
              ))
            )}
          </TabsContent>

          <TabsContent value="completados" className="space-y-4">
            {completados.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground">No hay viajes completados</p>
              </div>
            ) : (
              completados.map((viaje) => (
                <ViajeCard key={viaje.id} viaje={viaje} />
              ))
            )}
          </TabsContent>

          <TabsContent value="cancelados" className="space-y-4">
            {cancelados.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground">No hay viajes cancelados</p>
              </div>
            ) : (
              cancelados.map((viaje) => (
                <ViajeCard key={viaje.id} viaje={viaje} />
              ))
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

