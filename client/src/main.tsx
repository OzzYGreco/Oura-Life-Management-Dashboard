import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applyModeEarly } from './core/mode'

applyModeEarly()

// Esc belongs to the app: it closes dialogs, menus and expanded rows. Unclaimed,
// the browser also acts on it, and Safari takes it as "leave full screen".
// Registered first, in the capture phase, so it runs before any handler can stop
// the event; it only marks the key as handled and never stops it reaching them.
window.addEventListener('keydown', e => { if (e.key === 'Escape') e.preventDefault() }, true)

createRoot(document.getElementById('root')!).render(<App />)
