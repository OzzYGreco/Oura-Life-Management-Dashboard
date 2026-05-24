export const INSTRUMENTS = ['Stocks', 'Crypto', 'Futures'] as const
export const DIRECTIONS = ['Long', 'Short'] as const
export const ORDER_TYPES = ['Market', 'Limit'] as const
export const HORIZONS = ['3yr', 'yearly', 'monthly', 'weekly'] as const
export const GOAL_STATUSES = ['active', 'completed', 'paused'] as const

export const MISTAKES = [
  { key: 'early_entry',  label: 'Early Entry' },
  { key: 'early_exit',   label: 'Early Exit' },
  { key: 'late_entry',   label: 'Late Entry' },
  { key: 'exit_too_soon', label: 'Exit Too Soon' },
  { key: 'exit_too_late', label: 'Exit Too Late' },
  { key: 'no_trigger',   label: 'No Trigger' },
  { key: 'other',        label: 'Other' },
] as const

export const EXPENSE_CATEGORIES = [
  'Housing', 'Food', 'Transport', 'Subscriptions', 'Health', 'Clothing',
  'Entertainment', 'Education', 'Business', 'Investing', 'Other',
]

export const INCOME_CATEGORIES = [
  'Trading', 'Business', 'Salary', 'Freelance', 'Investments', 'Other',
]

export const EVENT_CATEGORIES = [
  { value: 'personal', label: 'Personal',   color: '#818cf8' },
  { value: 'business', label: 'Business',   color: '#a78bfa' },
  { value: 'health',   label: 'Health',     color: '#34d399' },
  { value: 'trading',  label: 'Trading',    color: '#fbbf24' },
  { value: 'focus',    label: 'Deep Work',  color: '#22d3ee' },
]

export const TASK_STATUSES = [
  { value: 'todo',        label: 'To Do',       color: '#525252' },
  { value: 'in-progress', label: 'In Progress', color: '#3b82f6' },
  { value: 'done',        label: 'Done',        color: '#10b981' },
]

export const EISENHOWER = [
  { key: 'UI',   label: 'Urgent + Important',     color: '#f87171', bg: 'rgba(248,113,113,0.12)', border: 'rgba(248,113,113,0.25)', desc: 'Do First' },
  { key: 'NUI',  label: 'Not Urgent + Important', color: '#818cf8', bg: 'rgba(129,140,248,0.12)', border: 'rgba(129,140,248,0.25)', desc: 'Schedule' },
  { key: 'UNI',  label: 'Urgent + Not Important', color: '#fbbf24', bg: 'rgba(251,191,36,0.12)',  border: 'rgba(251,191,36,0.25)',  desc: 'Delegate' },
  { key: 'NUNI', label: 'Not Urgent + Not Imp.',  color: '#6b7280', bg: 'rgba(107,114,128,0.12)', border: 'rgba(107,114,128,0.25)', desc: 'Eliminate' },
] as const

export const INVOICE_STATUSES = [
  { value: 'draft',    label: 'Draft',    color: '#525252' },
  { value: 'unpaid',   label: 'Unpaid',   color: '#f59e0b' },
  { value: 'paid',     label: 'Paid',     color: '#10b981' },
  { value: 'overdue',  label: 'Overdue',  color: '#ef4444' },
]
