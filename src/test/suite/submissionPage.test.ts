import * as assert from 'assert';
import { EXAMPLE_SUBMISSION_URL, submissionUrlProblem } from '../../export/submissionPage';

describe('Submission page address', () => {
  it('accepts web addresses', () => {
    assert.strictEqual(submissionUrlProblem(EXAMPLE_SUBMISSION_URL), null);
    assert.strictEqual(submissionUrlProblem('https://course.example.edu/a3'), null);
  });

  it('explains what is wrong with anything else', () => {
    assert.match(submissionUrlProblem('')!, /No submission page is set/);
    assert.match(submissionUrlProblem('course page')!, /not a web address/);
    assert.match(submissionUrlProblem('file:///etc/passwd')!, /http:\/\/ or https:\/\//);
    assert.match(submissionUrlProblem('javascript:alert(1)')!, /http:\/\/ or https:\/\//);
  });
});
