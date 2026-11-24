import { NextResponse } from 'next/server';
import { getVoiceSession, startVoice } from '@/lib/voice/run';
import { voiceErrorResponse } from '@/lib/voice/http';
import { publicView } from '@/lib/voice/session';
import { voiceAvailable } from '@/lib/voice/speech';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

/** Whether a voice check can run, and the conversation so far. */
export async function GET(_request: Request, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const stored = await getVoiceSession(id);
  return NextResponse.json({ available: voiceAvailable(), session: stored ? publicView(stored.session) : null });
}

/** Starts the voice check (or returns the one already running). */
export async function POST(_request: Request, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  if (!voiceAvailable()) {
    return NextResponse.json({ error: 'The voice check is not available. Answer in writing instead.' }, { status: 503 });
  }
  try {
    return NextResponse.json({ session: publicView(await startVoice(id)) });
  } catch (err) {
    return voiceErrorResponse(err, 'Starting the voice check');
  }
}
