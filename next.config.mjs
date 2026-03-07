/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    // SEGURIDAD: No ignorar errores de TypeScript en build
    // Esto detecta problemas antes de que lleguen a produccion
    ignoreBuildErrors: false,
  },
  images: {
    unoptimized: true,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
}

export default nextConfig

