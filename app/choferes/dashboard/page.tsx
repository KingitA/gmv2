export const dynamic = 'force-dynamic'
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Truck, Package, TrendingUp, LogOut } from 'lucide-react';
import { Badge } from "@/components/ui/badge";
// import { OfflineIndicator } from "@/components/offline-indicator";

export default async function DashboardPage() {
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
      <div className="min-h-screen bg-gradient-to-br from-primary/5 to-accent/5 flex items-center justify-center">
        <Card className="max-w-md mx-auto">
          <CardHeader>
            <CardTitle>No hay choferes disponibles</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">No se encontraron choferes en el sistema. Por favor, contacta al administrador.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const choferId = choferes[0].id;
  const choferNombre = choferes[0].nombre;

  console.log('[v0] Dashboard for chofer:', choferId, '-', choferNombre);

  // Obtener resumen de viajes
  const { data: viajes } = await supabase
    .from('viajes')
    .select('id, estado')
    .eq('chofer_id', choferId);

  console.log('[v0] Total viajes:', viajes?.length || 0);

  const viajesPendientes = viajes?.filter(v => v.estado === 'pendiente').length || 0;
  const viajesEnCurso = viajes?.filter(v => v.estado === 'en_viaje').length || 0;
  const viajesCompletados = viajes?.filter(v => v.estado === 'finalizado').length || 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 to-accent/5">
      {/* Header */}
      <header className="bg-card border-b border-border shadow-sm">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary">
              <Truck className="h-6 w-6 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Chofer App</h1>
              <p className="text-sm text-muted-foreground">{choferNombre}</p>
            </div>
          </div>

          <Button variant="ghost" size="icon">
            <LogOut className="h-5 w-5" />
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-6 space-y-6">
        <div>
          <h2 className="text-2xl font-bold mb-2">Bienvenido, {choferNombre}</h2>
          <p className="text-muted-foreground">Gestiona tus viajes y entregas</p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="shadow-md">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Viajes Pendientes
              </CardTitle>
              <Badge variant="secondary" className="text-xs">
                {viajesPendientes}
              </Badge>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{viajesPendientes}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Por iniciar
              </p>
            </CardContent>
          </Card>

          <Card className="shadow-md border-l-4 border-l-primary">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                En Curso
              </CardTitle>
              <Badge className="text-xs bg-primary">
                {viajesEnCurso}
              </Badge>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-primary">{viajesEnCurso}</div>
              <p className="text-xs text-muted-foreground mt-1">
                En ruta
              </p>
            </CardContent>
          </Card>

          <Card className="shadow-md">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Completados
              </CardTitle>
              <Badge variant="outline" className="text-xs">
                Este mes
              </Badge>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-success">{viajesCompletados}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Finalizados
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Link href="/choferes/viajes" className="block">
            <Card className="shadow-md hover:shadow-lg transition-shadow cursor-pointer h-full">
              <CardContent className="pt-6 flex flex-col items-center justify-center gap-4 min-h-[160px]">
                <div className="p-4 rounded-full bg-primary/10">
                  <Package className="h-8 w-8 text-primary" />
                </div>
                <div className="text-center">
                  <h3 className="text-xl font-bold">Ver Mis Viajes</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Lista completa de viajes asignados
                  </p>
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link href="/choferes/estadisticas" className="block">
            <Card className="shadow-md hover:shadow-lg transition-shadow cursor-pointer h-full">
              <CardContent className="pt-6 flex flex-col items-center justify-center gap-4 min-h-[160px]">
                <div className="p-4 rounded-full bg-accent/10">
                  <TrendingUp className="h-8 w-8 text-accent" />
                </div>
                <div className="text-center">
                  <h3 className="text-xl font-bold">Estadísticas</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Ver mi rendimiento del período
                  </p>
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>
      </main>

      {/* OfflineIndicator */}
      {/* <OfflineIndicator /> */}
    </div>
  );
}

