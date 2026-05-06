// pdf-parse 1.1.1 ships no TypeScript declarations and no @types/pdf-parse
// package exists. We import the inner `lib/pdf-parse.js` directly to dodge
// the famous index.js debug-branch bug (see comment at the import site in
// agent/w2_tools.ts). This ambient declaration lets `tsc -p
// tsconfig.build.json` resolve the module; the typed shape is enforced by an
// `as unknown as { default?: ... }` cast at the call site.
declare module 'pdf-parse/lib/pdf-parse.js';
