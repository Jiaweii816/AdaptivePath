import { canonicalizeConcept } from "./concepts";
import type { MemoryCandidate } from "./candidate-core.types";

export function sanitizeTeachingText(candidate: MemoryCandidate) {
  const raw = candidate.teachingText.replace(/\s+/g, " ").trim();
  if (/^[a-z0-9]+(?:_[a-z0-9]+)+$/i.test(raw)) return undefined;
  if (candidate.truthClass === "study_artifact" && containsPromptInjection(raw)) {
    return undefined;
  }
  if ([candidate.id, ...candidate.evidenceRefs].some((ref) => ref && raw.includes(ref))) {
    return undefined;
  }

  const cleaned = raw
    .replace(/\bconfidence\s*[:=]?\s*\d+(?:\.\d+)?%?/gi, "")
    .replace(/\b(?:cm[a-z0-9]{12,}|trace[-_: ]+[a-z0-9_-]{6,})\b/gi, "")
    .replace(/\b[a-z0-9]+(?:_[a-z0-9]+)+\b/gi, (token) =>
      canonicalizeConcept(token).replace(/_/g, " "),
    )
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? cleaned.slice(0, 260) : undefined;
}

export function sourceLabel(candidate: MemoryCandidate) {
  if (candidate.sourceProblem?.title) {
    return cleanSourceText(candidate.sourceProblem.title, "Past practice");
  }
  if (candidate.source === "onboarding_profile") return "你的自述画像";
  if (candidate.source === "knowledge_note") return "你的复习手册";
  if (candidate.source === "mistake_book") return "你的错题本";
  if (candidate.source === "domain_kb") return "算法参考";
  if (candidate.role === "learning_preference") return "你的学习偏好";
  return cleanSourceText(candidate.title, "Past practice");
}

export function cleanSourceText(value: string, fallback: string) {
  const cleaned = value
    .replace(/\b[a-z0-9]+(?:_[a-z0-9]+)+\b/gi, (token) =>
      token.replace(/_/g, " "),
    )
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? cleaned.slice(0, 100) : fallback;
}

export function relevanceExplanation(candidate: MemoryCandidate) {
  const signals = candidate.retrievalSignals;
  return [
    `tier ${signals.matchTier}`,
    signals.conceptMatch !== "none"
      ? `${signals.conceptMatch} concept`
      : undefined,
    `intent fit ${signals.intentFit.toFixed(2)}`,
  ]
    .filter(Boolean)
    .join("; ");
}

export function cleanOptionalText(value: string | undefined) {
  const cleaned = value
    ?.replace(/\bconfidence\s*[:=]?\s*\d+(?:\.\d+)?%?/gi, "")
    .replace(/\b(?:cm[a-z0-9]{12,}|trace[-_: ]+[a-z0-9_-]{6,})\b/gi, "")
    .replace(/\b[a-z0-9]+(?:_[a-z0-9]+)+\b/gi, (token) =>
      canonicalizeConcept(token).replace(/_/g, " "),
    )
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? cleaned.slice(0, 180) : undefined;
}

function containsPromptInjection(value: string) {
  return /ignore (?:all |the )?(?:previous|prior|system) instructions|忽略(?:之前|以上|系统)指令|call (?:the )?tool|调用工具/i.test(
    value,
  );
}
