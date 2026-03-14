'use client'

import { usePathname } from 'next/navigation'

export function MainContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isAuthRoute = pathname?.startsWith('/auth')
  const isDepositoRoute = pathname?.startsWith('/deposito')
  const noSidebar = isAuthRoute || isDepositoRoute

  return (
    <main className={`min-h-screen transition-all duration-200 ${noSidebar ? '' : 'pl-[230px]'}`}>
      {children}
    </main>
  )
}
