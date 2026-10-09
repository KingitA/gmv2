'use client'

import dynamic from 'next/dynamic'
import { CargaProgreso, MENSAJES } from "@/components/ui/carga-progreso"

const WarehousePlanner = dynamic(
  () => import('@/components/warehouse/WarehousePlanner'),
  {
    ssr: false,
    loading: () => (
      <div style={{ height: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9', fontFamily: 'system-ui' }}>
        <CargaProgreso mensajes={MENSAJES.general} titulo="Cargando Planner" />
      </div>
    ),
  }
)

export default function WarehousePage() {
  return <WarehousePlanner />
}
