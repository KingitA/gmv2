export function OrderStatusBadge({ status }: { status: string }) {
  const styles = {
    pendiente: "bg-amber-100 text-amber-700 border-amber-200",
    aprobado: "bg-green-100 text-green-700 border-green-200",
    rechazado: "bg-red-100 text-red-700 border-red-200",
    enviado: "bg-blue-100 text-blue-700 border-blue-200",
    entregado: "bg-emerald-100 text-emerald-700 border-emerald-200",
    cancelado: "bg-gray-100 text-gray-700 border-gray-200",
  }

  const labels = {
    pendiente: "Pendiente",
    aprobado: "Aprobado",
    rechazado: "Rechazado",
    enviado: "Enviado",
    entregado: "Entregado",
    cancelado: "Cancelado",
  }

  return (
    <span
      className={`inline-flex px-3 py-1 rounded-full text-xs font-medium border ${styles[status as keyof typeof styles] || styles.pendiente}`}
    >
      {labels[status as keyof typeof labels] || status}
    </span>
  )
}
