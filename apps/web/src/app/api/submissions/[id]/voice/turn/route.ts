import { NextResponse, after } from 'next/server';
import { runEvaluation } from '@/lib/evaluation/run';
import { speechContext, studentTurn } from '@/lib/voice/run';
import { MAX_STUDENT_TURN_CHARS, publicView, VoiceError } from '@/lib/voice/session';
import { audioExtension, isLikelyNoise, MAX_AUDIO_BYTES, sttConfig, transcribe, vocabularyPrompt } from '@/lib/voice/speech';
import { voiceErrorResponse } from '@/lib/voice/http';

export const runtime = 'nodejs';
// Transcription plus up to two tutor requests; normally a few seconds.
export const maxDuration = 120;

type Params = { params: Promise<{ id: string }> };

/**
 * One thing the student said: either a recording (multipart field "audio"),
 * which is transcribed and never stored, or typed text (JSON { text }).
 * Replies with what was heard and the conversation so far.
 */
export async function POST(request: Request, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  try {
    let text: string;
    let input: 'voice' | 'typed';
    let transcription = null;

    if ((request.headers.get('content-type') ?? '').startsWith('multipart/form-data')) {
      const form = await request.formData();
      const audio = form.get('audio');
      if (!(audio instanceof Blob) || audio.size === 0) throw new VoiceError('No recording was received.', 400);
      if (audio.size > MAX_AUDIO_BYTES) throw new VoiceError('That recording is too long. Try a shorter answer.', 413);
      if (!audioExtension(audio.type)) throw new VoiceError(`This browser recorded audio as ${audio.type || 'an unknown type'}, which can't be read. Type your answer instead.`, 415);
      const config = sttConfig();
      if (!config) throw new VoiceError('Speech recognition is not set up. Type your answer instead.', 503);
      const { code, language } = await speechContext(id);
      let heard;
      try {
        heard = await transcribe(config, new Uint8Array(await audio.arrayBuffer()), audio.type, vocabularyPrompt(code, language));
      } catch (err) {
        console.error('Transcription failed:', err);
        throw new VoiceError("Your answer couldn't be turned into text. Try again, or type it instead.", 502);
      }
      if (isLikelyNoise(heard.text)) {
        return NextResponse.json({ heard: '', retry: true });
      }
      text = heard.text;
      input = 'voice';
      transcription = { at: Date.now(), model: config.model, ms: heard.ms, audioBytes: audio.size, chars: heard.text.length };
    } else {
      const body = (await request.json().catch(() => ({}))) as { text?: unknown };
      text = typeof body.text === 'string' ? body.text.slice(0, MAX_STUDENT_TURN_CHARS) : '';
      input = 'typed';
      if (!text.trim()) throw new VoiceError('Type something first.', 400);
    }

    const session = await studentTurn(id, text, input, transcription);
    if (session.status === 'finished') {
      after(() => runEvaluation(id));
    }
    return NextResponse.json({ heard: text, session: publicView(session) });
  } catch (err) {
    return voiceErrorResponse(err, 'A voice turn');
  }
}
