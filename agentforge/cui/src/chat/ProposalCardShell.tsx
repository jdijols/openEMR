import type { ReactElement, ReactNode } from 'react';

/**
 * Shared chrome for any proposal-style card — W1 single-target writes
 * (vitals / chief complaint / etc.) AND W2 intake-form proposals all
 * render through this shell so the rail has one consistent design
 * language for "the assistant is asking for a Confirm / Reject decision."
 *
 * The shell is purely presentational: state drives styling, but consumers
 * own their state machines and action handlers. State names mirror the
 * W1 ProposalBlock vocabulary so existing CSS selectors
 * (`.agentforge-msg__proposal-card[data-state="…"]`) carry over without
 * any rename.
 *
 * Children render in the body slot — W1 passes a `<p>` of preview text,
 * W2 passes the structured intake sections. The shell provides title +
 * status + actions + hint chrome around whatever the consumer provides.
 */
export type ProposalCardState =
  | 'idle'
  | 'submitting'
  | 'accepted'
  | 'declined'
  | 'denied'
  | 'failed'
  | 'voice';

export type ProposalCardActionsConfig = Readonly<{
  onConfirm: () => void;
  onReject: () => void;
  /** Default "Confirm". W1 deletes pass "Delete"; W2 intake passes "Confirm". */
  confirmLabel?: string;
  /** Default "Reject". W1 deletes pass "Cancel". */
  rejectLabel?: string;
  confirmIcon?: ReactNode;
  rejectIcon?: ReactNode;
  /** Drives visual treatment of the primary button. Defaults to "primary". */
  confirmVariant?: 'primary' | 'danger';
  /** When true, both buttons render disabled (e.g. submitting). */
  disabled?: boolean;
}>;

export type ProposalCardShellProps = Readonly<{
  /** Top-left header text. Default: "Proposed change". */
  title?: string;
  /** Top-right header text — W1 uses the formatted write target. Optional. */
  targetLabel?: string;
  /** Header icon next to the title. Default: a clipboard-check glyph. */
  headerIcon?: ReactNode;
  /** Drives accent color via `data-state` and CSS variables. */
  state: ProposalCardState;
  /** When set, renders the status pill below the body. */
  statusMessage?: string;
  /** Icon paired with the status pill (decorative — the text carries semantics). */
  statusIcon?: ReactNode;
  /** Confirm/Reject button row. Omit to render no actions (terminal states). */
  actions?: ProposalCardActionsConfig;
  /** Optional hint line (e.g. "Thread not ready…" when env is missing). */
  hint?: string;
  /** Aria label override for the card region. */
  ariaLabel?: string;
  /** Body content — usually a `<p>` of preview text or a list of structured fields. */
  children?: ReactNode;
}>;

export function ProposalCardShell(props: ProposalCardShellProps): ReactElement {
  const title = props.title ?? 'Proposed change';
  const headerIcon = props.headerIcon ?? <DefaultClipboardIcon />;
  const actions = props.actions;
  const confirmLabel = actions?.confirmLabel ?? 'Confirm';
  const rejectLabel = actions?.rejectLabel ?? 'Reject';
  const confirmVariant = actions?.confirmVariant ?? 'primary';
  const ariaLabel = props.ariaLabel ?? title;

  return (
    <div
      className="agentforge-msg__proposal-card"
      data-state={props.state}
      aria-label={ariaLabel}
    >
      <header className="agentforge-msg__proposal-header">
        <span className="agentforge-msg__proposal-label">
          {headerIcon}
          <span>{title}</span>
        </span>
        {props.targetLabel !== undefined && props.targetLabel !== '' ? (
          <span className="agentforge-msg__proposal-target">{props.targetLabel}</span>
        ) : null}
      </header>

      {props.children !== undefined ? (
        <div className="agentforge-msg__proposal-body">{props.children}</div>
      ) : null}

      {props.statusMessage !== undefined && props.statusMessage !== '' ? (
        <p className="agentforge-msg__proposal-status" role="status">
          {props.statusIcon}
          <span>{props.statusMessage}</span>
        </p>
      ) : null}

      {actions !== undefined ? (
        <div className="agentforge-msg__proposal-actions">
          <button
            type="button"
            className={
              confirmVariant === 'danger' ?
                'agentforge-msg__proposal-btn agentforge-msg__proposal-btn--danger'
              : 'agentforge-msg__proposal-btn agentforge-msg__proposal-btn--primary'
            }
            onClick={actions.onConfirm}
            disabled={actions.disabled === true}
          >
            {actions.confirmIcon}
            <span>{confirmLabel}</span>
          </button>
          <button
            type="button"
            className="agentforge-msg__proposal-btn agentforge-msg__proposal-btn--secondary"
            onClick={actions.onReject}
            disabled={actions.disabled === true}
          >
            {actions.rejectIcon}
            <span>{rejectLabel}</span>
          </button>
        </div>
      ) : null}

      {props.hint !== undefined && props.hint !== '' ? (
        <p className="agentforge-msg__proposal-hint">{props.hint}</p>
      ) : null}
    </div>
  );
}

/**
 * Fallback clipboard glyph for the shell header when the consumer does
 * not supply its own. Same stroked-currentColor convention as the rest
 * of the panel iconography.
 */
function DefaultClipboardIcon(): ReactElement {
  return (
    <svg
      className="agentforge-msg__icon"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
      <rect x="9" y="3" width="6" height="4" rx="1" />
      <path d="m9 14 2 2 4-4" />
    </svg>
  );
}
