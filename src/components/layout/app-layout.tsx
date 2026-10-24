import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Sidebar } from "./sidebar";

export function AppLayout({
  contentClassName,
  displayName,
  navigationMode = "push",
  children,
}: {
  contentClassName?: string;
  displayName: string;
  navigationMode?: "push" | "drawer";
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <Sidebar displayName={displayName} mode={navigationMode === "drawer" ? "overlay" : "push"} presentation={navigationMode === "drawer" ? "drawer" : "rail"} />
      <main className="min-w-0 flex-1">
        <div
          className={cn(
            "mx-auto w-full max-w-6xl px-4 py-6 lg:px-8",
            contentClassName,
          )}
        >
          {children}
        </div>
      </main>
    </div>
  );
}
