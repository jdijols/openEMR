import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

/**
 * PatientSubNav — the row of patient subpage tabs (Dashboard / History /
 * Assessments ▾ / Report / Documents / Transactions / Issues / Ledger /
 * External Data) that mirrors the legacy nav rendered inside demographics.php.
 *
 * Tabs are href links pointing at the legacy PHP pages; clicking navigates
 * the same chart-shell "pat" tab pane to the legacy page (replacing this
 * React app with the legacy renderer). When the user navigates back to the
 * Dashboard tab, our React app remounts. Standard tab behavior.
 *
 * Style intent: halfway between legacy text-link nav and our refined React
 * design language. Same horizontal text-link structure as the legacy (so the
 * jump from React → PHP page feels seamless), but with refined typography,
 * slightly larger hit targets, and our `--af-*` token vocabulary.
 *
 * In standalone-dev mode (no `__AGENTFORGE_DASHBOARD__` injected), the nav
 * doesn't render — its links would point at non-existent paths.
 */

type TabConfig = {
  id: string
  label: string
  href: string | null
  children?: TabConfig[]
}

function buildTabs(webroot: string, pid: number | undefined): TabConfig[] {
  const root = webroot
  const pidStr = pid != null ? String(pid) : ''
  return [
    { id: 'dashboard', label: 'Dashboard', href: null },
    { id: 'history', label: 'History', href: `${root}/interface/patient_file/history/history.php` },
    {
      id: 'assessments',
      label: 'Assessments',
      href: null,
      children: [
        {
          id: 'sdoh',
          label: 'SDOH Assessment',
          href: `${root}/interface/patient_file/history/history_sdoh_widget.php?pid=${pidStr}`,
        },
      ],
    },
    {
      id: 'report',
      label: 'Report',
      href: `${root}/interface/patient_file/report/patient_report.php`,
    },
    {
      id: 'documents',
      label: 'Documents',
      href: `${root}/controller.php?document&list&patient_id=${pidStr}`,
    },
    {
      id: 'transactions',
      label: 'Transactions',
      href: `${root}/interface/patient_file/transaction/transactions.php`,
    },
    {
      id: 'issues',
      label: 'Issues',
      href: `${root}/interface/patient_file/summary/stats_full.php?active=all`,
    },
    {
      id: 'ledger',
      label: 'Ledger',
      href: `${root}/interface/reports/pat_ledger.php?form=1&patient_id=${pidStr}`,
    },
    {
      id: 'external_data',
      label: 'External Data',
      href: `${root}/interface/reports/external_data.php`,
    },
  ]
}

function restoreSession(): void {
  // Mirror the legacy `onclick="top.restoreSession()"` so the OpenEMR session
  // timer resets on click. `top` always references the chart-shell window.
  try {
    const t = window.top as unknown as { restoreSession?: () => void } | null
    t?.restoreSession?.()
  } catch {
    // Same-origin should always allow this; ignore otherwise.
  }
}

export function PatientSubNav() {
  const injected = typeof window !== 'undefined' ? window.__AGENTFORGE_DASHBOARD__ : undefined
  if (!injected) return null
  const tabs = buildTabs(injected.webroot ?? '', injected.pid)

  return (
    <nav
      className="sticky top-[78px] z-[5] bg-af-surface/85 backdrop-blur-md border-b border-af-border"
      aria-label="Patient sections"
    >
      {/*
        No `overflow-x-auto` here on purpose: when `overflow-x` is auto/scroll
        the browser silently coerces `overflow-y` to auto too (CSS spec), which
        clips the Assessments dropdown menu (it opens BELOW the nav row and
        gets cropped by the row's vertical extent — the symptom looks like the
        menu just doesn't open). With overflow visible, the dropdown renders
        correctly. 9 tabs fit comfortably at desktop widths.

        No max-width / mx-auto: the sub-nav fills the iframe edge-to-edge so
        the leftmost tab's left edge aligns with the leftmost card's left edge
        below it. px-5 (20 px) matches the dashboard's content padding.
      */}
      <div className="px-5 flex items-stretch gap-0.5">
        {tabs.map((tab) =>
          tab.children && tab.children.length > 0 ? (
            <DropdownTab key={tab.id} tab={tab} />
          ) : (
            <SimpleTab key={tab.id} tab={tab} active={tab.id === 'dashboard'} />
          ),
        )}
      </div>
    </nav>
  )
}

function tabClassName(active: boolean, extra = ''): string {
  // `relative` is required so the active underline can position absolutely.
  // `whitespace-nowrap` keeps long labels (External Data) on one line.
  // `outline-offset-[-2px]` keeps focus rings inside the row, not above it.
  const base =
    'relative whitespace-nowrap px-3.5 py-3 text-[13.5px] font-medium tracking-tight transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-af-primary'
  const state = active
    ? "text-af-primary after:content-[''] after:absolute after:bottom-0 after:left-2 after:right-2 after:h-[2px] after:bg-af-primary after:rounded-t-sm"
    : 'text-af-text-subtle hover:text-af-primary hover:bg-af-primary-50/60'
  return `${base} ${state} ${extra}`.trim()
}

function SimpleTab({ tab, active }: { tab: TabConfig; active: boolean }) {
  if (active || !tab.href) {
    return (
      <span className={tabClassName(true)} aria-current="page">
        {tab.label}
      </span>
    )
  }
  return (
    <a href={tab.href} onClick={restoreSession} className={tabClassName(false)}>
      {tab.label}
    </a>
  )
}

function DropdownTab({ tab }: { tab: TabConfig }) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative flex items-stretch">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={tabClassName(false, 'inline-flex items-center gap-1')}
      >
        {tab.label}
        <ChevronDown
          size={14}
          aria-hidden
          className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && tab.children && (
        <div
          role="menu"
          className="absolute top-full left-0 mt-1 min-w-[200px] bg-af-surface border border-af-border rounded-lg shadow-[0_8px_24px_rgba(15,23,42,0.08),0_1px_2px_rgba(15,23,42,0.04)] z-10 py-1.5"
        >
          {tab.children.map((child) => (
            <a
              key={child.id}
              role="menuitem"
              href={child.href ?? '#'}
              onClick={() => {
                restoreSession()
                setOpen(false)
              }}
              className="block px-4 py-2 text-sm text-af-text-subtle hover:bg-af-primary-50/60 hover:text-af-primary focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-af-primary"
            >
              {child.label}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
