'use client';

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { StudentQuestion } from '@/lib/questions/types';
import type { VoicePublic } from '@/lib/voice/types';
import { CodeExcerpts } from './CodeExcerpts';

/**
 * The voice check: the student talks with an AI tutor about their four
 * questions. No camera; the microphone records only while it is the
 * student's turn, and each turn is sent to be turned into text. When the
 * tutor speaks, an orb pulses with its voice; when the student speaks, waves
 * move with theirs.
 */

type Phase = 'intro' | 'starting' | 'speaking' | 'listening' | 'paused' | 'thinking' | 'typing' | 'finished';

/** Silence after speech that ends the student's turn. Long enough to pause and think mid-sentence. */
const END_OF_TURN_MS = 1800;
/** A turn this long is sent whatever happens. */
const MAX_TURN_MS = 90_000;
/** Speech must last this long before a turn counts as started (ignores clicks and coughs). */
const MIN_SPEECH_MS = 250;
const NO_ANSWER = '(No answer given.)';

export interface VoiceAnswers {
  answers: { questionId: string; text: string }[];
  submittedAt: number;
}

function answersOf(session: VoicePublic, questions: StudentQuestion[]): { questionId: string; text: string }[] {
  return questions.map((q) => {
    const said = session.turns.filter((t) => t.role === 'student' && t.questionId === q.id).map((t) => t.text);
    return { questionId: q.id, text: said.length > 0 ? said.join('\n') : NO_ANSWER };
  });
}

/** Index of the first tutor turn after the student's last turn: what the tutor has just said. */
function latestTutorStart(session: VoicePublic): number {
  let i = session.turns.length;
  while (i > 0 && session.turns[i - 1].role === 'tutor') i--;
  return i;
}

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const type of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

