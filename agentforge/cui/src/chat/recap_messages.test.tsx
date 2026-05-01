/**
 * Gate 5 G5-07 — UC-C recap renderer.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MessageList } from '../chat/MessageList.js';

describe('MessageList recap (UC-C)', () => {
  it('renders distinct visual rows per recap classification', () => {
    render(
      <MessageList
        boundPatientUuid="uu"
        messages={[
          {
            role: 'assistant',
            blocks: [
              {
                type: 'recap',
                items: [
                  { id: 'a', classification: 'confirmed', summary: 'Saved vitals' },
                  { id: 'b', classification: 'rejected', summary: 'Skipped allergy' },
                  { id: 'c', classification: 'unresolved', summary: 'Pending note' },
                  { id: 'd', classification: 'refusal', summary: 'Model refused' },
                ],
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByText(/What we captured/u)).toBeInTheDocument();
    expect(screen.getByText('confirmed')).toBeInTheDocument();
    expect(screen.getByText('rejected')).toBeInTheDocument();
    expect(screen.getByText('unresolved')).toBeInTheDocument();
    expect(screen.getByText('refusal')).toBeInTheDocument();
    expect(screen.getByText('Saved vitals')).toBeInTheDocument();
  });
});
