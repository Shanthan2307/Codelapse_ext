import * as assert from 'assert';
import OpenAI from 'openai';
import { describeOpenAIError, openAIModelName, DEFAULT_OPENAI_MODEL } from '../src/lib/ai/openai';
import { aiProvider } from '../src/lib/ai/provider';
import { OpenAIQuestionModel } from '../src/lib/questions/model';
import { OpenAIEvaluatorModel } from '../src/lib/evaluation/model';
import type { GeneratorOutput } from '../src/lib/questions/schema';

const prompt = { system: 's', user: 'u' };
const stub = (reply: object | Error) =>
  ({
    responses: {
      parse: async () => {
        if (reply instanceof Error) throw reply;
        return reply;
      }
    }
  }) as unknown as OpenAI;
const rateLimit = (type: string, code: string) =>
  new OpenAI.RateLimitError(429, { type, code, message: 'x' }, 'x', new Headers());

describe('OpenAI models', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('returns the parsed output and token usage', async () => {
    const output: GeneratorOutput = { questions: [], notes_for_instructor: null };
    const model = new OpenAIQuestionModel({
      client: stub({ status: 'completed', output: [], output_parsed: output, usage: { input_tokens: 10, output_tokens: 5 } })
    });
    assert.deepStrictEqual(await model.generate(prompt), { output, usage: { inputTokens: 10, outputTokens: 5 } });
  });

  it('reports a refusal, a cut-off reply and an unparsed reply clearly', async () => {
    const refused = { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }], output_parsed: null };
    await assert.rejects(new OpenAIEvaluatorModel({ client: stub(refused) }).evaluate(prompt), /declined/);
    const cut = { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [], output_parsed: null };
    await assert.rejects(new OpenAIEvaluatorModel({ client: stub(cut) }).evaluate(prompt), /ran out of room/);
    await assert.rejects(new OpenAIQuestionModel({ client: stub({ status: 'completed', output: [], output_parsed: null }) }).generate(prompt), /unexpected format/);
  });

  it('tells "no credit" apart from a short-term rate limit', () => {
    assert.match(describeOpenAIError(rateLimit('insufficient_quota', 'credit_balance_exhausted')), /no credit/);
    assert.match(describeOpenAIError(rateLimit('requests', 'rate_limit_exceeded')), /rate limiting/);
  });

  it('uses gpt-5.5 unless configured otherwise', () => {
    delete process.env.CODELAPSE_OPENAI_MODEL;
    assert.strictEqual(openAIModelName(), DEFAULT_OPENAI_MODEL);
    process.env.CODELAPSE_OPENAI_MODEL = 'gpt-5-mini';
    assert.strictEqual(new OpenAIQuestionModel({ client: stub({}) }).model, 'gpt-5-mini');
  });

  it('picks OpenAI when its key is set, unless a provider is named', () => {
    delete process.env.CODELAPSE_AI_PROVIDER;
    delete process.env.FEATHERLESS_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-test';
    assert.strictEqual(aiProvider(), 'openai');
    delete process.env.OPENAI_API_KEY;
    assert.strictEqual(aiProvider(), 'anthropic');
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.CODELAPSE_AI_PROVIDER = 'anthropic';
    assert.strictEqual(aiProvider(), 'anthropic');
  });
});
