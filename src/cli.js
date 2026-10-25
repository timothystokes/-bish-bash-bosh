/** @returns {string} */
export function helpText() {
  return [
    'hodge: model-agnostic harness for loop-engineered delivery',
    '',
    'Usage:',
    '  hodge [--help]',
    '',
    'Commands (not yet implemented): step, run',
    '',
  ].join('\n');
}

/**
 * @param {string[]} argv
 * @returns {number} exit code
 */
export function main(argv) {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(helpText());
    return 0;
  }
  process.stderr.write(`hodge: unknown command '${argv[0]}'\n\n${helpText()}`);
  return 2;
}
