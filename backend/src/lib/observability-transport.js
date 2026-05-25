const DEFAULT_TIMEOUT_MS = 3000;

const postJson = async ({
  url,
  token,
  payload,
  signal,
}) => {
  if (!url) {
    return false;
  }

  const headers = {
    "Content-Type": "application/json",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Observability endpoint responded with ${response.status}.`);
  }

  return true;
};

const schedulePostJson = ({ url, token, payload, onError }) => {
  if (!url) {
    return false;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  postJson({
    url,
    token,
    payload,
    signal: controller.signal,
  })
    .catch((error) => {
      if (typeof onError === "function") {
        onError(error);
      }
    })
    .finally(() => {
      clearTimeout(timeout);
    });

  return true;
};

module.exports = {
  postJson,
  schedulePostJson,
};
