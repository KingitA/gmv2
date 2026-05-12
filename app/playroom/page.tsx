'use client'

import { useState } from 'react'
import PlayroomNav from '@/components/playroom/PlayroomNav'
import MegasurChat from '@/components/playroom/MegasurChat'
import ChatDrawer from '@/components/playroom/ChatDrawer'
import RotacionStockMuerto from '@/components/playroom/reportes/RotacionStockMuerto'
import RankingClientesABC from '@/components/playroom/reportes/RankingClientesABC'
import CuentasCorrientes from '@/components/playroom/reportes/CuentasCorrientes'
import ArticulosVendidos from '@/components/playroom/reportes/ArticulosVendidos'
import ComisionesViajantes from '@/components/playroom/reportes/ComisionesViajantes'
import ComprobantesFiscal from '@/components/playroom/reportes/ComprobantesFiscal'

const TABS = [
  {
    id: 'articulos',
    label: 'Artículos Vendidos',
    icon: '🏷️',
    description: 'Venta neta, márgenes, comparativos',
  },
  {
    id: 'cuentas',
    label: 'Cuentas Corrientes',
    icon: '💰',
    description: 'Antigüedad de saldos, mora, DSO',
  },
  {
    id: 'clientes-abc',
    label: 'Clientes ABC',
    icon: '👥',
    description: 'Ranking por facturación, variaciones, estado de cartera',
  },
  {
    id: 'comisiones',
    label: 'Comisiones',
    icon: '💼',
    description: 'Devengadas y performance por viajante',
  },
  {
    id: 'rotacion',
    label: 'Rotación & Stock Muerto',
    icon: '📦',
    description: 'Capital inmovilizado, SKUs sin movimiento, sugerencias de liquidación',
  },
  {
    id: 'fiscal',
    label: 'Fiscal ARCA',
    icon: '📑',
    description: 'Libro IVA ventas, exportación ARCA',
  },
]

const REPORTS: Record<string, React.ComponentType> = {
  articulos: ArticulosVendidos,
  cuentas: CuentasCorrientes,
  'clientes-abc': RankingClientesABC,
  comisiones: ComisionesViajantes,
  rotacion: RotacionStockMuerto,
  fiscal: ComprobantesFiscal,
}

export default function PlayroomPage() {
  const [activeTab, setActiveTab] = useState('articulos')
  const [chatOpen, setChatOpen] = useState(false)
  const [chatInitialMsg, setChatInitialMsg] = useState<string | undefined>()
  const ReportComponent = REPORTS[activeTab]

  function abrirChat(mensaje?: string) {
    setChatInitialMsg(mensaje)
    setChatOpen(true)
  }

  return (
    <div className="p-6" style={{ maxWidth: '1600px', margin: '0 auto' }}>
      {/* Header */}
      <div className="flex items-end justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold text-white tracking-tight">PLAYROOM</h1>
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded-md tracking-widest"
              style={{
                background: 'linear-gradient(135deg, #7c3aed, #06b6d4)',
                color: '#fff',
                boxShadow: '0 2px 8px rgba(124,58,237,0.4)',
              }}
            >
              BI
            </span>
          </div>
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.25)' }}>
            Megasur · Business Intelligence · {TABS.find(t => t.id === activeTab)?.description}
          </p>
        </div>
        <p className="text-xs" style={{ color: 'rgba(255,255,255,0.15)' }}>
          {new Date().toLocaleDateString('es-AR', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </p>
      </div>

      {/* Megasur Chat Bar */}
      <MegasurChat onOpen={abrirChat} />

      {/* Tab navigation */}
      <PlayroomNav activeTab={activeTab} onTabChange={setActiveTab} tabs={TABS} />

      {/* Divider */}
      <div className="my-5" style={{ height: '1px', background: 'rgba(255,255,255,0.05)' }} />

      {/* Report content */}
      <ReportComponent />

      {/* Chat Drawer */}
      <ChatDrawer
        open={chatOpen}
        onClose={() => { setChatOpen(false); setChatInitialMsg(undefined) }}
        initialMessage={chatInitialMsg}
      />
    </div>
  )
}
