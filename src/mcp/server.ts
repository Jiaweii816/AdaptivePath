import { isAbsolute } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { resolveMemoryOrigin } from "@/server/memory/memory-origin";
import {
  assertNotLearnerDatabase,
  MCP_PROJECT_ROOT,
} from "./database-safety";
import type { McpToolDef } from "./tools";

const MCP_SERVER_INFO = {
  name: "patterncoach",
  version: "0.1.0",
} as const;

const ISOLATED_WRITE_ORIGINS = new Set([
  "development",
  "test",
  "evaluation",
]);

export type McpServerEnvironment = Readonly<
  Record<string, string | undefined>
>;

export type McpServerOptions = {
  env?: McpServerEnvironment;
  cwd?: string;
};

/**
 * Write-capable MCP tools are an opt-in development facility. The gate is
 * deliberately stricter than the general SQLite helper because a relative
 * path is too easy to resolve against an unexpected client working directory.
 */
export function assertMcpWriteAllowed(
  args: Record<string, unknown>,
  options: McpServerOptions = {},
): void {
  const env = options.env ?? process.env;
  const projectRoot = options.cwd ?? MCP_PROJECT_ROOT;

  if (env.MCP_ALLOW_WRITES !== "1") {
    throw new Error("MCP write denied: set MCP_ALLOW_WRITES=1");
  }

  const configuredDatabaseUrl = env.DATABASE_URL?.trim();
  if (!configuredDatabaseUrl) {
    throw new Error(
      "MCP write denied: DATABASE_URL must explicitly select an isolated SQLite database",
    );
  }

  if (!hasAbsoluteSqlitePath(configuredDatabaseUrl)) {
    throw new Error(
      "MCP write denied: DATABASE_URL must use an absolute SQLite path",
    );
  }

  assertNotLearnerDatabase(configuredDatabaseUrl, projectRoot);

  const origin = resolveMemoryOrigin(env);
  if (!ISOLATED_WRITE_ORIGINS.has(origin)) {
    throw new Error(
      "MCP write denied: PATTERNCOACH_MEMORY_ORIGIN must be development, test, or evaluation",
    );
  }

  const handle = args.handle;
  if (typeof handle !== "string" || !handle.trim()) {
    throw new Error("MCP write denied: write tools require an explicit handle");
  }
  if (handle.trim().toLocaleLowerCase("en-US") === "iris904") {
    throw new Error("MCP write denied: refuse to write the Iris904 learner account");
  }
}

export function createMcpServer(
  tools: readonly McpToolDef[],
  options: McpServerOptions = {},
): McpServer {
  const server = new McpServer(MCP_SERVER_INFO);

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: {
          readOnlyHint: tool.effect === "read",
          destructiveHint: tool.effect === "write",
        },
      },
      async (args) => {
        const input: Record<string, unknown> = args;
        if (tool.effect === "write") {
          assertMcpWriteAllowed(input, options);
        }
        return tool.handler(input);
      },
    );
  }

  return server;
}

export async function startMcpServer(
  tools: readonly McpToolDef[],
  options: McpServerOptions & { transport?: Transport } = {},
): Promise<McpServer> {
  const server = createMcpServer(tools, options);
  await server.connect(options.transport ?? new StdioServerTransport());
  return server;
}

function hasAbsoluteSqlitePath(databaseUrl: string): boolean {
  if (!databaseUrl.startsWith("file:")) {
    return isAbsolute(databaseUrl);
  }

  const [rawPath] = databaseUrl.slice("file:".length).split("?");
  return Boolean(rawPath && isAbsolute(rawPath));
}
