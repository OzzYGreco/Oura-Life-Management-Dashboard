import { sqliteTable, integer, text, real } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

// ─── TRADES ──────────────────────────────────────────────────────────────────

export const tradingAccounts = sqliteTable('trading_accounts', {
  id:              integer('id').primaryKey({ autoIncrement: true }),
  name:            text('name').notNull(),
  broker:          text('broker'),
  currency:        text('currency').notNull().default('USD'),
  startingBalance: real('starting_balance'),
  notes:           text('notes'),
  createdAt:       text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt:       text('updated_at').notNull().default(sql`(datetime('now'))`),
})

export const trades = sqliteTable('trades', {
  id:              integer('id').primaryKey({ autoIncrement: true }),
  accountId:       integer('account_id').references(() => tradingAccounts.id),
  date:            text('date').notNull(),
  time:            text('time'),
  durationMinutes: integer('duration_minutes'),
  instrument:      text('instrument').notNull(),
  asset:           text('asset').notNull(),
  direction:       text('direction').notNull(),
  orderType:       text('order_type').notNull(),
  entryPrice:      real('entry_price').notNull(),
  stopLoss:        real('stop_loss'),
  exitPrice:       real('exit_price'),
  size:            real('size'),
  riskDollars:     real('risk_dollars'),
  expectedLoss:    real('expected_loss'),
  realizedPnl:     real('realized_pnl'),
  deviationPct:    real('deviation_pct'),
  rrRatio:         real('rr_ratio'),
  exitOrderType:   text('exit_order_type'),
  entryFeeAmount:  real('entry_fee_amount'),
  exitFeeAmount:   real('exit_fee_amount'),
  fundingFeeAmount: real('funding_fee_amount'),
  slippageAmount:  real('slippage_amount'),
  netPnl:          real('net_pnl'),
  rulesMet:        integer('rules_met'),
  setupLabel:      text('setup_label'),
  quickNote:       text('quick_note'),
  mistakes:        text('mistakes', { mode: 'json' }).$type<string[]>(),
  mistakesOther:   text('mistakes_other'),
  tags:            text('tags', { mode: 'json' }).$type<string[]>(),
  // ── Compounded / pyramided trades ─────────────────────────────────────────
  isCompounded:    integer('is_compounded').notNull().default(0),
  entries:         text('entries', { mode: 'json' }).$type<{ price: number; size: number; sl?: number }[]>(),
  takeProfits:     text('take_profits', { mode: 'json' }).$type<{ price: number; size: number }[]>(),
  createdAt:       text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt:       text('updated_at').notNull().default(sql`(datetime('now'))`),
})

