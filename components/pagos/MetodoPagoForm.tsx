"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Trash2, Plus } from "lucide-react"
import { DepositoItemsForm } from "./DepositoItemsForm"
import { DateInputAR } from "@/components/ui/date-input-ar"

export type TipoPago = "efectivo" | "transferencia" | "cheque" | "deposito"

export interface MetodoPago {
  id: string
  tipo: TipoPago
  monto: number
  // efectivo
  caja_id?: string
  // transferencia
  cuenta_bancaria_id?: string
  fecha_transferencia?: string
  numero_comprobante?: string
  // cheque
  numero_cheque?: string
  banco_emisor?: string
  fecha_emision?: string
  fecha_cheque?: string
  localidad?: string
  cuit_emisor?: string
  color_cheque?: "BLANCO" | "NEGRO" | "ECHEQ"
  // deposito
  fecha_deposito?: string
  items?: DepositoItem[]
}

export interface DepositoItem {
  id: string
  tipo_item: "efectivo" | "cheque"
  monto: number
  numero_cheque?: string
  banco_emisor?: string
  fecha_pago_cheque?: string
  numero_comprobante_deposito?: string
  fecha_deposito_efectivo?: string
  nro_comprobante_deposito_ef?: string
}

interface CajaOption { id: string; nombre: string }
interface BancoOption { id: string; nombre: string; banco: string }

interface Props {
  metodos: MetodoPago[]
  onChange: (metodos: MetodoPago[]) => void
}

const tipoLabels: Record<TipoPago, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  cheque: "Cheque",
  deposito: "Depósito",
}

const colorLabels = { BLANCO: "Blanco", NEGRO: "Negro", ECHEQ: "Echeq" }

function genId() { return Math.random().toString(36).slice(2) }

