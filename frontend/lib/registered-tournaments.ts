const STORAGE_KEY = "quest-registered-tournaments";

const isBrowser = () => typeof window !== "undefined";

export const getRegisteredTournamentSlugs = () => {
  if (!isBrowser()) {
    return [];
  }

  try {
    const storedValue = window.localStorage.getItem(STORAGE_KEY);
    if (!storedValue) {
      return [];
    }

    const parsedValue = JSON.parse(storedValue);
    return Array.isArray(parsedValue)
      ? parsedValue.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
};

export const isTournamentRegisteredLocally = (slug: string) =>
  getRegisteredTournamentSlugs().includes(slug);

export const markTournamentRegistered = (slug: string) => {
  if (!isBrowser()) {
    return;
  }

  const registeredSlugs = new Set(getRegisteredTournamentSlugs());
  registeredSlugs.add(slug);

  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(Array.from(registeredSlugs))
  );
  window.dispatchEvent(
    new CustomEvent("quest:tournament-registered", {
      detail: { slug },
    })
  );
};
