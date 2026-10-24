import { chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  sendEmail,
  type EmailMessage,
} from "@/server/jobs/proactive/email-transport";

const temporaryDirectories: string[] = [];

const message: EmailMessage = {
  to: "learner@example.com",
  from: "coach@example.com",
  subject: "Daily review",
  html: "<p>Practice binary search.</p>",
  text: "Practice binary search.",
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("sendEmail", () => {
  it("writes a private file receipt under a private /tmp task directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "pc-email-test-"));
    temporaryDirectories.push(root);
    await chmod(root, 0o700);

    const receipt = await sendEmail(message, {
      env: { EMAIL_TRANSPORT: "file" },
      tmpRoot: root,
    });

    expect(receipt.transport).toBe("file");
    if (receipt.transport !== "file") {
      throw new Error("Expected file transport receipt.");
    }
    expect(dirname(receipt.detail)).toContain("patterncoach-daily-coach-");
    expect(await readFile(receipt.detail, "utf8")).toContain("Daily review");
    expect((await stat(dirname(receipt.detail))).mode & 0o777).toBe(0o700);
    expect((await stat(receipt.detail)).mode & 0o777).toBe(0o600);
  });

  it.each([
    { field: "RESEND_API_KEY", env: { EMAIL_TRANSPORT: "resend" }, patch: {} },
    {
      field: "to",
      env: { EMAIL_TRANSPORT: "resend", RESEND_API_KEY: "test-key" },
      patch: { to: " " },
    },
    {
      field: "from",
      env: { EMAIL_TRANSPORT: "resend", RESEND_API_KEY: "test-key" },
      patch: { from: " " },
    },
  ])("fails explicitly when $field is missing", async ({ env, patch, field }) => {
    await expect(sendEmail({ ...message, ...patch }, { env })).rejects.toThrow(
      field,
    );
  });

  it("returns a stable Resend receipt only after provider acceptance", async () => {
    const send = vi.fn(async () => ({
      data: { id: "resend-message-123" },
      error: null,
    }));

    const receipt = await sendEmail(message, {
      env: { EMAIL_TRANSPORT: "resend", RESEND_API_KEY: "test-key" },
      createResendClient: () => ({ emails: { send } }),
    });

    expect(send).toHaveBeenCalledWith(message);
    expect(receipt).toEqual({
      transport: "resend",
      messageId: "resend-message-123",
    });
  });

  it("surfaces provider errors and missing ids without fabricating success", async () => {
    await expect(
      sendEmail(message, {
        env: { EMAIL_TRANSPORT: "resend", RESEND_API_KEY: "test-key" },
        createResendClient: () => ({
          emails: {
            send: async () => ({
              data: null,
              error: { message: "provider rejected request" },
            }),
          },
        }),
      }),
    ).rejects.toThrow(/provider rejected request/);

    await expect(
      sendEmail(message, {
        env: { EMAIL_TRANSPORT: "resend", RESEND_API_KEY: "test-key" },
        createResendClient: () => ({
          emails: { send: async () => ({ data: { id: " " }, error: null }) },
        }),
      }),
    ).rejects.toThrow(/no message id/);
  });

  it("rejects smtp and every unsupported transport", async () => {
    await expect(
      sendEmail(message, { env: { EMAIL_TRANSPORT: "smtp" } }),
    ).rejects.toThrow(/unsupported EMAIL_TRANSPORT/i);
  });

  it("refuses to write file receipts outside the system temporary directory", async () => {
    await expect(
      sendEmail(message, {
        env: { EMAIL_TRANSPORT: "file" },
        tmpRoot: "/workspace/not-a-mail-scratch-directory",
      }),
    ).rejects.toThrow(/system \/tmp directory/);
  });
});