function timeLeft(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function VoiceCheck({
  submissionId,
  questions,
  closesAt,
  initialSession,
  onUseWriting,
  onFinished
}: {
  submissionId: string;
  questions: StudentQuestion[];
  closesAt: number;
  initialSession: VoicePublic | null;
  onUseWriting: () => void;
  onFinished: (result: VoiceAnswers) => void;
}) {
  const [phase, setPhase] = useState<Phase>('intro');
  const [session, setSession] = useState<VoicePublic | null>(initialSession);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState('');
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [now, setNow] = useState<number | null>(null);

  const sessionRef = useRef<VoicePublic | null>(initialSession);
  const typingRef = useRef(false);
  const levelRef = useRef(0);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const outAnalyserRef = useRef<AnalyserNode | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const vadTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const speakTokenRef = useRef(0);
  const unmountedRef = useRef(false);

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const updateSession = useCallback((next: VoicePublic) => {
    sessionRef.current = next;
    setSession(next);
  }, []);

  // ---- Levels for the animation ----

  const readLevel = (analyser: AnalyserNode | null): number => {
    if (!analyser) return 0;
    const data = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (const v of data) sum += v * v;
    return Math.sqrt(sum / data.length);
  };

  // ---- Listening ----

  const stopVad = () => {
    if (vadTimerRef.current) clearInterval(vadTimerRef.current);
    vadTimerRef.current = null;
  };

  const finishSession = useCallback(
    (final: VoicePublic) => {
      setPhase('finished');
      levelRef.current = 0;
      onFinished({ answers: answersOf(final, questions), submittedAt: Date.now() });
    },
    [onFinished, questions]
  );

  // Declared below; refs break the cycle between speaking, listening and sending.
  const speakFromRef = useRef<(from: number) => void>(() => undefined);
  const listenRef = useRef<() => void>(() => undefined);

  const handleReply = useCallback(
    async (response: Response) => {
      const json = (await response.json().catch(() => ({}))) as { error?: string; heard?: string; retry?: boolean; session?: VoicePublic };
      if (!response.ok) {
        setError(json.error ?? 'Something went wrong. Try again.');
        if (response.status === 410 || response.status === 409) {
          // Closed or already answered: reload shows the current state.
          if (/already|ended/i.test(json.error ?? '')) setTimeout(() => window.location.reload(), 2500);
        }
        if (typingRef.current) setPhase('typing');
        else listenRef.current();
        return;
      }
      if (json.retry || !json.session) {
        setNotice("I didn't catch that. Try saying it again.");
        if (typingRef.current) setPhase('typing');
        else listenRef.current();
        return;
      }
      setNotice(null);
      updateSession(json.session);
      speakFromRef.current(latestTutorStart(json.session));
    },
    [updateSession]
  );

  const sendAudio = useCallback(
    async (blob: Blob) => {
      setPhase('thinking');
      setError(null);
      const form = new FormData();
      const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
      form.append('audio', blob, `turn.${ext}`);
      try {
        await handleReply(await fetch(`/api/submissions/${submissionId}/voice/turn`, { method: 'POST', body: form }));
      } catch {
        setError('Your answer could not be sent. Check your connection and try again.');
        listenRef.current();
      }
    },
    [handleReply, submissionId]
  );

  const sendText = useCallback(async () => {
    const text = draft.trim();
    if (!text) {
      setError('Type your answer first.');
      return;
    }
    setPhase('thinking');
    setError(null);
    try {
      const response = await fetch(`/api/submissions/${submissionId}/voice/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      if (response.ok) setDraft('');
      await handleReply(response);
    } catch {
      setError('Your answer could not be sent. Check your connection and try again.');
      setPhase('typing');
    }
  }, [draft, handleReply, submissionId]);

  const stopRecording = useCallback((send: boolean) => {
    stopVad();
    const recorder = recorderRef.current;
    recorderRef.current = null;
    levelRef.current = 0;
    if (!recorder || recorder.state === 'inactive') return;
    (recorder as MediaRecorder & { sendOnStop?: boolean }).sendOnStop = send;
    recorder.stop();
  }, []);

  const listen = useCallback(() => {
    if (unmountedRef.current) return;
    const stream = streamRef.current;
    if (!stream || typingRef.current) {
      setPhase('typing');
      return;
    }
    const mimeType = pickMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch {
      setError("This browser can't record audio. Type your answers instead.");
      typingRef.current = true;
      setTyping(true);
      setPhase('typing');
      return;
    }
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
    recorder.onstop = () => {
      const send = (recorder as MediaRecorder & { sendOnStop?: boolean }).sendOnStop;
      if (send && chunks.length > 0) void sendAudio(new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' }));
    };
    recorderRef.current = recorder;
    recorder.start(250);
    setPhase('listening');

    // Voice activity: measure the room for a moment, then end the turn after a pause that follows speech.
    const started = Date.now();
    let floor = 0.01;
    let speechMs = 0;
    let lastVoice = 0;
    stopVad();
    vadTimerRef.current = setInterval(() => {
      const rms = readLevel(micAnalyserRef.current);
      const t = Date.now();
      if (t - started < 300) {
        floor = Math.max(floor, rms);
        levelRef.current = 0;
        return;
      }
      const threshold = Math.max(0.02, floor * 2.5);
      levelRef.current = Math.min(1, rms * 8);
      if (rms > threshold) {
        speechMs += 50;
        lastVoice = t;
      }
      const spoke = speechMs >= MIN_SPEECH_MS;
      if ((spoke && t - lastVoice > END_OF_TURN_MS) || t - started > MAX_TURN_MS) {
        stopRecording(spoke);
        if (!spoke) {
          setNotice("I didn't hear anything. Tap the microphone when you're ready.");
          setPhase('paused');
        }
      }
    }, 50);
  }, [sendAudio, stopRecording]);
  listenRef.current = listen;

  // ---- Speaking ----

  const afterSpeaking = useCallback(() => {
    const current = sessionRef.current;
    if (current?.status === 'finished') {
      finishSession(current);
    } else if (typingRef.current) {
      setPhase('typing');
    } else {
      listenRef.current();
    }
  }, [finishSession]);

  const speakFrom = useCallback(
    async (from: number) => {
      const token = ++speakTokenRef.current;
      setPhase('speaking');
      const current = sessionRef.current;
      const text = current?.turns.slice(from).map((t) => t.text).join(' ') ?? '';
      const audio = audioRef.current;
      try {
        const response = await fetch(`/api/submissions/${submissionId}/voice/speak`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from })
        });
        if (!response.ok || !audio) throw new Error('no audio');
        const url = URL.createObjectURL(await response.blob());
        if (token !== speakTokenRef.current) return;
        audio.src = url;
        audio.onended = () => {
          URL.revokeObjectURL(url);
          if (token === speakTokenRef.current) afterSpeaking();
        };
        await audio.play();
      } catch {
        // No voice from the server: use the browser's own, so the conversation can go on.
        if (token !== speakTokenRef.current) return;
        if (typeof window !== 'undefined' && 'speechSynthesis' in window && text) {
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.onend = () => token === speakTokenRef.current && afterSpeaking();
          utterance.onerror = () => token === speakTokenRef.current && afterSpeaking();
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(utterance);
        } else {
          afterSpeaking();
        }
      }
    },
    [afterSpeaking, submissionId]
  );
  speakFromRef.current = (from) => void speakFrom(from);

  const stopSpeaking = () => {
    speakTokenRef.current++;
    audioRef.current?.pause();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  };

  // ---- Start, repeat, interrupt, end ----

  const setUpAudio = useCallback(async (): Promise<boolean> => {
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = ctxRef.current ?? new AudioCtx();
    ctxRef.current = ctx;
    await ctx.resume();
    if (!audioRef.current) {
      const audio = new Audio();
      audio.crossOrigin = 'anonymous';
      audioRef.current = audio;
      const source = ctx.createMediaElementSource(audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      analyser.connect(ctx.destination);
      outAnalyserRef.current = analyser;
    }
    if (typingRef.current) return true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      streamRef.current = stream;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      micAnalyserRef.current = analyser;
      return true;
    } catch {
      return false;
    }
  }, []);

  async function start() {
    setError(null);
    setPhase('starting');
    const micOk = await setUpAudio();
    if (!micOk) {
      setError("The microphone isn't available, so you can type your answers to the tutor instead. To talk, allow microphone access for this site and reload the page.");
      typingRef.current = true;
      setTyping(true);
    }
    try {
      const response = await fetch(`/api/submissions/${submissionId}/voice`, { method: 'POST' });
      const json = (await response.json().catch(() => ({}))) as { error?: string; session?: VoicePublic };
      if (!response.ok || !json.session) {
        setError(json.error ?? 'The voice check could not start. Try again, or answer in writing.');
        setPhase('intro');
        return;
      }
      updateSession(json.session);
      if (json.session.status === 'finished') {
        finishSession(json.session);
        return;
      }
      void speakFrom(latestTutorStart(json.session));
    } catch {
      setError('The voice check could not start. Check your connection and try again.');
      setPhase('intro');
    }
  }

  function repeat() {
    const current = sessionRef.current;
    if (!current || phase === 'thinking') return;
    stopRecording(false);
    void speakFrom(latestTutorStart(current));
  }

  function interrupt() {
    if (phase !== 'speaking') return;
    stopSpeaking();
    afterSpeaking();
  }

  async function end() {
    setConfirmEnd(false);
    stopSpeaking();
    stopRecording(false);
    setPhase('thinking');
    try {
      const response = await fetch(`/api/submissions/${submissionId}/voice/finish`, { method: 'POST' });
      const json = (await response.json().catch(() => ({}))) as { error?: string; session?: VoicePublic };
      if (!response.ok || !json.session) {
        setError(json.error ?? 'The voice check could not be ended. Try again.');
        setPhase(typingRef.current ? 'typing' : 'paused');
        return;
      }
      updateSession(json.session);
      void speakFrom(latestTutorStart(json.session));
    } catch {
      setError('The voice check could not be ended. Check your connection and try again.');
      setPhase(typingRef.current ? 'typing' : 'paused');
    }
  }

  function switchToTyping(on: boolean) {
    if (on && !typing) {
      typingRef.current = true;
      setTyping(true);
      stopRecording(false);
      if (phase === 'listening' || phase === 'paused') setPhase('typing');
    } else if (!on && typing) {
      if (!streamRef.current) {
        setError('The microphone is not available. Allow microphone access for this site and reload the page.');
        return;
      }
      typingRef.current = false;
      setTyping(false);
      if (phase === 'typing') listen();
    }
  }

  // Release the microphone when leaving the page.
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      stopVad();
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioRef.current?.pause();
      void ctxRef.current?.close();
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    };
  }, []);

  // Stop listening once the student has finished.
  useEffect(() => {
    if (phase === 'finished') streamRef.current?.getTracks().forEach((t) => t.stop());
  }, [phase]);

  // ---- Rendering ----

  const total = questions.length;
  const index = Math.min(session?.questionIndex ?? 0, total - 1);
  const question = questions[index];
  const remaining = now === null ? null : closesAt - now;
  const lastTutor = session ? session.turns.slice(latestTutorStart(session)).map((t) => t.text).join(' ') : '';
  const lastStudent = session ? [...session.turns].reverse().find((t) => t.role === 'student') : undefined;
  const lastStudentShown = lastStudent && session && session.turns.lastIndexOf(lastStudent) === latestTutorStart(session) - 1;

  if (phase === 'intro' || phase === 'starting') {
    const resuming = !!session && session.status === 'active';
    return (
      <section className="card voice-intro">
        <div className="voice-intro-head">
          <span className="voice-intro-icon" aria-hidden="true">
            <MicIcon />
          </span>
          <div>
            <h2>Talk through your work</h2>
            <p className="muted">
              A short spoken conversation about your {total} questions, with an AI tutor. Usually about ten minutes.
            </p>
          </div>
        </div>
        <ul className="voice-intro-list">
          <li>The tutor asks each question out loud, and the code it is about is shown on screen.</li>
          <li>Ask it to repeat or explain a question any time. If you are stuck, it can give you a hint. It won&apos;t give you the answer.</li>
          <li>
            <strong>No camera.</strong> Your microphone is on only while it&apos;s your turn. What you say is turned into text by a
            speech recognition service; the audio is not kept. Your instructor reads the text of the conversation.
          </li>
          <li>You can type instead of talking at any point.</li>
        </ul>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="button" onClick={onUseWriting} disabled={phase === 'starting'}>
            Answer in writing instead
          </button>
          <button type="button" className="button button-primary" onClick={start} disabled={phase === 'starting'}>
            {phase === 'starting' ? 'Starting…' : resuming ? 'Continue the voice check' : 'Start the voice check'}
          </button>
        </div>
      </section>
    );
  }

  const stateLabel: Record<Phase, string> = {
    intro: '',
    starting: 'Starting…',
    speaking: 'Tutor is speaking · tap the circle to interrupt',
    listening: 'Listening… pause when you are done',
    paused: 'Microphone paused',
    thinking: 'Thinking…',
    typing: 'Type your answer below',
    finished: 'Finished'
  };

  return (
    <section className="card voice-check" aria-label="Voice check">
      <div className="voice-head">
        <div className="voice-title">
          <MicIcon />
          <strong>Voice check</strong>
        </div>
        <div className="voice-chips">
          <span className="voice-chip">{phase === 'finished' ? 'Done' : `Question ${index + 1} of ${total}`}</span>
          {phase !== 'finished' && (
            <span className="voice-chip" role="timer">
              Time left {remaining === null ? '–' : timeLeft(remaining)}
            </span>
          )}
        </div>
      </div>

      <div className="voice-body">
        <div className="voice-code">
          {question && question.excerpts.length > 0 ? (
            <>
              <p className="voice-code-label">The code this question is about</p>
              <CodeExcerpts excerpts={question.excerpts} />
            </>
          ) : (
            <p className="voice-code-label">
              This question is about what happened while you worked, such as your builds, so there is no code to show for it.
            </p>
          )}
        </div>

        <div className="voice-stage">
          <VoiceVisual
            mode={phase === 'listening' ? 'wave' : phase === 'speaking' ? 'orb' : phase === 'thinking' ? 'think' : 'idle'}
            levelRef={levelRef}
            outAnalyserRef={outAnalyserRef}
            onClick={interrupt}
          />
          <p className="voice-state" aria-live="polite">
            {stateLabel[phase]}
          </p>
          <p className="voice-caption">{lastTutor}</p>
          {lastStudentShown && lastStudent && (
            <p className="voice-heard">
              <span className="muted">You said:</span> {lastStudent.text}
            </p>
          )}
          {notice && <p className="voice-notice">{notice}</p>}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          {phase === 'finished' ? null : typing ? (
            <form
              className="voice-type"
              onSubmit={(e) => {
                e.preventDefault();
                void sendText();
              }}
            >
              <textarea
                className="answer-input"
                rows={3}
                maxLength={1500}
                value={draft}
                placeholder="Type what you would say…"
                onChange={(e) => {
                  setDraft(e.target.value);
                  if (error) setError(null);
                }}
                disabled={phase === 'thinking' || phase === 'speaking'}
                aria-label="Your answer"
              />
              <button type="submit" className="button button-primary" disabled={phase !== 'typing'}>
                Send
              </button>
            </form>
          ) : null}

          {phase !== 'finished' && (
            <div className="voice-controls">
              {phase === 'listening' && (
                <button type="button" className="button button-primary" onClick={() => stopRecording(true)}>
                  I&apos;m done
                </button>
              )}
              {phase === 'listening' && (
                <button type="button" className="button" onClick={() => { stopRecording(false); setPhase('paused'); }}>
                  Pause
                </button>
              )}
              {phase === 'paused' && (
                <button type="button" className="button button-primary" onClick={() => { setNotice(null); listen(); }}>
                  Tap to talk
                </button>
              )}
              <button type="button" className="button" onClick={repeat} disabled={phase === 'thinking'}>
                Repeat
              </button>
              <button type="button" className="button" onClick={() => switchToTyping(!typing)} disabled={phase === 'thinking'}>
                {typing ? 'Use microphone' : 'Type instead'}
              </button>
              <button type="button" className="button button-danger-text" onClick={() => setConfirmEnd(true)} disabled={phase === 'thinking'}>
                End
              </button>
            </div>
          )}

          {confirmEnd && (
            <div className="confirm-box" role="alertdialog" aria-label="Confirm ending the voice check">
              <p>
                <strong>End the voice check now?</strong> What you have said so far is saved as your answers, and you can&apos;t
                continue afterwards.
              </p>
              <div className="form-actions">
                <button type="button" className="button" onClick={() => setConfirmEnd(false)}>
                  Keep going
                </button>
                <button type="button" className="button button-primary" onClick={end}>
                  End and save
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {session && session.turns.length > 1 && (
        <details className="voice-transcript">
          <summary>Conversation so far</summary>
          <ol>
            {session.turns.map((t, i) => (
              <li key={i} className={t.role === 'tutor' ? 'voice-turn-tutor' : 'voice-turn-student'}>
                <span className="voice-turn-who">{t.role === 'tutor' ? 'Tutor' : 'You'}</span> {t.text}
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}

function MicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

/**
 * The animation: an orb that swells with the tutor's voice, waves that follow
 * the student's, a slow breathing orb with dots while thinking.
 */
function VoiceVisual({
  mode,
  levelRef,
  outAnalyserRef,
  onClick
}: {
  mode: 'orb' | 'wave' | 'think' | 'idle';
  levelRef: MutableRefObject<number>;
  outAnalyserRef: MutableRefObject<AnalyserNode | null>;
  onClick: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = 280;
    const H = 180;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);
    const styles = getComputedStyle(document.documentElement);
    const accent = styles.getPropertyValue('--c-accent').trim() || '#2360a5';
    const soft = styles.getPropertyValue('--c-subtle').trim() || '#7d8998';
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const data = new Float32Array(1024);
    let smooth = 0;
    let frame = 0;
    const t0 = performance.now();

    const outputLevel = () => {
      const analyser = outAnalyserRef.current;
      if (!analyser) return 0;
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < analyser.fftSize; i++) sum += data[i] * data[i];
      const rms = Math.sqrt(sum / analyser.fftSize);
      // Browser voice fallback has no analyser signal: keep the orb gently alive.
      return rms > 0.001 ? Math.min(1, rms * 6) : 0.25 + 0.15 * Math.sin((performance.now() - t0) / 140);
    };

    const draw = (now: number) => {
      const t = reduceMotion ? 0 : (now - t0) / 1000;
      const m = modeRef.current;
      const target = m === 'orb' ? outputLevel() : m === 'wave' ? levelRef.current : m === 'think' ? 0.12 : 0;
      smooth += (target - smooth) * 0.18;
      ctx.clearRect(0, 0, W, H);
      const cx = W / 2;
      const cy = H / 2;

      if (m === 'wave') {
        const lines: [string, number, number, number][] = [
          [accent, 1, 0, 2.2],
          [accent, 0.45, 1.7, 1.6],
          [soft, 0.35, 3.1, 1.2]
        ];
        for (const [color, alpha, phase, width] of lines) {
          ctx.strokeStyle = color;
          ctx.globalAlpha = alpha;
          ctx.lineWidth = width;
          ctx.beginPath();
          for (let x = 8; x <= W - 8; x += 2) {
            const envelope = Math.sin((Math.PI * (x - 8)) / (W - 16));
            const y = cy + envelope * (6 + smooth * 52) * Math.sin(x * 0.045 + t * 6 + phase) * Math.cos(x * 0.012 - t * 1.3 + phase);
            if (x === 8) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      } else {
        const breathing = m === 'think' || m === 'idle';
        const base = breathing ? 44 + (m === 'think' ? 4 * Math.sin(t * 2.2) : 0) : 46;
        const amp = breathing ? 0 : smooth * 16;
        for (let k = 3; k >= 1; k--) {
          ctx.globalAlpha = (m === 'idle' ? 0.07 : 0.12) * k;
          ctx.fillStyle = accent;
          ctx.beginPath();
          const r = base + amp * (1 + 0.35 * (3 - k)) + (breathing ? 0 : (3 - k) * 6 * smooth);
          for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.05) {
            const wobble = breathing ? 1.5 * Math.sin(a * 3 + t * 2) : 3 * smooth * Math.sin(a * 4 + t * 5 + k) + 2 * smooth * Math.sin(a * 6 - t * 4);
            const x = cx + (r + wobble) * Math.cos(a);
            const y = cy + (r + wobble) * Math.sin(a);
            if (a === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.fill();
        }
        ctx.globalAlpha = m === 'idle' ? 0.5 : 1;
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.arc(cx, cy, base * 0.82 + amp * 0.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        if (m === 'think') {
          ctx.fillStyle = '#ffffff';
          for (let i = 0; i < 3; i++) {
            ctx.globalAlpha = 0.55 + 0.45 * Math.max(0, Math.sin(t * 5 - i * 0.9));
            ctx.beginPath();
            ctx.arc(cx - 14 + i * 14, cy, 4, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
        }
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [levelRef, outAnalyserRef]);

  return (
    <canvas
      ref={canvasRef}
      className={`voice-visual voice-visual-${mode}`}
      style={{ width: 280, height: 180 }}
      onClick={onClick}
      role="img"
      aria-label={mode === 'orb' ? 'The tutor is speaking' : mode === 'wave' ? 'Listening to you' : 'Waiting'}
    />
  );
}
