import type { ReactNode } from "react";
import { Bot } from "lucide-react";

/**
 * Shared presentation extracted from the original PatternCoach Workbench.
 * Biology and coding use the same actual chat-bubble components.
 * Agent routing and message persistence remain server responsibilities.
 */
export function AssistantBubble({ children }: { children: ReactNode }) {
  return (
    <div aria-label="Coach chat reply" className="flex items-start gap-3 text-sm leading-6">
      <div className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full border border-violet-200 bg-violet-100 text-violet-700">
        <Bot className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className="min-w-0 rounded-md border border-border bg-background p-4">
        {children}
      </div>
    </div>
  );
}

export function UserBubble({ children }: { children: ReactNode }) {
  return (
    <div aria-label="User chat message" className="ml-auto max-w-[88%] rounded-md border border-border bg-muted/40 p-3 text-sm leading-6">
      {children}
    </div>
  );
}
