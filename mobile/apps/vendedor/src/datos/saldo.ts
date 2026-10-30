// SALDO QUE SE MUESTRA (P2-42, regla del dueño 29/10/2026).
//
// El saldo proyectado descuenta lo que van a hacer los cobros todavía sin confirmar, incluido
// su 10 % por pago contado. Con un cobro contado en camino, el proyectado de un cliente que
// DEBE puede quedar negativo: es el 10 % (o un ajuste), no plata a favor del cliente, y
// mostrarlo como "a favor" confunde a los vendedores. Regla: si debía $100 con 10 % contado
// y pagó $90, debe $0. "A favor" se muestra solo si el cliente ya tiene plata a favor en su
// saldo real.

const r2 = (n: number) => Math.round(n * 100) / 100

export function saldoVisible(real: number, proyectado: number | null | undefined): number {
  const proy = r2(Number(proyectado ?? real) || 0)
  if (real > -0.005 && proy < 0) return 0
  return proy
}
