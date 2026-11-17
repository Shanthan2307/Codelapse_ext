/**
 * Longest wait for one AI request. A hosted function (Vercel) stops after
 * 300 s, and each step may try twice, so one try must stay well under half
 * of that.
 */
export const AI_REQUEST_TIMEOUT_MS = 2 * 60 * 1000;

/** A step still "pending" after this long was cut off (for example by the host's time limit). */
export const STALLED_AFTER_MS = 10 * 60 * 1000;
