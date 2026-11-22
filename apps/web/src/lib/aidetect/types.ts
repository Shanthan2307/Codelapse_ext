/**
 * The result of an outside AI-code detector (Codequiry), kept next to the
 * recording-based signals. Optional: only made when CODEQUIRY_API_KEY is set,
 * since it sends the submitted code to that company.
 */
export interface ExternalAiCheck {
  status: 'running' | 'ready' | 'failed';
  provider: 'codequiry';
  startedAt: number;
  finishedAt?: number;
  lastPolledAt?: number;
  error?: string;
  /** The detector's id for this check, used to poll for the result. */
  checkId?: number;
  /** 0-100, as the detector reports it. */
  averageAiProbability?: number;
  maxAiProbability?: number;
  /** The detector's own banding: high >= 70, medium 45-69, low < 45. */
  riskLevel?: 'high' | 'medium' | 'low';
  files: ExternalFileResult[];
}

export interface ExternalFileResult {
  path: string;
  aiProbability: number;
  classification?: string;
  summary?: string;
}
