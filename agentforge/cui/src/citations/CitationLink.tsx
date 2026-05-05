import type { ReactElement } from 'react';

/**
 * §9 / G2-MVP-66 — clickable citation wrapper. Dispatches by `source_type`:
 *   lab_pdf | intake_form  → open DocumentModal at cited page (parent handles).
 *   guideline_chunk        → window.open(source_url, '_blank', 'noopener').
 *   openemr_record         → existing W1 postMessage navigation (parent handles).
 */

export type CitationLinkSource =
  | { readonly source_type: 'lab_pdf' | 'intake_form'; readonly source_id: string; readonly page_or_section: string; readonly bbox?: readonly [number, number, number, number] }
  | { readonly source_type: 'guideline_chunk'; readonly source_url: string; readonly page_or_section: string }
  | { readonly source_type: 'openemr_record'; readonly source_id: string; readonly page_or_section: string };

export type CitationLinkProps = {
  readonly children: string;
  readonly citation: CitationLinkSource;
  readonly onOpenDocument?: (citation: Extract<CitationLinkSource, { source_type: 'lab_pdf' | 'intake_form' }>) => void;
  readonly onOpenOpenemr?: (citation: Extract<CitationLinkSource, { source_type: 'openemr_record' }>) => void;
};

export function CitationLink(props: CitationLinkProps): ReactElement {
  const onClick = (e: React.MouseEvent<HTMLButtonElement>): void => {
    e.preventDefault();
    if (props.citation.source_type === 'lab_pdf' || props.citation.source_type === 'intake_form') {
      props.onOpenDocument?.(props.citation);
      return;
    }
    if (props.citation.source_type === 'guideline_chunk') {
      // Open in new tab with `noopener` per security posture (no opener access back).
      window.open(props.citation.source_url, '_blank', 'noopener');
      return;
    }
    if (props.citation.source_type === 'openemr_record') {
      props.onOpenOpenemr?.(props.citation);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="citation-link"
      data-source-type={props.citation.source_type}
      className="agentforge-cui__citation-link"
      style={{ background: 'transparent', border: 'none', padding: 0, color: '#1d4ed8', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}
    >
      {props.children}
    </button>
  );
}
