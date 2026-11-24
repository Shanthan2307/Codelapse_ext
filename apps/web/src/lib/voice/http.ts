import { NextResponse } from 'next/server';
import { VoiceError } from './session';

/** A voice route's error as JSON: the message for expected problems, a generic one otherwise. */
export function voiceErrorResponse(err: unknown, what: string): NextResponse {
  if (err instanceof VoiceError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error(`${what} failed:`, err);
  return NextResponse.json({ error: 'Something went wrong on our side. Try again.' }, { status: 500 });
}
