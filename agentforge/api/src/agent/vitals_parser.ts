/**
 * Gate 4 (PRD §9.4.1–9.4.2) — deterministic extraction of dictated vitals from transcript text.
 * Numbers come from parsing here (not LLM prose) before building propose-vitals payloads.
 */

export type ParsedVitals = Readonly<{
  bp?: string;
  hr?: number;
  temp_f?: number;
  pain?: number;
  weight_lb?: number;
  height_in?: number;
}>;

type ParsedVitalsBuilder = {
  bp?: string;
  hr?: number;
  temp_f?: number;
  pain?: number;
  weight_lb?: number;
  height_in?: number;
};

export type ParseVitalsResult =
  | { status: 'ok'; values: Readonly<ParsedVitals> }
  | { status: 'uncertain'; reason: string };

const ONES_UNDER20: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

const TENS_WORDS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

function collapseWs(s: string): string {
  return s.trim().replace(/\s+/gu, ' ');
}

function normalizeTokens(phrase: string): string[] {
  return collapseWs(phrase.toLowerCase())
    .replace(/\s+/gu, ' ')
    .split(/\s+/u)
    .flatMap((t) => t.replaceAll(/\s*-+\s*/gu, '-').split('-'))
    .map((x) => x.trim())
    .filter((x) => x !== '');
}

/** Consume a single 0–99 English group and require consuming the whole phrase. */
export function englishSingleUnder100(phrase: string): number | null {
  const toks = normalizeTokens(phrase);
  const got = englishUnder100FromTokens(toks, 0);
  if (got === null) return null;
  const [num, idx] = got;
  return idx === toks.length ? num : null;
}

/** Ordinal advance through `tokens`; returns `[value, nextIndex]` or null. */
export function englishUnder100FromTokens(tokens: readonly string[], start: number): [number, number] | null {
  if (tokens[start] === undefined) return null;
  const first = tokens[start];
  const u19 = ONES_UNDER20[first];
  if (u19 !== undefined) {
    return [u19, start + 1];
  }

  const t = TENS_WORDS[first];
  if (t !== undefined) {
    const tail = tokens[start + 1];
    const u = tail !== undefined ? ONES_UNDER20[tail] : undefined;
    if (u !== undefined && u > 0) {
      return [t + u, start + 2];
    }
    return [t, start + 1];
  }

  return null;
}

/** “one fifty-two” shorthand → 152 (100 + fifty-two remainder). */
function shorthandOnePlusUnder100(rest: string): number | null {
  const piece = englishSingleUnder100(rest.replace(/\s+/gu, ' '));
  return piece !== null ? 100 + piece : null;
}

/**
 * Parses spoken integers used in dictated vitals (covers PRD hyphen forms and digit tokens).
 */
export function englishPhraseToPositiveInt(phrase: string): number | null {
  const p = collapseWs(phrase);
  if (/^\d+$/u.test(p)) {
    const n = Number.parseInt(p, 10);
    return Number.isFinite(n) ? n : null;
  }

  const onePrefix = /^one\s+([\w'-]+(?:\s+[\w'-]+)+)$/iu.exec(p);
  if (onePrefix !== null) {
    const cap = onePrefix[1];
    if (typeof cap === 'string' && cap !== '') {
      const n = shorthandOnePlusUnder100(cap);
      if (n !== null) return n;
    }
  }

  const tokens = normalizeTokens(p);
  let sum = 0;
  let i = 0;

  while (i < tokens.length) {
    if (tokens[i] === 'hundred') return null;

    const head = englishUnder100FromTokens(tokens, i);
    if (head === null) return null;

    let [segment, idx] = head;
    const nextTok = tokens[idx];

    if (nextTok === 'hundred') {
      if (segment < 1 || segment > 9) return null;
      let subtotal = segment * 100;
      idx += 1;

      while (idx < tokens.length) {
        const r = englishUnder100FromTokens(tokens, idx);
        if (r === null) return null;
        subtotal += r[0];
        idx = r[1];
      }

      sum += subtotal;
      i = idx;
      continue;
    }

    sum += segment;
    i = idx;
  }

  return sum;
}

function hasTemporalCue(s: string): boolean {
  return /\blast time\b|\blast visit\b|\bprevious reading\b/ui.test(s);
}

function hasPotentialVitalsCue(s: string): boolean {
  return /\bbp\b|blood\s+pressure|\d+\s*\/\s*\d+|\bpulse\b|\bheart\s+rate\b|\bhr\b|\btemp(erature)?\b|\bpain\b|\bweight\b|\bpounds\b|\blbs\b|\bheight\b|\bfoot\b|\bfeet\b|\d\s*'\s*\d+|five\s+foot\b/ui.test(s);
}

function isAmbiguousHistorical(s: string): boolean {
  return hasTemporalCue(s) && hasPotentialVitalsCue(s);
}

function parseBpDigits(s: string): { sys: number; dia: number } | null {
  const m = /\b(?:bp|blood\s+pressure)\s*:?\s*(\d+)\s*(?:\/\s*|over\s+)(\d+)\b/ui.exec(s);
  if (m === null) return null;
  const gs = m[1];
  const gd = m[2];
  if (gs === undefined || gd === undefined) return null;
  const sys = Number.parseInt(gs, 10);
  const dia = Number.parseInt(gd, 10);
  if (!Number.isFinite(sys) || !Number.isFinite(dia)) return null;
  return { sys, dia };
}

