/**
 * Phase 2 — `formatPreview(target, payload)` is the single source of truth
 * for the affordance preview line and the in-chat resolved receipt. These
 * tests pin the per-target format spec from
 * `affordance-queue-iteration.md` so any future change to a formatter
 * surfaces here before it ships to a physician's chart.
 */

import { describe, expect, it } from 'vitest';
import { formatPreview } from '../../src/conversations/preview_formatters.js';

describe('formatPreview', () => {
  describe('chief_complaint', () => {
    it('renders the trimmed reason text, truncated at ~50 chars', () => {
      expect(formatPreview('chief_complaint', { reason: 'Cough and fever for 3 days' })).toBe(
        'Cough and fever for 3 days',
      );
    });

    it('truncates long reasons to 50 chars with ellipsis', () => {
      const long = 'Patient reports a long string of complaints describing many symptoms in detail';
      const out = formatPreview('chief_complaint', { reason: long });
      expect(out.length).toBeLessThanOrEqual(50);
      expect(out.endsWith('…')).toBe(true);
    });

    it('falls back to a generic label when reason is missing', () => {
      expect(formatPreview('chief_complaint', {})).toBe('Chief complaint');
    });
  });

  describe('chief_complaint_delete', () => {
    it('returns the constant "Clear chief complaint"', () => {
      expect(formatPreview('chief_complaint_delete', {})).toBe('Clear chief complaint');
    });
  });

  describe('vitals', () => {
    it('formats a compact key-vitals string', () => {
      expect(
        formatPreview('vitals', { bp: '120/80', hr: 72, weight_lb: 180 }),
      ).toBe('BP 120/80 · HR 72 · Wt 180lb');
    });

    it('skips missing vital keys', () => {
      expect(formatPreview('vitals', { bp: '110/70' })).toBe('BP 110/70');
    });

    it('handles temperature, height, pain', () => {
      expect(
        formatPreview('vitals', { temp: 98.6, height_in: 70, pain: 3 }),
      ).toBe('Temp 98.6 · Ht 70" · Pain 3');
    });

    it('falls back to a generic label when payload is empty', () => {
      expect(formatPreview('vitals', {})).toBe('Vitals');
    });
  });

  describe('vitals_delete', () => {
    it('renders a UUID-prefix fallback (no row metadata in payload)', () => {
      expect(formatPreview('vitals_delete', { vitals_uuid: 'd4c8e1ff-1234-5678-9abc-def012345678' })).toBe(
        'Void vitals · row d4c8e1ff…',
      );
    });
  });

  describe('tobacco', () => {
    it('humanizes the controlled-vocabulary status', () => {
      expect(formatPreview('tobacco', { status: 'never_smoker' })).toBe('Status: never smoker');
      expect(formatPreview('tobacco', { status: 'former_smoker' })).toBe('Status: former smoker');
      expect(formatPreview('tobacco', { status: 'current_every_day' })).toBe('Status: current daily smoker');
    });

    it('falls back gracefully on unknown status', () => {
      expect(formatPreview('tobacco', { status: 'unknown_value' })).toBe('Status: unknown value');
    });
  });

  describe('clinical_note', () => {
    it('truncates note text at ~50 chars', () => {
      const out = formatPreview('clinical_note', {
        text: 'Patient denies chest pain or shortness of breath. Vitals stable.',
      });
      expect(out.length).toBeLessThanOrEqual(50);
      expect(out.endsWith('…')).toBe(true);
    });
  });

  describe('clinical_note_update', () => {
    it('uses the "Update note · …" prefix and truncates at ~30 chars', () => {
      const out = formatPreview('clinical_note_update', {
        action: 'update',
        note_uuid: 'abc',
        text: 'Adjust dosing to 5mg twice daily and monitor',
      });
      expect(out.startsWith('Update note · ')).toBe(true);
    });
  });

  describe('clinical_note_delete', () => {
    it('returns the constant "Delete note"', () => {
      expect(formatPreview('clinical_note_delete', { action: 'delete', note_uuid: 'abc' })).toBe('Delete note');
    });
  });

  describe('allergy (add)', () => {
    it('joins substance · reaction · severity with humanized option_ids', () => {
      expect(
        formatPreview('allergy', {
          action: 'add',
          substance: 'Penicillin',
          reaction: 'shortness_of_breath',
          severity: 'life_threatening_severity',
        }),
      ).toBe('Penicillin · Shortness of breath · Life threatening');
    });

    it('capitalizes lowercase substance', () => {
      expect(formatPreview('allergy', { action: 'add', substance: 'walnuts' })).toBe('Walnuts');
    });

    it('renders substance only when reaction/severity are missing', () => {
      expect(formatPreview('allergy', { action: 'add', substance: 'Penicillin' })).toBe('Penicillin');
    });

    it('falls back to "New allergy" when no fields are populated', () => {
      expect(formatPreview('allergy', { action: 'add' })).toBe('New allergy');
    });
  });

  describe('allergy (update)', () => {
    it('formats update_substance with the new substance', () => {
      expect(formatPreview('allergy', { action: 'update_substance', substance: 'sulfa' })).toBe(
        'Update substance → Sulfa',
      );
    });

    it('formats update_reaction with humanized id', () => {
      expect(formatPreview('allergy', { action: 'update_reaction', reaction: 'shortness_of_breath' })).toBe(
        'Update reaction → Shortness of breath',
      );
    });

    it('formats update_severity with humanized id', () => {
      expect(formatPreview('allergy', { action: 'update_severity', severity: 'mild_to_moderate' })).toBe(
        'Update severity → Mild to moderate',
      );
    });
  });

  describe('allergy_delete', () => {
    it('uses UUID-prefix fallback (substance not in payload)', () => {
      expect(formatPreview('allergy_delete', { allergy_uuid: 'a4c8e1ff-1234-5678-9abc-def012345678' })).toBe(
        'Remove allergy · row a4c8e1ff…',
      );
    });
  });

  describe('medication_add', () => {
    it('renders "<name> <dose> · <frequency>"', () => {
      expect(formatPreview('medication_add', { name: 'Lisinopril', dose: '10mg', frequency: 'daily' })).toBe(
        'Lisinopril 10mg · daily',
      );
    });

    it('omits missing dose / frequency', () => {
      expect(formatPreview('medication_add', { name: 'Aspirin' })).toBe('Aspirin');
      expect(formatPreview('medication_add', { name: 'Aspirin', dose: '81mg' })).toBe('Aspirin 81mg');
      expect(formatPreview('medication_add', { name: 'Aspirin', frequency: 'qHS' })).toBe('Aspirin · qHS');
    });
  });

  describe('medication_discontinue', () => {
    it('uses UUID-prefix fallback', () => {
      expect(
        formatPreview('medication_discontinue', { medication_uuid: 'b4c8e1ff-1234-5678-9abc-def012345678' }),
      ).toBe('Discontinue · row b4c8e1ff…');
    });
  });

  describe('family_history_add', () => {
    it('formats "<relation>: <condition>" with capitalized relation', () => {
      expect(formatPreview('family_history_add', { relation: 'father', condition: 'heart attack' })).toBe(
        'Father: heart attack',
      );
    });
  });

  describe('document_delete', () => {
    it('uses UUID-prefix fallback (title not in payload)', () => {
      expect(formatPreview('document_delete', { docref_uuid: 'c4c8e1ff-1234-5678-9abc-def012345678' })).toBe(
        'Remove document · c4c8e1ff…',
      );
    });
  });

  describe('demographics_update', () => {
    it('lists the changed field names', () => {
      expect(
        formatPreview('demographics_update', { contact_phone: '555-...', address: '123 Main' }),
      ).toBe('Update contact_phone, address');
    });

    it('does not include the persisted preview field itself', () => {
      // Round-trip safety: re-formatting a payload that already has `preview`
      // (because it was stored that way) must not include `preview` in the
      // listed changed fields.
      expect(
        formatPreview('demographics_update', {
          contact_phone: '555-...',
          preview: 'should not echo back',
        }),
      ).toBe('Update contact_phone');
    });
  });

  describe('bundle (Phase 4 hook)', () => {
    it('uses a stored preview when present', () => {
      expect(
        formatPreview('bundle', {
          kind: 'bundle',
          preview: 'Demographics · 3 medications · 2 allergies',
        }),
      ).toBe('Demographics · 3 medications · 2 allergies');
    });

    it('falls back to a generic label when preview is missing', () => {
      expect(formatPreview('bundle', { kind: 'bundle', sections: [] })).toBe('Bundle proposal');
    });
  });

  describe('unknown target', () => {
    it('returns the raw target string as a last-resort legibility fallback', () => {
      expect(formatPreview('something_new', {})).toBe('something_new');
    });
  });
});
