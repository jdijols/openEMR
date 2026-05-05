import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Composer } from './Composer.js';
import { ErrorBanner } from './ErrorBanner.js';
import { ExtractionAcknowledgment } from './ExtractionAcknowledgment.js';
import { IntakeProposalCard, type IntakeProposalData } from './IntakeProposalCard.js';
import { TypingIndicator } from './TypingIndicator.js';
import { CitationLink } from '../citations/CitationLink.js';

/**
 * §9 / G2-MVP-61, 63, 66, 67, 68, 69 — consolidated CUI smoke tests.
 * AttachmentPreview + DocumentModal + useDocumentBytes are exercised
 * indirectly via Composer here; their pdfjs render path is verified at
 * G2-MVP-99 manual smoke (jsdom does not run pdfjs cleanly).
 */

describe('§9 G2-MVP-63 — ErrorBanner', () => {
  it('renders the message', () => {
    render(<ErrorBanner message="bad mime type" />);
    expect(screen.getByTestId('error-banner')).toHaveTextContent('bad mime type');
  });
});

describe('§9 G2-MVP-67 — TypingIndicator', () => {
  it('mounts when visible=true', () => {
    render(<TypingIndicator visible={true} />);
    expect(screen.getByTestId('typing-indicator')).toBeInTheDocument();
  });

  it('returns null when visible=false', () => {
    const { container } = render(<TypingIndicator visible={false} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('§9 G2-MVP-66 — CitationLink', () => {
  it('lab_pdf source dispatches onOpenDocument', () => {
    const onOpenDocument = vi.fn();
    render(
      <CitationLink citation={{ source_type: 'lab_pdf', source_id: 'docref-x', page_or_section: 'page:1' }} onOpenDocument={onOpenDocument}>
        158
      </CitationLink>,
    );
    fireEvent.click(screen.getByTestId('citation-link'));
    expect(onOpenDocument).toHaveBeenCalledOnce();
  });

  it('guideline_chunk opens new tab via window.open with noopener', () => {
    const winOpen = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(
      <CitationLink citation={{ source_type: 'guideline_chunk', source_url: 'https://uspstf.example/statin', page_or_section: 'Statin' }}>
        ACC/AHA Guideline
      </CitationLink>,
    );
    fireEvent.click(screen.getByTestId('citation-link'));
    expect(winOpen).toHaveBeenCalledWith('https://uspstf.example/statin', '_blank', 'noopener');
    winOpen.mockRestore();
  });
});

describe('§9 G2-MVP-68 — ExtractionAcknowledgment', () => {
  it('renders pending state with spinner', () => {
    render(<ExtractionAcknowledgment status={{ status: 'pending', docType: 'lab_pdf', fileName: 'lipid.pdf' }} />);
    expect(screen.getByTestId('extraction-ack-pending')).toBeInTheDocument();
  });

  it('resolved lab template includes count + abnormal flag', () => {
    render(
      <ExtractionAcknowledgment
        status={{ status: 'resolved', docType: 'lab_pdf', fileName: 'lipid.pdf', nFacts: 5, nAbnormal: 4 }}
      />,
    );
    const node = screen.getByTestId('extraction-ack-resolved');
    expect(node).toHaveTextContent(/5 result/);
    expect(node).toHaveTextContent(/4 abnormal/);
  });

  it('resolved intake template uses the intake schema', () => {
    render(
      <ExtractionAcknowledgment
        status={{ status: 'resolved', docType: 'intake_form', fileName: 'intake.pdf', nFacts: 12 }}
      />,
    );
    expect(screen.getByTestId('extraction-ack-resolved')).toHaveTextContent(/12 fields/);
  });
});

describe('§9 G2-MVP-69 — IntakeProposalCard', () => {
  const data: IntakeProposalData = {
    demographics: { name: 'Chen, Margaret L.', dob: '1967-08-14', sex: 'female', contact_phone: '(510) 555-0148' },
    chief_concern: { text: 'Tired during the day', onset: '~3 weeks' },
    current_medications: [
      { name: 'Lisinopril', dose: '10 mg', frequency: 'PO daily' },
      { name: 'Metformin', dose: '500 mg', frequency: 'PO BID' },
    ],
    allergies: [{ substance: 'Penicillin', reaction: 'Hives', severity: 'moderate' }],
    family_history: [{ relation: 'Mother', condition: 'Type 2 diabetes' }],
  };

  it('renders all 5 sections from extraction', () => {
    render(<IntakeProposalCard data={data} onConfirm={vi.fn()} onReject={vi.fn()} />);
    expect(screen.getByTestId('intake-section-demographics')).toBeInTheDocument();
    expect(screen.getByTestId('intake-section-chief-concern')).toBeInTheDocument();
    expect(screen.getByTestId('intake-section-medications')).toBeInTheDocument();
    expect(screen.getByTestId('intake-section-allergies')).toBeInTheDocument();
    expect(screen.getByTestId('intake-section-family')).toBeInTheDocument();
  });

  it('Confirm fires intent dispatch', () => {
    const onConfirm = vi.fn();
    render(<IntakeProposalCard data={data} onConfirm={onConfirm} onReject={vi.fn()} />);
    fireEvent.click(screen.getByTestId('intake-proposal-confirm'));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('Reject discards', () => {
    const onReject = vi.fn();
    render(<IntakeProposalCard data={data} onConfirm={vi.fn()} onReject={onReject} />);
    fireEvent.click(screen.getByTestId('intake-proposal-reject'));
    expect(onReject).toHaveBeenCalledOnce();
  });
});

describe('§9 G2-MVP-61 — Composer', () => {
  it('renders empty state with attach button + no file preview', () => {
    render(<Composer onSubmit={vi.fn()} />);
    expect(screen.getByTestId('composer-attach')).toBeInTheDocument();
    expect(screen.queryByTestId('attachment-preview')).not.toBeInTheDocument();
  });

  it('invalid file type triggers ErrorBanner', async () => {
    render(<Composer onSubmit={vi.fn()} />);
    const input = screen.getByTestId('composer-file-input') as HTMLInputElement;
    const bad = new File([new Uint8Array(8)], 'bad.swf', { type: 'application/x-shockwave-flash' });
    fireEvent.change(input, { target: { files: [bad] } });
    await waitFor(() => expect(screen.getByTestId('error-banner')).toBeInTheDocument());
    expect(screen.queryByTestId('attachment-preview')).not.toBeInTheDocument();
  });

  it('text-only send fires onSubmit with empty file', () => {
    const onSubmit = vi.fn();
    render(<Composer onSubmit={onSubmit} />);
    const input = screen.getByTestId('composer-input');
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.click(screen.getByTestId('composer-send'));
    expect(onSubmit).toHaveBeenCalledWith({ text: 'hello', file: null });
  });
});
