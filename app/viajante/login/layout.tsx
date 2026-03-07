
export default function ViajanteLoginLayout({
    children,
}: {
    children: React.ReactNode
}) {
    // Este layout está vacío intencionalmente para evitar heredar la Navbar del RootLayout si fuera un grupo de rutas,
    // pero como next.js anida layouts, lo que necesitamos realmente es que el RootLayout detecte rutas.
    // SIN EMBARGO, el error 500 en login suele ser por algo que explota al renderizar.
    // Al crear un layout aquí, garantizamos un boundary limpio.
    return (
        <div className="viajante-login-layout bg-gray-100 min-h-screen">
            {children}
        </div>
    )
}
