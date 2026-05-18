import dynamic from 'next/dynamic'

const WarehousePlanner = dynamic(
  () => import('@/components/warehouse/WarehousePlanner'),
  {
    ssr: false,
    loading: () => (
      <div style={{ height: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9', fontFamily: 'system-ui' }}>
        <div style={{ textAlign: 'center', color: '#64748b' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🏭</div>
          <div style={{ fontWeight: 600 }}>Cargando Planner...</div>
        </div>
      </div>
    ),
  }
)

export default function WarehousePage() {
  return <WarehousePlanner />
}
