export default function PlayroomLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: '#0a0f1e',
        minHeight: '100vh',
        fontFamily: "'Inter', 'Geist', sans-serif",
      }}
    >
      {children}
    </div>
  )
}
