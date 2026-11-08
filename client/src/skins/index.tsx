/**
 * Skin registry: each skin supplies its own Shell (navigation and frame) and
 * its own layout for the pages it has redesigned. Pages a skin hasn't
 * redesigned yet render the shared page inside that skin's Shell, wearing its
 * colours through the --c-* tokens.
 */
import { Outlet } from 'react-router-dom'
import { useSkin, type SkinId } from './core'
import { WhoopShell } from './whoop/Shell'
import { WhoopToday } from './whoop/Today'
import { WhoopRoutine } from './whoop/Routine'
import { WhoopWeek } from './whoop/Week'
import { WhoopTraining } from './whoop/Training'
import { TrainingPage } from '../pages/Training'
import { LinearWeek } from './linear/Week'
import { RevolutWeek } from './revolut/Week'
import { ThingsWeek } from './things/Week'
import { GoalsPage } from '../pages/Goals'
import { LinearRoutine } from './linear/Routine'
import { RevolutRoutine } from './revolut/Routine'
import { ThingsRoutine } from './things/Routine'
import { ChecklistsPage } from '../pages/Checklists'
import { LinearShell } from './linear/Shell'
import { LinearToday } from './linear/Today'
import { RevolutShell } from './revolut/Shell'
import { RevolutToday } from './revolut/Today'
import { ThingsShell } from './things/Shell'
import { ThingsToday } from './things/Today'
import { NextToday } from './next/Today'
import { NextWeek } from './next/Week'
import { NextRoutine } from './next/Routine'
import { NextTraining } from './next/Training'
import { NextMoney } from './next/Money'
import { NextCalendar } from './next/Calendar'
import { NextNotes } from './next/Notes'
import { NotesPage } from '../pages/Notes'
import { CalendarPage } from '../pages/Calendar'
import { FinancesPage } from '../pages/Finances'
import './skins.css'
import './next/trading.css'
import './next/business.css'

type Skin = {
  Shell: React.ComponentType<{ children: React.ReactNode }>
  Today: React.ComponentType
  /** Redesigned pages; a page missing here falls back to the shared one. */
  Routine?: React.ComponentType
  Week?: React.ComponentType
  Training?: React.ComponentType
  Money?: React.ComponentType
  Calendar?: React.ComponentType
  Notes?: React.ComponentType
}

const REGISTRY: Record<SkinId, Skin> = {
  whoop:   { Shell: WhoopShell, Today: WhoopToday, Routine: WhoopRoutine, Week: WhoopWeek, Training: WhoopTraining },
  linear:  { Shell: LinearShell, Today: LinearToday, Routine: LinearRoutine, Week: LinearWeek },
  revolut: { Shell: RevolutShell, Today: RevolutToday, Routine: RevolutRoutine, Week: RevolutWeek },
  things:  { Shell: ThingsShell, Today: ThingsToday, Routine: ThingsRoutine, Week: ThingsWeek },
  // The one-layout redesign (DESIGN.md), the default: Whoop's frame with every page redesigned.
  next:    { Shell: WhoopShell, Today: NextToday, Routine: NextRoutine, Week: NextWeek, Training: NextTraining, Money: NextMoney, Calendar: NextCalendar, Notes: NextNotes },
}

export function SkinFrame() {
  const { skin } = useSkin()
  const { Shell } = REGISTRY[skin]
  return <Shell><Outlet /></Shell>
}

export function SkinToday() {
  const { skin } = useSkin()
  const { Today } = REGISTRY[skin]
  return <Today key={skin} />
}

export { SkinProvider } from './core'

export function SkinRoutine() {
  const { skin } = useSkin()
  const Page = REGISTRY[skin].Routine ?? ChecklistsPage
  return <Page key={skin} />
}

export function SkinWeek() {
  const { skin } = useSkin()
  const Page = REGISTRY[skin].Week ?? GoalsPage
  return <Page key={skin} />
}

export function SkinTraining() {
  const { skin } = useSkin()
  const Page = REGISTRY[skin].Training ?? TrainingPage
  return <Page key={skin} />
}

export function SkinMoney() {
  const { skin } = useSkin()
  const Page = REGISTRY[skin].Money ?? FinancesPage
  return <Page key={skin} />
}

export function SkinCalendar() {
  const { skin } = useSkin()
  const Page = REGISTRY[skin].Calendar ?? CalendarPage
  return <Page key={skin} />
}

export function SkinNotes() {
  const { skin } = useSkin()
  const Page = REGISTRY[skin].Notes ?? NotesPage
  return <Page key={skin} />
}
