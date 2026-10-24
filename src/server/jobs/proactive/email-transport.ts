import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { Resend } from "resend";

export type EmailMessage = {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
};

export type EmailReceipt =
  | {
      transport: "file";
      detail: string;
    }
  | {
      transport: "resend";
      messageId: string;
    };

type ResendClient = {
  emails: {
    send(message: EmailMessage): Promise<{
      data: { id: string } | null;
      error: { message: string } | null;
    }>;
  };
};

export type EmailTransportOptions = {
  env?: Readonly<Record<string, string | undefined>>;
  tmpRoot?: string;
  createResendClient?: (apiKey: string) => ResendClient;
};

export async function sendEmail(
  message: EmailMessage,
  options: EmailTransportOptions = {},
): Promise<EmailReceipt> {
  validateMessage(message);
  const env = options.env ?? process.env;
  const transport = env.EMAIL_TRANSPORT?.trim() || "file";

  if (transport === "file") {
    return sendToFile(message, options.tmpRoot ?? tmpdir());
  }
  if (transport === "resend") {
    const apiKey = env.RESEND_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("RESEND_API_KEY is required for resend transport.");
    }
    const client = (options.createResendClient ?? createResendClient)(apiKey);
    const result = await client.emails.send(message);
    if (result.error) {
      throw new Error(`Resend send failed: ${result.error.message}`);
    }
    const messageId = result.data?.id.trim();
    if (!messageId) {
      throw new Error("Resend send failed: provider returned no message id.");
    }
    return {
      transport: "resend",
      messageId,
    };
  }

  throw new Error(`Unsupported EMAIL_TRANSPORT: ${transport}`);
}

async function sendToFile(
  message: EmailMessage,
  temporaryRoot: string,
): Promise<EmailReceipt> {
  assertSystemTemporaryRoot(temporaryRoot);
  const directory = await mkdtemp(
    join(temporaryRoot, "patterncoach-daily-coach-"),
  );
  await chmod(directory, 0o700);
  const path = join(directory, "email.html");
  const content = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(message.subject)}</title></head><body><dl><dt>To</dt><dd>${escapeHtml(message.to)}</dd><dt>From</dt><dd>${escapeHtml(message.from)}</dd><dt>Subject</dt><dd>${escapeHtml(message.subject)}</dd></dl>${message.html}<hr><pre>${escapeHtml(message.text)}</pre></body></html>`;
  await writeFile(path, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return {
    transport: "file",
    detail: path,
  };
}

function assertSystemTemporaryRoot(temporaryRoot: string) {
  const systemTemporaryRoot = resolve(tmpdir());
  const selectedRoot = resolve(temporaryRoot);
  const relativePath = relative(systemTemporaryRoot, selectedRoot);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error("File email transport must write under the system /tmp directory.");
  }
}

function createResendClient(apiKey: string): ResendClient {
  return new Resend(apiKey);
}

function validateMessage(message: EmailMessage) {
  requireHeader(message.to, "to");
  requireHeader(message.from, "from");
  requireHeader(message.subject, "subject");
  if (!message.html.trim()) throw new Error("html must not be blank.");
  if (!message.text.trim()) throw new Error("text must not be blank.");
}

function requireHeader(value: string, field: string) {
  if (!value.trim()) throw new Error(`${field} is required.`);
  if (/[\r\n]/.test(value)) {
    throw new Error(`${field} must not contain line breaks.`);
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}