export function MetodoPagoForm({ metodos, onChange }: Props) {
  const [cajas, setCajas] = useState<CajaOption[]>([])
  const [bancos, setBancos] = useState<BancoOption[]>([])
  const supabase = createClient()

  useEffect(() => {
    supabase.from("cajas_financieras").select("id, nombre").eq("activo", true).then(({ data }) => setCajas(data || []))
    supabase.from("cuentas_bancarias").select("id, nombre, banco").eq("activo", true).order("nombre").then(({ data }) => setBancos(data || []))
  }, [])

  const addMetodo = () => {
    onChange([...metodos, { id: genId(), tipo: "efectivo", monto: 0 }])
  }

  const removeMetodo = (id: string) => {
    onChange(metodos.filter((m) => m.id !== id))
  }

  const updateMetodo = (id: string, patch: Partial<MetodoPago>) => {
    onChange(metodos.map((m) => m.id === id ? { ...m, ...patch } : m))
  }

  const montoDeposito = (m: MetodoPago) =>
    (m.items || []).reduce((s, it) => s + Number(it.monto), 0)

  return (
    <div className="space-y-3">
      {metodos.map((m) => (
        <div key={m.id} className="border rounded-lg p-4 bg-white relative">
          <div className="flex items-center gap-3 mb-3">
            <Select
              value={m.tipo}
              onValueChange={(v) => updateMetodo(m.id, { tipo: v as TipoPago, monto: 0, items: [] })}
            >
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(tipoLabels) as TipoPago[]).map((t) => (
                  <SelectItem key={t} value={t}>{tipoLabels[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {m.tipo !== "deposito" && (
              <div className="flex-1 max-w-xs">
                <Input
                  type="number"
                  placeholder="Monto"
                  min={0}
                  step="0.01"
                  value={m.monto || ""}
                  onChange={(e) => updateMetodo(m.id, { monto: parseFloat(e.target.value) || 0 })}
                />
              </div>
            )}
            {m.tipo === "deposito" && (
              <span className="text-sm text-muted-foreground ml-2">
                Total: ${montoDeposito(m).toLocaleString("es-AR", { minimumFractionDigits: 2 })}
              </span>
            )}
            <button
              onClick={() => removeMetodo(m.id)}
              className="ml-auto text-muted-foreground hover:text-red-500 transition-colors"
              type="button"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>

          {/* ── EFECTIVO ── */}
          {m.tipo === "efectivo" && (
            <div className="grid grid-cols-2 gap-3 mt-2">
              <div>
                <Label className="text-xs">Destino</Label>
                <Select
                  value={m.caja_id || ""}
                  onValueChange={(v) => updateMetodo(m.id, { caja_id: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar caja" />
                  </SelectTrigger>
                  <SelectContent>
                    {cajas.map((c) => <SelectItem key={c.id} value={c.id}>{c.nombre}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* ── TRANSFERENCIA ── */}
          {m.tipo === "transferencia" && (
            <div className="grid grid-cols-2 gap-3 mt-2">
              <div>
                <Label className="text-xs">Banco destino</Label>
                <Select
                  value={m.cuenta_bancaria_id || ""}
                  onValueChange={(v) => updateMetodo(m.id, { cuenta_bancaria_id: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar banco" />
                  </SelectTrigger>
                  <SelectContent>
                    {bancos.map((b) => <SelectItem key={b.id} value={b.id}>{b.banco} — {b.nombre}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Fecha transferencia</Label>
                <DateInputAR value={m.fecha_transferencia || ""} onChange={(v) => updateMetodo(m.id, { fecha_transferencia: v })} />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Nro. comprobante / referencia</Label>
                <Input placeholder="Nro. operación" value={m.numero_comprobante || ""} onChange={(e) => updateMetodo(m.id, { numero_comprobante: e.target.value })} />
              </div>
            </div>
          )}

          {/* ── CHEQUE ── */}
          {m.tipo === "cheque" && (
            <div className="grid grid-cols-2 gap-3 mt-2">
              <div>
                <Label className="text-xs">Nro. cheque</Label>
                <Input placeholder="12345678" value={m.numero_cheque || ""} onChange={(e) => updateMetodo(m.id, { numero_cheque: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Banco emisor</Label>
                <Input placeholder="Banco Nación" value={m.banco_emisor || ""} onChange={(e) => updateMetodo(m.id, { banco_emisor: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Fecha emisión</Label>
                <DateInputAR value={m.fecha_emision || ""} onChange={(v) => updateMetodo(m.id, { fecha_emision: v })} />
              </div>
              <div>
                <Label className="text-xs">Fecha de pago</Label>
                <DateInputAR value={m.fecha_cheque || ""} onChange={(v) => updateMetodo(m.id, { fecha_cheque: v })} />
              </div>
              <div>
                <Label className="text-xs">Localidad</Label>
                <Input placeholder="Buenos Aires" value={m.localidad || ""} onChange={(e) => updateMetodo(m.id, { localidad: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">CUIT emisor</Label>
                <Input placeholder="20-12345678-9" value={m.cuit_emisor || ""} onChange={(e) => updateMetodo(m.id, { cuit_emisor: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Color</Label>
                <Select value={m.color_cheque || "BLANCO"} onValueChange={(v) => updateMetodo(m.id, { color_cheque: v as any })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.entries(colorLabels)).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* ── DEPÓSITO ── */}
          {m.tipo === "deposito" && (
            <div className="mt-2 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Banco destino</Label>
                  <Select
                    value={m.cuenta_bancaria_id || ""}
                    onValueChange={(v) => updateMetodo(m.id, { cuenta_bancaria_id: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar banco" />
                    </SelectTrigger>
                    <SelectContent>
                      {bancos.map((b) => <SelectItem key={b.id} value={b.id}>{b.banco} — {b.nombre}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Fecha depósito</Label>
                  <DateInputAR value={m.fecha_deposito || ""} onChange={(v) => updateMetodo(m.id, { fecha_deposito: v })} />
                </div>
              </div>
              <DepositoItemsForm
                items={m.items || []}
                onChange={(items) => updateMetodo(m.id, { items })}
              />
            </div>
          )}
        </div>
      ))}

      <Button type="button" variant="outline" size="sm" onClick={addMetodo}>
        <Plus className="h-4 w-4 mr-1" /> Agregar método de pago
      </Button>
    </div>
  )
}
