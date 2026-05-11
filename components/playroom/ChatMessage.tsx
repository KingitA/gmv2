'use client'

import { useMemo } from 'react'

interface ChatMessageProps {
  role: 'user' | 'assistant'
  content: string
  data?: any[] | null
  loading?: boolean
}

function ars(n: number) {
  if (typeof n !== 'number') return String(n)
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)
}

function formatCell(value: any): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'number') {
    // Heuristic: large numbers are probably pesos
    if (Math.abs(value) > 500) return ars(value)
    return value.toLocaleString('es-AR')
  }
  if (typeof value === 'boolean') return value ? 'Sí' : 'No'
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return new Date(value + 'T00:00:00').toLocaleDateString('es-AR')
  }
  return String(value)
}

function DataTableInline({ data }: { data: any[] }) {
  const columns = useMemo(() => {
    if (!data.length) return []
    return Object.keys(data[0])
  }, [data])

  function downloadCSV() {
    const header = columns.join(';')
    const rows = data.map(r => columns.map(c => {
      const v = r[c]
      return typeof v === 'string' && v.includes(';') ? `"${v}"` : String(v ?? '')
    }).join(';'))
    const csv = [header, ...rows].join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `megasur_export_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="mt-3 rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
              {columns.map(col => (
                <th key={col} className="text-left px-3 py-2 font-semibold uppercase tracking-wide"
                  style={{ color: 'rgba(255,255,255,0.4)', borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap' }}>
                  {col.replace(/_/g, ' ')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                className="hover:bg-white/[0.02] transition-colors">
                {columns.map(col => (
                  <td key={col} className="px-3 py-2 font-mono" style={{ color: 'rgba(255,255,255,0.75)', whiteSpace: 'nowrap' }}>
                    {formatCell(row[col])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-3 py-2 flex items-center justify-between" style={{ background: 'rgba(255,255,255,0.02)', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.25)' }}>{data.length} filas</span>
        <button
          onClick={downloadCSV}
          className="text-[10px] px-2.5 py-1 rounded font-medium"
          style={{ background: 'rgba(124,58,237,0.15)', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.25)' }}
        >
          Descargar CSV
        </button>
      </div>
    </div>
  )
}

function parseMarkdown(text: string): React.ReactNode[] {
  const lines = text.split('\n')
  const nodes: React.ReactNode[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (line.startsWith('### ')) {
      nodes.push(<h3 key={i} className="font-bold text-sm mt-3 mb-1 text-white">{line.slice(4)}</h3>)
    } else if (line.startsWith('## ')) {
      nodes.push(<h2 key={i} className="font-bold text-base mt-4 mb-2 text-white">{line.slice(3)}</h2>)
    } else if (line.startsWith('**') && line.endsWith('**')) {
      nodes.push(<p key={i} className="font-bold text-sm text-white">{line.slice(2, -2)}</p>)
    } else if (line.startsWith('- ') || line.startsWith('• ')) {
      nodes.push(
        <li key={i} className="text-sm ml-3 list-disc list-inside" style={{ color: 'rgba(255,255,255,0.75)' }}>
          {line.slice(2)}
        </li>
      )
    } else if (line.trim() === '') {
      nodes.push(<div key={i} className="h-2" />)
    } else {
      nodes.push(
        <p key={i} className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.8)' }}>
          {line}
        </p>
      )
    }
    i++
  }
  return nodes
}

export default function ChatMessage({ role, content, data, loading }: ChatMessageProps) {
  const isUser = role === 'user'

  if (loading) {
    return (
      <div className="flex gap-3 items-start">
        <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs flex-shrink-0"
          style={{ background: 'linear-gradient(135deg, #7c3aed, #06b6d4)' }}>
          M
        </div>
        <div className="rounded-2xl px-4 py-3" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex gap-1 items-center h-5">
            {[0, 1, 2].map(n => (
              <div key={n} className="w-1.5 h-1.5 rounded-full"
                style={{ background: '#7c3aed', animation: `bounce 1s ${n * 0.2}s infinite` }} />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-tr-sm px-4 py-3 text-sm"
          style={{ background: 'linear-gradient(135deg, #7c3aed, #5b21b6)', color: '#fff' }}>
          {content}
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-3 items-start">
      <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 text-white"
        style={{ background: 'linear-gradient(135deg, #7c3aed, #06b6d4)' }}>
        M
      </div>
      <div className="flex-1 min-w-0">
        <div className="rounded-2xl rounded-tl-sm px-4 py-3"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <div>{parseMarkdown(content)}</div>
        </div>
        {data && data.length > 0 && <DataTableInline data={data} />}
      </div>
    </div>
  )
}
