"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Trash2, Plus } from "lucide-react"
import type { DepositoItem } from "./MetodoPagoForm"

function genId() { return Math.random().toString(36).slice(2) }

interface Props {
  items: DepositoItem[]
  onChange: (items: DepositoItem[]) => void
}

export function DepositoItemsForm({ items, onChange }: Props) {
  const addItem = (tipo: "efectivo" | "cheque") => {
    onChange([...items, { id: genId(), tipo_item: tipo, monto: 0 }])
  }

  const removeItem = (id: string) => onChange(items.filter((it) => it.id !== id))

  const updateItem = (id: string, patch: Partial<DepositoItem>) =>
    onChange(items.map((it) => it.id === id ? { ...it, ...patch } : it))

  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
        Ítems del depósito
      </div>

      {items.map((item) => (
        <div key={item.id} className="border border-dashed rounded-lg p-3 bg-gray-50 relative">
          <div className="flex items-center gap-3 mb-2">
            <Select
              value={item.tipo_item}
              onValueChange={(v) => updateItem(item.id, { tipo_item: v as any })}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="efectivo">Efectivo</SelectItem>
                <SelectItem value="cheque">Cheque</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="number"
              placeholder="Monto"
              min={0}
              step="0.01"
              value={item.monto || ""}
              onChange={(e) => updateItem(item.id, { monto: parseFloat(e.target.value) || 0 })}
              className="w-36"
            />
            <button
              type="button"
              onClick={() => removeItem(item.id)}
              className="ml-auto text-muted-foreground hover:text-red-500"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>

          {item.tipo_item === "efectivo" && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Fecha depósito</Label>
                <Input type="date" value={item.fecha_deposito_efectivo || ""} onChange={(e) => updateItem(item.id, { fecha_deposito_efectivo: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Nro. comprobante</Label>
                <Input placeholder="Nro. comprobante" value={item.nro_comprobante_deposito_ef || ""} onChange={(e) => updateItem(item.id, { nro_comprobante_deposito_ef: e.target.value })} />
              </div>
            </div>
          )}

          {item.tipo_item === "cheque" && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Nro. cheque</Label>
                <Input placeholder="12345678" value={item.numero_cheque || ""} onChange={(e) => updateItem(item.id, { numero_cheque: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Banco emisor</Label>
                <Input placeholder="Banco Nación" value={item.banco_emisor || ""} onChange={(e) => updateItem(item.id, { banco_emisor: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Fecha de pago del cheque</Label>
                <Input type="date" value={item.fecha_pago_cheque || ""} onChange={(e) => updateItem(item.id, { fecha_pago_cheque: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Nro. comprobante depósito</Label>
                <Input placeholder="Nro. depósito" value={item.numero_comprobante_deposito || ""} onChange={(e) => updateItem(item.id, { numero_comprobante_deposito: e.target.value })} />
              </div>
            </div>
          )}
        </div>
      ))}

      <div className="flex gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => addItem("efectivo")} className="text-xs">
          <Plus className="h-3 w-3 mr-1" /> Efectivo
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => addItem("cheque")} className="text-xs">
          <Plus className="h-3 w-3 mr-1" /> Cheque
        </Button>
      </div>
    </div>
  )
}
