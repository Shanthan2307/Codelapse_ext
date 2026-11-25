import { NextResponse } from 'next/server';
import { getVoiceSession } from '@/lib/voice/run';
import { synthesize } from '@/lib/voice/speech';

export const runtime = 'nodejs';
export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };

/** Longest text spoken in one request: the welcome plus the first question fits comfortably. */
const MAX_SPOKEN_CHARS = 1500;

/**
 * The tutor's latest lines as MP3: the tutor turns from index `from` to the
 * end of the conversation. Only text the tutor already said can be spoken,
 * so this cannot be used to read out anything else.
 */
export async function POST(request: Request, { params }: Params): Promise<Response> {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { from?: unknown };
  const from = typeof body.from === 'number' && Number.isInteger(body.from) ? body.from : -1;
  const stored = await getVoiceSession(id);
  const turns = stored?.session.turns ?? [];
  if (from < 0 || from >= turns.length || turns.slice(from).some((t) => t.role !== 'tutor')) {
    return NextResponse.json({ error: 'Nothing to say.' }, { status: 400 });
  }
  const text = turns
    .slice(from)
    .map((t) => t.text)
    .join(' ')
    .slice(0, MAX_SPOKEN_CHARS);
  try {
    const audio = await synthesize(text);
    return new Response(audio as unknown as BodyInit, {
      headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' }
    });
  } catch (err) {
    console.error('Speech synthesis failed:', err);
    return NextResponse.json({ error: 'The voice is unavailable right now.' }, { status: 502 });
  }
}
