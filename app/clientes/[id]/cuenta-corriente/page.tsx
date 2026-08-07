"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";
import { ExternalLink } from "lucide-react";

const ArrowLeftIcon = () => (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
    </svg>
);

const FileTextIcon = () => (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
);

interface Comprobante {
    id: string;
    tipo_comprobante: string;
    numero_comprobante: string;
    fecha: string;
    pedido_id: string;
    numero_pedido: string;
    total_neto: number;
    total_iva: number;
    total_factura: number;
    saldo_pendiente: number;
    estado: string;
    anulado?: boolean;
}

interface MovimientoCC {
    id?: string;
    fecha: string;
    tipo_movimiento: string;
    debe: number;
    haber: number;
    numero_comprobante?: string | null;
    observaciones?: string | null;
    referencia_tipo?: string | null;
    referencia_id?: string | null;
}

interface PagoDetalle {
    tipo_pago: string;
    monto: number;
    numero_cheque?: string;
    banco?: string;
    referencia?: string;
}

interface Imputacion {
    id: string;
    comprobante_id: string;
    monto_imputado: number;
    tipo_comprobante: string;
}

interface Pago {
    id: string;
    fecha_pago: string;
    monto: number;
    forma_pago: string;
    estado: string;
    observaciones?: string;
    imputaciones: Imputacion[];
    detalles: PagoDetalle[];
}

interface Devolucion {
    id: string;
    numero_devolucion: string;
    created_at: string;
    monto_total: number;
    estado: string;
    observaciones?: string;
}

interface CuentaCorrienteData {
    cliente: {
        id: string;
        razon_social: string;
        nombre: string;
        cuit: string;
        direccion: string;
        telefono: string;
        saldo_total: number;
        saldo_proyectado?: number;
        pendiente_verificacion?: number;
        condicion_iva?: string | null;
    };
    comprobantes: Comprobante[];
    pagos: Pago[];
    devoluciones: Devolucion[];
    movimientos?: MovimientoCC[];
}

interface PagoFormData {
    tipo: 'efectivo' | 'cheque' | 'transferencia';
    monto: number;
    detalles: {
        numero_cheque?: string;
        banco?: string;
        fecha_cheque?: string;
        referencia?: string;
    };
}

interface DocumentoUnificado {
    id: string;
    tipo: string; // "Factura A", "Devolución Pendiente", "Nota de Crédito", etc.
    numero: string;
    fecha: string;
    pedido: string;
    total: number;
    saldo: number;
    estado: string;
    es_devolucion: boolean;
    es_credito: boolean;
}

