"use client";

import { useState, useEffect, Suspense, use } from "react";
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import Link from "next/link";
import { useToast } from "@/hooks/use-toast";

const ArrowLeftIcon = () => (
  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
  </svg>
);

const Loader2Icon = () => (
  <svg className="h-5 w-5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
  </svg>
);

interface DocumentoImputable {
  id: string;
  tipo: 'factura' | 'nota_credito' | 'devolucion';
  numero: string;
  fecha: string;
  total_original: number;
  saldo_pendiente: number;
  seleccionado: boolean;
  es_credito: boolean;
}

interface PagoItem {
  id: string;
  tipo: 'efectivo' | 'cheque' | 'transferencia';
  monto: number;
  detalles?: {
    numero_cheque?: string;
    banco?: string;
    fecha_cheque?: string;
    referencia?: string;
  };
}

interface PedidoData {
  id: string;
  numero_pedido: string;
  cliente_id: string;
  cliente_nombre: string;
  viaje_estado: string;
}

function PagoForm({ viajeId }: { viajeId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const pedidoId = searchParams.get("pedido");

  const [pedido, setPedido] = useState<PedidoData | null>(null);
  const [documentos, setDocumentos] = useState<DocumentoImputable[]>([]);
  const [pagos, setPagos] = useState<PagoItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Estado para el formulario de nuevo pago
  const [nuevoPagoTipo, setNuevoPagoTipo] = useState<"efectivo" | "cheque" | "transferencia">("efectivo");
  const [nuevoPagoMonto, setNuevoPagoMonto] = useState("");
  const [nuevoPagoDetalles, setNuevoPagoDetalles] = useState({
    numero_cheque: "",
    banco: "",
    fecha_cheque: "",
    referencia: "",
  });
  const [observaciones, setObservaciones] = useState("");

  useEffect(() => {
    const loadPedido = async () => {
      if (!pedidoId) return;

      try {
        const viajeResponse = await fetch(`/api/viajes/${viajeId}`);
        const viajeData = await viajeResponse.json();

        if (!viajeData.viaje || (viajeData.viaje.estado !== 'asignado' && viajeData.viaje.estado !== 'en_curso')) {
          toast({
            variant: "destructive",
            title: "Viaje no disponible",
            description: "Solo puedes registrar pagos en viajes asignados o en curso",
          });
          return;
        }

        const pedidoResponse = await fetch(`/api/pedidos/${pedidoId}?includeComprobantes=true`);
        const pedidoData = await pedidoResponse.json();

        if (!pedidoResponse.ok || !pedidoData) {
          toast({ variant: "destructive", title: "Error", description: "No se pudo cargar el pedido" });
          return;
        }

        // Procesar documentos
        const docs: DocumentoImputable[] = [];

        // 1. Facturas y Notas de Crédito
        (pedidoData.comprobantes || []).forEach((comp: any) => {
          const esNC = comp.tipo_comprobante.startsWith("NC");
          docs.push({
            id: comp.id,
            tipo: esNC ? 'nota_credito' : 'factura',
            numero: `${comp.tipo_comprobante} ${comp.numero_comprobante}`,
            fecha: comp.fecha,
            total_original: Number(comp.total_factura),
            saldo_pendiente: Number(comp.saldo_pendiente),
            seleccionado: false,
            es_credito: esNC,
          });
        });

        // 2. Devoluciones pendientes
        (pedidoData.devoluciones || []).forEach((dev: any) => {
          docs.push({
            id: dev.id,
            tipo: 'devolucion',
            numero: dev.numero_devolucion,
            fecha: dev.created_at,
            total_original: Number(dev.monto_total),
            saldo_pendiente: Number(dev.monto_total),
            seleccionado: false,
            es_credito: true,
          });
        });

        setDocumentos(docs);
        setPedido({
          id: pedidoData.id,
          numero_pedido: pedidoData.numero_pedido,
          cliente_id: pedidoData.cliente_id,
          cliente_nombre: pedidoData.cliente_nombre,
          viaje_estado: viajeData.viaje.estado,
        });

        setIsLoading(false);
      } catch (error) {
        console.error('Error cargando datos:', error);
      }
    };

    loadPedido();
  }, [pedidoId, viajeId, router, toast]);

  const handleToggleDocumento = (id: string) => {
    setDocumentos(prev => prev.map(doc =>
      doc.id === id ? { ...doc, seleccionado: !doc.seleccionado } : doc
    ));
  };

  const handleAddPago = () => {
    const monto = parseFloat(nuevoPagoMonto);
    if (isNaN(monto) || monto <= 0) {
      toast({ variant: "destructive", title: "Error", description: "Monto inválido" });
      return;
    }

    const nuevoPago: PagoItem = {
      id: `pago-${Date.now()}`,
      tipo: nuevoPagoTipo,
      monto: monto,
      detalles: nuevoPagoTipo !== 'efectivo' ? { ...nuevoPagoDetalles } : undefined
    };

    setPagos(prev => [...prev, nuevoPago]);

    // Reset form
    setNuevoPagoMonto("");
    setNuevoPagoDetalles({
      numero_cheque: "",
      banco: "",
      fecha_cheque: "",
      referencia: "",
    });
  };

  const handleRemovePago = (id: string) => {
    setPagos(prev => prev.filter(p => p.id !== id));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pedido) return;

    const totalImputar = documentos
      .filter(d => d.seleccionado)
      .reduce((sum, d) => sum + (d.es_credito ? -d.saldo_pendiente : d.saldo_pendiente), 0);

    const totalPagado = pagos.reduce((sum, p) => sum + p.monto, 0);

    // Validación laxa: permitimos diferencia de hasta $1 por redondeo
    if (Math.abs(totalImputar - totalPagado) > 1) {
      toast({
        variant: "destructive",
        title: "Montos no coinciden",
        description: `Total a imputar: $${totalImputar.toLocaleString('es-AR')} vs Total pagado: $${totalPagado.toLocaleString('es-AR')}`
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch('/api/pagos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          viaje_id: viajeId,
          pedido_id: pedido.id,
          cliente_id: pedido.cliente_id,
          monto_total: totalPagado,
          pagos: pagos,
          documentos_imputados: documentos.filter(d => d.seleccionado).map(d => ({
            id: d.id,
            tipo: d.tipo,
            monto: d.saldo_pendiente // Asumimos imputación total del saldo por ahora
          })),
          observaciones
        }),
      });

      if (!response.ok) throw new Error('Error al registrar pago');

      toast({ title: "Pago registrado", description: "El pago ha sido enviado a revisión." });
      router.push(`/choferes/viajes/${viajeId}`);
    } catch (error) {
      console.error(error);
      toast({ variant: "destructive", title: "Error", description: "No se pudo registrar el pago" });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Cálculos para UI
  const totalFacturas = documentos.filter(d => d.seleccionado && !d.es_credito).reduce((sum, d) => sum + d.saldo_pendiente, 0);
  const totalCredito = documentos.filter(d => d.seleccionado && d.es_credito).reduce((sum, d) => sum + d.saldo_pendiente, 0);
  const totalAImputar = totalFacturas - totalCredito;
  const totalPagado = pagos.reduce((sum, p) => sum + p.monto, 0);
  const restante = totalAImputar - totalPagado;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2Icon />
      </div>
    );
  }

  if (!pedido) return null;

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <header className="bg-white border-b sticky top-0 z-10 px-4 py-3 flex items-center gap-3">
        <Link href={`/choferes/viajes/${viajeId}`}>
          <Button variant="ghost" size="icon"><ArrowLeftIcon /></Button>
        </Link>
        <div>
          <h1 className="font-bold text-lg">Imputar Pago</h1>
          <p className="text-sm text-gray-500">{pedido.cliente_nombre}</p>
        </div>
      </header>

      <main className="p-4 space-y-6">
        {/* Sección 1: Documentos */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Documentos a Imputar</CardTitle>
            <CardDescription>Selecciona facturas y notas de crédito</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {documentos.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">No hay documentos pendientes</p>
            ) : (
              documentos.map(doc => (
                <div key={doc.id} className={`flex items-center justify-between p-3 border rounded-lg ${doc.seleccionado ? 'bg-primary/5 border-primary/30' : 'bg-white'}`}>
                  <div className="flex items-center gap-3">
                    <Checkbox
                      checked={doc.seleccionado}
                      onCheckedChange={() => handleToggleDocumento(doc.id)}
                    />
                    <div>
                      <p className="font-medium text-sm">{doc.numero}</p>
                      <p className="text-xs text-gray-500">{new Date(doc.fecha).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`font-bold ${doc.es_credito ? 'text-green-600' : ''}`}>
                      {doc.es_credito ? '-' : ''}${doc.saldo_pendiente.toLocaleString('es-AR')}
                    </p>
                    <p className="text-xs text-gray-400">Total: ${doc.total_original.toLocaleString('es-AR')}</p>
                  </div>
                </div>
              ))
            )}

            <div className="bg-gray-100 p-3 rounded-lg mt-4 space-y-1">
              <div className="flex justify-between text-sm">
                <span>Facturas:</span>
                <span>${totalFacturas.toLocaleString('es-AR')}</span>
              </div>
              <div className="flex justify-between text-sm text-green-600">
                <span>Crédito/Devoluciones:</span>
                <span>-${totalCredito.toLocaleString('es-AR')}</span>
              </div>
              <div className="flex justify-between font-bold text-lg border-t pt-1 mt-1">
                <span>Total a Pagar:</span>
                <span>${totalAImputar.toLocaleString('es-AR')}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Sección 2: Pagos */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Formas de Pago</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Lista de pagos agregados */}
            {pagos.length > 0 && (
              <div className="space-y-2 mb-4">
                {pagos.map(pago => (
                  <div key={pago.id} className="flex justify-between items-center p-2 bg-gray-50 rounded border">
                    <div>
                      <p className="font-medium capitalize">{pago.tipo}</p>
                      {pago.tipo === 'cheque' && <p className="text-xs text-gray-500">#{pago.detalles?.numero_cheque} - {pago.detalles?.banco}</p>}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-bold">${pago.monto.toLocaleString('es-AR')}</span>
                      <Button variant="ghost" size="sm" onClick={() => handleRemovePago(pago.id)} className="text-red-500 h-6 w-6 p-0">
                        ×
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Formulario nuevo pago */}
            <div className="border rounded-lg p-3 space-y-3 bg-gray-50/50">
              <p className="text-sm font-medium">Agregar Pago</p>
              <div className="grid grid-cols-2 gap-3">
                <Select value={nuevoPagoTipo} onValueChange={(v: any) => setNuevoPagoTipo(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="efectivo">Efectivo</SelectItem>
                    <SelectItem value="cheque">Cheque</SelectItem>
                    <SelectItem value="transferencia">Transferencia</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  placeholder="Monto"
                  value={nuevoPagoMonto}
                  onChange={e => setNuevoPagoMonto(e.target.value)}
                />
              </div>

              {nuevoPagoTipo === 'cheque' && (
                <div className="grid grid-cols-2 gap-3">
                  <Input placeholder="N° Cheque" value={nuevoPagoDetalles.numero_cheque} onChange={e => setNuevoPagoDetalles({ ...nuevoPagoDetalles, numero_cheque: e.target.value })} />
                  <Input placeholder="Banco" value={nuevoPagoDetalles.banco} onChange={e => setNuevoPagoDetalles({ ...nuevoPagoDetalles, banco: e.target.value })} />
                  <Input type="date" value={nuevoPagoDetalles.fecha_cheque} onChange={e => setNuevoPagoDetalles({ ...nuevoPagoDetalles, fecha_cheque: e.target.value })} />
                </div>
              )}

              {nuevoPagoTipo === 'transferencia' && (
                <Input placeholder="Referencia / Comprobante" value={nuevoPagoDetalles.referencia} onChange={e => setNuevoPagoDetalles({ ...nuevoPagoDetalles, referencia: e.target.value })} />
              )}

              <Button onClick={handleAddPago} type="button" variant="secondary" className="w-full" disabled={!nuevoPagoMonto}>
                + Agregar {nuevoPagoTipo}
              </Button>
            </div>

            <div className="flex justify-between font-bold text-lg pt-2">
              <span>Total Pagado:</span>
              <span className={restante < 0 ? "text-red-500" : "text-green-600"}>
                ${totalPagado.toLocaleString('es-AR')}
              </span>
            </div>
            {restante !== 0 && (
              <p className="text-right text-sm text-gray-500">
                {restante > 0 ? `Faltan $${restante.toLocaleString('es-AR')}` : `Sobran $${Math.abs(restante).toLocaleString('es-AR')}`}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <Label>Observaciones</Label>
            <Textarea
              value={observaciones}
              onChange={e => setObservaciones(e.target.value)}
              placeholder="Notas adicionales..."
              className="mt-2"
            />
          </CardContent>
        </Card>

        <Button
          onClick={handleSubmit}
          className="w-full"
          size="lg"
          disabled={isSubmitting || totalPagado === 0 || Math.abs(restante) > 1}
        >
          {isSubmitting ? "Procesando..." : "Confirmar Pago"}
        </Button>
      </main>
    </div>
  );
}

export default function PagoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <Loader2Icon />
      </div>
    }>
      <PagoForm viajeId={id} />
    </Suspense>
  );
}
