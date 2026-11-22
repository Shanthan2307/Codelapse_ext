import type { Language } from '../course';
import type { ExternalAiCheck, ExternalFileResult } from './types';
import { makeZip } from './zip';

/**
 * Client for Codequiry (codequiry.com), an AI-code and plagiarism detector for
 * universities, one of the few detectors that still accepts source code.
 *
 * The flow, from its API guide: create a check, upload a ZIP with one folder
 * per submission, start it, poll until it completes (2-10 minutes), then read
 * the AI results. Its documentation is inconsistent in places, so the parts
 * that vary are read defensively and the engine is configurable
 * (CODEQUIRY_TEST_TYPE). Verify with a real key before relying on it.
 */

const BASE_URL = 'https://codequiry.com/api/v1';
const REQUEST_TIMEOUT_MS = 20_000;

/** Codequiry's language ids (GET /languages). */
const LANGUAGE_IDS: Record<Language, number> = { c: 16, python: 14 };

/** check.status_id values. */
const STATUS_FAILED = 3;
const STATUS_COMPLETED = 4;

export interface CodequiryConfig {
  apiKey: string;
  testType: number;
  fetch?: typeof fetch;
}

export function codequiryConfig(env: NodeJS.ProcessEnv = process.env): CodequiryConfig | null {
  const apiKey = env.CODEQUIRY_API_KEY?.trim();
  if (!apiKey) return null;
  const testType = Number(env.CODEQUIRY_TEST_TYPE ?? 1);
  return { apiKey, testType: Number.isInteger(testType) && testType > 0 ? testType : 1 };
}

async function call(config: CodequiryConfig, path: string, body: Record<string, unknown> | FormData): Promise<Record<string, unknown>> {
  const doFetch = config.fetch ?? fetch;
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const response = await doFetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { apikey: config.apiKey, Accept: 'application/json', ...(isForm ? {} : { 'Content-Type': 'application/json' }) },
    body: isForm ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  const text = await response.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    // Not JSON: reported below with the status.
  }
  if (!response.ok) {
    const message = typeof json.message === 'string' ? json.message : typeof json.error === 'string' ? json.error : text.slice(0, 200);
    throw new Error(`Codequiry ${path} answered ${response.status}: ${message}`);
  }
  return json;
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};

/** Creates a check, uploads the code and starts it; returns the check id to poll. */
export async function startCodequiryCheck(
  config: CodequiryConfig,
  input: { submissionId: string; language: Language; files: { name: string; content: string }[] }
): Promise<number> {
  // The check is named by submission id only: no student names leave the site.
  const created = await call(config, '/check/create', { name: `codelapse-${input.submissionId}`, language: LANGUAGE_IDS[input.language] });
  const checkId = num(created.id) ?? num(obj(created.check).id) ?? num(obj(created.data).id);
  if (checkId === undefined) throw new Error('Codequiry did not return a check id.');

  // One folder per submission; the folder name becomes the submission name.
  const encoder = new TextEncoder();
  const zip = makeZip(input.files.map((f) => ({ name: `submission/${f.name}`, bytes: encoder.encode(f.content) })));
  const form = new FormData();
  form.append('check_id', String(checkId));
  form.append('file', new Blob([zip as BlobPart], { type: 'application/zip' }), 'submission.zip');
  await call(config, '/check/upload', form);

  await call(config, '/check/start', { check_id: checkId, test_type: config.testType });
  return checkId;
}

/**
 * Asks how a running check is doing. Returns the finished check when it is
 * done (ready or failed), or null while it is still running.
 */
export async function pollCodequiryCheck(config: CodequiryConfig, current: ExternalAiCheck, now = Date.now()): Promise<ExternalAiCheck | null> {
  if (current.checkId === undefined) return { ...current, status: 'failed', error: 'No Codequiry check id was saved.', finishedAt: now };
  const got = await call(config, '/check/get', { check_id: current.checkId });
  const statusId = num(obj(got.check).status_id) ?? num(got.status_id);
  if (statusId === STATUS_FAILED) {
    return { ...current, status: 'failed', error: 'Codequiry reported that the check failed.', finishedAt: now, lastPolledAt: now };
  }
  if (statusId !== STATUS_COMPLETED) return null;

  const results = await call(config, '/ai-results', { assignment_id: current.checkId });
  return { ...current, ...readAiResults(results), status: 'ready', finishedAt: now, lastPolledAt: now };
}

/** Reads the AI part of Codequiry's /ai-results answer. */
export function readAiResults(results: Record<string, unknown>): Pick<ExternalAiCheck, 'averageAiProbability' | 'maxAiProbability' | 'riskLevel' | 'files'> {
  const submissions = Array.isArray(results.submissions) ? results.submissions.map(obj) : [];
  const detection = submissions.map((s) => obj(s.ai_detection)).find((d) => Object.keys(d).length > 0) ?? {};
  const files: ExternalFileResult[] = (Array.isArray(detection.files) ? detection.files.map(obj) : [])
    .map((f) => ({
      path: String(f.file_path ?? f.filename ?? '').split('/').pop() ?? '',
      aiProbability: num(f.ai_probability) ?? 0,
      ...(typeof f.classification === 'string' ? { classification: f.classification } : {}),
      ...(typeof f.summary === 'string' && f.summary ? { summary: f.summary } : {})
    }))
    .filter((f) => f.path);
  const risk = String(detection.risk_level ?? '').toLowerCase();
  return {
    averageAiProbability: num(detection.avg_ai_probability),
    maxAiProbability: num(detection.max_ai_probability),
    ...(risk === 'high' || risk === 'medium' || risk === 'low' ? { riskLevel: risk } : {}),
    files
  };
}
