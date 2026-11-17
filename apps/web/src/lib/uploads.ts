/** Direct uploads (hosted site): where files wait between upload and submission. */
export const UPLOAD_ID = /^[a-f0-9]{32}$/;

export function uploadPaths(uploadId: string, codeNames: string[]) {
  return {
    recording: `uploads/${uploadId}/recording.codelapse`,
    code: codeNames.map((name) => ({ name, path: `uploads/${uploadId}/code/${name}` }))
  };
}
