"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { MoneyColorBadge } from "./MoneyColorBadge"

interface Cheque {
    id: string
    banco: string
    numero: string
    fecha_vencimiento: string
    monto: number
    color: "BLANCO" | "NEGRO"
}

interface ChequeSelectorModalProps {
    open: boolean
    onClose: () => void
    cheques: Cheque[]
    onSelect: (selected: Cheque[]) => void
    multiSelect?: boolean
}

export function ChequeSelectorModal({ open, onClose, cheques, onSelect, multiSelect = true }: ChequeSelectorModalProps) {
    const [selected, setSelected] = useState<Set<string>>(new Set())

    const toggleCheque = (id: string) => {
        const newSet = new Set(selected)
        if (newSet.has(id)) {
            newSet.delete(id)
        } else {
            if (!multiSelect) {
                newSet.clear()
            }
            newSet.add(id)
        }
        setSelected(newSet)
    }

    const handleConfirm = () => {
        const selectedCheques = cheques.filter(c => selected.has(c.id))
        onSelect(selectedCheques)
        setSelected(new Set())
        onClose()
    }

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Seleccionar Cheques en Cartera</DialogTitle>
                </DialogHeader>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-12"></TableHead>
                            <TableHead>Banco</TableHead>
                            <TableHead>Número</TableHead>
                            <TableHead>Vencimiento</TableHead>
                            <TableHead>Monto</TableHead>
                            <TableHead>Color</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {cheques.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={6} className="text-center text-muted-foreground">
                                    No hay cheques disponibles
                                </TableCell>
                            </TableRow>
                        ) : (
                            cheques.map(cheque => (
                                <TableRow key={cheque.id} className="cursor-pointer" onClick={() => toggleCheque(cheque.id)}>
                                    <TableCell>
                                        <Checkbox checked={selected.has(cheque.id)} />
                                    </TableCell>
                                    <TableCell>{cheque.banco}</TableCell>
                                    <TableCell>{cheque.numero}</TableCell>
                                    <TableCell>{new Date(cheque.fecha_vencimiento).toLocaleDateString()}</TableCell>
                                    <TableCell className="font-semibold">${cheque.monto.toFixed(2)}</TableCell>
                                    <TableCell>
                                        <MoneyColorBadge color={cheque.color} />
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
                <div className="flex justify-between items-center pt-4 border-t">
                    <span className="text-sm text-muted-foreground">
                        {selected.size} cheque{selected.size !== 1 ? "s" : ""} seleccionado{selected.size !== 1 ? "s" : ""}
                    </span>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={onClose}>Cancelar</Button>
                        <Button onClick={handleConfirm} disabled={selected.size === 0}>
                            Confirmar Selección
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
