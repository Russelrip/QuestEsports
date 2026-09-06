type ApiEnvelope<T> = T & {
  success?: boolean;
  message?: string;
};

type NextRequestInit = RequestInit & {
  next?: {
    revalidate?: number | false;
    tags?: string[];
  };
};

export class ApiRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
  }
}

export const parseApiOrigin = (value?: string) => {
  const configuredApiUrl = value?.trim();
  if (!configuredApiUrl) return null;

  // Permit harmless trailing slashes, but reject anything that is not an
  // origin. In particular, do not let a path, query, fragment, credentials,
  // or unsupported protocol become part of a request URL.
  if (/[?#]/.test(configuredApiUrl)) return null;
  const originCandidate = configuredApiUrl.replace(/\/+$/, "");

  try {
    const parsedUrl = new URL(originCandidate);
    if (
      !["http:", "https:"].includes(parsedUrl.protocol) ||
      parsedUrl.username ||
      parsedUrl.password ||
      parsedUrl.pathname !== "/"
    ) {
      return null;
    }
    return parsedUrl.origin;
  } catch {
    return null;
  }
};

const getConfiguredApiOrigin = () => parseApiOrigin(
  typeof window === "undefined"
    ? process.env.INTERNAL_API_URL?.trim() || process.env.NEXT_PUBLIC_API_URL?.trim()
    : process.env.NEXT_PUBLIC_API_URL?.trim()
);

export const buildApiUrl = (path: string) => {
  if (
    /^(?:https?|data|blob):/i.test(path)
  ) {
    return path;
  }

  const apiOrigin = getConfiguredApiOrigin();
  return apiOrigin ? new URL(path, `${apiOrigin}/`).toString() : path;
};

const getServerSiteOrigin = () => {
  if (typeof window !== "undefined") {
    return "";
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) {
    return "";
  }

  try {
    return new URL(siteUrl).origin;
  } catch {
    return "";
  }
};

export const withServerOriginHeader = (headers?: HeadersInit) => {
  const nextHeaders = new Headers(headers);
  const serverOrigin = getServerSiteOrigin();

  if (serverOrigin && !nextHeaders.has("Origin")) {
    nextHeaders.set("Origin", serverOrigin);
  }

  return nextHeaders;
};

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  options: NextRequestInit = {},
  timeoutMs = 15_000
) {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException("The request took too long. Please try again.", "TimeoutError"));
  }, timeoutMs);
  const abort = () => controller.abort(
    options.signal?.reason || new DOMException("The request was interrupted. Please try again.", "AbortError")
  );
  if (options.signal?.aborted) abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    return await fetch(input, { ...options, signal: controller.signal });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    const message = error instanceof Error ? error.message : "";

    if (timedOut || name === "TimeoutError") {
      throw new ApiRequestError("The request took too long. Please try again.", 408);
    }
    if (controller.signal.aborted || name === "AbortError" || /signal is aborted|aborted without reason/i.test(message)) {
      throw new ApiRequestError("The request was interrupted. Please try again.", 0);
    }
    if (name === "TypeError" && /failed to fetch|networkerror|load failed/i.test(message)) {
      throw new ApiRequestError("Could not reach the server. Check your connection and try again.", 0);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}

export async function readApiResponse<T>(
  response: Response,
  fallbackMessage = "Request failed."
) {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    try {
      return (await response.json()) as ApiEnvelope<T>;
    } catch {
      return {
        success: false,
        message: fallbackMessage,
      } as ApiEnvelope<T>;
    }
  }

  const text = await response.text();
  const trimmedText = text.trim();
  const isSafePlainText =
    contentType.includes("text/plain") &&
    trimmedText.length > 0 &&
    trimmedText.length <= 500 &&
    !/<(?:!doctype|html|body|script)\b/i.test(trimmedText);
  return {
    success: false,
    message: isSafePlainText
      ? trimmedText
      : fallbackMessage || `Request failed with status ${response.status}.`,
  } as ApiEnvelope<T>;
}

export async function parseApiResponse<T>(
  response: Response,
  fallbackMessage = "Request failed."
) {
  const data = await readApiResponse<T>(response, fallbackMessage);

  if (!response.ok || data.success === false) {
    throw new ApiRequestError(data.message || fallbackMessage, response.status);
  }

  return data as ApiEnvelope<T> & { success: true };
}

export async function fetchApiJson<T>(
  path: string,
  options: NextRequestInit = {},
  fallbackMessage = "Request failed."
) {
  const response = await fetchWithTimeout(buildApiUrl(path), {
    ...options,
    headers: withServerOriginHeader(options.headers),
  });
  return parseApiResponse<T>(response, fallbackMessage);
}
