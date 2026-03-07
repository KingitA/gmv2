import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, Truck, MapPin, DollarSign, Package } from 'lucide-react';
import Link from "next/link";
import type { Viaje } from "@/lib/types";

const estadoConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive'; color: string }> = {
  pendiente: { label: 'Pendiente', variant: 'secondary' as const, color: 'text-gray-600' },
  asignado: { label: 'Asignado', variant: 'default' as const, color: 'text-blue-600' },
  en_curso: { label: 'En Curso', variant: 'default' as const, color: 'text-primary' },
  completado: { label: 'Completado', variant: 'outline' as const, color: 'text-green-600' },
  cancelado: { label: 'Cancelado', variant: 'destructive' as const, color: 'text-destructive' },
};

function normalizeEstado(estado: string): string {
  return estado?.toLowerCase().trim() || 'pendiente';
}

interface ViajeCardProps {
  viaje: Viaje;
}

export function ViajeCard({ viaje }: ViajeCardProps) {
  const estadoNormalizado = normalizeEstado(viaje.estado);
  const config = estadoConfig[estadoNormalizado] || {
    label: viaje.estado || 'Pendiente',
    variant: 'secondary' as const,
    color: 'text-gray-600'
  };

  return (
    <Link href={`/choferes/viajes/${viaje.id}`}>
      <Card className="shadow-md hover:shadow-lg transition-all cursor-pointer border-l-4 border-l-primary">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <CardTitle className="text-lg font-bold line-clamp-1">
                {viaje.nombre}
              </CardTitle>
              <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                <Calendar className="h-4 w-4" />
                {new Date(viaje.fecha).toLocaleDateString('es-AR', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric'
                })}
              </div>
            </div>
            <Badge variant={config.variant} className="shrink-0">
              {config.label}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded bg-primary/10">
                <Truck className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Vehículo</p>
                <p className="font-semibold">{viaje.vehiculo}</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded bg-accent/10">
                <Package className="h-4 w-4 text-accent" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Pedidos</p>
                <p className="font-semibold">{viaje.pedidos_count || 0}</p>
              </div>
            </div>
          </div>

          {viaje.zonas && (
            <div className="flex items-start gap-2 text-sm pt-2 border-t">
              <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <p className="text-muted-foreground line-clamp-1">{viaje.zonas}</p>
            </div>
          )}

          {viaje.total_facturado !== undefined && (
            <div className="flex items-center justify-between pt-2 border-t">
              <span className="text-sm text-muted-foreground">Total Facturado</span>
              <span className="text-lg font-bold text-primary">
                ${viaje.total_facturado.toLocaleString('es-AR')}
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
