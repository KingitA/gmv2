"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import { useRouter } from 'next/navigation'
import { useToast } from "@/hooks/use-toast"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { Package, MapPin, Calendar, DollarSign, ArrowRight } from 'lucide-react'

interface Pedido {
  id: string
  numero_pedido: string
  fecha: string
  estado: string
  prioridad: number
  total: number
  cliente: {
    nombre: string
    localidad: string
  }
  asignado_a: string | null
  pedidos_detalle: { id: string }[]
}

interface PedidosListaProps {
  initialPedidos: Pedido[]
  userId: string
  userEmail: string
}

export function PedidosLista({ initialPedidos, userId, userEmail }: PedidosListaProps) {
  const [pedidos, setPedidos] = useState<Pedido[]>(initialPedidos)
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()
  const { toast } = useToast()

  const fetchPedidos = async () => {
    setIsLoading(true)
    const supabase = createClient()

    const { data, error } = await supabase
      .from("pedidos")
      .select(`
        id,
        numero_pedido,
        fecha,
        estado,
        prioridad,
        total,
        asignado_a,
        cliente:clientes(nombre, localidad),
        pedidos_detalle(id)
      `)
      .in("estado", ["pendiente", "en_preparacion"])
      .order("prioridad", { ascending: true })
      .order("fecha", { ascending: true })

    if (error) {
      toast({
        title: "Error",
        description: "No se pudieron cargar los pedidos",
        variant: "destructive",
      })
    } else {
      setPedidos(data || [])
    }
    setIsLoading(false)
  }

  const handleEmpezarPreparacion = async (pedidoId: string, estadoActual: string) => {
    const supabase = createClient()

    if (estadoActual === "en_preparacion") {
      router.push(`/deposito/preparar/${pedidoId}`)
      return
    }

    if (estadoActual === "pendiente") {
      try {
        const { error: updateError } = await supabase
          .from("pedidos")
          .update({
            estado: "en_preparacion",
            asignado_a: userEmail,
          })
          .eq("id", pedidoId)
          .eq("estado", "pendiente")

        if (updateError) throw updateError

        const { error: sesionError } = await supabase
          .from("picking_sesiones")
          .insert({
            pedido_id: pedidoId,
            usuario_id: userId,
            usuario_email: userEmail,
            estado: "EN_PROGRESO",
          })

        if (sesionError) {
          console.error("[v0] Error creando sesión:", sesionError)
        }

        toast({
          title: "Pedido asignado",
          description: "Comenzando preparación...",
        })

        router.push(`/deposito/preparar/${pedidoId}`)
      } catch (error) {
        console.error("[v0] Error al empezar preparación:", error)
        toast({
          title: "Error",
          description: "No se pudo asignar el pedido.",
          variant: "destructive",
        })
        fetchPedidos()
      }
    }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-12">
        <Spinner className="h-8 w-8" />
      </div>
    )
  }

  if (pedidos.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Package className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-lg font-semibold">No hay pedidos pendientes</p>
          <p className="text-sm text-muted-foreground">Todos los pedidos están listos</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">Pedidos Pendientes</h2>
        <Button variant="outline" size="sm" onClick={fetchPedidos}>
          Actualizar
        </Button>
      </div>

      {pedidos.map((pedido) => {
        const enPreparacion = pedido.estado === "en_preparacion"

        return (
          <Card key={pedido.id} className={enPreparacion ? "border-primary" : ""}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 space-y-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-lg font-bold">Pedido #{pedido.numero_pedido}</h3>
                    {pedido.estado === "pendiente" && <Badge variant="secondary">PENDIENTE</Badge>}
                    {enPreparacion && (
                      <Badge variant="default" className="bg-primary">
                        EN PREPARACIÓN
                      </Badge>
                    )}
                    {pedido.prioridad && pedido.prioridad <= 3 && (
                      <Badge variant="destructive">Prioridad {pedido.prioridad}</Badge>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                    <div className="flex items-center gap-2">
                      <Package className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{pedido.cliente?.nombre || "Cliente"}</span>
                    </div>
                    {pedido.cliente?.localidad && (
                      <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-muted-foreground" />
                        <span className="text-muted-foreground">{pedido.cliente.localidad}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">
                        {format(new Date(pedido.fecha), "dd/MM/yyyy", { locale: es })}
                      </span>
                    </div>
                    {pedido.total && (
                      <div className="flex items-center gap-2">
                        <DollarSign className="h-4 w-4 text-muted-foreground" />
                        <span className="text-muted-foreground">${pedido.total.toLocaleString("es-AR")}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <Package className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">{pedido.pedidos_detalle?.length || 0} artículos</span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <Button
                    size="lg"
                    onClick={() => handleEmpezarPreparacion(pedido.id, pedido.estado)}
                    className="whitespace-nowrap"
                  >
                    {enPreparacion ? "CONTINUAR" : "EMPEZAR"}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
