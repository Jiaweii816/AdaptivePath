export function normalizeProviderError(error: unknown) {
  const record = asRecord(error);
  const nestedError = asRecord(record.error);
  const response = asRecord(record.response);
  const headers = asHeaderRecord(record.headers) ?? asHeaderRecord(response.headers);

  return {
    type:
      readString(record.type) ??
      readString(nestedError.type) ??
      (error instanceof Error ? error.name : typeof error),
    code: readString(record.code) ?? readString(nestedError.code),
    param: readString(record.param) ?? readString(nestedError.param),
    message:
      readString(record.message) ??
      readString(nestedError.message) ??
      (error instanceof Error ? error.message : String(error)),
    status: readNumber(record.status) ?? readNumber(response.status),
    requestId:
      readString(record.request_id) ??
      readString(record.requestId) ??
      readHeader(headers, "x-request-id") ??
      readHeader(headers, "request-id"),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asHeaderRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return undefined;
}

function readString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readHeader(
  headers: Record<string, unknown> | undefined,
  name: string,
) {
  if (!headers) {
    return undefined;
  }

  const direct = headers[name] ?? headers[name.toLowerCase()];
  if (typeof direct === "string" && direct.length > 0) {
    return direct;
  }

  const get = headers.get;
  if (typeof get === "function") {
    const value = get.call(headers, name);
    return typeof value === "string" && value.length > 0 ? value : undefined;
  }

  return undefined;
}
