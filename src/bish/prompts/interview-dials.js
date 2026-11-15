export const DEFAULT_CURIOSITY = 4;
export const DEFAULT_ACCURACY = 5;

const clamp = (v, fallback) => Math.min(10, Math.max(1, Math.round(Number(v) || fallback)));

// The two settings as the interview will use them, defaults filled in.
export const effectiveSettings = ({ curiosity, accuracy } = {}) => ({ accuracy: clamp(accuracy, DEFAULT_ACCURACY), curiosity: clamp(curiosity, DEFAULT_CURIOSITY) });
const band = (n, bands) => bands.find(([max]) => n <= max)[1];

// Turns the two 1-10 interview settings into guidance. Neither sets a number of questions: accuracy is how
// specific the specification must be before a gap counts as closed, curiosity is how far the agent
// follows the ramifications of each answer. A question is only ever raised for a real gap.
export default ({ curiosity, accuracy } = {}) => {
  const c = clamp(curiosity, DEFAULT_CURIOSITY);
  const d = clamp(accuracy, DEFAULT_ACCURACY);
  const accuracyText = band(d, [
    [2, 'Work at the level of broad intent. Treat a gap as closed once the overall behaviour is clear, and leave specifics to the builder.'],
    [4, 'Work at the level of main behaviours and key decisions. Leave minor specifics to the builder.'],
    [6, 'Work at the level of each feature and its observable behaviour. Leave implementation choices to the builder.'],
    [8, 'Work at the level of precise behaviour, including inputs, outputs, limits, defaults and error cases.'],
    [10, 'Work at the level of exact, verifiable behaviour for every feature. Leave nothing the builder would have to interpret.'],
  ]);
  const curiosityText = band(c, [
    [2, 'Take each answer at face value. Only follow up where it contradicts or leaves something essential undecided.'],
    [4, 'Follow up on the direct consequences of an answer where they are not yet covered.'],
    [6, 'Consider what an answer implies for the rest of the solution and follow up on consequences not yet covered.'],
    [8, 'Explore the wider ramifications of an answer: edge cases, failure modes and interactions with other decisions.'],
    [10, 'Explore every ramification of an answer, including second order effects and the questions the user may not have thought to ask.'],
  ]);
  return `Accuracy ${d} of 10: ${accuracyText}\nCuriosity ${c} of 10: ${curiosityText}\nOnly ask a question for a real gap at these levels, never to fill a quota. Where the builder could sensibly choose for themselves at this level of accuracy, make that choice in the specification rather than asking.`;
};
