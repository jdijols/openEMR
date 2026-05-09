import type { ReactNode } from 'react'

export type ClinicalCardStatus = 'loading' | 'empty' | 'error' | 'content'

type Props = {
  title: string
  status: ClinicalCardStatus
  emptyMessage?: string
  errorMessage?: string
  errorCorrelationId?: string
  action?: ReactNode
  children?: ReactNode
}

export function ClinicalCard({
  title,
  status,
  emptyMessage,
  errorMessage,
  errorCorrelationId,
  action,
  children,
}: Props) {
  return (
    <section
      className="rounded-af-card border border-af-border bg-af-surface shadow-sm overflow-hidden"
      data-status={status}
    >
      <header className="flex items-center justify-between px-5 py-3 border-b border-af-gray-100">
        <h2 className="text-sm font-semibold tracking-tight text-af-text">{title}</h2>
        {action && <div className="text-af-gray-400">{action}</div>}
      </header>
      <div className="px-5 py-4">
        {status === 'loading' && <LoadingSkeleton />}
        {status === 'empty' && (
          <p className="text-sm text-af-text-muted">{emptyMessage ?? 'No data on file.'}</p>
        )}
        {status === 'error' && (
          <div className="text-sm text-af-danger">
            <p>{errorMessage ?? 'Could not load.'}</p>
            {errorCorrelationId && (
              <p className="mt-1 text-xs font-mono text-af-danger/80">
                correlation: {errorCorrelationId}
              </p>
            )}
          </div>
        )}
        {status === 'content' && children}
      </div>
    </section>
  )
}

function LoadingSkeleton() {
  return (
    <div className="space-y-2 animate-pulse" aria-hidden>
      <div className="h-3 bg-af-gray-100 rounded w-2/3" />
      <div className="h-3 bg-af-gray-100 rounded w-1/2" />
      <div className="h-3 bg-af-gray-100 rounded w-3/5" />
    </div>
  )
}
