import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applyModeEarly } from './core/mode'

applyModeEarly()

createRoot(document.getElementById('root')!).render(<App />)
