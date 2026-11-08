import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/queryClient'
import { ThemeContext } from './lib/themeContext'
import { useTheme } from './hooks/useTheme'
import { SkinProvider, SkinFrame, SkinToday, SkinRoutine, SkinWeek, SkinTraining, SkinMoney, SkinCalendar, SkinNotes } from './skins'
import { DashboardPage } from './pages/Dashboard'
import { TradingPage } from './pages/Trading'
import { BusinessPage } from './pages/Business'

// Reminders now come from the server as native notifications, so the
// browser no longer runs its own alert timer.
function Layout() {
  return (
    <SkinProvider>
      <SkinFrame />
    </SkinProvider>
  )
}

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true,        element: <SkinToday /> },
      { path: 'summary',    element: <DashboardPage /> },
      { path: 'trading',    element: <TradingPage /> },
      { path: 'checklists', element: <SkinRoutine /> },
      { path: 'goals',      element: <SkinWeek /> },
      { path: 'finances',   element: <SkinMoney /> },
      { path: 'business/*', element: <BusinessPage /> },
      { path: 'training',   element: <SkinTraining /> },
      { path: 'calendar',   element: <SkinCalendar /> },
      { path: 'notes',      element: <SkinNotes /> },
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
