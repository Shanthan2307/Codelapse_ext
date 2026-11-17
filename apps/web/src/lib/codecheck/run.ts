import { findAssignment } from '../course';
import { getCodeCheck, getSubmission, readAllSubmittedCode, saveCodeCheck } from '../store';
import { checkCode, emptyCodeCheck } from './check';
import { CodeCheckModel, createCodeCheckModel } from './model';

export async function markCodeCheckPending(id: string): Promise<void> {
  await saveCodeCheck(id, emptyCodeCheck('pending'));
}

/**
 * Checks and stores a submission's code. Runs after the upload response is
 * sent, alongside question writing; never throws.
 */
export async function runCodeCheck(id: string): Promise<void> {
  try {
    const record = await getSubmission(id);
    const assignment = record ? findAssignment(record.assignmentId) : undefined;
    if (!record || !assignment) return;
    let model: CodeCheckModel;
    try {
      model = createCodeCheckModel();
    } catch (err) {
      await saveCodeCheck(id, emptyCodeCheck('failed', { error: `Could not set up the code checker: ${String(err)}`, finishedAt: Date.now() }));
      return;
    }
    const check = await checkCode(
      {
        assignmentTitle: assignment.title,
        assignmentDescription: assignment.description,
        language: assignment.language,
        code: await readAllSubmittedCode(record),
        recording: record.recording
      },
      model
    );
    await saveCodeCheck(id, check);
  } catch (err) {
    console.error(`Code check for ${id} failed:`, err);
    const current = await getCodeCheck(id).catch(() => null);
    await saveCodeCheck(
      id,
      emptyCodeCheck('failed', { error: `Code check failed: ${String(err)}`, finishedAt: Date.now(), log: current?.log ?? [] })
    ).catch(() => undefined);
  }
}
