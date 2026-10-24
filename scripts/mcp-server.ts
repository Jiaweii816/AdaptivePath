import { loadLocalEnv } from "@/lib/env";

loadLocalEnv();

async function main(): Promise<void> {
  // Keep runtime imports after environment loading: the Prisma adapter resolves
  // DATABASE_URL when its module is initialized.
  const [{ startMcpServer }, { buildMcpTools }, { createMcpToolServices }] =
    await Promise.all([
      import("@/mcp/server"),
      import("@/mcp/tools"),
      import("@/mcp/tool-services"),
    ]);

  const runtime = await createMcpToolServices();
  let server: Awaited<ReturnType<typeof startMcpServer>>;
  try {
    server = await startMcpServer(buildMcpTools(runtime.services));
  } catch (error) {
    await runtime.close();
    throw error;
  }

  let shutdownPromise: Promise<void> | undefined;
  const shutdown = () => {
    shutdownPromise ??= Promise.allSettled([server.close(), runtime.close()]).then(
      (results) => {
        for (const result of results) {
          if (result.status === "rejected") {
            console.error(formatError(result.reason));
            process.exitCode = 1;
          }
        }
      },
    );
    return shutdownPromise;
  };

  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
  process.stdin.once("end", () => void shutdown());
  process.stdin.once("close", () => void shutdown());
}

function formatError(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

main().catch((error: unknown) => {
  // stdout is reserved exclusively for the MCP stdio protocol.
  console.error(formatError(error));
  process.exitCode = 1;
});
