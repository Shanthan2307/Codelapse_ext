import OpenAI, { toFile } from 'openai';
import { FEATHERLESS_BASE_URL } from '../ai/featherless';
import { joinMp3Segments } from './mp3';

/**
 * Speech for the voice check. Featherless has no speech-to-text model, so
 * transcription goes to any service with an OpenAI-compatible
 * /audio/transcriptions endpoint (Groq by default); the tutor's voice comes
 * from a text-to-speech model on Featherless.
 */

/** Largest recording accepted for one student turn (a minute of speech is well under 1 MB). */
export const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
export const SPEECH_TIMEOUT_MS = 30_000;

export interface SttConfig {
  name: string;
  baseURL: string;
  apiKey: string;
  model: string;
}

const STT_PRESETS: Record<string, { name: string; baseURL: string; key: string; model: string }> = {
  groq: { name: 'Groq', baseURL: 'https://api.groq.com/openai/v1', key: 'GROQ_API_KEY', model: 'whisper-large-v3-turbo' },
  openai: { name: 'OpenAI', baseURL: 'https://api.openai.com/v1', key: 'OPENAI_API_KEY', model: 'gpt-4o-mini-transcribe' }
};

/**
 * Where transcription goes. CODELAPSE_STT_PROVIDER picks "groq", "openai" or
 * "custom" (CODELAPSE_STT_BASE_URL and CODELAPSE_STT_API_KEY); without it,
 * Groq is used when GROQ_API_KEY is set. CODELAPSE_STT_MODEL overrides the
 * model. Null when nothing is configured: the voice check is then unavailable.
 */
export function sttConfig(env: NodeJS.ProcessEnv = process.env): SttConfig | null {
  const chosen = env.CODELAPSE_STT_PROVIDER?.trim().toLowerCase() || (env.GROQ_API_KEY ? 'groq' : env.CODELAPSE_STT_API_KEY ? 'custom' : '');
  if (chosen === 'custom') {
    if (!env.CODELAPSE_STT_BASE_URL || !env.CODELAPSE_STT_API_KEY || !env.CODELAPSE_STT_MODEL) return null;
    return { name: 'custom', baseURL: env.CODELAPSE_STT_BASE_URL, apiKey: env.CODELAPSE_STT_API_KEY, model: env.CODELAPSE_STT_MODEL };
  }
  const preset = STT_PRESETS[chosen];
  const apiKey = preset ? env[preset.key] : undefined;
  if (!preset || !apiKey) return null;
  return { name: preset.name, baseURL: preset.baseURL, apiKey, model: env.CODELAPSE_STT_MODEL || preset.model };
}

/** Text-to-speech on Featherless. CODELAPSE_TTS_MODEL and CODELAPSE_TTS_VOICE override the defaults. */
export function ttsConfig(env: NodeJS.ProcessEnv = process.env): { model: string; voice: string } | null {
  if (!env.FEATHERLESS_API_KEY) return null;
  return { model: env.CODELAPSE_TTS_MODEL || 'hexgrad/Kokoro-82M', voice: env.CODELAPSE_TTS_VOICE || 'af_heart' };
}

/** True when the site can run a voice check: a tutor model, transcription and a voice. */
export function voiceAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CODELAPSE_VOICE !== 'off' && !!env.FEATHERLESS_API_KEY && sttConfig(env) !== null;
}

const EXTENSIONS: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav'
};

/** File extension for a recording's MIME type ("audio/webm;codecs=opus" is webm). */
export function audioExtension(mimeType: string): string | null {
  return EXTENSIONS[mimeType.split(';')[0].trim().toLowerCase()] ?? null;
}

/**
 * Names that help the recogniser spell code words: the identifiers in the
 * student's code, most frequent first. Whisper-style models take a short
 * text prompt of vocabulary.
 */
export function vocabularyPrompt(code: { content: string }[], language: string, limit = 40): string {
  const counts = new Map<string, number>();
  for (const file of code) {
    for (const word of file.content.match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) ?? []) {
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  const names = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([w]) => w);
  return `A student explains their ${language} code. Words used: ${names.join(', ')}.`;
}

/**
 * Lines speech recognisers are known to invent from silence or noise. A turn
 * that is only one of these is treated as nothing said.
 */
const HALLUCINATIONS = [
  'thank you',
  'thanks for watching',
  'thank you for watching',
  'thank you very much',
  'you',
  'bye',
  'subtitles by the amara.org community',
  'please subscribe'
];

export function isLikelyNoise(text: string): boolean {
  const t = text.toLowerCase().replace(/[^a-z. ]/g, '').replace(/\.+$/, '').trim();
  return t === '' || HALLUCINATIONS.includes(t);
}

export async function transcribe(
  config: SttConfig,
  audio: Uint8Array,
  mimeType: string,
  prompt: string
): Promise<{ text: string; ms: number }> {
  const extension = audioExtension(mimeType);
  if (!extension) throw new Error(`Unsupported audio type: ${mimeType}`);
  const client = new OpenAI({ baseURL: config.baseURL, apiKey: config.apiKey, timeout: SPEECH_TIMEOUT_MS, maxRetries: 1 });
  const started = Date.now();
  const result = await client.audio.transcriptions.create({
    file: await toFile(audio, `turn.${extension}`, { type: mimeType.split(';')[0] }),
    model: config.model,
    language: 'en',
    prompt
  });
  return { text: (result.text ?? '').trim(), ms: Date.now() - started };
}

/** The tutor's line as MP3 audio. */
export async function synthesize(text: string, config = ttsConfig()): Promise<Uint8Array> {
  if (!config) throw new Error('FEATHERLESS_API_KEY is not set.');
  const client = new OpenAI({ baseURL: FEATHERLESS_BASE_URL, apiKey: process.env.FEATHERLESS_API_KEY, timeout: SPEECH_TIMEOUT_MS, maxRetries: 1 });
  const response = await client.audio.speech.create({
    model: config.model,
    voice: config.voice as 'alloy',
    input: text,
    response_format: 'mp3'
  });
  // One MP3 per sentence comes back; join them so every browser plays the whole line.
  return joinMp3Segments(new Uint8Array(await response.arrayBuffer()));
}
