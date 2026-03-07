import { nowArgentina } from "@/lib/utils"

export const mockDashboardData = {
  viajes: [
    {
      id: 1,
      fecha: nowArgentina(),
      estado: "programado",
      chofer: "Juan Pérez",
      nombre: "Viaje a Rosario",
      zona: { nombre: "Rosario" },
    },
    {
      id: 2,
      fecha: new Date(Date.now() + 86400000).toISOString(),
      estado: "pendiente",
      chofer: "María González",
      nombre: "Reparto Centro",
      zona: { nombre: "Centro" },
    },
  ],
  totalPedidosPendientes: 2,
  saldosCount: 1,
}
