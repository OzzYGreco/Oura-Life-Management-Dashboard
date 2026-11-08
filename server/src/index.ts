import express from 'express'
import cors from 'cors'
import path from 'path'
import fs from 'fs'
import { errorHandler } from './middleware/errorHandler'

// Ensure upload directories exist (created on first run after a fresh clone)
const uploadsBase = path.join(__dirname, '../uploads')
for (const dir of ['screenshots', 'note-images', 'profile']) {
  fs.mkdirSync(path.join(uploadsBase, dir), { recursive: true })
}
import { startAdSpendSchedule } from './lib/adSpendSync'
import { startStripeSchedule } from './lib/stripeSync'
import { startBybitSync } from './lib/bybit/stream'
import bybitRouter from './routes/bybit'
import tradesRouter from './routes/trades'
import tradingSetupsRouter from './routes/tradingSetups'
import assetIconsRouter from './routes/assetIcons'
import tradingAccountsRouter from './routes/tradingAccounts'
import checklistsRouter from './routes/checklists'
import goalsRouter from './routes/goals'
import financesRouter, { materializeRecurring } from './routes/finances'
import businessRouter, { materializeRecurringInvoices } from './routes/business'
import businessGrowthRouter from './routes/businessGrowth'
import trainingRouter from './routes/training'
import calendarRouter from './routes/calendar'
import notesRouter from './routes/notes'
import dashboardRouter from './routes/dashboard'
import todayRouter from './routes/today'
import routineRouter from './routes/routine'
import weekRouter from './routes/week'
import milestonesRouter from './routes/milestones'
import { startDayScheduler } from './lib/scheduler'

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors({ origin: 'http://localhost:5173' }))
app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ extended: true }))

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')))

// API routes
app.use('/api/trades', tradesRouter)
app.use('/api/trading-setups', tradingSetupsRouter)
app.use('/api/asset-icons', assetIconsRouter)
app.use('/api/trading-accounts', tradingAccountsRouter)
app.use('/api/bybit', bybitRouter)
app.use('/api/checklists', checklistsRouter)
app.use('/api/goals', goalsRouter)
app.use('/api/finance', financesRouter)
app.use('/api/business', businessRouter)
app.use('/api/business', businessGrowthRouter)
app.use('/api/training', trainingRouter)
app.use('/api/calendar', calendarRouter)
app.use('/api/notes', notesRouter)
app.use('/api/dashboard', dashboardRouter)
app.use('/api/today', todayRouter)
app.use('/api/routine', routineRouter)
app.use('/api/week', weekRouter)
app.use('/api/milestones', milestonesRouter)

app.use(errorHandler)

// The built app (client/dist), when present: one address for everything, so
// the always-on agent needs no separate front-end server. API routes above win.
const clientDist = path.join(__dirname, '../../client/dist')
if (fs.existsSync(path.join(clientDist, 'index.html'))) {
  app.use(express.static(clientDist))
  app.get(/^\/(?!api\/|uploads\/).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')))
}

startAdSpendSchedule()
startStripeSchedule()
startBybitSync()
startDayScheduler()

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
  // Materialize any recurring expenses/income that came due while the server was off
  materializeRecurring().catch(err => console.error('materializeRecurring startup error:', err))
  // Materialize any recurring invoices that came due while the server was off
  materializeRecurringInvoices().catch(err => console.error('materializeRecurringInvoices startup error:', err))
})
