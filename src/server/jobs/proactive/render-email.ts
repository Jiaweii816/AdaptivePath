import type { DailyPlan } from "./build-daily-plan";

export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
};

export function renderEmail(plan: DailyPlan): RenderedEmail {
  const subject = `PatternCoach Daily Review · ${plan.date}`;
  const weaknessHtml = plan.weaknesses.length
    ? `<h3>Recent Weakness Signals</h3><ul>${plan.weaknesses
        .map(
          (weakness) =>
            `<li><strong>${escapeHtml(problemLabel(weakness.title, weakness.leetcodeNumber))}</strong>: ${escapeHtml(weakness.summary)}</li>`,
        )
        .join("")}</ul>`
    : "";
  const recommendationHtml = plan.recommended.length
    ? `<h3>Targeted Practice</h3><ul>${plan.recommended
        .map(
          (recommendation) =>
            `<li>${escapeHtml(problemLabel(recommendation.title, recommendation.problemId))} — ${escapeHtml(recommendation.reason)}</li>`,
        )
        .join("")}</ul>`
    : "";
  const weaknessText = plan.weaknesses.length
    ? `\nRecent Weakness Signals:\n${plan.weaknesses
        .map(
          (weakness) =>
            `- ${problemLabel(weakness.title, weakness.leetcodeNumber)}: ${weakness.summary}`,
        )
        .join("\n")}`
    : "";
  const recommendationText = plan.recommended.length
    ? `\nTargeted Practice:\n${plan.recommended
        .map(
          (recommendation) =>
            `- ${problemLabel(recommendation.title, recommendation.problemId)} — ${recommendation.reason}`,
        )
        .join("\n")}`
    : "";

  return {
    subject,
    html: `<h2>${escapeHtml(subject)}</h2>${weaknessHtml}${recommendationHtml}`,
    text: `${subject}${weaknessText}${recommendationText}`,
  };
}

function problemLabel(title: string, leetcodeNumber?: number | string) {
  return leetcodeNumber === undefined
    ? title
    : `LC ${leetcodeNumber} · ${title}`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}
