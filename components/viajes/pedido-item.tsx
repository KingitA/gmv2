"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Pedido } from "@/lib/types";
import Link from "next/link";

const MapPinIcon = () => (
  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

const PhoneIcon = () => (
  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
  </svg>
);

const PackageIcon = () => (
  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
  </svg>
);

const CreditCardIcon = () => (
  <svg className="h-5 w-5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
  </svg>
);

const RotateIcon = () => (
  <svg className="h-5 w-5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
  </svg>
);

const FileTextIcon = () => (
  <svg className="h-5 w-5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
  </svg>
);

interface PedidoItemProps {
  pedido: Pedido;
  viajeId: string;
}

const estadoConfig: Record<string, { label: string, variant: 'secondary' | 'default' | 'outline' | 'destructive' }> = {
  pendiente: { label: 'Pendiente', variant: 'secondary' },
  en_viaje: { label: 'En Viaje', variant: 'default' },
  entregado: { label: 'Entregado', variant: 'outline' },
  cancelado: { label: 'Cancelado', variant: 'destructive' },
  preparado: { label: 'Preparado', variant: 'secondary' },
  facturado: { label: 'Facturado', variant: 'outline' },
  asignado: { label: 'Asignado', variant: 'secondary' },
  en_curso: { label: 'En Curso', variant: 'default' },
};

export function PedidoItem({ pedido, viajeId }: PedidoItemProps) {
  const estadoNormalizado = pedido.estado?.toLowerCase().replace(/\s+/g, '_') || 'pendiente';
  
  const config = estadoConfig[estadoNormalizado] || {
    label: pedido.estado || 'Desconocido',
    variant: 'secondary' as const
  };
  
  const puedeInteractuar = estadoNormalizado === 'asignado' || estadoNormalizado === 'en_curso';

  return (
    <Card className="shadow-md hover:shadow-lg transition-shadow">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-mono text-muted-foreground">
                #{pedido.numero_pedido}
              </span>
              <Badge variant={config.variant} className="text-xs">
                {config.label}
              </Badge>
            </div>
            <h3 className="font-bold text-lg leading-tight">{pedido.cliente_nombre}</h3>
          </div>
          <div className="text-right shrink-0">
            <div className="flex items-center gap-1.5 text-primary">
              <PackageIcon />
              <span className="font-bold text-lg">{pedido.bultos}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">bultos</p>
          </div>
        </div>

        <div className="space-y-2.5 text-sm">
          {pedido.direccion && (
            <div className="flex items-start gap-2.5">
              <MapPinIcon />
              <div className="flex-1 min-w-0">
                <p className="font-medium">{pedido.direccion}</p>
                {pedido.localidad && (
                  <p className="text-muted-foreground">{pedido.localidad}</p>
                )}
              </div>
            </div>
          )}
          {pedido.telefono && (
            <div className="flex items-center gap-2.5">
              <PhoneIcon />
              <a href={`tel:${pedido.telefono}`} className="text-primary hover:underline font-medium">
                {pedido.telefono}
              </a>
            </div>
          )}
        </div>

        <div className="space-y-2.5 pt-4 border-t">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground font-medium">Saldo Anterior:</span>
            <span className="font-bold text-base">
              ${pedido.saldo_anterior.toLocaleString('es-AR')}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground font-medium">Saldo Actual:</span>
            <span className="font-bold text-base">
              ${pedido.saldo_actual.toLocaleString('es-AR')}
            </span>
          </div>
          <div className="flex items-center justify-between pt-2 border-t">
            <span className="font-bold text-base">Total a Cobrar:</span>
            <span className="font-bold text-2xl text-primary">
              ${pedido.total.toLocaleString('es-AR')}
            </span>
          </div>
        </div>

        {puedeInteractuar && (
          <div className="grid grid-cols-3 gap-2 pt-4 border-t">
            <Link href={`/viajes/${viajeId}/pago?pedido=${pedido.id}`} className="block">
              <Button variant="default" className="w-full h-12" size="default">
                <CreditCardIcon />
                <span className="text-sm font-semibold">Pago</span>
              </Button>
            </Link>
            <Link href={`/viajes/${viajeId}/devolucion?pedido=${pedido.id}`} className="block">
              <Button variant="outline" className="w-full h-12" size="default">
                <RotateIcon />
                <span className="text-sm font-semibold">Devolución</span>
              </Button>
            </Link>
            <Button variant="ghost" className="w-full h-12" size="default" disabled>
              <FileTextIcon />
              <span className="text-sm font-semibold">Comprob.</span>
            </Button>
          </div>
        )}

        {pedido.observaciones && (
          <div className="pt-3 border-t">
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold">Obs:</span> {pedido.observaciones}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
