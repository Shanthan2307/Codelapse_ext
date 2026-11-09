import * as assert from 'assert';
import { needsInstructor, proxy, suppliedPassword } from '../src/proxy';

const req = (path: string, method = 'GET', authorization?: string) => {
  const url = new URL(path, 'http://localhost:3100');
  return {
    method,
    nextUrl: url,
    url: url.toString(),
    headers: new Headers(authorization ? { authorization } : {})
  } as unknown as Parameters<typeof proxy>[0];
};
const basic = (password: string) => `Basic ${Buffer.from(`instructor:${password}`).toString('base64')}`;

describe('Instructor password', () => {
  afterEach(() => {
    delete process.env.CODELAPSE_INSTRUCTOR_PASSWORD;
  });

  it('covers the instructor pages, research data, ratings and re-running the AI', () => {
    for (const path of ['/instructor', '/instructor/compare', '/instructor/submissions/x/replay', '/api/research/export']) {
      assert.ok(needsInstructor(req(path)), path);
    }
    assert.ok(needsInstructor(req('/api/submissions/abc/feedback', 'PUT')));
    assert.ok(needsInstructor(req('/api/submissions/abc/evaluation', 'POST')));
    assert.ok(needsInstructor(req('/api/submissions/abc/questions', 'POST')));
  });

  it('leaves everything a student needs open', () => {
    for (const [path, method] of [
      ['/courses/cs101/assignments/a3-reverse', 'GET'],
      ['/api/submissions', 'POST'],
      ['/submissions/abc', 'GET'],
      ['/api/submissions/abc/questions', 'GET'],
      ['/api/submissions/abc/answers', 'POST'],
      ['/instructors-guide', 'GET']
    ]) {
      assert.ok(!needsInstructor(req(path, method)), `${method} ${path}`);
    }
  });

  it('asks for the password only when one is set, and accepts the right one', () => {
    assert.strictEqual(proxy(req('/instructor')).status, 200, 'no password set: open');
    process.env.CODELAPSE_INSTRUCTOR_PASSWORD = 'tulip-42';
    const denied = proxy(req('/instructor'));
    assert.strictEqual(denied.status, 401);
    assert.match(denied.headers.get('www-authenticate') ?? '', /^Basic /);
    assert.strictEqual(proxy(req('/instructor', 'GET', basic('wrong'))).status, 401);
    assert.strictEqual(proxy(req('/instructor', 'GET', basic('tulip-42'))).status, 200);
    assert.strictEqual(proxy(req('/submissions/abc')).status, 200, 'student pages stay open');
  });

  it('reads the password from a Basic header, keeping colons in it', () => {
    assert.strictEqual(suppliedPassword(basic('a:b:c')), 'a:b:c');
    assert.strictEqual(suppliedPassword('Bearer x'), null);
    assert.strictEqual(suppliedPassword(null), null);
  });
});
