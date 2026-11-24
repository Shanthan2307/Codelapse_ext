import { NextResponse, after } from 'next/server';
import { runEvaluation } from '@/lib/evaluation/run';
import { finishVoice } from '@/lib/voice/run';
import { publicView } from '@/lib/voice/session';
import { voiceErrorResponse } from '@/lib/voice/http';

export const runtime = 'nodejs';
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

/** The student ends the voice check early. What they said so far becomes their answers. */
export async function POST(_request: Request, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  try {
    const session = await finishVoice(id);
    after(() => runEvaluation(id));
    return NextResponse.json({ session: publicView(session) });
  } catch (err) {
    return voiceErrorResponse(err, 'Ending the voice check');
  }
}
