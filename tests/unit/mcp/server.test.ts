import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createMcpServer } from "@/mcp/server";
import type { McpToolDef } from "@/mcp/tools";

const openServers: Array<ReturnType<typeof createMcpServer>> = [];
const openClients: Client[] = [];

afterEach(async () => {
  await Promise.all(openClients.splice(0).map((client) => client.close()));
  await Promise.all(openServers.splice(0).map((server) => server.close()));
});

describe("PatternCoach MCP server", () => {
  it("registers tool descriptions and Zod input schemas with the SDK", async () => {
    const handler = vi.fn(async () => textResult("ok"));
    const { client } = await connect([
      tool({
        name: "recall_history",
        description: "Recall learner history.",
        effect: "read",
        inputSchema: {
          handle: z.string().min(1),
          count: z.number().int().min(1).max(5).optional(),
        },
        handler,
      }),
    ]);

    const listed = await client.listTools();

    expect(listed.tools).toHaveLength(1);
    expect(listed.tools[0]).toMatchObject({
      name: "recall_history",
      description: "Recall learner history.",
      inputSchema: {
        type: "object",
        required: ["handle"],
        properties: {
          handle: { type: "string", minLength: 1 },
          count: { type: "integer", minimum: 1, maximum: 5 },
        },
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    });

    const result = await client.callTool({
      name: "recall_history",
      arguments: { handle: "PatternCoachDev", count: 2 },
    });
    expect(result).toMatchObject(textResult("ok"));
    expect(handler).toHaveBeenCalledWith({
      handle: "PatternCoachDev",
      count: 2,
    });
  });

  it("denies a write before its handler unless writes are explicitly enabled", async () => {
    const handler = vi.fn(async () => textResult("written"));
    const { client } = await connect([writeTool(handler)], {
      DATABASE_URL: "file:/tmp/patterncoach-mcp-test.sqlite",
      PATTERNCOACH_MEMORY_ORIGIN: "test",
    });

    const result = await client.callTool({
      name: "save_note",
      arguments: { handle: "PatternCoachDev", note: "remember this" },
    });

    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain(
      "MCP write denied: set MCP_ALLOW_WRITES=1",
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it("allows a write only for an explicit absolute isolated database", async () => {
    const handler = vi.fn(async () => textResult("written"));
    const { client } = await connect([writeTool(handler)], {
      MCP_ALLOW_WRITES: "1",
      DATABASE_URL: "file:/tmp/patterncoach-mcp-test.sqlite",
      PATTERNCOACH_MEMORY_ORIGIN: "development",
    });

    const result = await client.callTool({
      name: "save_note",
      arguments: { handle: "PatternCoachDev", note: "remember this" },
    });

    expect(result).toMatchObject(textResult("written"));
    expect(handler).toHaveBeenCalledOnce();
  });

  it.each([
    {
      label: "an unset database",
      env: {
        MCP_ALLOW_WRITES: "1",
        PATTERNCOACH_MEMORY_ORIGIN: "test",
      },
      message: "DATABASE_URL must explicitly select",
    },
    {
      label: "an ambiguous relative database",
      env: {
        MCP_ALLOW_WRITES: "1",
        DATABASE_URL: "file:./isolated.sqlite",
        PATTERNCOACH_MEMORY_ORIGIN: "test",
      },
      message: "DATABASE_URL must use an absolute SQLite path",
    },
    {
      label: "the workspace learner database",
      env: {
        MCP_ALLOW_WRITES: "1",
        DATABASE_URL: "file:/repo/dev.db",
        PATTERNCOACH_MEMORY_ORIGIN: "test",
      },
      message: "refuse to write workspace learner dev.db",
    },
    {
      label: "learner-origin memory",
      env: {
        MCP_ALLOW_WRITES: "1",
        DATABASE_URL: "file:/tmp/isolated.sqlite",
        PATTERNCOACH_MEMORY_ORIGIN: "learner",
      },
      message: "PATTERNCOACH_MEMORY_ORIGIN must be development, test, or evaluation",
    },
  ])("rejects $label", async ({ env, message }) => {
    const handler = vi.fn(async () => textResult("written"));
    const { client } = await connect([writeTool(handler)], env, "/repo");

    const result = await client.callTool({
      name: "save_note",
      arguments: { handle: "PatternCoachDev", note: "remember this" },
    });

    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain(message);
    expect(handler).not.toHaveBeenCalled();
  });

  it("refuses the real learner handle even on an isolated database", async () => {
    const handler = vi.fn(async () => textResult("written"));
    const { client } = await connect([writeTool(handler)], {
      MCP_ALLOW_WRITES: "1",
      DATABASE_URL: "file:/tmp/patterncoach-mcp-test.sqlite",
      PATTERNCOACH_MEMORY_ORIGIN: "evaluation",
    });

    const result = await client.callTool({
      name: "save_note",
      arguments: { handle: " Iris904 ", note: "do not write" },
    });

    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain(
      "refuse to write the Iris904 learner account",
    );
    expect(handler).not.toHaveBeenCalled();
  });
});

function tool(definition: McpToolDef): McpToolDef {
  return definition;
}

function writeTool(
  handler: McpToolDef["handler"],
): McpToolDef {
  return tool({
    name: "save_note",
    description: "Save a learner note.",
    effect: "write",
    inputSchema: {
      handle: z.string().min(1),
      note: z.string().min(1),
    },
    handler,
  });
}

async function connect(
  tools: readonly McpToolDef[],
  env: Readonly<Record<string, string | undefined>> = {},
  cwd = "/repo",
) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(tools, { env, cwd });
  const client = new Client({ name: "patterncoach-test", version: "0.1.0" });
  openServers.push(server);
  openClients.push(client);
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return { client, server };
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function resultText(result: unknown) {
  if (
    typeof result !== "object" ||
    result === null ||
    !("content" in result) ||
    !Array.isArray(result.content)
  ) {
    return "";
  }

  return result.content
    .map((item: unknown) => {
      if (
        typeof item !== "object" ||
        item === null ||
        !("type" in item) ||
        !("text" in item)
      ) {
        return "";
      }
      return item.type === "text" && typeof item.text === "string"
        ? item.text
        : "";
    })
    .filter(Boolean)
    .join("\n");
}
