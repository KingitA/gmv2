'use client'

interface Tab {
  id: string
  label: string
  icon: string
  description?: string
}

interface PlayroomNavProps {
  activeTab: string
  onTabChange: (id: string) => void
  tabs: Tab[]
}

export default function PlayroomNav({ activeTab, onTabChange, tabs }: PlayroomNavProps) {
  return (
    <div
      className="flex gap-1 overflow-x-auto"
      style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}
    >
      {tabs.map(tab => {
        const active = activeTab === tab.id
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            title={tab.description}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all"
            style={
              active
                ? {
                    background: 'linear-gradient(135deg, rgba(124,58,237,0.2), rgba(6,182,212,0.1))',
                    border: '1px solid rgba(124,58,237,0.3)',
                    color: '#fff',
                    boxShadow: '0 2px 12px rgba(124,58,237,0.15)',
                  }
                : {
                    color: 'rgba(255,255,255,0.4)',
                    border: '1px solid transparent',
                  }
            }
            onMouseEnter={e => {
              if (!active) {
                ;(e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.7)'
                ;(e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)'
              }
            }}
            onMouseLeave={e => {
              if (!active) {
                ;(e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.4)'
                ;(e.currentTarget as HTMLButtonElement).style.background = 'transparent'
              }
            }}
          >
            <span className="text-base">{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        )
      })}
    </div>
  )
}
