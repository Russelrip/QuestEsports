import { fetchApiJson } from "@/lib/api";

export type Rulebook = {
  id: string;
  slug: string;
  title: string;
  game: string;
  variant: string;
  content: string;
  tournamentCount?: number;
  createdAt: string;
  updatedAt: string;
};

export const fetchRulebooks = async () => {
  const data = await fetchApiJson<{ rulebooks: Rulebook[] }>("/api/rulebooks", {
    cache: "no-store",
  });
  return data.rulebooks;
};

export const fetchRulebookBySlug = async (slug: string) => {
  const data = await fetchApiJson<{ rulebook: Rulebook }>(
    `/api/rulebooks/${encodeURIComponent(slug)}`,
    { cache: "no-store" }
  );
  return data.rulebook;
};
