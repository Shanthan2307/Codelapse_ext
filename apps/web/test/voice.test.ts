import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { processSubmission } from '../src/lib/processSubmission';
import { findAssignment } from '../src/lib/course';
import { generateQuestions } from '../src/lib/questions/generate';
import type { QuestionModel } from '../src/lib/questions/model';
import type { GeneratorOutput } from '../src/lib/questions/schema';
import type { QuestionSet } from '../src/lib/questions/types';
import type { SubmissionRecord } from '../src/lib/types';
import { buildEvaluatorPrompt } from '../src/lib/evaluation/prompt';
import { MemoryBackend } from '../src/lib/storage/memory';
import { useBackend } from '../src/lib/storage';
import { getAnswers, getEvaluation, saveQuestionSet, saveSubmission } from '../src/lib/store';
import {
  addStudentTurn,
  answersFromSession,
  applyTutorReply,
  closeSession,
  LIMITS,
  NO_ANSWER,
  publicView,
  spokenText,
  startSession,
  VoiceError
} from '../src/lib/voice/session';
import { buildTutorPrompt } from '../src/lib/voice/prompt';
import { checkTutorReply } from '../src/lib/voice/validate';
import { audioExtension, isLikelyNoise, sttConfig, vocabularyPrompt, voiceAvailable } from '../src/lib/voice/speech';
import { joinMp3Segments } from '../src/lib/voice/mp3';
import { finishVoice, getVoiceSession, startVoice, studentTurn } from '../src/lib/voice/run';
import type { TutorModel } from '../src/lib/voice/tutor';
import type { TutorMove } from '../src/lib/voice/types';
import { needsInstructor } from '../src/proxy';

const RECORDINGS = path.resolve(__dirname, '../../../fixtures/recordings');
const DIR = path.join(RECORDINGS, 'honest-incremental');
const CODE = fs.readFileSync(path.join(DIR, 'submission', 'reverse.c'));

function record(): SubmissionRecord {
  return processSubmission({
    studentId: 'student-a',
    assignmentId: 'a3-reverse',
    bundle: { name: 'x.codelapse', bytes: fs.readFileSync(path.join(DIR, 'honest-incremental.codelapse')) },
    codeFiles: [{ name: 'reverse.c', bytes: CODE }]
  });
}

async function questionSet(rec: SubmissionRecord): Promise<QuestionSet> {
  const m1 = rec.moments.find((m) => m.kind === 'fix-after-failed-run')!;
  const m2 = rec.moments.find((m) => m.id !== m1.id)!;
  let n = 0;
  const q = (type: 'process' | 'code', extra: object) => ({
    type,
    moment_id: null,
    code_ref: null,
    concept: 'loops',
    question: `Why did you write \`part ${++n}\` this way?`,
    rationale: 'Checks the reasoning.',
    strong_answer_points: ['the loop stops halfway so each pair is swapped once'],
    ...extra
  });
  const generated: GeneratorOutput = {
    questions: [
      q('process', { moment_id: m1.id }),
      q('process', { moment_id: m2.id }),
      q('code', { code_ref: { file: 'reverse.c', start_line: 4, end_line: 6 } }),
      q('code', { code_ref: { file: 'reverse.c', start_line: 12, end_line: 14 } })
    ] as GeneratorOutput['questions'],
    notes_for_instructor: null
  };
  const writer: QuestionModel = { provider: 'test', model: 'scripted', generate: async () => ({ output: generated }) };
  const assignment = findAssignment('a3-reverse')!;
  const set = await generateQuestions(
    { record: rec, assignmentTitle: assignment.title, assignmentDescription: assignment.description, code: [{ name: 'reverse.c', content: CODE.toString('utf-8') }] },
    writer
  );
  assert.strictEqual(set.status, 'ready', set.error);
  return set;
}

/** A tutor that replies from a script, and remembers the prompts it was given. */
function scriptedTutor(replies: unknown[]): TutorModel & { prompts: { system: string; user: string }[] } {
  const prompts: { system: string; user: string }[] = [];
  return {
    provider: 'featherless',
    model: 'scripted',
    prompts,
    async reply(prompt) {
      prompts.push(prompt);
      const next = replies.shift();
      if (next instanceof Error) throw next;
      return { output: next as { say: string; move: TutorMove } };
    }
  };
}