function CuentaCorrientePage({ params }: { params: Promise<{ id: string }> }) {
    const router = useRouter();
    const { toast } = useToast();
    const { id: clienteId } = use(params);
    const [data, setData] = useState<CuentaCorrienteData | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    // Modal states
    const [showPaymentModal, setShowPaymentModal] = useState(false);
    const [showAdjustmentModal, setShowAdjustmentModal] = useState(false);
    const [selectedDocumentos, setSelectedDocumentos] = useState<string[]>([]);
    const [pagosForm, setPagosForm] = useState<PagoFormData[]>([]);
    const [observaciones, setObservaciones] = useState("");

    // Pago contado 10%
    const [aplicarContado, setAplicarContado] = useState(false);

    // Adjustment form
    const [selectedComprobanteForAdjustment, setSelectedComprobanteForAdjustment] = useState<string>("");
    const [adjustmentMonto, setAdjustmentMonto] = useState("");
    const [adjustmentMotivo, setAdjustmentMotivo] = useState("");

    useEffect(() => {
        fetchData();
    }, [clienteId]);

    const fetchData = async () => {
        try {
            const response = await fetch(`/api/clientes/${clienteId}/cuenta-corriente`);
            if (!response.ok) throw new Error("Error al cargar cuenta corriente");
            const result = await response.json();
            setData(result);
        } catch (error) {
            console.error(error);
            toast({ variant: "destructive", title: "Error", description: "No se pudo cargar la cuenta corriente" });
        } finally {
            setIsLoading(false);
        }
    };

    const getDocumentosUnificados = (): DocumentoUnificado[] => {
        if (!data) return [];

        const documentos: DocumentoUnificado[] = [];

        // Add comprobantes (facturas, notas de crédito, etc.)
        const TIPOS_CREDITO = ["NC", "NCA", "NCB", "NCC", "REV"];
        data.comprobantes.forEach((comp) => {
            documentos.push({
                id: comp.id,
                tipo: comp.tipo_comprobante, // "FA", "NCA", "PRES", etc.
                numero: comp.numero_comprobante,
                fecha: comp.fecha,
                pedido: comp.numero_pedido || "-",
                total: comp.total_factura,
                saldo: comp.saldo_pendiente,
                estado: comp.anulado ? "anulado" : comp.estado,
                es_devolucion: false,
                es_credito: TIPOS_CREDITO.includes(comp.tipo_comprobante) ||
                    comp.tipo_comprobante.toLowerCase().includes("nota de crédito") ||
                    comp.tipo_comprobante.toLowerCase().includes("reversa"),
            });
        });

        // Add devoluciones pendientes
        data.devoluciones.forEach((dev) => {
            documentos.push({
                id: dev.id,
                tipo: "Devolución Pendiente",
                numero: dev.numero_devolucion,
                fecha: dev.created_at,
                pedido: "-",
                total: dev.monto_total,
                saldo: dev.monto_total, // Toda la devolución es un crédito pendiente
                estado: dev.estado,
                es_devolucion: true,
                es_credito: true,
            });
        });

        // Add pagos as rows
        data.pagos.forEach((pago) => {
            const metodoPago = pago.detalles.map(d => d.tipo_pago).join(" + ");
            documentos.push({
                id: pago.id,
                tipo: "PAGO",
                numero: metodoPago || "Pago",
                fecha: pago.fecha_pago,
                pedido: "-",
                total: -pago.monto, // Negativo porque es un pago (reduce deuda)
                saldo: 0, // Los pagos no tienen saldo pendiente
                estado: pago.estado,
                es_devolucion: false,
                es_credito: true, // Los pagos son créditos (reducen deuda)
            });
        });

        // Sort by date descending
        documentos.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());

        return documentos;
    };

    const handleToggleDocumento = (id: string) => {
        setSelectedDocumentos(prev =>
            prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
        );
    };

    /** Bonificación contado 10%: la NC es proporcional a TODOS los componentes
     *  (neto + IVA + percepciones) → exactamente 10% del total facturado. */
    const calcularBonificacionContado = (): number => {
        if (!data) return 0;
        return selectedDocumentos.reduce((sum, id) => {
            const comp = data.comprobantes.find(c => c.id === id);
            if (!comp) return sum;
            if (["PRES", "FA", "FB", "FC"].includes(comp.tipo_comprobante)) {
                return sum + Math.abs(comp.total_factura) * 0.1;
            }
            return sum;
        }, 0);
    };

    const handleAddPagoForm = () => {
        setPagosForm([...pagosForm, { tipo: 'efectivo', monto: 0, detalles: {} }]);
    };

    const handleRemovePagoForm = (index: number) => {
        setPagosForm(pagosForm.filter((_, i) => i !== index));
    };

    const handleSubmitPayment = async () => {
        if (selectedDocumentos.length === 0) {
            toast({ variant: "destructive", title: "Error", description: "Selecciona al menos un comprobante" });
            return;
        }

        const totalPago = pagosForm.reduce((sum, p) => sum + Number(p.monto), 0);
        if (totalPago <= 0) {
            toast({ variant: "destructive", title: "Error", description: "Ingresa un monto válido" });
            return;
        }

        try {
            const allDocs = getDocumentosUnificados();
            const response = await fetch('/api/pagos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    cliente_id: clienteId,
                    monto_total: totalPago,
                    pagos: pagosForm,
                    documentos_imputados: selectedDocumentos.map(id => {
                        const doc = allDocs.find(d => d.id === id);
                        return {
                            id,
                            tipo: doc?.es_devolucion ? 'devolucion' : 'factura',
                            monto: doc?.saldo || 0
                        };
                    }),
                    observaciones
                }),
            });

            if (!response.ok) throw new Error('Error al registrar pago');

            const pagoResult = await response.json();

            // Generar bonificación pago contado 10% si corresponde
            if (aplicarContado && selectedDocumentos.length > 0) {
                const comprobanteIds = selectedDocumentos.filter(id => {
                    const doc = allDocs.find(d => d.id === id);
                    return doc && !doc.es_devolucion && doc.tipo !== "PAGO";
                });

                if (comprobanteIds.length > 0) {
                    try {
                        const bonifRes = await fetch('/api/pagos/generar-bonificacion', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                cliente_id: clienteId,
                                comprobante_ids: comprobanteIds,
                                pago_id: pagoResult?.pago?.id || pagoResult?.id,
                            }),
                        });
                        const bonifData = await bonifRes.json();
                        if (bonifRes.ok && bonifData.total_bonificacion > 0) {
                            toast({
                                title: "Bonificación contado generada",
                                description: `NC/REV por $${Math.round(bonifData.total_bonificacion).toLocaleString('es-AR')} generados automáticamente`,
                            });
                        }
                    } catch {
                        // Si falla la bonificación, no bloqueamos el pago ya registrado
                        toast({ variant: "destructive", title: "Atención", description: "Pago registrado, pero hubo un error al generar la bonificación contado. Verificar manualmente." });
                    }
                }
            }

            toast({ title: "Éxito", description: "Pago registrado correctamente" });
            setShowPaymentModal(false);
            setSelectedDocumentos([]);
            setPagosForm([]);
            setObservaciones("");
            setAplicarContado(false);
            fetchData();
        } catch (error) {
            toast({ variant: "destructive", title: "Error", description: "No se pudo registrar el pago" });
        }
    };

    const handleSubmitAdjustment = async () => {
        if (!selectedComprobanteForAdjustment || !adjustmentMonto || !adjustmentMotivo) {
            toast({ variant: "destructive", title: "Error", description: "Completa todos los campos" });
            return;
        }

        try {
            const response = await fetch(`/api/clientes/${clienteId}/ajustes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    comprobante_id: selectedComprobanteForAdjustment,
                    monto: parseFloat(adjustmentMonto),
                    motivo: adjustmentMotivo
                }),
            });

            if (!response.ok) throw new Error('Error al ajustar saldo');

            const result = await response.json();
            toast({ title: "Éxito", description: result.mensaje });
            setShowAdjustmentModal(false);
            setSelectedComprobanteForAdjustment("");
            setAdjustmentMonto("");
            setAdjustmentMotivo("");
            fetchData();
        } catch (error) {
            toast({ variant: "destructive", title: "Error", description: "No se pudo ajustar el saldo" });
        }
    };

    const eliminarAjuste = async (movimientoId: string) => {
        if (!window.confirm("¿Eliminar este ajuste manual? El saldo del cliente se recalcula al instante.")) return;
        try {
            const res = await fetch(`/api/clientes/${clienteId}/ajustes`, {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ movimiento_id: movimientoId }),
            });
            const d = await res.json();
            if (!res.ok) throw new Error(d.error || "Error eliminando el ajuste");
            toast({ title: "Ajuste eliminado", description: "El saldo se recalculó." });
            fetchData();
        } catch (e: any) {
            toast({ variant: "destructive", title: "Error", description: e.message });
        }
    };

    const getEstadoBadge = (saldo: number, esDevolucion: boolean) => {
        if (esDevolucion) {
            return <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200">Pendiente ERP</Badge>;
        }
        if (saldo === 0) return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">Pagado</Badge>;
        if (saldo > 0) return <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">Pendiente</Badge>;
        return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">A favor</Badge>;
    };

    const getPagoBadge = (estado: string) => {
        if (estado === "pendiente" || estado === "pendiente_rendicion")
            return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">Pendiente de verificación</Badge>;
        if (estado === "rechazado")
            return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">Rechazado</Badge>;
        if (estado === "anulado")
            return <Badge variant="outline" className="bg-gray-100 text-gray-600 border-gray-200">Anulado</Badge>;
        return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">Confirmado</Badge>;
    };

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
            </div>
        );
    }

    if (!data) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <p className="text-gray-500">No se pudo cargar la información</p>
            </div>
        );
    }

    const documentosUnificados = getDocumentosUnificados();
    const totalSeleccionado = selectedDocumentos.reduce((sum, id) => {
        const doc = documentosUnificados.find(d => d.id === id);
        return sum + (doc?.es_credito ? -doc.saldo : doc?.saldo || 0);
    }, 0);

    // ── Extracto (libro mayor): cada fila que mueve el saldo, con acumulado ──
    // Es la fuente de verdad del Saldo Real: la última fila cierra exacto ahí.
    const ETIQUETA_MOV: Record<string, string> = {
        venta: "Factura / Venta",
        factura: "Factura",
        pago: "Pago",
        nota_credito: "Nota de crédito",
        nota_debito: "Nota de débito",
        ajuste: "Ajuste manual",
        debito: "Ajuste (débito)",
        credito: "Ajuste (crédito)",
        devolucion: "Devolución",
    };
    const extracto = (() => {
        const movs = [...(data.movimientos ?? [])].sort(
            (a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime()
        );
        let acumulado = 0;
        return movs.map((m, i) => {
            acumulado += Number(m.debe || 0) - Number(m.haber || 0);
            return { ...m, saldo_acumulado: acumulado, key: i };
        });
    })();

    return (
        <div className="min-h-screen bg-gray-50">
            <header className="bg-white border-b sticky top-0 z-10 px-6 py-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Button variant="ghost" size="icon" onClick={() => router.back()}>
                            <ArrowLeftIcon />
                        </Button>
                        <div>
                            <h1 className="text-2xl font-bold">{data.cliente.razon_social || data.cliente.nombre}</h1>
                            <p className="text-sm text-gray-500">CUIT: {data.cliente.cuit}</p>
                        </div>
                    </div>
                    <div className="text-right">
                        <p className="text-sm text-gray-500">Saldo Real</p>
                        <p className={`text-3xl font-bold ${data.cliente.saldo_total > 0 ? 'text-red-600' : 'text-green-600'}`}>
                            ${data.cliente.saldo_total.toLocaleString('es-AR')}
                        </p>
                        {(data.cliente.pendiente_verificacion ?? 0) > 0 && (
                            <p className="text-xs text-amber-600 mt-1">
                                Pendiente de verificación: ${(data.cliente.pendiente_verificacion ?? 0).toLocaleString('es-AR')}
                                {' · '}Proyectado: ${(data.cliente.saldo_proyectado ?? 0).toLocaleString('es-AR')}
                            </p>
                        )}
                    </div>
                </div>
            </header>

            <main className="container mx-auto px-6 py-8 space-y-6">
                {/* Quick Actions */}
                <div className="flex gap-3">
                    <Link href={`/pagos-clientes?cliente_id=${clienteId}`}>
                        <Button>
                            Registrar Pago
                        </Button>
                    </Link>
                    <Button variant="outline" onClick={() => setShowAdjustmentModal(true)}>
                        Ajustar Saldo
                    </Button>
                </div>

                {/* ── Extracto: el libro mayor que justifica el Saldo Real ── */}
                <Card>
                    <CardHeader>
                        <CardTitle>Extracto de cuenta</CardTitle>
                        <CardDescription>
                            Todos los movimientos que componen el saldo — facturas, pagos, notas de crédito y ajustes — con el saldo acumulado. La última fila cierra en el Saldo Real.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Fecha</TableHead>
                                        <TableHead>Movimiento</TableHead>
                                        <TableHead>Detalle</TableHead>
                                        <TableHead className="text-right">Debe (+)</TableHead>
                                        <TableHead className="text-right">Haber (−)</TableHead>
                                        <TableHead className="text-right">Saldo</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {extracto.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={6} className="text-center text-gray-500 py-8">
                                                Sin movimientos registrados
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        extracto.map((m) => (
                                            <TableRow key={m.key} className={m.tipo_movimiento?.includes("ajuste") || m.tipo_movimiento === "debito" || m.tipo_movimiento === "credito" ? "bg-amber-50/50" : ""}>
                                                <TableCell className="whitespace-nowrap">{new Date(m.fecha).toLocaleDateString('es-AR')}</TableCell>
                                                <TableCell className="font-medium whitespace-nowrap">
                                                    {ETIQUETA_MOV[m.tipo_movimiento] ?? (m.tipo_movimiento || "Movimiento")}
                                                    {m.numero_comprobante ? ` ${m.numero_comprobante}` : ""}
                                                </TableCell>
                                                <TableCell className="max-w-[340px] truncate text-gray-500" title={m.observaciones || ""}>
                                                    {m.observaciones || "—"}
                                                </TableCell>
                                                <TableCell className="text-right tabular-nums">
                                                    {Number(m.debe) > 0 ? `$${Number(m.debe).toLocaleString('es-AR')}` : ""}
                                                </TableCell>
                                                <TableCell className="text-right tabular-nums text-green-700">
                                                    {Number(m.haber) > 0 ? `−$${Number(m.haber).toLocaleString('es-AR')}` : ""}
                                                </TableCell>
                                                <TableCell className={`text-right font-bold tabular-nums ${m.saldo_acumulado > 0 ? "text-red-600" : "text-green-600"}`}>
                                                    ${m.saldo_acumulado.toLocaleString('es-AR')}
                                                    {m.tipo_movimiento === "ajuste" && m.referencia_tipo === "ajuste_manual" && m.id && (
                                                        <button
                                                            onClick={() => eliminarAjuste(m.id!)}
                                                            title="Eliminar este ajuste manual"
                                                            className="ml-2 align-middle text-gray-300 hover:text-red-600"
                                                        >
                                                            🗑
                                                        </button>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                    {extracto.length > 0 && (
                                        <TableRow className="bg-gray-50 border-t-2">
                                            <TableCell colSpan={5} className="font-bold">Saldo actual</TableCell>
                                            <TableCell className={`text-right font-bold text-base tabular-nums ${data.cliente.saldo_total > 0 ? "text-red-600" : "text-green-600"}`}>
                                                ${data.cliente.saldo_total.toLocaleString('es-AR')}
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>

                {/* Unified Documents Table */}
                <Card>
                    <CardHeader>
                        <CardTitle>Comprobantes</CardTitle>
                        <CardDescription>Estado de cada comprobante (saldos de imputación) — para seleccionar y pagar</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-12"></TableHead>
                                        <TableHead>Tipo</TableHead>
                                        <TableHead>Número</TableHead>
                                        <TableHead>Fecha</TableHead>
                                        <TableHead>Pedido</TableHead>
                                        <TableHead className="text-right">Total</TableHead>
                                        <TableHead className="text-right">Saldo</TableHead>
                                        <TableHead>Estado</TableHead>
                                        <TableHead></TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {documentosUnificados.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={9} className="text-center text-gray-500 py-8">
                                                No hay comprobantes registrados
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        documentosUnificados.map((doc) => (
                                            <TableRow key={doc.id} className={`hover:bg-gray-50 ${doc.estado === "anulado" && doc.tipo !== "PAGO" ? "opacity-50 line-through" : ""}`}>
                                                <TableCell>
                                                    <Checkbox
                                                        checked={selectedDocumentos.includes(doc.id)}
                                                        onCheckedChange={() => handleToggleDocumento(doc.id)}
                                                    />
                                                </TableCell>
                                                <TableCell className="font-medium">{doc.tipo}</TableCell>
                                                <TableCell>{doc.numero}</TableCell>
                                                <TableCell>{new Date(doc.fecha).toLocaleDateString('es-AR')}</TableCell>
                                                <TableCell>
                                                    {doc.pedido !== "-" ? (
                                                        <Link href={`/pedidos/${doc.pedido}`} className="text-blue-600 hover:underline">
                                                            {doc.pedido}
                                                        </Link>
                                                    ) : (
                                                        <span className="text-gray-400">-</span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-right font-medium">
                                                    ${doc.total.toLocaleString('es-AR')}
                                                </TableCell>
                                                <TableCell className={`text-right font-bold ${doc.es_credito ? 'text-green-600' : ''}`}>
                                                    {doc.es_credito ? '-' : ''}${Math.abs(doc.saldo).toLocaleString('es-AR')}
                                                </TableCell>
                                                <TableCell>
                                                    {doc.tipo === "PAGO"
                                                        ? getPagoBadge((doc as any).estado)
                                                        : doc.estado === "anulado"
                                                            ? <Badge variant="outline" className="bg-gray-100 text-gray-500 border-gray-200">Anulado</Badge>
                                                            : getEstadoBadge(doc.saldo, doc.es_devolucion)}
                                                </TableCell>
                                                <TableCell>
                                                    {!doc.es_devolucion && doc.tipo !== "PAGO" && (
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={() => window.open(`/api/comprobantes-venta/${doc.id}/pdf`, '_blank')}
                                                        >
                                                            <FileTextIcon />
                                                        </Button>
                                                    )}
                                                    {doc.tipo === "PAGO" && (
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            title="Ver recibo"
                                                            onClick={() => window.open(`/api/pagos-clientes/${doc.id}/recibo`, '_blank')}
                                                        >
                                                            <ExternalLink className="h-4 w-4" />
                                                        </Button>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                        {selectedDocumentos.length > 0 && (
                            <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                                <p className="font-medium">
                                    {selectedDocumentos.length} documento(s) seleccionado(s) - Total: ${totalSeleccionado.toLocaleString('es-AR')}
                                </p>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </main>

            {/* Payment Modal */}
            <Dialog open={showPaymentModal} onOpenChange={setShowPaymentModal}>
                <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Registrar Pago</DialogTitle>
                        <DialogDescription>
                            Total seleccionado: ${totalSeleccionado.toLocaleString('es-AR')}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div>
                            <Label>Formas de Pago</Label>
                            {pagosForm.map((pago, index) => (
                                <div key={index} className="border rounded p-3 mt-2 space-y-2">
                                    <div className="flex gap-2">
                                        <Select value={pago.tipo} onValueChange={(v: any) => {
                                            const newForms = [...pagosForm];
                                            newForms[index].tipo = v;
                                            setPagosForm(newForms);
                                        }}>
                                            <SelectTrigger className="w-40">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="efectivo">Efectivo</SelectItem>
                                                <SelectItem value="cheque">Cheque</SelectItem>
                                                <SelectItem value="transferencia">Transferencia</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <Input
                                            type="number"
                                            placeholder="Monto"
                                            value={pago.monto}
                                            onChange={(e) => {
                                                const newForms = [...pagosForm];
                                                newForms[index].monto = parseFloat(e.target.value) || 0;
                                                setPagosForm(newForms);
                                            }}
                                        />
                                        <Button variant="ghost" size="sm" onClick={() => handleRemovePagoForm(index)}>×</Button>
                                    </div>
                                    {pago.tipo === 'cheque' && (
                                        <div className="grid grid-cols-2 gap-2">
                                            <Input placeholder="N° Cheque" onChange={(e) => {
                                                const newForms = [...pagosForm];
                                                newForms[index].detalles.numero_cheque = e.target.value;
                                                setPagosForm(newForms);
                                            }} />
                                            <Input placeholder="Banco" onChange={(e) => {
                                                const newForms = [...pagosForm];
                                                newForms[index].detalles.banco = e.target.value;
                                                setPagosForm(newForms);
                                            }} />
                                        </div>
                                    )}
                                    {pago.tipo === 'transferencia' && (
                                        <Input placeholder="Referencia" onChange={(e) => {
                                            const newForms = [...pagosForm];
                                            newForms[index].detalles.referencia = e.target.value;
                                            setPagosForm(newForms);
                                        }} />
                                    )}
                                </div>
                            ))}
                            <Button variant="outline" size="sm" onClick={handleAddPagoForm} className="mt-2 w-full">
                                + Agregar forma de pago
                            </Button>
                        </div>
                        <div>
                            <Label>Observaciones</Label>
                            <Textarea value={observaciones} onChange={(e) => setObservaciones(e.target.value)} />
                        </div>

                        {/* Pago contado — bonificación 10% */}
                        {selectedDocumentos.length > 0 && (
                            <div className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${aplicarContado ? "bg-amber-50 border-amber-200" : "bg-muted/30"}`}>
                                <Checkbox
                                    id="aplicar-contado"
                                    checked={aplicarContado}
                                    onCheckedChange={(v) => setAplicarContado(!!v)}
                                    className="mt-0.5"
                                />
                                <div className="flex-1">
                                    <label htmlFor="aplicar-contado" className="text-sm font-medium cursor-pointer">
                                        Aplicar 10% descuento pago contado
                                    </label>
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                        Se generará automáticamente una NC/REV (artículo 11115) por cada comprobante seleccionado.
                                    </p>
                                    {aplicarContado && (
                                        <p className="text-sm font-bold text-amber-700 mt-1">
                                            Bonificación estimada: ${Math.round(calcularBonificacionContado()).toLocaleString('es-AR')}
                                        </p>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => { setShowPaymentModal(false); setAplicarContado(false); }}>Cancelar</Button>
                        <Button onClick={handleSubmitPayment}>Registrar Pago{aplicarContado ? " + Bonif. Contado" : ""}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Adjustment Modal */}
            <Dialog open={showAdjustmentModal} onOpenChange={setShowAdjustmentModal}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Ajustar Saldo</DialogTitle>
                        <DialogDescription>
                            Realizar un ajuste manual en el saldo de un comprobante
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div>
                            <Label>Comprobante</Label>
                            <Select value={selectedComprobanteForAdjustment} onValueChange={setSelectedComprobanteForAdjustment}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Selecciona un comprobante" />
                                </SelectTrigger>
                                <SelectContent>
                                    {data.comprobantes.map((comp) => (
                                        <SelectItem key={comp.id} value={comp.id}>
                                            {comp.tipo_comprobante} {comp.numero_comprobante} - Saldo: ${comp.saldo_pendiente.toLocaleString('es-AR')}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div>
                            <Label>Monto de Ajuste</Label>
                            <Input
                                type="number"
                                placeholder="Positivo suma, negativo resta"
                                value={adjustmentMonto}
                                onChange={(e) => setAdjustmentMonto(e.target.value)}
                            />
                        </div>
                        <div>
                            <Label>Motivo</Label>
                            <Textarea
                                placeholder="Explica el motivo del ajuste"
                                value={adjustmentMotivo}
                                onChange={(e) => setAdjustmentMotivo(e.target.value)}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowAdjustmentModal(false)}>Cancelar</Button>
                        <Button onClick={handleSubmitAdjustment}>Aplicar Ajuste</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

export default CuentaCorrientePage;