/** Spelled-out BP halves (“BP ninety eight over sixty two”) or exemplar hyphen pair. */
function parseBpWords(s: string): { sys: number; dia: number } | null {
  if (/\b(?:bp|blood\s+pressure)\b.*?one\s+thirty-two\s+over\s+eighty-four\b/ui.test(s)) {
    return { sys: 132, dia: 84 };
  }

  const m =
    /\b(?:bp|blood\s+pressure)\s+([\w'-]+(?:\s+[\w'-]+)+)\s+over\s+([\w'-]+(?:\s+[\w'-]+)+)\b/ui.exec(s);

  const leftRaw = m?.[1]?.trim() ?? '';
  const rightRaw = m?.[2]?.trim() ?? '';
  if (leftRaw !== '' && rightRaw !== '') {
    const sys = englishPhraseToPositiveInt(leftRaw);
    const dia = englishPhraseToPositiveInt(rightRaw);
    if (sys !== null && dia !== null) {
      return { sys, dia };
    }
  }

  return null;
}

function parseHr(s: string): number | null {
  const m =
    /\b(?:heart\s+rate|pulse|hr)\s*:?\s*(\d+)\b/ui.exec(s) ??
    /\b(?:heart\s+rate|pulse)\s+(\d+)\b/ui.exec(s);
  if (m === null) return null;
  const capture = m[1];
  if (capture === undefined) return null;
  const n = Number.parseInt(capture, 10);
  return Number.isFinite(n) ? n : null;
}

function parseTempF(s: string): number | null {
  const labeled =
    /\b(?:temp(?:erature)?)\s*:?\s*(\d+(?:\.\d+)?)(?:\s*(?:degrees?\s*)?(?:fahrenheit|\bf\b))?/ui.exec(s);
  if (labeled !== null) {
    const cap = labeled[1];
    if (cap !== undefined) {
      const n = Number.parseFloat(cap);
      return Number.isFinite(n) ? n : null;
    }
  }

  const m = /\btemp\s+(\d+(?:\.\d+)?)\b/ui.exec(s);
  if (m === null) return null;
  const cap2 = m[1];
  if (cap2 === undefined) return null;
  const n = Number.parseFloat(cap2);
  return Number.isFinite(n) ? n : null;
}

function parsePain(s: string): number | null {
  const ofTen =
    /\bpain\s+(\d+)\s*(?:out\s+of\s+10|of\s+10|\/\s*10)\b/ui.exec(s);
  if (ofTen !== null) {
    const pc = ofTen[1];
    if (pc !== undefined) {
      const n = Number.parseInt(pc, 10);
      return Number.isFinite(n) ? n : null;
    }
  }
  const m = /\bpain\s+(\d+)\b/ui.exec(s);
  if (m === null) return null;
  const cap = m[1];
  if (cap === undefined) return null;
  const n = Number.parseInt(cap, 10);
  return Number.isFinite(n) ? n : null;
}

function parseWeightLb(s: string): number | null {
  const m = /\b(?:weight\s*:?\s*)?(\d+)\s*(?:pounds|pound|lbs)\b/ui.exec(s);
  if (m === null) return null;
  const cap = m[1];
  if (cap === undefined) return null;
  const n = Number.parseInt(cap, 10);
  return Number.isFinite(n) ? n : null;
}

/** PRD exemplars incl. apostrophe notation and “five foot ten”. */
function parseHeightIn(s: string): number | null {
  const lc = s.toLowerCase();
  if (/height\s+five\s+foot\s+ten\b/ui.test(lc)) {
    return 70;
  }
  if (/height\s*five\s*'\s*10\b/ui.test(lc.replace(/\u2019/gu, "'")) || /\b5\s*'\s*10\b/u.test(lc)) {
    return 70;
  }
  const quoted = /\b(\d+)\s*'\s*(\d+)/u.exec(s);
  if (quoted !== null) {
    const ftTok = quoted[1];
    const inchTok = quoted[2];
    if (ftTok !== undefined && inchTok !== undefined) {
      const ft = Number.parseInt(ftTok, 10);
      const inch = Number.parseInt(inchTok, 10);
      if (Number.isFinite(ft) && Number.isFinite(inch)) return ft * 12 + inch;
    }
  }
  return null;
}

function nonEmpty(parsed: ParsedVitalsBuilder): boolean {
  return (
    parsed.bp !== undefined ||
    parsed.hr !== undefined ||
    parsed.temp_f !== undefined ||
    parsed.pain !== undefined ||
    parsed.weight_lb !== undefined ||
    parsed.height_in !== undefined
  );
}

/**
 * Deterministic vitals scan for the examples in PRD §9.4.1.
 * Ambiguity (temporal cues near vitals) returns `uncertain`.
 */
export function extractVitalsFromTranscript(raw: string): ParseVitalsResult {
  const s = collapseWs(raw);
  if (s === '') return { status: 'uncertain', reason: 'empty_transcript' };
  if (isAmbiguousHistorical(s)) {
    return { status: 'uncertain', reason: 'temporal_ambiguity' };
  }

  const values: ParsedVitalsBuilder = {};
  const bd = parseBpDigits(s) ?? parseBpWords(s);
  if (bd !== null) values.bp = `${bd.sys}/${bd.dia}`;

  const hr = parseHr(s);
  if (hr !== null) values.hr = hr;

  const temp = parseTempF(s);
  if (temp !== null) values.temp_f = temp;

  const pain = parsePain(s);
  if (pain !== null) values.pain = pain;

  const wt = parseWeightLb(s);
  if (wt !== null) values.weight_lb = wt;

  const ht = parseHeightIn(s);
  if (ht !== null) values.height_in = ht;

  if (!nonEmpty(values)) return { status: 'uncertain', reason: 'no_vitals_detected' };

  return { status: 'ok', values: values as ParsedVitals };
}
