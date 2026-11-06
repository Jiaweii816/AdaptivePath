/**
 * One type scale for the Biology practice page; components take sizes from here
 * instead of choosing their own. The question is the most prominent text.
 */
export const TYPE = {
  /** Question stem. */
  question: "text-xl font-normal leading-[1.5] text-slate-900",
  /** Section headings such as "Choose an answer". */
  heading: "text-lg font-semibold text-slate-900",
  /** Answer options. */
  option: "text-base font-medium leading-6",
  /** Running text the student reads or writes. */
  body: "text-base leading-7",
  /** Assumptions and tutor text: readable without competing with the question. */
  support: "text-[15px] leading-6",
  /** Secondary instructions, meta lines and action links. */
  secondary: "text-[13px] leading-5 text-slate-500",
  /** Small uppercase panel labels. */
  eyebrow: "text-[13px] font-semibold uppercase tracking-wider text-teal-700",
  /** Tool controls (PDF toolbar, reference tags). */
  control: "text-xs",
} as const;

/** Text links for actions such as showing the reference. */
export const ACTION_LINK = "text-[13px] font-semibold text-teal-700 underline-offset-2 hover:underline disabled:opacity-50";
