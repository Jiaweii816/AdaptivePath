"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

export type ProblemStatementData = {
  constraints?: string[];
  difficulty?: string | null;
  examples?: Array<{
    input: unknown;
    output: unknown;
    explanation?: string;
  }>;
  isDemoSupported?: boolean;
  leetcodeNumber?: number | null;
  localRunStatus?: string;
  officialUrl?: string | null;
  slug: string;
  statementMarkdown?: string;
  tags?: string[];
  title: string;
};

const lcExamplePlaceholder =
  "Fetched from LeetCode exampleTestcases; expected output is shown in the statement when available.";

function compactValue(value: unknown) {
  if (value === undefined) {
    return "undefined";
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function compactInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return compactValue(value);
  }

  return Object.entries(value as Record<string, unknown>)
    .map(([key, entry]) => `${key} = ${compactValue(entry)}`)
    .join(", ");
}

function difficultyClassName(difficulty: string | null | undefined) {
  switch (difficulty?.toLowerCase()) {
    case "easy":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "medium":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "hard":
      return "border-rose-200 bg-rose-50 text-rose-700";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

function cleanStatement(markdown: string | undefined) {
  return (markdown ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/```(\w+)?[ \t]*\n/g, (match, language: string | undefined) =>
      language ? `\`\`\`${language}\n` : "```\n",
    )
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function shouldRenderExample(
  example: NonNullable<ProblemStatementData["examples"]>[number],
) {
  if (example.output !== null && example.output !== undefined) {
    return true;
  }

  return Boolean(
    example.explanation?.trim() &&
      example.explanation.trim() !== lcExamplePlaceholder,
  );
}

function TagList({ tags }: { tags: string[] }) {
  if (tags.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {tags.map((tag) => (
        <span
          className="rounded-md border border-border bg-muted/60 px-2.5 py-1 text-xs font-medium text-muted-foreground"
          key={tag}
        >
          {tag}
        </span>
      ))}
    </div>
  );
}

function ExampleBlock({
  example,
  index,
  slug,
}: {
  example: NonNullable<ProblemStatementData["examples"]>[number];
  index: number;
  slug: string;
}) {
  return (
    <article
      className="border-l-2 border-border bg-muted/25 py-3 pl-4 pr-3"
      key={`${slug}-example-${index}`}
    >
      <h4 className="text-[15px] font-semibold text-foreground">
        Example {index + 1}:
      </h4>
      <div className="mt-3 space-y-1.5 font-mono text-[13px] leading-6 text-muted-foreground">
        <p className="break-words">
          <span className="font-semibold text-foreground">Input:</span>{" "}
          {compactInput(example.input)}
        </p>
        <p className="break-words">
          <span className="font-semibold text-foreground">Output:</span>{" "}
          {compactValue(example.output)}
        </p>
        {example.explanation && example.explanation !== lcExamplePlaceholder ? (
          <p className="break-words">
            <span className="font-semibold text-foreground">Explanation:</span>{" "}
            {example.explanation}
          </p>
        ) : null}
      </div>
    </article>
  );
}

export function ProblemStatement({
  className,
  dense = false,
  problem,
  showHeader = false,
  showTags = true,
}: {
  className?: string;
  dense?: boolean;
  problem: ProblemStatementData;
  showHeader?: boolean;
  showTags?: boolean;
}) {
  const statement = cleanStatement(problem.statementMarkdown);
  const structuredExamples = (problem.examples ?? []).filter(shouldRenderExample);
  const constraints = problem.constraints ?? [];
  const tags = problem.tags ?? [];

  return (
    <div className={cn("min-w-0", dense ? "space-y-4" : "space-y-5", className)}>
      {showHeader ? (
        <header className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {problem.difficulty ? (
              <span
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-medium",
                  difficultyClassName(problem.difficulty),
                )}
              >
                {problem.difficulty}
              </span>
            ) : null}
            {problem.leetcodeNumber ? (
              <span className="rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground">
                LC {problem.leetcodeNumber}
              </span>
            ) : null}
            {problem.isDemoSupported ? (
              <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                Demo supported
              </span>
            ) : null}
            {!problem.isDemoSupported && problem.localRunStatus === "runnable" ? (
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                Local Run ready
              </span>
            ) : null}
          </div>
          <h2 className={cn("font-semibold", dense ? "text-xl" : "text-2xl")}>
            {problem.title}
          </h2>
        </header>
      ) : null}

      {showTags ? <TagList tags={tags} /> : null}

      <div
        className={cn(
          "problem-statement-prose text-[15px] leading-7 text-foreground/90",
          dense && "text-sm leading-6",
        )}
      >
        {statement ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ children }) => (
                <p className="my-3 first:mt-0 last:mb-0">{children}</p>
              ),
              strong: ({ children }) => (
                <strong className="font-semibold text-foreground">
                  {children}
                </strong>
              ),
              em: ({ children }) => (
                <em className="italic text-foreground/80">{children}</em>
              ),
              ul: ({ children }) => (
                <ul className="my-3 list-disc space-y-1.5 pl-5">{children}</ul>
              ),
              ol: ({ children }) => (
                <ol className="my-3 list-decimal space-y-1.5 pl-5">
                  {children}
                </ol>
              ),
              li: ({ children }) => <li className="pl-1">{children}</li>,
              code: ({ className: codeClassName, children }) => {
                const isFenced = Boolean(codeClassName);

                if (isFenced) {
                  return (
                    <code className="block whitespace-pre-wrap break-words font-mono text-[13px] leading-6">
                      {children}
                    </code>
                  );
                }

                return (
                  <code className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[13px] text-foreground">
                    {children}
                  </code>
                );
              },
              pre: ({ children }) => (
                <pre className="my-4 overflow-auto border-l-2 border-border bg-muted/30 py-3 pl-4 pr-3 text-muted-foreground">
                  {children}
                </pre>
              ),
            }}
          >
            {statement}
          </ReactMarkdown>
        ) : (
          <p className="text-muted-foreground">
            PatternCoach has the local Hot-150 shell for this problem. Full
            statement details are not cached yet, but search and local-run
            readiness can still be shown without contacting LeetCode.
          </p>
        )}
      </div>

      {problem.officialUrl ? (
        <a
          className="inline-flex text-sm font-medium text-primary underline-offset-4 hover:underline"
          href={problem.officialUrl}
          rel="noreferrer"
          target="_blank"
        >
          Open official problem
        </a>
      ) : null}

      {structuredExamples.length > 0 ? (
        <section className="space-y-3">
          <h3 className="text-base font-semibold text-foreground">Examples</h3>
          <div className="space-y-4">
            {structuredExamples.map((example, index) => (
              <ExampleBlock
                example={example}
                index={index}
                key={`${problem.slug}-structured-example-${index}`}
                slug={problem.slug}
              />
            ))}
          </div>
        </section>
      ) : null}

      {constraints.length > 0 ? (
        <section className="space-y-3">
          <h3 className="text-base font-semibold text-foreground">
            Constraints
          </h3>
          <ul className="space-y-1.5 text-sm leading-6 text-muted-foreground">
            {constraints.map((constraint) => (
              <li className="flex gap-2" key={constraint}>
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-border" />
                <span>{constraint}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
