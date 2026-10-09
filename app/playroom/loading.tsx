import { CargaProgreso, MENSAJES } from '@/components/ui/carga-progreso'

export default function PlayroomLoading() {
  return (
    <div
      className="flex items-center justify-center"
      style={{ minHeight: 'calc(100vh - 0px)', background: '#0a0f1e' }}
    >
      <div className="flex w-full max-w-sm flex-col items-center gap-3 px-6">
        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '14px' }}>Cargando PLAYROOM</p>
        <CargaProgreso compacto mensajes={MENSAJES.general} className="[&>div:last-child]:text-white/40 [&>div:first-child]:bg-white/10" />
      </div>
    </div>
  )
}
