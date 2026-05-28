'use client'

import { usePathname } from 'next/navigation'

export function MainContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isAuthRoute = pathname?.startsWith('/auth')
  const isDepositoRoute = pathname?.startsWith('/deposito')
  const isWarehouseRoute = pathname?.startsWith('/warehouse')
  const isChoferRoute = pathname?.startsWith('/chofer')
  const noSidebar = isAuthRoute || isDepositoRoute || isWarehouseRoute || isChoferRoute

  return (
    <main className={`min-h-screen transition-all duration-200 ${noSidebar ? '' : 'pl-[230px]'}`}>
      {children}
    </main>
  )
}
