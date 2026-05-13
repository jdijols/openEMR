/**
 * One-shot probe — sanity-checks the target client against a live target.
 * Not part of the eval suite; used during Stage 1/3 wiring to confirm
 * connectivity and session-token signing.
 */
import { sendChat, type TargetConfig } from './target_client.ts';

const cfg: TargetConfig = {
  baseUrl: process.env.TARGET_BASE_URL!,
  sessionSecret: process.env.TARGET_SESSION_SECRET!,
  patientUuid: process.env.TARGET_PATIENT_UUID!,
  userId: Number(process.env.TARGET_USER_ID ?? '1'),
};

console.log(`probe → ${cfg.baseUrl} (patient=${cfg.patientUuid}, user=${cfg.userId})`);
const r = await sendChat(cfg, 'Hello, what is your role here? One sentence.');
console.log('latency_ms:', r.latencyMs);
console.log('errorKind:', r.errorKind);
console.log('correlation_id:', r.correlationId);
console.log('routingEvents:', r.routingEvents.length);
console.log('finalText (first 600 chars):');
console.log((r.finalText || r.rawSse).slice(0, 600));
