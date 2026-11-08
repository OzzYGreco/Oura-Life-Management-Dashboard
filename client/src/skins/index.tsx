/**
 * The app frame and its pages: Arete's one layout (DESIGN.md), on the Whoop
 * frame. Each route renders its redesigned page directly.
 */
import { Outlet } from 'react-router-dom'
import { WhoopShell } from './whoop/Shell'
import { NextToday } from './next/Today'
import { NextWeek } from './next/Week'
import { NextRoutine } from './next/Routine'
import { NextTraining } from './next/Training'
import { NextMoney } from './next/Money'
import { NextCalendar } from './next/Calendar'
import { NextNotes } from './next/Notes'
import './skins.css'
import './next/trading.css'
import './next/business.css'

export function SkinFrame() {
  return <WhoopShell><Outlet /></WhoopShell>
}

export { SkinProvider } from './core'
export const SkinToday = NextToday
export const SkinRoutine = NextRoutine
export const SkinWeek = NextWeek
export const SkinTraining = NextTraining
export const SkinMoney = NextMoney
export const SkinCalendar = NextCalendar
export const SkinNotes = NextNotes
