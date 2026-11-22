import { findAssignment } from '../course';
import { backend } from '../storage';
import { SAFE_ID } from '../storage/types';
import { getSubmission, readAllSubmittedCode } from '../store';
import { CodequiryConfig, codequiryConfig, pollCodequiryCheck, startCodequiryCheck } from './codequiry';
import type { ExternalAiCheck } from './types';

/** Poll at most this often, however often the instructor page reloads. */
const POLL_EVERY_MS = 30_000;
/** Codequiry says checks take 2-10 minutes; give up well after that. */
const GIVE_UP_AFTER_MS = 45 * 60_000;

export function externalDetectorEnabled(): boolean {
  return codequiryConfig() !== null;
}

export async function getExternalAiCheck(id: string): Promise<ExternalAiCheck | null> {
  if (!SAFE_ID.test(id)) return null;
  return (await backend().getDoc<ExternalAiCheck>(id, 'ai_detection'))?.data ?? null;
}

function save(id: string, check: ExternalAiCheck): Promise<void> {
  return backend().putDoc(id, 'ai_detection', check);
}

/** Sends the submitted code to the outside detector, if one is set up. Runs after the upload reply; never throws. */
export async function startExternalAiCheck(id: string, config: CodequiryConfig | null = codequiryConfig()): Promise<void> {
  if (!config) return;
  const startedAt = Date.now();
  try {
    const record = await getSubmission(id);
    const assignment = record ? findAssignment(record.assignmentId) : undefined;
    if (!record || !assignment) return;
    const files = await readAllSubmittedCode(record);
    const checkId = await startCodequiryCheck(config, { submissionId: id, language: assignment.language, files });
    await save(id, { status: 'running', provider: 'codequiry', startedAt, checkId, files: [] });
  } catch (err) {
    console.error(`External AI check for ${id} could not start:`, err);
    await save(id, {
      status: 'failed',
      provider: 'codequiry',
      startedAt,
      finishedAt: Date.now(),
      error: err instanceof Error ? err.message : String(err),
      files: []
    }).catch(() => undefined);
  }
}

/**
 * The stored result, after asking the detector for news if it is still
 * running and was not asked recently. Called when the instructor opens the
 * submission; never throws.
 */
export async function refreshExternalAiCheck(id: string, now = Date.now(), config: CodequiryConfig | null = codequiryConfig()): Promise<ExternalAiCheck | null> {
  const current = await getExternalAiCheck(id).catch(() => null);
  if (!current || current.status !== 'running' || !config) return current;
  if (current.lastPolledAt && now - current.lastPolledAt < POLL_EVERY_MS) return current;
  if (now - current.startedAt > GIVE_UP_AFTER_MS) {
    const failed: ExternalAiCheck = { ...current, status: 'failed', error: 'Codequiry did not finish within 45 minutes.', finishedAt: now };
    await save(id, failed).catch(() => undefined);
    return failed;
  }
  try {
    const next = (await pollCodequiryCheck(config, current, now)) ?? { ...current, lastPolledAt: now };
    await save(id, next);
    return next;
  } catch (err) {
    console.error(`Polling the external AI check for ${id} failed:`, err);
    const next = { ...current, lastPolledAt: now };
    await save(id, next).catch(() => undefined);
    return next;
  }
}
