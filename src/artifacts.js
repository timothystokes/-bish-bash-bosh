// Promotion review: open a PR from the sandbox branch for a human to review. Never merges.
export async function requestPromotion({ opener, runId, head, base, sha }) {
  if (!runId) throw new Error('runId is required');
  if (!head || !base) throw new Error('head and base are required');
  if (head === base) throw new Error('head must differ from base');
  const body = [`Promotion review for run \`${runId}\`.`, '', `- Commit: ${sha}`, '', 'A human must review and merge; bish never merges.'].join('\n');
  return opener.openPullRequest({ title: `Promote run ${runId}`, body, head, base });
}