export const tradeScreenshots = sqliteTable('trade_screenshots', {
  id:        integer('id').primaryKey({ autoIncrement: true }),
  tradeId:   integer('trade_id').notNull().references(() => trades.id, { onDelete: 'cascade' }),
  filePath:  text('file_path').notNull(),
  note:      text('note'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

// ─── CHECKLISTS ──────────────────────────────────────────────────────────────

export const checklistTemplates = sqliteTable('checklist_templates', {
  id:             integer('id').primaryKey({ autoIncrement: true }),
  name:           text('name').notNull(),
  type:           text('type').notNull(),
  goalId:         integer('goal_id'),
  enabled:        integer('enabled').notNull().default(1),
  repeatDaily:    integer('repeat_daily').notNull().default(1),
  createdAt:      text('created_at').notNull().default(sql`(datetime('now'))`),
})

export const checklistTemplateItems = sqliteTable('checklist_template_items', {
  id:           integer('id').primaryKey({ autoIncrement: true }),
  templateId:   integer('template_id').notNull().references(() => checklistTemplates.id, { onDelete: 'cascade' }),
  parentItemId: integer('parent_item_id'),
  label:        text('label').notNull(),
  time:         text('time'),
  importance:   text('importance'),
  repeatDaily:  integer('repeat_daily').notNull().default(1),
  sortOrder:    integer('sort_order').notNull().default(0),
})

export const checklistEntries = sqliteTable('checklist_entries', {
  id:         integer('id').primaryKey({ autoIncrement: true }),
  templateId: integer('template_id').references(() => checklistTemplates.id),   // nullable - null = ad-hoc entry
  date:       text('date').notNull(),
  createdAt:  text('created_at').notNull().default(sql`(datetime('now'))`),
})

export const checklistEntryItems = sqliteTable('checklist_entry_items', {
  id:             integer('id').primaryKey({ autoIncrement: true }),
  entryId:        integer('entry_id').notNull().references(() => checklistEntries.id, { onDelete: 'cascade' }),
  templateItemId: integer('template_item_id').references(() => checklistTemplateItems.id),  // nullable - null = ad-hoc item
  label:          text('label'),       // used when templateItemId is null
  time:           text('time'),        // used when templateItemId is null
  importance:     text('importance'),  // used when templateItemId is null
  completed:      integer('completed').notNull().default(0),
  completedAt:    text('completed_at'),
  archived:       integer('archived').notNull().default(0),
})

// ─── GOALS (point-scoring system) ────────────────────────────────────────────

export const goals = sqliteTable('goals', {
  id:          integer('id').primaryKey({ autoIncrement: true }),
  horizon:     text('horizon').notNull(),          // '3yr' | 'yearly' | 'monthly' | 'weekly'
  focus:       text('focus').notNull(),             // e.g. "Trading, System improvement"
  periodStart: text('period_start'),               // ISO date
  periodEnd:   text('period_end'),                 // ISO date
  status:      text('status').notNull().default('active'), // 'active' | 'completed'
  createdAt:   text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt:   text('updated_at').notNull().default(sql`(datetime('now'))`),
})

export const goalTasks = sqliteTable('goal_tasks', {
  id:           integer('id').primaryKey({ autoIncrement: true }),
  goalId:       integer('goal_id').notNull().references(() => goals.id, { onDelete: 'cascade' }),
  title:        text('title').notNull(),
  maxPoints:    real('max_points').notNull().default(1),
  earnedPoints: real('earned_points'),             // NULL = not yet scored
  notes:        text('notes'),
  sortOrder:    integer('sort_order').notNull().default(0),
})

export const goalRewards = sqliteTable('goal_rewards', {
  id:        integer('id').primaryKey({ autoIncrement: true }),
  goalId:    integer('goal_id').notNull().references(() => goals.id, { onDelete: 'cascade' }),
  minScore:  real('min_score').notNull(),           // threshold (e.g. 6, 7, 8)
  reward:    text('reward').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
})

// ─── FINANCES ────────────────────────────────────────────────────────────────

export const financeAccounts = sqliteTable('finance_accounts', {
  id:        integer('id').primaryKey({ autoIncrement: true }),
  name:      text('name').notNull(),
  type:      text('type').notNull(),
  balance:   real('balance').notNull().default(0),
  currency:  text('currency').notNull().default('USD'),
  isTrading: integer('is_trading').notNull().default(0),
  notes:     text('notes'),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
})

export const financeIncome = sqliteTable('finance_income', {
  id:                integer('id').primaryKey({ autoIncrement: true }),
  source:            text('source').notNull(),
  amount:            real('amount').notNull(),
  frequency:         text('frequency').notNull(),
  category:          text('category'),
  date:              text('date').notNull(),
  accountId:         integer('account_id'),
  notes:             text('notes'),
  recurringParentId: integer('recurring_parent_id'),
  lastGeneratedDate: text('last_generated_date'),
  createdAt:         text('created_at').notNull().default(sql`(datetime('now'))`),
})

export const financeExpenses = sqliteTable('finance_expenses', {
  id:                 integer('id').primaryKey({ autoIncrement: true }),
  description:        text('description').notNull(),
  amount:             real('amount').notNull(),
  category:           text('category').notNull(),
  date:               text('date').notNull(),
  accountId:          integer('account_id'),
  isRecurring:        integer('is_recurring').notNull().default(0),
  frequency:          text('frequency'),
  notes:              text('notes'),
  recurringParentId:  integer('recurring_parent_id'),
  lastGeneratedDate:  text('last_generated_date'),
  // Business cost attribution - lets a business expense be tied to the client
  // or project it was incurred for, which is what makes per-client margin work.
  clientId:           integer('client_id'),
  projectId:          integer('project_id'),
  vendor:             text('vendor'),
  createdAt:          text('created_at').notNull().default(sql`(datetime('now'))`),
  /** The going-forward price when it differs from what this row charged. */
  recurringAmount: real('recurring_amount'),
})

export const financeNetWorthSnapshots = sqliteTable('finance_net_worth_snapshots', {
  id:               integer('id').primaryKey({ autoIncrement: true }),
  date:             text('date').notNull().unique(),
  totalAssets:      real('total_assets').notNull(),
  totalLiabilities: real('total_liabilities').notNull().default(0),
  netWorth:         real('net_worth').notNull(),
  createdAt:        text('created_at').notNull().default(sql`(datetime('now'))`),
})

export const financeBudgets = sqliteTable('finance_budgets', {
  id:           integer('id').primaryKey({ autoIncrement: true }),
  category:     text('category').notNull().unique(),
  monthlyLimit: real('monthly_limit').notNull(),
  updatedAt:    text('updated_at').notNull().default(sql`(datetime('now'))`),
})

// ─── BUSINESS ────────────────────────────────────────────────────────────────

export const businessServices = sqliteTable('business_services', {
  id:               integer('id').primaryKey({ autoIncrement: true }),
  name:             text('name').notNull(),
  kind:             text('kind').notNull().default('one_off'),   // 'one_off' | 'recurring'
  defaultAmount:    real('default_amount'),
  defaultFrequency: text('default_frequency'),                    // recurring only
  /** One-off packages bill in milestones, e.g. [{label:'Deposit',pct:50},…] */
  milestones:       text('milestones', { mode: 'json' }).$type<{ label: string; pct: number; offsetDays?: number }[]>(),
  defaultTermDays:  integer('default_term_days').notNull().default(7),
  color:            text('color'),
  active:           integer('active').notNull().default(1),
  sortOrder:        integer('sort_order').notNull().default(0),
  notes:            text('notes'),
  createdAt:        text('created_at').notNull().default(sql`(datetime('now'))`),
})

export const businessClients = sqliteTable('business_clients', {
  id:        integer('id').primaryKey({ autoIncrement: true }),
  name:      text('name').notNull(),
  email:     text('email'),
  phone:     text('phone'),
  company:   text('company'),
  website:   text('website'),
  notes:     text('notes'),
  status:    text('status').notNull().default('active'),   // 'lead' | 'active' | 'churned' | 'inactive'
  source:      text('source'),                              // 'meta' | 'tiktok' | 'referral' | 'organic' | 'outbound' | 'other'
  campaignId:  integer('campaign_id'),
  wonDate:     text('won_date'),                            // first became a paying client
  churnedAt:   text('churned_at'),
  vatNumber:   text('vat_number'),
  addressLine: text('address_line'),
  city:        text('city'),
  postcode:    text('postcode'),
  country:     text('country'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  /** Learned the first time a payment is matched; certain for every one after. */
  stripeCustomerId: text('stripe_customer_id'),
})

export const businessProjects = sqliteTable('business_projects', {
  id:          integer('id').primaryKey({ autoIncrement: true }),
  clientId:    integer('client_id').references(() => businessClients.id),
  name:        text('name').notNull(),
  description: text('description'),
  status:      text('status').notNull().default('active'),
  startDate:   text('start_date'),
  dueDate:     text('due_date'),
  value:       real('value'),
  link:        text('link'),
  serviceId:      integer('service_id'),
  stage:          text('stage').notNull().default('discovery'), // discovery|design|build|review|launched
  launchedDate:   text('launched_date'),
  estimatedHours: real('estimated_hours'),
  createdAt:   text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt:   text('updated_at').notNull().default(sql`(datetime('now'))`),
})

export const businessProjectTasks = sqliteTable('business_project_tasks', {
  id:          integer('id').primaryKey({ autoIncrement: true }),
  projectId:   integer('project_id').notNull().references(() => businessProjects.id, { onDelete: 'cascade' }),
  title:       text('title').notNull(),
  description: text('description'),
  status:      text('status').notNull().default('todo'),
  dueDate:     text('due_date'),
  sortOrder:   integer('sort_order').notNull().default(0),
  createdAt:   text('created_at').notNull().default(sql`(datetime('now'))`),
})

export const businessInvoices = sqliteTable('business_invoices', {
  id:                integer('id').primaryKey({ autoIncrement: true }),
  clientId:          integer('client_id').notNull().references(() => businessClients.id),
  projectId:         integer('project_id').references(() => businessProjects.id),
  invoiceNumber:     text('invoice_number').notNull().unique(),
  amount:            real('amount').notNull(),
  status:            text('status').notNull().default('unpaid'),
  issueDate:         text('issue_date').notNull(),
  dueDate:           text('due_date').notNull(),
  paidDate:          text('paid_date'),
  notes:             text('notes'),
  // `amount` is the GROSS total (incl. tax). Net received = amount - feeAmount - refundedAmount.
  subtotal:          real('subtotal'),
  taxRate:           real('tax_rate').notNull().default(0),
  taxAmount:         real('tax_amount').notNull().default(0),
  feeAmount:         real('fee_amount').notNull().default(0),        // payment-processor fee
  refundedAmount:    real('refunded_amount').notNull().default(0),
  currency:          text('currency').notNull().default('GBP'),
  retainerId:        integer('retainer_id'),
  serviceId:         integer('service_id'),
  milestoneLabel:    text('milestone_label'),                        // 'Deposit' | 'Presentation' | 'Launch'
  periodStart:       text('period_start'),                           // retainer billing period
  periodEnd:         text('period_end'),
  sentDate:          text('sent_date'),
  // ── Legacy recurring-template columns. Superseded by businessRetainers;
  //    kept so historical rows stay readable.
  isRecurring:       integer('is_recurring').notNull().default(0),
  frequency:         text('frequency'),
  recurringParentId: integer('recurring_parent_id'),
  lastGeneratedDate: text('last_generated_date'),
  createdAt:         text('created_at').notNull().default(sql`(datetime('now'))`),
  /** 'stripe' | 'bank'. Null means nobody has said how it was paid. */
  paymentMethod:  text('payment_method'),
})

export const businessRetainers = sqliteTable('business_retainers', {
  id:                integer('id').primaryKey({ autoIncrement: true }),
  clientId:          integer('client_id').notNull().references(() => businessClients.id),
  serviceId:         integer('service_id').references(() => businessServices.id),
  name:              text('name').notNull(),
  amount:            real('amount').notNull(),
  currency:          text('currency').notNull().default('GBP'),
  frequency:         text('frequency').notNull().default('monthly'),
  startDate:         text('start_date').notNull(),
  endDate:           text('end_date'),                            // null = ongoing
  status:            text('status').notNull().default('active'),  // 'active' | 'paused' | 'cancelled'
  cancelReason:      text('cancel_reason'),
  cancelledAt:       text('cancelled_at'),
  netTermDays:       integer('net_term_days').notNull().default(0),
  autoInvoice:       integer('auto_invoice').notNull().default(1),
  lastGeneratedDate: text('last_generated_date'),
  nextInvoiceDate:   text('next_invoice_date'),
  notes:             text('notes'),
  createdAt:         text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt:         text('updated_at').notNull().default(sql`(datetime('now'))`),
})

/** Price history - this is what makes expansion / contraction MRR computable. */
export const businessRetainerChanges = sqliteTable('business_retainer_changes', {
  id:            integer('id').primaryKey({ autoIncrement: true }),
  retainerId:    integer('retainer_id').notNull().references(() => businessRetainers.id, { onDelete: 'cascade' }),
  effectiveDate: text('effective_date').notNull(),
  oldAmount:     real('old_amount').notNull(),
  newAmount:     real('new_amount').notNull(),
  reason:        text('reason'),
  createdAt:     text('created_at').notNull().default(sql`(datetime('now'))`),
})

export const businessInvoiceItems = sqliteTable('business_invoice_items', {
  id:          integer('id').primaryKey({ autoIncrement: true }),
  invoiceId:   integer('invoice_id').notNull().references(() => businessInvoices.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  quantity:    real('quantity').notNull().default(1),
  unitPrice:   real('unit_price').notNull(),
  amount:      real('amount').notNull(),
  taxRate:     real('tax_rate').notNull().default(0),
  sortOrder:   integer('sort_order').notNull().default(0),
})

/**
 * The partners. A draw is a share of profit, so owner pay never touches
 * finance_expenses and never reduces net profit.
 */
/**
 * One row per campaign per day. Where these exist they are the truth; where
 * they do not, spend is still pro-rated from the campaign's lifetime total.
 */
export const marketingSpendDaily = sqliteTable('marketing_spend_daily', {
  id:          integer('id').primaryKey({ autoIncrement: true }),
  campaignId:  integer('campaign_id').notNull().references(() => marketingCampaigns.id, { onDelete: 'cascade' }),
  date:        text('date').notNull(),
  spend:       real('spend').notNull(),
  impressions: integer('impressions'),
  clicks:      integer('clicks'),
  leads:       integer('leads'),
  /** 'manual' when typed in, otherwise the platform it came from. */
  source:      text('source').notNull().default('manual'),
  syncedAt:    text('synced_at'),
  createdAt:   text('created_at').notNull().default(sql`(datetime('now'))`),
})

/**
 * Payments as Stripe reports them. Stored whether or not they match an invoice,
 * so money that arrived is never invisible because the payer name was generic.
 */
export const stripePayments = sqliteTable('stripe_payments', {
  id:                integer('id').primaryKey({ autoIncrement: true }),
  stripeId:          text('stripe_id').notNull(),
  paymentIntentId:   text('payment_intent_id'),
  stripeCustomerId:  text('stripe_customer_id'),
  stripeInvoiceId:   text('stripe_invoice_id'),
  amountGross:       real('amount_gross').notNull(),
  fee:               real('fee').notNull().default(0),
  amountNet:         real('amount_net').notNull(),
  refunded:          real('refunded').notNull().default(0),
  currency:          text('currency').notNull().default('GBP'),
  paidDate:          text('paid_date').notNull(),
  payerName:         text('payer_name'),
  payerEmail:        text('payer_email'),
  description:       text('description'),
  status:            text('status').notNull().default('succeeded'),
  matchedInvoiceId:  integer('matched_invoice_id').references(() => businessInvoices.id),
  matchedClientId:   integer('matched_client_id').references(() => businessClients.id),
  /** 'exact' | 'high' | 'low' | 'none' */
  confidence:        text('confidence').notNull().default('none'),
  matchReason:       text('match_reason'),
  /** JSON array of ids when one payment settled several invoices. */
  coversInvoiceIds:  text('covers_invoice_ids'),
  matchedAt:         text('matched_at'),
  ignored:           integer('ignored').notNull().default(0),
  /** What the Stripe invoice behind this charge says about it recurring. */
  subscriptionId:    text('subscription_id'),
  /** Stripe's enum: subscription_create (new), subscription_cycle (renewal), manual. */
  billingReason:     text('billing_reason'),
  planAmount:        real('plan_amount'),
  planIntervalDays:  integer('plan_interval_days'),
  planDescription:   text('plan_description'),
  syncedAt:          text('synced_at'),
  createdAt:         text('created_at').notNull().default(sql`(datetime('now'))`),
})

export const businessOwners = sqliteTable('business_owners', {
  id:        integer('id').primaryKey({ autoIncrement: true }),
  name:      text('name').notNull(),
  sharePct:  real('share_pct').notNull().default(0),
  active:    integer('active').notNull().default(1),
  sortOrder: integer('sort_order').notNull().default(0),
  notes:     text('notes'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

export const businessOwnerDraws = sqliteTable('business_owner_draws', {
  id:        integer('id').primaryKey({ autoIncrement: true }),
  ownerId:   integer('owner_id').notNull().references(() => businessOwners.id, { onDelete: 'cascade' }),
  amount:    real('amount').notNull(),
  currency:  text('currency').notNull().default('GBP'),
  date:      text('date').notNull(),
  method:    text('method'),
  notes:     text('notes'),
  /** Set when the draw was also posted to the personal Finances ledger. */
  financeIncomeId: integer('finance_income_id'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

export const businessTimeEntries = sqliteTable('business_time_entries', {
  id:          integer('id').primaryKey({ autoIncrement: true }),
  projectId:   integer('project_id').notNull().references(() => businessProjects.id, { onDelete: 'cascade' }),
  date:        text('date').notNull(),
  hours:       real('hours').notNull(),
  description: text('description'),
  billable:    integer('billable').notNull().default(1),
  createdAt:   text('created_at').notNull().default(sql`(datetime('now'))`),
})

export const businessMeetingNotes = sqliteTable('business_meeting_notes', {
  id:          integer('id').primaryKey({ autoIncrement: true }),
  clientId:    integer('client_id').references(() => businessClients.id),
  projectId:   integer('project_id').references(() => businessProjects.id),
  title:       text('title').notNull(),
  content:     text('content'),
  meetingDate: text('meeting_date').notNull(),
  createdAt:   text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt:   text('updated_at').notNull().default(sql`(datetime('now'))`),
})

export const marketingCampaigns = sqliteTable('marketing_campaigns', {
  id:            integer('id').primaryKey({ autoIncrement: true }),
  name:          text('name').notNull(),
  platform:      text('platform').notNull(),        // 'google' | 'meta' | 'tiktok' | 'linkedin' | 'youtube' | 'pinterest' | 'snapchat' | 'x' | 'other'
  objective:     text('objective'),                  // 'awareness' | 'leads' | 'sales' | 'retargeting' | 'brand'
  budget:        real('budget').notNull(),           // planned budget (£)
  spent:         real('spent').notNull().default(0), // actual spend so far (£)
  fundingSource: text('funding_source').notNull().default('business'), // 'business' | 'personal'
  startDate:     text('start_date').notNull(),
  endDate:       text('end_date'),
  status:        text('status').notNull().default('active'), // 'active' | 'paused' | 'completed'
  notes:         text('notes'),
  /** Which platform to pull daily spend from, and what it is called there. */
  externalSource: text('external_source'),
  externalId:     text('external_id'),
  lastSyncedAt:   text('last_synced_at'),
  createdAt:     text('created_at').notNull().default(sql`(datetime('now'))`),
})

// ─── TRAINING ────────────────────────────────────────────────────────────────

export const workoutTemplates = sqliteTable('workout_templates', {
  id:        integer('id').primaryKey({ autoIncrement: true }),
  name:      text('name').notNull(),
  category:  text('category').notNull().default('strength'),
  exercises: text('exercises', { mode: 'json' }).$type<{ exerciseName: string; defaultSets: number }[]>().notNull().default([]),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

export const trainingWorkouts = sqliteTable('training_workouts', {
  id:              integer('id').primaryKey({ autoIncrement: true }),
  date:            text('date').notNull(),
  name:            text('name').notNull(),
  category:        text('category').notNull().default('strength'), // 'strength' | 'cardio' | 'sport' | 'hiit' | 'mobility'
  rpe:             integer('rpe'),                                   // Rate of Perceived Exertion 1–10
  notes:           text('notes'),
  durationMinutes: integer('duration_minutes'),
  createdAt:       text('created_at').notNull().default(sql`(datetime('now'))`),
})

export const trainingExercises = sqliteTable('training_exercises', {
  id:           integer('id').primaryKey({ autoIncrement: true }),
  workoutId:    integer('workout_id').notNull().references(() => trainingWorkouts.id, { onDelete: 'cascade' }),
  exerciseName: text('exercise_name').notNull(),
  sets:         integer('sets'),
  reps:         text('reps', { mode: 'json' }).$type<number[]>(),
  weight:       text('weight', { mode: 'json' }).$type<number[]>(),
  rpe:          integer('rpe'),
  notes:        text('notes'),
  sortOrder:    integer('sort_order').notNull().default(0),
})

export const trainingBodyMetrics = sqliteTable('training_body_metrics', {
  id:          integer('id').primaryKey({ autoIncrement: true }),
  date:        text('date').notNull().unique(),
  weightKg:    real('weight_kg'),
  bodyFatPct:  real('body_fat_pct'),
  notes:       text('notes'),
  createdAt:   text('created_at').notNull().default(sql`(datetime('now'))`),
})

export const trainingWeeklySchedule = sqliteTable('training_weekly_schedule', {
  id:               integer('id').primaryKey({ autoIncrement: true }),
  weekStart:        text('week_start').notNull(),
  dayOfWeek:        integer('day_of_week').notNull(),
  plannedWorkout:   text('planned_workout'),
  actualWorkoutId:  integer('actual_workout_id'),
})

// ─── CALENDAR ────────────────────────────────────────────────────────────────

export const calendarEvents = sqliteTable('calendar_events', {
  id:            integer('id').primaryKey({ autoIncrement: true }),
  title:         text('title').notNull(),
  description:   text('description'),
  startDatetime: text('start_datetime').notNull(),
  endDatetime:   text('end_datetime'),
  allDay:        integer('all_day').notNull().default(0),
  color:         text('color'),
  category:      text('category'),
  relatedTaskId: integer('related_task_id'),
  recurringRule: text('recurring_rule'),
  createdAt:     text('created_at').notNull().default(sql`(datetime('now'))`),
})

// ─── NOTES ───────────────────────────────────────────────────────────────────

export const noteCategories = sqliteTable('note_categories', {
  id:       integer('id').primaryKey({ autoIncrement: true }),
  name:     text('name').notNull(),
  color:    text('color'),
  parentId: integer('parent_id'),   // null = root folder
})

export const notes = sqliteTable('notes', {
  id:         integer('id').primaryKey({ autoIncrement: true }),
  title:      text('title').notNull(),
  content:    text('content'),
  categoryId: integer('category_id').references(() => noteCategories.id),
  tags:       text('tags', { mode: 'json' }).$type<string[]>(),
  pinned:     integer('pinned').notNull().default(0),
  createdAt:  text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt:  text('updated_at').notNull().default(sql`(datetime('now'))`),
  deletedAt:  text('deleted_at'),
})

export const noteImages = sqliteTable('note_images', {
  id:           integer('id').primaryKey({ autoIncrement: true }),
  noteId:       integer('note_id').notNull().references(() => notes.id, { onDelete: 'cascade' }),
  filePath:     text('file_path').notNull(),
  originalName: text('original_name'),
  createdAt:    text('created_at').notNull().default(sql`(datetime('now'))`),
})
