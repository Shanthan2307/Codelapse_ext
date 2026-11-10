import * as assert from 'assert';
import type OpenAI from 'openai';
import { DEFAULT_FEATHERLESS_MODEL, FEATHERLESS_BASE_URL, createFeatherlessClient, parseJson } from '../src/lib/ai/featherless';
import { aiProvider } from '../src/lib/ai/provider';
import { FeatherlessQuestionModel } from '../src/lib/questions/model';
import { FeatherlessEvaluatorModel } from '../src/lib/evaluation/model';

const prompt = { system: 's', user: 'u' };
const valid = JSON.stringify({ questions: [], notes_for_instructor: null });
const reply = (content: string | null, finish = 'stop', refusal: string | null = null) => ({
  choices: [{ finish_reason: finish, message: { content, refusal } }],
  usage: { prompt_tokens: 12, completion_tokens: 7 }
});

/** Answers each request with the next reply in turn, counting the requests. */
function scripted(replies: object[]): OpenAI & { calls: number } {
  const client = {
    calls: 0,
    chat: {
      completions: {
        create: async () => {
          client.calls++;
          return replies.shift();
        }
      }
    }
  };
  return client as unknown as OpenAI & { calls: number };
}

describe('Featherless models', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('parses and checks the JSON reply, with token usage', async () => {
    const client = scripted([reply(valid)]);
    const result = await new FeatherlessQuestionModel({ client }).generate(prompt);
    assert.deepStrictEqual(result, { output: { questions: [], notes_for_instructor: null }, usage: { inputTokens: 12, outputTokens: 7 } });
  });

  it('tries once more when the reply is not valid JSON for the schema', async () => {
    const client = scripted([reply('{"questions": [ broken'), reply('```json\n' + valid + '\n```')]);
    await new FeatherlessQuestionModel({ client }).generate(prompt);
    assert.strictEqual(client.calls, 2);
    await assert.rejects(
      new FeatherlessEvaluatorModel({ client: scripted([reply('{}'), reply('nope')]) }).evaluate(prompt),
      /unexpected format/
    );
  });

  it('reports a cut-off reply and a refusal clearly', async () => {
    await assert.rejects(new FeatherlessQuestionModel({ client: scripted([reply(valid, 'length')]) }).generate(prompt), /ran out of room/);
    await assert.rejects(new FeatherlessQuestionModel({ client: scripted([reply(null, 'stop', 'no')]) }).generate(prompt), /declined/);
  });

  it('reads JSON with or without a code fence', () => {
    assert.deepStrictEqual(parseJson('{"a":1}'), { a: 1 });
    assert.deepStrictEqual(parseJson('Here:\n```json\n{"a":1}\n```'), { a: 1 });
    assert.strictEqual(parseJson('not json'), undefined);
  });

  it('talks to Featherless with DeepSeek V3 by default', () => {
    process.env.FEATHERLESS_API_KEY = 'rc_test';
    delete process.env.CODELAPSE_FEATHERLESS_MODEL;
    assert.strictEqual(createFeatherlessClient().baseURL, FEATHERLESS_BASE_URL);
    assert.strictEqual(new FeatherlessQuestionModel({ client: scripted([]) }).model, DEFAULT_FEATHERLESS_MODEL);
  });

  it('is chosen first when its key is set, unless a provider is named', () => {
    delete process.env.CODELAPSE_AI_PROVIDER;
    process.env.FEATHERLESS_API_KEY = 'rc_test';
    process.env.OPENAI_API_KEY = 'sk-test';
    assert.strictEqual(aiProvider(), 'featherless');
    process.env.CODELAPSE_AI_PROVIDER = 'openai';
    assert.strictEqual(aiProvider(), 'openai');
  });
});
