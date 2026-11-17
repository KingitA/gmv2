/**
 * Hojas visibles de un Excel (Juan 17/11/2026): un pedido "anexo" se mandó con el
 * mismo archivo del pedido anterior y todas las hojas ocultas salvo la nueva; la
 * importación leía también las ocultas y duplicó el pedido (002202 / 002208).
 * Lo que el cliente no ve en el Excel no se importa. Si por algún motivo no queda
 * ninguna visible, se usan todas (un Excel así no se puede abrir igual).
 */
export function hojasVisibles(workbook: { SheetNames: string[]; Workbook?: { Sheets?: Array<{ name?: string; Hidden?: number }> } }): string[] {
    const ocultas = new Set(
        (workbook.Workbook?.Sheets ?? []).filter((s) => s?.name && (s.Hidden ?? 0) !== 0).map((s) => s.name as string),
    )
    const visibles = workbook.SheetNames.filter((n) => !ocultas.has(n))
    return visibles.length > 0 ? visibles : workbook.SheetNames
}
