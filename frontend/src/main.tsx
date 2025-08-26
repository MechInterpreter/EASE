import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import App from './App'
import { Suspense, lazy } from 'react'
const EnhancedGraphRoute = lazy(() => import('./components/EnhancedGraphRoute'))
import './index.css'

function AppWithRouting() {
  return (
    <BrowserRouter>
      <Suspense fallback={<div className="p-4">Loading…</div>}>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/graph" element={<EnhancedGraphRoute />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

const el = document.getElementById('root')!
ReactDOM.createRoot(el).render(
  <React.StrictMode>
    <AppWithRouting />
  </React.StrictMode>
)
