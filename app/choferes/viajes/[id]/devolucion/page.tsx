'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';

const MOTIVOS_DEVOLUCION = [
  'No le gustó',
  'Producto dañado',
  'Producto vencido',
  'Error en el pedido',
  'Otro',
];

interface ArticuloItem {
  id: string;
  articulo_id: string;
  descripcion: string;
  cantidad_devolver: number;
  precio: number;
  fecha_venta?: string;
  origen: string;
  motivo: string;
  es_vendible: boolean;
}

interface PedidoData {
  id: string;
  numero_pedido: string;
  cliente_id: string;
  cliente_nombre: string;
}

function DevolucionForm({ viajeId }: { viajeId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const pedidoId = searchParams.get('pedido');

  const [pedido, setPedido] = useState<PedidoData | null>(null);
  const [articulos, setArticulos] = useState<ArticuloItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [busqueda, setBusqueda] = useState('');
  const [articulosBusqueda, setArticulosBusqueda] = useState<any[]>([]);
  const [buscando, setBuscando] = useState(false);

  const [observaciones, setObservaciones] = useState('');

  const buscarArticulos = async (termino: string) => {
    if (termino.length < 3) {
      setArticulosBusqueda([]);
      return;
    }

    setBuscando(true);
    try {
      const response = await fetch(`/api/articulos/buscar?q=${encodeURIComponent(termino)}`);
      const data = await response.json();
      setArticulosBusqueda(data || []);
    } catch (error) {
      console.error('[v0] Error buscando artículos:', error);
    } finally {
      setBuscando(false);
    }
  };

  const agregarArticulo = async (articulo: any) => {
    if (!pedido) return;

    try {
      const response = await fetch(
        `/api/articulos/ultimo-precio?articulo_id=${articulo.id}&cliente_id=${pedido.cliente_id}&pedido_id=${pedido.id}`
      );

      const resultado = await response.json();

      let precio = 0;
      let origen = '';
      let fecha_venta = undefined;

      if (!resultado.encontrado) {
        // Si no se encuentra, permitimos ingreso manual (usamos 0 como flag o pedimos input)
        // Por simplicidad en UI, lo agregamos con precio 0 y el usuario lo edita
        toast({
          title: 'Artículo no encontrado en historial',
          description: 'No se encontró venta en el último año. Se agregó con precio $0 para ingreso manual.',
        });
        precio = 0;
        origen = 'manual';
      } else {
        precio = resultado.precio;
        origen = resultado.origen;
        fecha_venta = resultado.fecha;

        toast({
          title: 'Artículo agregado',
          description: `Precio: $${resultado.precio.toLocaleString('es-AR')} (${resultado.origen === 'pedido_actual' ? 'pedido actual' : 'última factura'})`,
        });
      }

      if (articulos.find((a) => a.articulo_id === articulo.id)) {
        toast({
          variant: 'destructive',
          title: 'Artículo duplicado',
          description: 'Este artículo ya está en la lista',
        });
        return;
      }

      const nuevoArticulo: ArticuloItem = {
        id: `temp-${Date.now()}`,
        articulo_id: articulo.id,
        descripcion: articulo.descripcion,
        cantidad_devolver: 1,
        precio: precio,
        fecha_venta: fecha_venta,
        origen: origen,
        motivo: MOTIVOS_DEVOLUCION[0],
        es_vendible: true,
      };

      setArticulos((prev) => [...prev, nuevoArticulo]);
      setBusqueda('');
      setArticulosBusqueda([]);

    } catch (error) {
      console.error('[v0] Error agregando artículo:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo agregar el artículo',
      });
    }
  };

  useEffect(() => {
    const loadData = async () => {
      console.log('--- DEBUG DEVOLUCION ---');
      console.log('viajeId:', viajeId);
      console.log('pedidoId:', pedidoId);

      if (!pedidoId) {
        console.error('No pedidoId found');
        // router.push(`/choferes/viajes/${viajeId}`);
        return;
      }

      try {
        const response = await fetch(`/api/pedidos/${pedidoId}`);
        console.log('API Response status:', response.status);

        const pedidoData = await response.json();
        console.log('API Response data:', pedidoData);

        if (!response.ok || !pedidoData) {
          console.error('API Error or no data');
          toast({
            variant: "destructive",
            title: "Error",
            description: "No se pudo cargar el pedido",
          });
          // router.push(`/choferes/viajes/${viajeId}`);
          return;
        }

        setPedido({
          id: pedidoData.id,
          numero_pedido: pedidoData.numero_pedido,
          cliente_id: pedidoData.cliente_id,
          cliente_nombre: pedidoData.cliente_nombre,
        });

        setIsLoading(false);
      } catch (error) {
        console.error('Fetch error:', error);
        // router.push(`/choferes/viajes/${viajeId}`);
      }
    };

    loadData();
  }, [pedidoId, viajeId, router, toast]);

  useEffect(() => {
    const handler = setTimeout(() => {
      buscarArticulos(busqueda);
    }, 500);

    return () => clearTimeout(handler);
  }, [busqueda]);

  const handleCantidadChange = (id: string, cantidad: number) => {
    setArticulos((prev) =>
      prev.map((art) =>
        art.id === id
          ? {
            ...art,
            cantidad_devolver: Math.max(1, cantidad),
          }
          : art
      )
    );
  };

  const handleMotivoChange = (id: string, motivo: string) => {
    setArticulos((prev) => prev.map((art) => (art.id === id ? { ...art, motivo } : art)));
  };

  const handleVendibleChange = (id: string, es_vendible: boolean) => {
    setArticulos((prev) => prev.map((art) => (art.id === id ? { ...art, es_vendible } : art)));
  };

  const eliminarArticulo = (id: string) => {
    setArticulos((prev) => prev.filter((art) => art.id !== id));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pedido) return;

    if (articulos.length === 0) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Debes agregar al menos un artículo',
      });
      return;
    }

    const articulosSinMotivo = articulos.filter((art) => !art.motivo);
    if (articulosSinMotivo.length > 0) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Todos los artículos deben tener un motivo de devolución',
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch('/api/devoluciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cliente_id: pedido.cliente_id,
          viaje_id: viajeId,
          pedido_id: pedido.id,
          observaciones,
          items: articulos.map((item) => ({
            articulo_id: item.articulo_id,
            cantidad: item.cantidad_devolver,
            precio_venta_original: item.precio,
            fecha_venta_original: item.fecha_venta,
            motivo: item.motivo,
            es_vendible: item.es_vendible,
          })),
        }),
      });

      const resultado = await response.json();

      if (!response.ok) {
        throw new Error(resultado.error || 'Error al registrar devolución');
      }

      toast({
        title: 'Devolución registrada',
        description: `${resultado.numero_devolucion} - Total: $${resultado.monto_total.toLocaleString(
          'es-AR'
        )}. Pendiente de aprobación desde ERP.`,
      });

      router.push(`/choferes/viajes/${viajeId}`);
    } catch (error) {
      console.error('[v0] Error registrando devolución:', error);

      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'No se pudo registrar la devolución',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <svg className="h-8 w-8 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      </div>
    );
  }

  if (!pedido) return null;

  const montoTotal = articulos.reduce((sum, art) => sum + art.precio * art.cantidad_devolver, 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 to-accent/5">
      <header className="bg-card border-b border-border shadow-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <Link href={`/choferes/viajes/${viajeId}`}>
              <Button variant="ghost" size="icon">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
              </Button>
            </Link>
            <div>
              <h1 className="text-xl font-bold">Registrar Devolución</h1>
              <p className="text-sm text-muted-foreground">
                Pedido #{pedido.numero_pedido} - {pedido.cliente_nombre}
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 space-y-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <Card className="shadow-md">
            <CardHeader>
              <CardTitle className="text-lg">Buscar Artículo para Devolver</CardTitle>
              <CardDescription>
                Busca por nombre o código. Solo se pueden devolver artículos previamente vendidos.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="relative">
                <Input
                  type="text"
                  placeholder="Buscar por nombre o código..."
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  className="text-lg"
                />
                {buscando && (
                  <svg className="absolute right-3 top-3 h-5 w-5 animate-spin text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                )}
              </div>

              {articulosBusqueda.length > 0 && (
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {articulosBusqueda.map((art) => (
                    <button
                      key={art.id}
                      type="button"
                      onClick={() => agregarArticulo(art)}
                      className="w-full text-left p-3 border rounded-lg hover:bg-primary/5 transition-colors"
                    >
                      <p className="font-semibold">{art.descripcion}</p>
                      <p className="text-sm text-muted-foreground">SKU: {art.sku}</p>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-md">
            <CardHeader>
              <CardTitle className="text-lg">Artículos a Devolver ({articulos.length})</CardTitle>
              <CardDescription>
                {articulos.length === 0
                  ? 'No hay artículos agregados. Busca y selecciona artículos arriba.'
                  : 'Configura cantidad, motivo y estado de cada artículo'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {articulos.map((articulo) => (
                <div key={articulo.id} className="border rounded-lg p-4 space-y-4 bg-card">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <p className="font-semibold text-base">{articulo.descripcion}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Label htmlFor={`precio-${articulo.id}`} className="text-sm text-muted-foreground whitespace-nowrap">
                          Precio: $
                        </Label>
                        <Input
                          id={`precio-${articulo.id}`}
                          type="number"
                          step="0.01"
                          min="0"
                          value={articulo.precio}
                          onChange={(e) => {
                            const nuevoPrecio = parseFloat(e.target.value) || 0;
                            setArticulos(prev => prev.map(a => a.id === articulo.id ? { ...a, precio: nuevoPrecio } : a));
                          }}
                          className="h-7 w-24 text-sm"
                          disabled={articulo.origen !== 'manual'}
                        />
                        <span className="text-xs text-muted-foreground ml-1">
                          ({articulo.origen === 'pedido_actual' ? 'pedido actual' : articulo.origen === 'ultima_factura' ? 'última factura' : 'manual'})
                        </span>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => eliminarArticulo(articulo.id)}
                      className="text-destructive hover:text-destructive"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        className="h-5 w-5"
                      >
                        <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                      </svg>
                    </Button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor={`cant-${articulo.id}`} className="text-sm">
                        Cantidad a devolver *
                      </Label>
                      <Input
                        id={`cant-${articulo.id}`}
                        type="number"
                        min="1"
                        value={articulo.cantidad_devolver}
                        onChange={(e) => handleCantidadChange(articulo.id, parseInt(e.target.value) || 1)}
                        className="text-base mt-1"
                      />
                    </div>

                    <div>
                      <Label htmlFor={`motivo-${articulo.id}`} className="text-sm">
                        Motivo de devolución *
                      </Label>
                      <Select
                        value={articulo.motivo}
                        onValueChange={(value) => handleMotivoChange(articulo.id, value)}
                      >
                        <SelectTrigger id={`motivo-${articulo.id}`} className="mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {MOTIVOS_DEVOLUCION.map((motivo) => (
                            <SelectItem key={motivo} value={motivo}>
                              {motivo}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t">
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id={`vendible-${articulo.id}`}
                        checked={articulo.es_vendible}
                        onCheckedChange={(checked) => handleVendibleChange(articulo.id, checked as boolean)}
                      />
                      <Label htmlFor={`vendible-${articulo.id}`} className="cursor-pointer text-sm">
                        ✓ Producto vendible (puede reintegrarse al stock)
                      </Label>
                    </div>

                    <div className="text-right">
                      <p className="text-sm text-muted-foreground">Subtotal</p>
                      <p className="text-lg font-bold">
                        ${(articulo.precio * articulo.cantidad_devolver).toLocaleString('es-AR')}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="shadow-md">
            <CardHeader>
              <CardTitle className="text-lg">Observaciones Generales</CardTitle>
              <CardDescription>Información adicional sobre la devolución (opcional)</CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                className="min-h-[80px] text-base"
                placeholder="Ej: Cliente molesto, embalaje dañado, etc..."
              />

              {articulos.length > 0 && (
                <div className="pt-4 mt-4 border-t">
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-bold text-lg">Total Devolución:</span>
                    <span className="font-bold text-2xl text-destructive">
                      ${montoTotal.toLocaleString('es-AR')}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    * La devolución se creará con estado PENDIENTE y debe ser confirmada desde el ERP
                    (/revision-devoluciones)
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 gap-3 pt-2">
            <Link href={`/choferes/viajes/${viajeId}`} className="w-full">
              <Button type="button" variant="outline" size="lg" className="w-full">
                Cancelar
              </Button>
            </Link>
            <Button
              type="submit"
              disabled={isSubmitting || articulos.length === 0}
              variant="destructive"
              size="lg"
              className="w-full"
            >
              {isSubmitting ? (
                <>
                  <svg
                    className="h-5 w-5 animate-spin mr-2"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                      fill="none"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Procesando...
                </>
              ) : (
                "Cerrar Devolución"
              )}
            </Button>
          </div>
        </form>
      </main>
    </div>
  );
}

import { use } from 'react';

// ... (imports anteriores se mantienen igual, solo agregamos 'use' de react si no estaba, o lo usamos directamente)

export default function DevolucionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <svg className="h-8 w-8 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      </div>
    }>
      <DevolucionForm viajeId={id} />
    </Suspense>
  );
}
