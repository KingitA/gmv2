import { CargaProgreso } from '@/components/ui/carga-progreso'

export default function PlayroomLoading() {
  return <CargaProgreso titulo="Abriendo Playroom" mensajes={['Buscando ventas y cobranzas…', 'Armando el tablero…', 'Despertando a Jarvis…', 'Ya casi está…']} />
}
