import type { ReactNode } from 'react'
import { AlertCircle, Inbox } from 'lucide-react'

export type ClinicalCardStatus = 'loading' | 'empty' | 'error' | 'content'

export type ClinicalCardAccent = 'default' | 'sky' | 'emerald' | 'amber' | 'rose' | 'violet'

type Props = {
  title: string
  status: ClinicalCardStatus
  /**
   * Color accent applied to the icon chip + (subtle) left border on hover.
   * Default surfaces a neutral card; semantic accents communicate the card's
   * clinical category at a glance (Allergies/rose, Vitals/sky, etc.).
   */
  accent?: ClinicalCardAccent
  /** Lucide-react icon (or any 16-20px element) shown in the header chip. */
  icon?: ReactNode
  /** Custom empty-state node — overrides emptyMessage rendering when present. */
  emptyState?: ReactNode
  emptyMessage?: string
  errorMessage?: string
  errorCorrelationId?: string
  action?: ReactNode
  children?: ReactNode
}

const ACCENT_CHIP: Record<ClinicalCardAccent, string> = {
  default: 'bg-af-gray-100 text-af-text-subtle ring-af-border',
  sky: 'bg-sky-50 text-sky-700 ring-sky-200/70',
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200/70',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200/70',
  rose: 'bg-rose-50 text-rose-700 ring-rose-200/70',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200/70',
}

export function ClinicalCard({
  title,
  status,
  accent = 'default',
  icon,
  emptyState,
  emptyMessage,
  errorMessage,
  errorCorrelationId,
  action,
  children,
}: Props) {
  return (
    <section
      className="group rounded-xl border border-af-border bg-af-surface shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:shadow-[0_4px_12px_rgba(15,23,42,0.06)] hover:border-af-border-strong/70 transition-all duration-200 overflow-hidden"
      data-status={status}
      data-accent={accent}
    >
      <header className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-af-gray-100">
        <div className="flex items-center gap-3 min-w-0">
          {icon && (
            <span
              className={`shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-lg ring-1 ${ACCENT_CHIP[accent]}`}
              aria-hidden
            >
              {icon}
            </span>
          )}
          <h2 className="text-[14px] font-semibold tracking-tight text-af-text truncate">
            {title}
          </h2>
        </div>
        {action && <div className="shrink-0 text-af-gray-400">{action}</div>}
      </header>
      <div className="px-5 py-4">
        {status === 'loading' && <LoadingSkeleton />}
        {status === 'empty' && (emptyState ?? <DefaultEmptyState message={emptyMessage} />)}
        {status === 'error' && <ErrorState message={errorMessage} correlationId={errorCorrelationId} />}
        {status === 'content' && children}
      </div>
    </section>
  )
}

function LoadingSkeleton() {
  return (
    <div className="space-y-2.5" aria-hidden>
      <div className="h-3 w-2/3 rounded bg-gradient-to-r from-af-gray-100 via-af-gray-200 to-af-gray-100 bg-[length:200%_100%] animate-shimmer" />
      <div className="h-3 w-1/2 rounded bg-gradient-to-r from-af-gray-100 via-af-gray-200 to-af-gray-100 bg-[length:200%_100%] animate-shimmer" />
      <div className="h-3 w-3/5 rounded bg-gradient-to-r from-af-gray-100 via-af-gray-200 to-af-gray-100 bg-[length:200%_100%] animate-shimmer" />
    </div>
  )
}

function DefaultEmptyState({ message }: { message?: string }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <span
        className="shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-af-gray-100 text-af-gray-500"
        aria-hidden
      >
        <Inbox size={16} />
      </span>
      <p className="text-sm text-af-text-muted">{message ?? 'No data on file.'}</p>
    </div>
  )
}

function ErrorState({ message, correlationId }: { message?: string; correlationId?: string }) {
  return (
    <div className="flex items-start gap-3 py-1">
      <span
        className="shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-rose-600 ring-1 ring-rose-200/70"
        aria-hidden
      >
        <AlertCircle size={16} />
      </span>
      <div className="text-sm text-af-text">
        <p className="font-medium">{message ?? 'Could not load.'}</p>
        {correlationId && (
          <p className="mt-1 text-[11px] font-mono text-af-text-muted">
            correlation: {correlationId}
          </p>
        )}
      </div>
    </div>
  )
}
