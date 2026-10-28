import { rebuildPointers } from './podge-pointers.js';

// Lambda entry for the state machine's `ReadPointers` step. The target repo is the shared
// volume mounted at `HODGE_REPO_DIR`; the control file defaults to `control.json` inside it.
export async function handler(event) {
  const repoDir = process.env.HODGE_REPO_DIR ?? '/mnt/work';
  const controlFile = process.env.HODGE_CONTROL_FILE ?? `${repoDir}/control.json`;
  return rebuildPointers(repoDir, event.runId, controlFile);
}
