import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { demo } from './data'
import Home from './pages/Home'
import Login from './pages/Login'
import Painel from './pages/Painel'
import Loja from './pages/Loja'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {demo && <div className="demo">Modo demonstração — os dados ficam salvos só neste navegador.</div>}
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/entrar" element={<Login />} />
        <Route path="/painel" element={<Painel />} />
        <Route path="/:slug" element={<Loja />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
