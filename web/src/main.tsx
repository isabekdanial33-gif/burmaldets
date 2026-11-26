import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './v2.css'
import './v3.css'
import './dark.css'
import './shef/shef.css'
import './shef/bm.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
