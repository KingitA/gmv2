"use client"

import { useState, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Upload, Plus, X, Search, Check, FileText } from "lucide-react"
import { searchClientes } from "@/lib/actions/clientes"
import { toast } from "sonner"

interface NuevoPedidoDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAddToQueue: (clienteId: string, clienteNombre: string, files: File[]) => void
}

export function NuevoPedidoDialog({ open, onOpenChange, onAddToQueue }: NuevoPedidoDialogProps) {
  const [clienteId, setClienteId] = useState("")
  const [clienteNombre, setClienteNombre] = useState("")
  const [clienteSearch, setClienteSearch] = useState("")
  const [clientesEncontrados, setClientesEncontrados] = useState<any[]>([])
  const [showClienteDropdown, setShowClienteDropdown] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleClienteSearch = async (term: string) => {
    setClienteSearch(term)
    setClienteId("")
    setClienteNombre("")
    if (term.length < 2) {
      setShowClienteDropdown(false)
      return
    }
    try {
      const res = await searchClientes(term)
      setClientesEncontrados(res || [])
      setShowClienteDropdown(true)
    } catch {
      // ignore
    }
  }

  const selectCliente = (c: any) => {
    setClienteId(c.id)
    setClienteNombre(c.razon_social)
    setClienteSearch(c.razon_social)
    setShowClienteDropdown(false)
  }

  const handleFiles = (selected: FileList | null) => {
    if (!selected) return
    const newFiles = Array.from(selected)
    setFiles(prev => [...prev, ...newFiles])
  }

  const removeFile = (idx: number) => {
    setFiles(prev => prev.filter((_, i) => i !== idx))
  }

  const handleSubmit = () => {
    if (!clienteId) {
      toast.error("Seleccioná un cliente antes de agregar a la cola")
      return
    }
    if (files.length === 0) {
      toast.error("Cargá al menos un archivo")
      return
    }
    onAddToQueue(clienteId, clienteNombre, files)
    toast.success(`Pedido de ${clienteNombre} agregado a la cola`)
    // Reset and allow adding another
    setClienteId("")
    setClienteNombre("")
    setClienteSearch("")
    setFiles([])
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Nuevo Pedido</DialogTitle>
          <DialogDescription>
            Seleccioná el cliente y cargá los archivos. Se agrega a la cola y se procesa automáticamente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          {/* Cliente selector */}
          <div className="space-y-1.5">
            <Label>Cliente <span className="text-destructive">*</span></Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Buscar cliente..."
                value={clienteSearch}
                onChange={(e) => handleClienteSearch(e.target.value)}
                onFocus={() => { if (clienteSearch.length >= 2) setShowClienteDropdown(true) }}
                onBlur={() => setTimeout(() => setShowClienteDropdown(false), 150)}
              />
              {clienteId && (
                <Check className="absolute right-2.5 top-2.5 h-4 w-4 text-green-500" />
              )}
            </div>
            {showClienteDropdown && clientesEncontrados.length > 0 && (
              <div className="border rounded-md shadow-sm bg-background max-h-[200px] overflow-auto z-50 relative">
                {clientesEncontrados.map(c => (
                  <div
                    key={c.id}
                    className="px-3 py-2 hover:bg-muted cursor-pointer text-sm flex items-center justify-between"
                    onMouseDown={() => selectCliente(c)}
                  >
                    <span>{c.razon_social}</span>
                    {clienteId === c.id && <Check className="h-4 w-4 text-primary" />}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* File upload */}
          <div className="space-y-1.5">
            <Label>Archivos del pedido <span className="text-destructive">*</span></Label>

            <div
              className="border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center text-muted-foreground hover:bg-muted/30 transition-colors cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files) }}
            >
              <Upload className="h-7 w-7 mb-2" />
              <p className="text-sm font-medium">Arrastrá o hacé clic para subir</p>
              <p className="text-xs mt-0.5">JPG, PNG, PDF, Excel — múltiples archivos</p>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept="image/*,.pdf,.xlsx,.xls,.csv,.txt"
                multiple
                onChange={(e) => handleFiles(e.target.files)}
              />
            </div>

            {files.length > 0 && (
              <div className="space-y-1 mt-2">
                {files.map((file, idx) => (
                  <div key={idx} className="flex items-center justify-between bg-muted/50 rounded-md px-3 py-1.5 text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{file.name}</span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        ({(file.size / 1024).toFixed(0)} KB)
                      </span>
                    </div>
                    <button onClick={() => removeFile(idx)} className="ml-2 text-muted-foreground hover:text-destructive">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              className="flex-1 gap-2"
              onClick={handleSubmit}
              disabled={!clienteId || files.length === 0}
            >
              <Plus className="h-4 w-4" />
              Agregar a Cola
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
