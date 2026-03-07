export const dynamic = 'force-dynamic'
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Truck, UserCheck, ArrowLeft, MapPin, MapPinned } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function TablasPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="icon" className="hover:bg-accent">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Tablas</h1>
              <p className="text-sm text-muted-foreground">Configuración de datos maestros</p>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          <Link href="/tablas/viajantes" className="group">
            <Card className="duration-200 hover:shadow-lg hover:scale-105 cursor-pointer border-l-4 border-l-blue-500 hover:border-l-blue-600 h-full">
              <CardContent className="p-6">
                <div className="flex flex-col gap-4">
                  <div className="p-3 bg-blue-50 rounded-lg group-hover:bg-blue-100 transition-colors w-fit">
                    <UserCheck className="h-6 w-6 text-blue-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg mb-1">Viajantes</h3>
                    <p className="text-sm text-muted-foreground">Gestionar vendedores y comisiones</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link href="/tablas/transportes" className="group">
            <Card className="duration-200 hover:shadow-lg hover:scale-105 cursor-pointer border-l-4 border-l-orange-500 hover:border-l-orange-600 h-full">
              <CardContent className="p-6">
                <div className="flex flex-col gap-4">
                  <div className="p-3 bg-orange-50 rounded-lg group-hover:bg-orange-100 transition-colors w-fit">
                    <Truck className="h-6 w-6 text-orange-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg mb-1">Transportes</h3>
                    <p className="text-sm text-muted-foreground">Gestionar empresas de transporte</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link href="/tablas/zonas" className="group">
            <Card className="duration-200 hover:shadow-lg hover:scale-105 cursor-pointer border-l-4 border-l-green-500 hover:border-l-green-600 h-full">
              <CardContent className="p-6">
                <div className="flex flex-col gap-4">
                  <div className="p-3 bg-green-50 rounded-lg group-hover:bg-green-100 transition-colors w-fit">
                    <MapPin className="h-6 w-6 text-green-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg mb-1">Zonas</h3>
                    <p className="text-sm text-muted-foreground">Organizar zonas de reparto</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link href="/tablas/localidades" className="group">
            <Card className="duration-200 hover:shadow-lg hover:scale-105 cursor-pointer border-l-4 border-l-purple-500 hover:border-l-purple-600 h-full">
              <CardContent className="p-6">
                <div className="flex flex-col gap-4">
                  <div className="p-3 bg-purple-50 rounded-lg group-hover:bg-purple-100 transition-colors w-fit">
                    <MapPinned className="h-6 w-6 text-purple-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg mb-1">Localidades</h3>
                    <p className="text-sm text-muted-foreground">Gestionar localidades y asignar zonas</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>
      </main>
    </div>
  )
}

