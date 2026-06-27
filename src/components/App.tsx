'use client'
import dynamic from 'next/dynamic'

const CrisisVE = dynamic(() => import('./CrisisVE'), { ssr: false })

export default function App() {
  return <CrisisVE />
}
