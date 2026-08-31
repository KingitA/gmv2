"use client"
import { formatDateAR } from "@/lib/utils";

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
import { FechaInput } from "@/components/finanzas/fecha-input";
import { disponibleDePago } from "@/lib/cuenta-corriente/pago-disponible";

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
    comprobante_tipo?: string | null;
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
    estado?: string | null;
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
    // Vista: "saldos" (default — solo lo que tiene saldo) | "detallada" (desglose + filtro fechas)
    const [vista, setVista] = useState<"saldos" | "detallada">("saldos");
    const [fechaDesde, setFechaDesde] = useState("");
    const [fechaHasta, setFechaHasta] = useState("");

    // Modal states
    const [showAdjustmentModal, setShowAdjustmentModal] = useState(false);
    const [selectedDocumentos, setSelectedDocumentos] = useState<string[]>([]);


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

        // Devoluciones EN PROCESO: estimativo informativo para facilitar la
        // cobranza — NO son crédito real (el crédito nace con la NC/REV, que ya
        // aparece como comprobante). saldo=0 para que ninguna suma las cuente.
        data.devoluciones.forEach((dev) => {
            documentos.push({
                id: dev.id,
                tipo: "Devolución en proceso",
                numero: dev.numero_devolucion,
                fecha: dev.created_at,
                pedido: "-",
                total: -Math.abs(dev.monto_total), // estimado a descontar
                saldo: 0,
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

            // Plata a cuenta: lo del pago que no se aplicó a ningún comprobante
            // (entrega a cuenta o sobrante). Fórmula única compartida con la
            // Caja del Día: lib/cuenta-corriente/pago-disponible.ts.
            if (pago.estado === "confirmado") {
                const tipoDe = new Map(data.comprobantes.map((c) => [c.id, c.tipo_comprobante]));
                const disponible = disponibleDePago(
                    pago.monto,
                    (pago.imputaciones || []).map((i) => ({
                        monto_imputado: i.monto_imputado,
                        estado: i.estado,
                        tipo_comprobante_destino: tipoDe.get(i.comprobante_id) ?? null,
                    })),
                );
                if (disponible > 0.009) {
                    documentos.push({
                        id: `acuenta-${pago.id}`,
                        tipo: "A CUENTA",
                        numero: metodoPago || "Pago",
                        fecha: pago.fecha_pago,
                        pedido: "-",
                        total: -disponible,
                        saldo: -disponible,
                        estado: "a_cuenta",
                        es_devolucion: false,
                        es_credito: true,
                    });
                }
            }
        });

        // Sort by date descending
        documentos.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));

        return documentos;
    };

    const handleToggleDocumento = (id: string) => {
        setSelectedDocumentos(prev =>
            prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
        );
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
        presupuesto: "Presupuesto",
    };
    // Con el tipo real del comprobante referenciado, la etiqueta es exacta
    // (la REV interna no es lo mismo que una NC fiscal)
    const ETIQUETA_TIPO: Record<string, string> = {
        FA: "Factura A",
        FB: "Factura B",
        FC: "Factura C",
        PRES: "Presupuesto",
        REV: "Reversa",
        NC: "Nota de crédito",
        NCA: "Nota de crédito A",
        NCB: "Nota de crédito B",
        NCC: "Nota de crédito C",
        NDA: "Nota de débito A",
        NDB: "Nota de débito B",
        NDC: "Nota de débito",
        REM: "Remito",
    };
    const etiquetaMov = (m: MovimientoCC) => {
        // La reversa de un pago anulado se postea como tipo 'ajuste' pero NO es
        // un ajuste manual: rotularla por su referencia real.
        if (m.referencia_tipo === "pago_anulacion") return "Anulación de pago";
        return (
            (m.comprobante_tipo && ETIQUETA_TIPO[m.comprobante_tipo]) ??
            ETIQUETA_MOV[m.tipo_movimiento] ??
            (m.tipo_movimiento || "Movimiento")
        );
    };
    // Filtro por fecha (vista detallada). El saldo acumulado se calcula sobre
    // TODOS los movimientos (si no, arrancaría de cero en la fecha filtrada).
    const enRango = (fecha: string) => {
        const f = fecha?.slice(0, 10);
        if (fechaDesde && f < fechaDesde) return false;
        if (fechaHasta && f > fechaHasta) return false;
        return true;
    };
    const extracto = (() => {
        const movs = [...(data.movimientos ?? [])].sort(
            (a, b) => String(a.fecha).localeCompare(String(b.fecha))
        );
        let acumulado = 0;
        return movs
            .map((m, i) => {
                acumulado += Number(m.debe || 0) - Number(m.haber || 0);
                return { ...m, saldo_acumulado: acumulado, key: i };
            })
            .filter((m) => enRango(m.fecha));
    })();

    // Cobros en la calle (pendientes de verificación): son PROMESAS, no tocan
    // el libro hasta que la oficina confirma. Se muestran en gris en el
    // extracto (sin sumar) y como chip en cada comprobante que imputan.
    const cobrosEnCalle = (data.pagos ?? []).filter((p) => p.estado === "pendiente" || p.estado === "pendiente_rendicion");
    const enCallePorComprobante = new Map<string, number>();
    for (const p of cobrosEnCalle) {
        for (const i of p.imputaciones || []) {
            if (i.estado === "anulado") continue;
            enCallePorComprobante.set(i.comprobante_id, (enCallePorComprobante.get(i.comprobante_id) ?? 0) + Number(i.monto_imputado || 0));
        }
    }

    // Filas de la tabla según la vista: "saldos" = solo lo que tiene saldo
    // (deuda o a favor); "detallada" = todo, con filtro de fechas.
    const documentosVisibles = documentosUnificados.filter((doc) => {
        if (vista === "saldos") {
            // Comprobantes con saldo + plata a cuenta (con su fecha) + devoluciones
            // en proceso (estimativo visible aunque su saldo real sea 0)
            if (doc.es_devolucion) return doc.estado !== "anulado";
            return doc.tipo !== "PAGO" && doc.estado !== "anulado" && Math.abs(doc.saldo) > 0.009;
        }
        // En detallada los pagos completos ya se ven — las filas "A CUENTA" duplicarían
        return doc.tipo !== "A CUENTA" && enRango(doc.fecha);
    });

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
                {/* Quick Actions + selector de vista */}
                <div className="flex flex-wrap items-center gap-3">
                    <Link href={`/pagos-clientes?cliente_id=${clienteId}`}>
                        <Button>
                            Registrar Pago
                        </Button>
                    </Link>
                    <Button variant="outline" onClick={() => setShowAdjustmentModal(true)}>
                        Ajustar Saldo
                    </Button>
                    <div className="ml-auto inline-flex rounded-lg bg-gray-200 p-0.5">
                        {([["saldos", "Solo saldos"], ["detallada", "Cuenta detallada"]] as const).map(([key, label]) => (
                            <button
                                key={key}
                                onClick={() => setVista(key)}
                                className={`rounded-md px-4 py-1.5 text-sm font-semibold transition ${
                                    vista === key ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900"
                                }`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                    {vista === "detallada" && (
                        <div className="flex items-center gap-2 text-sm text-gray-500">
                            Desde
                            <FechaInput value={fechaDesde} onChange={setFechaDesde} containerClassName="w-[125px]" />
                            hasta
                            <FechaInput value={fechaHasta} onChange={setFechaHasta} containerClassName="w-[125px]" />
                            {(fechaDesde || fechaHasta) && (
                                <button
                                    onClick={() => { setFechaDesde(""); setFechaHasta(""); }}
                                    className="text-xs font-semibold text-blue-600 hover:underline"
                                >
                                    Limpiar
                                </button>
                            )}
                        </div>
                    )}
                </div>

                {/* ── Extracto: el libro mayor que justifica el Saldo Real ── */}
                {vista === "detallada" && (
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
                                                <TableCell className="whitespace-nowrap">{formatDateAR(m.fecha)}</TableCell>
                                                <TableCell className="font-medium whitespace-nowrap">
                                                    {etiquetaMov(m)}
                                                    {m.numero_comprobante ? (
                                                        m.referencia_tipo === "comprobante_venta" && m.referencia_id ? (
                                                            <button
                                                                onClick={() => window.open(`/api/comprobantes-venta/${m.referencia_id}/pdf`, '_blank')}
                                                                className="ml-1 text-blue-600 hover:underline"
                                                                title="Abrir PDF del comprobante"
                                                            >
                                                                {m.numero_comprobante}
                                                            </button>
                                                        ) : (
                                                            ` ${m.numero_comprobante}`
                                                        )
                                                    ) : ""}
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
                                    {/* Cobros en la calle: promesas sin verificar — en gris, no suman */}
                                    {cobrosEnCalle.map((p) => (
                                        <TableRow key={`calle-${p.id}`} className="bg-slate-50/70 text-gray-400 italic">
                                            <TableCell className="whitespace-nowrap">{formatDateAR(p.fecha_pago)}</TableCell>
                                            <TableCell className="whitespace-nowrap">Cobro en calle — sin verificar</TableCell>
                                            <TableCell className="max-w-[340px] truncate" title={p.observaciones || ""}>
                                                {p.estado === "pendiente_rendicion" ? "pendiente de rendición" : "pendiente de confirmación"}
                                                {(p.observaciones || "").includes("[10% CONTADO]") ? " · con 10% contado" : ""}
                                            </TableCell>
                                            <TableCell />
                                            <TableCell className="text-right tabular-nums">(−${Number(p.monto).toLocaleString('es-AR')})</TableCell>
                                            <TableCell />
                                        </TableRow>
                                    ))}
                                    {cobrosEnCalle.length > 0 && data.cliente.saldo_proyectado != null && (
                                        <TableRow className="bg-slate-100">
                                            <TableCell colSpan={5} className="font-semibold text-gray-600">
                                                Saldo proyectado (si la oficina confirma lo cobrado en calle, con su 10%, créditos y ajustes)
                                            </TableCell>
                                            <TableCell className={`text-right font-bold tabular-nums ${data.cliente.saldo_proyectado > 0 ? "text-red-500" : "text-green-600"}`}>
                                                ${data.cliente.saldo_proyectado.toLocaleString('es-AR')}
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
                )}

                {/* Unified Documents Table */}
                <Card>
                    <CardHeader>
                        <CardTitle>{vista === "saldos" ? "Saldos pendientes" : "Comprobantes"}</CardTitle>
                        <CardDescription>
                            {vista === "saldos"
                                ? "Solo lo que tiene saldo: deuda del cliente o crédito a favor. Para el desglose completo, pasá a Cuenta detallada."
                                : "Estado de cada comprobante (saldos de imputación) — para seleccionar y pagar"}
                        </CardDescription>
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
                                    {documentosVisibles.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={9} className="text-center text-gray-500 py-8">
                                                {vista === "saldos" ? "Sin saldos pendientes — la cuenta está al día 🎉" : "No hay comprobantes registrados"}
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        documentosVisibles.map((doc) => (
                                            <TableRow key={doc.id} className={`hover:bg-gray-50 ${doc.estado === "anulado" && doc.tipo !== "PAGO" ? "opacity-50 line-through" : ""}`}>
                                                <TableCell>
                                                    {doc.tipo !== "A CUENTA" && (
                                                        <Checkbox
                                                            checked={selectedDocumentos.includes(doc.id)}
                                                            onCheckedChange={() => handleToggleDocumento(doc.id)}
                                                        />
                                                    )}
                                                </TableCell>
                                                <TableCell className="font-medium">{doc.tipo}</TableCell>
                                                <TableCell>
                                                    {!doc.es_devolucion && doc.tipo !== "PAGO" && doc.tipo !== "A CUENTA" ? (
                                                        <button
                                                            onClick={() => window.open(`/api/comprobantes-venta/${doc.id}/pdf`, '_blank')}
                                                            className="text-blue-600 hover:underline"
                                                            title="Abrir PDF del comprobante"
                                                        >
                                                            {doc.numero}
                                                        </button>
                                                    ) : (
                                                        doc.numero
                                                    )}
                                                </TableCell>
                                                <TableCell>{formatDateAR(doc.fecha)}</TableCell>
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
                                                    {(enCallePorComprobante.get(doc.id) ?? 0) > 0.005 && (
                                                        <span className="ml-2 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 align-middle" title="Cobrado por el vendedor/chofer, pendiente de verificación en oficina">
                                                            en calle ${enCallePorComprobante.get(doc.id)!.toLocaleString('es-AR')}
                                                        </span>
                                                    )}
                                                </TableCell>
                                                <TableCell>
                                                    {doc.tipo === "PAGO"
                                                        ? getPagoBadge((doc as any).estado)
                                                        : doc.tipo === "A CUENTA"
                                                            ? <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">A cuenta</Badge>
                                                            : doc.estado === "anulado"
                                                                ? <Badge variant="outline" className="bg-gray-100 text-gray-500 border-gray-200">Anulado</Badge>
                                                                : getEstadoBadge(doc.saldo, doc.es_devolucion)}
                                                </TableCell>
                                                <TableCell>
                                                    {!doc.es_devolucion && doc.tipo !== "PAGO" && doc.tipo !== "A CUENTA" && (
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
