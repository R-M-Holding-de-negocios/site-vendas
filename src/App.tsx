import { lazy, Suspense } from 'react'
import { BrowserRouter, HashRouter, Route, Routes } from 'react-router-dom'
import { db, HASH_ROUTER } from './lib/api'
import { resetDemo } from './lib/db-demo'
import { Loading, ToastHost } from './ui/kit'

const Landing = lazy(() => import('./site/Landing'))
const Login = lazy(() => import('./site/Login'))
const PanelApp = lazy(() => import('./panel/PanelApp'))
const AdminApp = lazy(() => import('./admin/AdminApp'))
const StoreApp = lazy(() => import('./store/StoreApp'))

function DemoBar() {
  if (!db.demo) return null
  return (
    <div className="demo-bar no-print">
      <span>Modo demonstração: os dados ficam só neste navegador.</span>
      <button className="link" onClick={() => confirm('Apagar tudo e restaurar a loja de exemplo?') && resetDemo()}>
        Restaurar exemplo
      </button>
    </div>
  )
}

export default function App() {
  const Router = HASH_ROUTER ? HashRouter : BrowserRouter
  return (
    <Router>
      <DemoBar />
      <Suspense fallback={<div className="main"><Loading /></div>}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/entrar" element={<Login />} />
          <Route path="/painel/*" element={<PanelApp />} />
          <Route path="/admin/*" element={<AdminApp />} />
          <Route path="/:slug/*" element={<StoreApp />} />
        </Routes>
      </Suspense>
      <ToastHost />
    </Router>
  )
}
