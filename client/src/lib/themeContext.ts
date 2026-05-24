import { createContext, useContext } from 'react'

interface ThemeCtx {
  theme: 'dark' | 'light'
  toggle: () => void
}

export const ThemeContext = createContext<ThemeCtx>({ theme: 'dark', toggle: () => {} })
export const useThemeContext = () => useContext(ThemeContext)