describe('voice check: conversation rules', () => {
  let set: QuestionSet;
  before(async () => {
    set = await questionSet(record());
  });

  it('opens with a welcome and the first question, read without markdown', () => {
    const s = startSession(set, 'm', 'tutor-v1', 1000);
    assert.strictEqual(s.status, 'active');
    assert.strictEqual(s.turns.length, 1);
    assert.match(s.turns[0].text, /Question 1 of 4\. Why did you write part 1 this way\?$/);
    assert.ok(!s.turns[0].text.includes('`'));
    assert.match(s.turns[0].text, /won't give you answers/);
    assert.deepStrictEqual(Object.keys(s.progress), set.questions.map((q) => q.id));
  });

  it('reads the next question word for word when the tutor moves on, and closes after the last', () => {
    let s = startSession(set, 'm', 'v', 0);
    for (let i = 0; i < set.questions.length; i++) {
      s = addStudentTurn(set, s, `answer ${i + 1}`, 'voice', i);
      s = applyTutorReply(set, s, { say: 'Thanks.', move: 'next' }, i);
    }
    assert.strictEqual(s.status, 'finished');
    assert.strictEqual(s.endedBy, 'completed');
    const asks = s.turns.filter((t) => t.kind === 'ask').map((t) => t.text);
    assert.strictEqual(asks.length, 4);
    assert.match(asks[1], /^Question 2 of 4\. Why did you write part 2 this way\?$/);
    assert.match(asks[3], /^Last question\./);
    assert.strictEqual(s.turns[s.turns.length - 1].kind, 'close');
    assert.throws(() => addStudentTurn(set, s, 'more', 'voice', 9), VoiceError);
  });

  it('moves on when the tutor would go past a limit, replacing its line', () => {
    let s = startSession(set, 'm', 'v', 0);
    const q1 = set.questions[0].id;
    for (let i = 0; i < LIMITS.followUps; i++) {
      s = addStudentTurn(set, s, 'not sure', 'voice', i);
      s = applyTutorReply(set, s, { say: 'Can you say more?', move: 'follow_up' }, i);
    }
    assert.strictEqual(s.progress[q1].followUps, LIMITS.followUps);
    assert.strictEqual(s.questionIndex, 0);
    s = addStudentTurn(set, s, 'still not sure', 'voice', 5);
    s = applyTutorReply(set, s, { say: 'Can you say even more about the loop?', move: 'follow_up' }, 5);
    assert.strictEqual(s.questionIndex, 1, 'a third follow-up becomes "next"');
    const moved = s.turns.filter((t) => t.questionId === q1 && t.kind === 'next');
    assert.strictEqual(moved.length, 1);
    assert.ok(!moved[0].text.includes('loop'), 'the model line written to continue is not spoken');
  });

  it('turns the conversation into answers: each question\'s student turns, plus the transcript', () => {
    let s = startSession(set, 'm', 'v', 0);
    s = addStudentTurn(set, s, 'I am stuck', 'voice', 1);
    s = applyTutorReply(set, s, { say: 'What did the compiler say?', move: 'hint' }, 2);
    s = addStudentTurn(set, s, '  it wanted a ; after the declaration  ', 'typed', 3);
    s = applyTutorReply(set, s, { say: 'Thanks.', move: 'next' }, 4);
    s = closeSession(set, s, 'student', 5);
    const answers = answersFromSession(set, s, 6);
    assert.strictEqual(answers.mode, 'voice');
    assert.strictEqual(answers.answers[0].text, 'I am stuck\nit wanted a ; after the declaration');
    assert.strictEqual(answers.answers[1].text, NO_ANSWER);
    assert.strictEqual(answers.answers[3].text, NO_ANSWER);
    const c = answers.conversations![0];
    assert.strictEqual(c.hints, 1);
    assert.deepStrictEqual(
      c.turns.map((t) => `${t.role}:${t.kind ?? ''}`),
      ['tutor:ask', 'student:', 'tutor:hint', 'student:', 'tutor:next']
    );
    const view = publicView(s);
    assert.ok(!('log' in view) && !('progress' in view), 'the browser never gets prompts or counters');
  });
});

describe('voice check: tutor replies', () => {
  let set: QuestionSet;
  before(async () => {
    set = await questionSet(record());
  });
  const check = (say: string, move = 'hint') => checkTutorReply({ say, move }, set.questions[0]);

  it('accepts a short question-style hint and cleans it for speech', () => {
    const r = check('What does `strlen` return for an *empty* string?');
    assert.deepStrictEqual(r.problems, []);
    assert.strictEqual(r.say, 'What does strlen return for an empty string?');
    assert.strictEqual(spokenText('Why does `count_vowels` call `tolower`?'), 'Why does count_vowels call tolower?');
  });

  it('rejects code, personal questions, long speeches, unknown moves and the private notes', () => {
    assert.ok(check('Try writing for (i = 0; i < n; i++) instead.').problems.some((p) => p.includes('code')));
    assert.ok(check('Before we go on, what is your student ID?').problems.some((p) => p.includes('personal')));
    assert.ok(check('word '.repeat(60)).problems.some((p) => p.includes('longer')));
    assert.ok(check('Okay.', 'answer').problems.some((p) => p.includes('move')));
    assert.ok(
      check('Think about how the loop stops halfway so each pair is swapped once.').problems.some((p) => p.includes('private'))
    );
  });

  it('gives the tutor the question, its notes, the conversation and the moves left', () => {
    let s = startSession(set, 'm', 'v', 0);
    s = addStudentTurn(set, s, 'Can you explain the question?', 'voice', 1);
    const q = set.questions[0];
    const prompt = buildTutorPrompt({
      assignmentTitle: 'A3',
      code: [{ name: 'reverse.c', content: CODE.toString('utf-8') }],
      moments: record().moments,
      question: q,
      questionNumber: 1,
      questionCount: 4,
      turns: s.turns,
      progress: s.progress[q.id]
    });
    assert.match(prompt.system, /Never give the answer/);
    assert.match(prompt.system, /personal information/);
    assert.ok(prompt.user.includes(q.text));
    assert.ok(prompt.user.includes('<question_notes>'));
    assert.ok(prompt.user.includes('Student: Can you explain the question?'));
    assert.match(prompt.user, /hint 2 of 2 left/);
    assert.match(prompt.user, /What happened:/, 'a process question carries its evidence');
  });
});

describe('voice check: answer review', () => {
  it('shows the reviewer the conversation and how to weigh hints, only for voice answers', async () => {
    const rec = record();
    const set = await questionSet(rec);
    let s = startSession(set, 'm', 'v', 0);
    s = addStudentTurn(set, s, 'no idea', 'voice', 1);
    s = applyTutorReply(set, s, { say: 'What did the build say?', move: 'hint' }, 2);
    s = addStudentTurn(set, s, 'it said expected a semicolon', 'voice', 3);
    const answers = answersFromSession(set, closeSession(set, s, 'student', 4), 5);
    const context = { questions: set, answers, moments: rec.moments, code: [{ name: 'reverse.c', content: CODE.toString('utf-8') }], assignmentTitle: 'A3' };
    const voice = buildEvaluatorPrompt(context);
    assert.match(voice.system, /given out loud/);
    assert.ok(voice.user.includes('<conversation hints="1" follow_ups="0">'));
    assert.ok(voice.user.includes('Tutor (hint): What did the build say?'));
    const written = buildEvaluatorPrompt({ ...context, answers: { submittedAt: 1, answers: answers.answers } });
    assert.ok(!written.system.includes('given out loud'));
    assert.ok(!written.user.includes('<conversation'));
  });
});

describe('voice check: joining the tutor audio', () => {
  // MPEG-2 Layer III, 64 kbps, 24 kHz, mono: 192-byte frames, as Kokoro sends.
  const FRAME = 192;
  function frame(fill: number, xing?: { frames: number; bytes: number }): Uint8Array {
    const f = new Uint8Array(FRAME).fill(fill);
    f.set([0xff, 0xf3, 0x84, 0xc4]);
    if (xing) {
      f.set([...'Xing'].map((c) => c.charCodeAt(0)), 13);
      f.set([0, 0, 0, 0x0f], 17);
      new DataView(f.buffer).setUint32(21, xing.frames);
      new DataView(f.buffer).setUint32(25, xing.bytes);
    }
    return f;
  }
  const concat = (parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((p) => [...p]));

  it('keeps one header for the whole stream, so players read every sentence', () => {
    const sentence1 = [frame(0, { frames: 3, bytes: 4 * FRAME }), frame(1), frame(2), frame(3)];
    const sentence2 = [frame(0, { frames: 2, bytes: 3 * FRAME }), frame(4), frame(5)];
    const out = joinMp3Segments(concat([...sentence1, ...sentence2]));
    assert.strictEqual(out.length, 6 * FRAME);
    const view = new DataView(out.buffer, out.byteOffset);
    assert.strictEqual(String.fromCharCode(...out.subarray(13, 17)), 'Xing');
    assert.strictEqual(view.getUint32(17), 0x7);
    assert.strictEqual(view.getUint32(21), 5, 'frame count covers both sentences');
    assert.strictEqual(view.getUint32(25), 6 * FRAME, 'byte count is the whole file');
    assert.deepStrictEqual([1, 2, 3, 4, 5].map((n) => out[(n * FRAME) + 100]), [1, 2, 3, 4, 5], 'audio frames kept in order');
    assert.ok(!Buffer.from(out.subarray(FRAME)).includes('Xing'), 'no second header');
  });

  it('leaves anything that is not MP3 alone', () => {
    const notMp3 = new Uint8Array([1, 2, 3, 4, 5]);
    assert.strictEqual(joinMp3Segments(notMp3), notMp3);
  });
});

describe('voice check: speech settings', () => {
  it('uses Groq when its key is set, or an explicitly chosen provider', () => {
    assert.strictEqual(sttConfig({}), null);
    assert.strictEqual(sttConfig({ GROQ_API_KEY: 'g' })?.model, 'whisper-large-v3-turbo');
    assert.strictEqual(sttConfig({ GROQ_API_KEY: 'g', CODELAPSE_STT_MODEL: 'whisper-large-v3' })?.model, 'whisper-large-v3');
    assert.strictEqual(sttConfig({ OPENAI_API_KEY: 'o' }), null, 'OpenAI only when chosen');
    assert.strictEqual(sttConfig({ OPENAI_API_KEY: 'o', CODELAPSE_STT_PROVIDER: 'openai' })?.name, 'OpenAI');
    assert.strictEqual(sttConfig({ CODELAPSE_STT_PROVIDER: 'custom', CODELAPSE_STT_BASE_URL: 'http://x' }), null);
    assert.ok(voiceAvailable({ FEATHERLESS_API_KEY: 'f', GROQ_API_KEY: 'g' }));
    assert.ok(!voiceAvailable({ FEATHERLESS_API_KEY: 'f' }));
    assert.ok(!voiceAvailable({ FEATHERLESS_API_KEY: 'f', GROQ_API_KEY: 'g', CODELAPSE_VOICE: 'off' }));
  });

  it('helps the recogniser with the student\'s own names and drops invented lines', () => {
    const prompt = vocabularyPrompt([{ content: CODE.toString('utf-8') }], 'C');
    assert.match(prompt, /reverse/);
    assert.match(prompt, /count_vowels/);
    assert.ok(isLikelyNoise('Thank you.'));
    assert.ok(isLikelyNoise('  '));
    assert.ok(!isLikelyNoise('Thank you, the loop stops halfway.'));
    assert.strictEqual(audioExtension('audio/webm;codecs=opus'), 'webm');
    assert.strictEqual(audioExtension('audio/mp4'), 'm4a');
    assert.strictEqual(audioExtension('video/mp4'), null);
  });

  it('leaves the voice routes open to students', () => {
    const req = (p: string) => ({ method: 'POST', nextUrl: { pathname: p } }) as Parameters<typeof needsInstructor>[0];
    assert.ok(!needsInstructor(req('/api/submissions/abc/voice')));
    assert.ok(!needsInstructor(req('/api/submissions/abc/voice/turn')));
  });
});

describe('voice check: running a conversation', () => {
  let rec: SubmissionRecord;
  let set: QuestionSet;
  beforeEach(async () => {
    useBackend(new MemoryBackend());
    rec = { ...record(), id: 'voice-test', questionsCloseAt: Date.now() + 3600_000 };
    await saveSubmission(rec, { name: 'x.codelapse', bytes: new Uint8Array([1]) }, [{ name: 'reverse.c', bytes: CODE }]);
    set = await questionSet(rec);
    await saveQuestionSet(rec.id, set);
  });
  after(() => useBackend(null));

  it('retries a reply that breaks the rules, then saves the answers when the last question is done', async () => {
    await startVoice(rec.id);
    const again = await startVoice(rec.id);
    assert.strictEqual(again.turns.length, 1, 'starting twice returns the same conversation');

    const tutor = scriptedTutor([
      { say: 'Write if (x) { y; } there.', move: 'hint' },
      { say: 'What did the compiler point at?', move: 'hint' }
    ]);
    let s = await studentTurn(rec.id, 'I forget', 'voice', { at: 1, model: 'w', ms: 5, audioBytes: 100, chars: 8 }, tutor);
    assert.strictEqual(tutor.prompts.length, 2);
    assert.match(tutor.prompts[1].user, /could not be used/);
    assert.strictEqual(s.turns[s.turns.length - 1].text, 'What did the compiler point at?');
    assert.strictEqual(s.log.length, 2);
    assert.strictEqual(s.transcriptions[0].questionId, set.questions[0].id);

    for (let i = 0; i < 4; i++) {
      s = await studentTurn(rec.id, `my answer ${i}`, 'typed', null, scriptedTutor([{ say: 'Thanks.', move: 'next' }]));
    }
    assert.strictEqual(s.status, 'finished');
    const answers = await getAnswers(rec.id);
    assert.strictEqual(answers?.mode, 'voice');
    assert.strictEqual(answers?.answers[0].text, 'I forget\nmy answer 0');
    assert.strictEqual((await getEvaluation(rec.id))?.status, 'pending', 'the review is queued like written answers');
    await assert.rejects(studentTurn(rec.id, 'late', 'typed', null, scriptedTutor([])), /already submitted/);
  });

  it('falls back to a neutral line when the tutor keeps failing', async () => {
    await startVoice(rec.id);
    const s = await studentTurn(rec.id, 'hello', 'voice', null, scriptedTutor([new Error('timeout'), new Error('timeout')]));
    const last = s.turns[s.turns.length - 1];
    assert.strictEqual(last.kind, 'follow_up');
    assert.match(last.text, /say a little more/);
    assert.ok(s.log[s.log.length - 1].fallback);
  });

  it('lets the student end early, saving what they said', async () => {
    await startVoice(rec.id);
    await studentTurn(rec.id, 'first thought', 'voice', null, scriptedTutor([{ say: 'Thanks.', move: 'next' }]));
    const s = await finishVoice(rec.id);
    assert.strictEqual(s.endedBy, 'student');
    const answers = await getAnswers(rec.id);
    assert.strictEqual(answers?.answers[0].text, 'first thought');
    assert.strictEqual(answers?.answers[1].text, NO_ANSWER);
    assert.strictEqual((await getVoiceSession(rec.id))?.session.status, 'finished');
  });

  it('refuses once the answer window has closed', async () => {
    await saveSubmission({ ...rec, questionsCloseAt: Date.now() - 1 }, { name: 'x.codelapse', bytes: new Uint8Array([1]) }, []);
    await assert.rejects(startVoice(rec.id), (err: unknown) => err instanceof VoiceError && err.status === 410);
  });
});
