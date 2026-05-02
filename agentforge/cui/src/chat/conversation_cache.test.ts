/**
 * Per-tab conversation payload cache — mirrors `brief_cache.test.ts`.
 * Covers read/write round-trip, TTL expiry, the 8-patient LRU cap,
 * sessionStorage failure tolerance, and isolation across patients.
 *
 * Adds one extra case relative to the brief cache: a proposal block
 * with a `resolved` field round-trips so reloads see resolved
 * proposals as resolved (the whole point of lifting `ProposalPhase`
 * out of the `ProposalBlock` component's local state).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  conversationPayloadStorageKey,
  readCachedConversation,
  writeCachedConversation,
  type CachedConversationPayload,
} from './conversation_cache.js';
import type { ChatMessage } from '../types/chat.js';

function samplePayload(text = 'Hello'): CachedConversationPayload {
  const messages: ChatMessage[] = [
    { role: 'user', blocks: [{ type: 'text', text }] },
    { role: 'assistant', blocks: [{ type: 'text', text: `re: ${text}` }] },
  ];
  return { messages };
}

afterEach(() => {
  window.sessionStorage.clear();
  vi.useRealTimers();
});

describe('conversation_cache', () => {
  it('returns null before any write', () => {
    expect(readCachedConversation('pat-A')).toBeNull();
  });

  it('round-trips a payload through sessionStorage', () => {
    const payload = samplePayload('round-trip');
    writeCachedConversation('pat-A', payload);
    const out = readCachedConversation('pat-A');
    expect(out).not.toBeNull();
    expect(out?.messages).toEqual(payload.messages);
  });

  it('round-trips a proposal block with its resolved field intact', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        blocks: [
          {
            type: 'proposal',
            proposal_id: 'prop-resolve-1',
            write_target: 'vitals',
            preview: 'BP 120/80',
            resolved: { phase: 'accepted' },
          },
        ],
      },
    ];
    writeCachedConversation('pat-A', { messages });
    const out = readCachedConversation('pat-A');
    expect(out?.messages[0]?.blocks[0]).toMatchObject({
      type: 'proposal',
      proposal_id: 'prop-resolve-1',
      resolved: { phase: 'accepted' },
    });
  });

  it('does not bleed across patients', () => {
    writeCachedConversation('pat-A', samplePayload('A'));
    expect(readCachedConversation('pat-B')).toBeNull();
  });

  it('expires past the 2-hour TTL', () => {
    const start = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(start);
    writeCachedConversation('pat-A', samplePayload('expires'));

    vi.setSystemTime(start + 2 * 60 * 60 * 1000 + 1);
    expect(readCachedConversation('pat-A')).toBeNull();
    expect(window.sessionStorage.getItem(conversationPayloadStorageKey('pat-A'))).toBeNull();
  });

  it('still returns a fresh entry just inside the TTL', () => {
    const start = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(start);
    writeCachedConversation('pat-A', samplePayload('fresh'));

    vi.setSystemTime(start + 2 * 60 * 60 * 1000 - 1);
    expect(readCachedConversation('pat-A')).not.toBeNull();
  });

  it('evicts the least-recently-written patient past the 8-patient cap', () => {
    for (let i = 0; i < 9; i++) {
      writeCachedConversation(`pat-${i}`, samplePayload(`b-${i}`));
    }
    expect(readCachedConversation('pat-0')).toBeNull();
    for (let i = 1; i < 9; i++) {
      expect(readCachedConversation(`pat-${i}`)).not.toBeNull();
    }
  });

  it('promotes a patient on rewrite so it is no longer the LRU eviction candidate', () => {
    for (let i = 0; i < 8; i++) {
      writeCachedConversation(`pat-${i}`, samplePayload(`b-${i}`));
    }
    writeCachedConversation('pat-0', samplePayload('refreshed'));
    writeCachedConversation('pat-new', samplePayload('new'));
    expect(readCachedConversation('pat-0')).not.toBeNull();
    expect(readCachedConversation('pat-1')).toBeNull();
  });

  it('returns null on corrupt JSON', () => {
    window.sessionStorage.setItem(conversationPayloadStorageKey('pat-A'), 'not-json');
    expect(readCachedConversation('pat-A')).toBeNull();
  });

  it('returns null when sessionStorage.getItem throws', () => {
    const original = window.sessionStorage.getItem;
    Object.defineProperty(window.sessionStorage, 'getItem', {
      configurable: true,
      value: () => {
        throw new Error('sessionStorage unavailable');
      },
    });
    try {
      expect(readCachedConversation('pat-A')).toBeNull();
    } finally {
      Object.defineProperty(window.sessionStorage, 'getItem', {
        configurable: true,
        value: original,
      });
    }
  });

  it('swallows write errors silently when sessionStorage is unavailable', () => {
    const original = window.sessionStorage.setItem;
    Object.defineProperty(window.sessionStorage, 'setItem', {
      configurable: true,
      value: () => {
        throw new Error('quota exceeded');
      },
    });
    try {
      expect(() => writeCachedConversation('pat-A', samplePayload())).not.toThrow();
    } finally {
      Object.defineProperty(window.sessionStorage, 'setItem', {
        configurable: true,
        value: original,
      });
    }
  });
});
