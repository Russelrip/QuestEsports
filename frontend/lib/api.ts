export type ApiEnvelope<T> = T & {
  success?: boolean;
  message?: string;
};

export const buildApiUrl = (path: string) => {
  if (
    path.startsWith("http://") ||
    path.startsWith("https://") ||
    path.startsWith("data:") ||
    path.startsWith("blob:")
  ) {
    return path;
  }

  const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || "";
  return apiBaseUrl ? `${apiBaseUrl}${path}` : path;
};

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
  return {
    success: false,
    message: text || `Request failed with status ${response.status}.`,
  } as ApiEnvelope<T>;
}

export async function parseApiResponse<T>(
  response: Response,
  fallbackMessage = "Request failed."
) {
  const data = await readApiResponse<T>(response, fallbackMessage);

  if (!response.ok || data.success === false) {
    throw new Error(data.message || fallbackMessage);
  }

  return data as ApiEnvelope<T> & { success: true };
}

export async function fetchApiJson<T>(
  path: string,
  options: RequestInit = {},
  fallbackMessage = "Request failed."
) {
  const response = await fetch(buildApiUrl(path), options);
  return parseApiResponse<T>(response, fallbackMessage);
}
