import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ActionOutcomeCard } from "@/features/workbench/action-outcome-card";

describe("ActionOutcomeCard", () => {
  it("renders a backend-confirmed Mistake Book save independently of Coach prose", () => {
    const html = renderToStaticMarkup(
      createElement(ActionOutcomeCard, {
        onOpen: vi.fn(),
        outcomes: [
          {
            toolName: "save_mistake_book_entry",
            displayName: "错题本",
            status: "completed",
            message: "错题本：已保存「Course Schedule KeyError」",
            recordId: "entry-1",
          },
        ],
      }),
    );

    expect(html).toContain("Save status (backend confirmed)");
    expect(html).toContain("Saved: 错题本");
    expect(html).toContain("View Mistake Book");
    expect(html).toContain('data-status="completed"');
  });

  it("does not present a failed Knowledge Handbook write as saved", () => {
    const html = renderToStaticMarkup(
      createElement(ActionOutcomeCard, {
        onOpen: vi.fn(),
        outcomes: [
          {
            toolName: "save_knowledge_note",
            displayName: "知识手册",
            status: "failed",
            message: "知识手册：操作失败，未确认写入成功",
          },
        ],
      }),
    );

    expect(html).toContain("Not saved: 知识手册");
    expect(html).not.toContain("View Knowledge Handbook");
    expect(html).toContain('data-status="failed"');
  });
});
