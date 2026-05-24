import { createBrowserRouter, RouterProvider, Outlet } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/queryClient'
import { ThemeContext } from './lib/themeContext'
import { useTheme } from './hooks/useTheme'
import { useChecklistNotifications } from './hooks/useChecklistNotifications'
import { Sidebar } from './components/layout/Sidebar'
import { TopBar } from './components/layout/TopBar'
import { DashboardPage } from './pages/Dashboard'
import { TradingPage } from './pages/Trading'
import { ChecklistsPage } from './pages/Checklists'
import { GoalsPage } from './pages/Goals'
import { FinancesPage } from './pages/Finances'
import { BusinessPage } from './pages/Business'
import { TrainingPage } from './pages/Training'
import { CalendarPage } from './pages/Calendar'
import { NotesPage } from './pages/Notes'

function Layout() {
  useChecklistNotifications()
  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--c-bg-primary)' }}>
      <Sidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true,        element: <DashboardPage /> },
      { path: 'trading',    element: <TradingPage /> },
      { path: 'checklists', element: <ChecklistsPage /> },
      { path: 'goals',      element: <GoalsPage /> },
      { path: 'finances',   element: <FinancesPage /> },
      { path: 'business',   element: <BusinessPage /> },
      { path: 'training',   element: <TrainingPage /> },
      { path: 'calendar',   element: <CalendarPage /> },
      { path: 'notes',      element: <NotesPage /> },
    ],
  },
])

export default function App() {
  const themeCtx = useTheme()
  return (
    <ThemeContext.Provider value={themeCtx}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeContext.Provider>
  )
}
