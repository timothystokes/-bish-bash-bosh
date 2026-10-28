const MAX_ITEM_CHARS = 1500;

// The first unchecked checkbox of a plan, with its indented continuation lines, and how many are open.
// The loop prompt carries only this item, so context does not grow with the plan.
export function nextItem(plan) {
  const lines = plan.split('\n');
  const isOpen = (l) => /^\s*[-*] \[ \] /.test(l);
  const start = lines.findIndex(isOpen);
  if (start === -1) return null;
  const indent = /^\s*/.exec(lines[start])?.[0].length;
  const item = [lines[start]];
  for (const l of lines.slice(start + 1)) {
    if (l.trim() === '' || (/^\s*/.exec(l)?.[0].length ?? 0) <= indent) break;
    item.push(l);
  }
  return { text: item.join('\n').slice(0, MAX_ITEM_CHARS), open: lines.filter(isOpen).length };
}
