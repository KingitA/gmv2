export default function PlayroomLoading() {
  return (
    <div
      className="flex items-center justify-center"
      style={{ minHeight: 'calc(100vh - 0px)', background: '#0a0f1e' }}
    >
      <div className="flex flex-col items-center gap-4">
        <div
          className="w-10 h-10 rounded-full border-2 animate-spin"
          style={{ borderColor: '#7c3aed', borderTopColor: 'transparent' }}
        />
        <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: '14px' }}>Cargando PLAYROOM...</p>
      </div>
    </div>
  )
}
