/** Whether opening a cited passage counts as reference use for the current question. */
export function planCitation(input: Readonly<{ reviewing: boolean; referenceUsed: boolean }>): Readonly<{ recordReference: boolean }> {
  // Review talks about a submitted question; reading its passages must not change the current question's condition.
  return { recordReference: !input.reviewing && !input.referenceUsed };
}
