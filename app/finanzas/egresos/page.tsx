"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"

export default function EgresosPage() {
    return (
        <div className="min-h-screen bg-background">
            <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
                <div className="flex items-center gap-4">
                    <Link href="/finanzas">
                        <Button variant="ghost" size="icon">
                            <ArrowLeft className="h-5 w-5" />
                        </Button>
                    </Link>
                    <div>
                        <h1 className="text-2xl font-bold">Egresos Generales</h1>
                        <p className="text-sm text-muted-foreground">Gastos, sueldos e inversiones</p>
                    </div>
                </div>
            </header>

            <main className="container mx-auto px-6 py-8">
                <Card>
                    <CardContent className="py-12 text-center">
                        <p className="text-muted-foreground">Funcionalidad en desarrollo</p>
                    </CardContent>
                </Card>
            </main>
        </div>
    )
}


