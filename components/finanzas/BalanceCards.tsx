"use client"

import { Card, CardContent } from "@/components/ui/card"
import { MoneyColorBadge } from "./MoneyColorBadge"

interface BalanceCardsProps {
    saldos: Array<{
        cuenta_tipo: "CAJA" | "BANCO"
        cuenta_id: string
        color: "BLANCO" | "NEGRO"
        saldo: number
    }>
    cuentas: Array<{
        id: string
        nombre: string
        tipo: "CAJA" | "BANCO"
    }>
}

export function BalanceCards({ saldos, cuentas }: BalanceCardsProps) {
    const getSaldoCuenta = (cuentaId: string, color: "BLANCO" | "NEGRO") => {
        const saldo = saldos.find(s => s.cuenta_id === cuentaId && s.color === color)
        return saldo?.saldo || 0
    }

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {cuentas.map(cuenta => (
                <Card key={cuenta.id}>
                    <CardContent className="p-4">
                        <h3 className="font-semibold text-sm mb-3">{cuenta.nombre}</h3>
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <MoneyColorBadge color="BLANCO" />
                                <span className="font-bold">${getSaldoCuenta(cuenta.id, "BLANCO").toFixed(2)}</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <MoneyColorBadge color="NEGRO" />
                                <span className="font-bold">${getSaldoCuenta(cuenta.id, "NEGRO").toFixed(2)}</span>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            ))}
        </div>
    )
}
