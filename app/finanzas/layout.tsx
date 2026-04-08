"use client"

import { ReactNode, useState, useEffect } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Lock, Eye, EyeOff } from "lucide-react"

const SESSION_KEY = "fin_unlocked"
const PASSWORD    = "Bauti214!"

export default function FinanzasLayout({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState(false)
  const [input,    setInput]    = useState("")
  const [show,     setShow]     = useState(false)
  const [error,    setError]    = useState(false)
  const [checked,  setChecked]  = useState(false)

  // Check sessionStorage on mount (persists while tab is open)
  useEffect(() => {
    if (sessionStorage.getItem(SESSION_KEY) === "1") setUnlocked(true)
    setChecked(true)
  }, [])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (input === PASSWORD) {
      sessionStorage.setItem(SESSION_KEY, "1")
      setUnlocked(true)
      setError(false)
    } else {
      setError(true)
      setInput("")
    }
  }

  if (!checked) return null

  if (!unlocked) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="w-full max-w-sm">
          <div className="flex flex-col items-center gap-4 mb-8">
            <div className="w-14 h-14 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center">
              <Lock className="h-6 w-6 text-slate-300" />
            </div>
            <div className="text-center">
              <h1 className="text-xl font-bold text-white">Módulo Financiero</h1>
              <p className="text-sm text-slate-400 mt-1">Ingresá la contraseña para continuar</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="relative">
              <Input
                type={show ? "text" : "password"}
                value={input}
                onChange={e => { setInput(e.target.value); setError(false) }}
                placeholder="Contraseña"
                autoFocus
                className={`bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 pr-10 h-11 ${error ? "border-red-500 focus-visible:ring-red-500" : ""}`}
              />
              <button
                type="button"
                onClick={() => setShow(p => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
              >
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {error && <p className="text-xs text-red-400 text-center">Contraseña incorrecta</p>}
            <Button type="submit" className="w-full h-11 bg-indigo-600 hover:bg-indigo-700">
              Ingresar
            </Button>
          </form>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
