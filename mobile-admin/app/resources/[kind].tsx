import { useLocalSearchParams } from "expo-router";
import { OperationsScreen, type ListCard } from "@/components/OperationsScreen";
import type { RecordAction } from "@/components/DetailModal";
import { formatDate, formatMoney, humanize } from "@/theme";
import type { AdminUser, ContactMessage, GameCategorySummary, ProductSummary, RecruitmentApplication, TeamSummary, TournamentSummary } from "@/types";

type Identified = { id: string; [key: string]: unknown };
type ResourceConfig<T extends Identified> = {
  title: string;
  subtitle: string;
  endpoint: string;
  responseKey: string;
  filters?: Array<{ label: string; value: string }>;
  filterKey?: string;
  searchable?: boolean;
  card: (item: T) => ListCard;
  detailPath?: (item: T) => string;
  detailKey?: string;
  actions?: (item: T, detail: Record<string, unknown>) => RecordAction[];
};

const deleteAction = (label: string, path: string): RecordAction => ({
  label: `Delete ${label}`,
  tone: "danger",
  method: "DELETE",
  path,
  confirm: `Permanently delete this ${label}? This cannot be undone.`,
});

const configs: Record<string, ResourceConfig<Identified>> = {
  recruitment: {
    title: "Recruitment",
    subtitle: "Applicant review queue",
    endpoint: "/api/admin/recruitment-applications",
    responseKey: "applications",
    filters: ["", "pending", "reviewed", "accepted", "rejected"].map((value) => ({ label: value ? humanize(value) : "All", value })),
    card: (raw) => {
      const item = raw as RecruitmentApplication;
      return { title: item.fullName, subtitle: `${humanize(item.applicationType)} · ${item.game}`, status: item.status, meta: [item.email, item.teamName || "Individual", formatDate(item.createdAt)] };
    },
    actions: (raw) => {
      const item = raw as RecruitmentApplication;
      return ["reviewed", "accepted", "rejected"].filter((status) => status !== item.status).map((status) => ({ label: humanize(status), tone: status === "rejected" ? "danger" : "primary", method: "PATCH", path: `/api/admin/recruitment-applications/${item.id}/status`, body: { status } })) as RecordAction[];
    },
  },
  messages: {
    title: "Messages",
    subtitle: "Contact and support inbox",
    endpoint: "/api/admin/contact-messages",
    responseKey: "messages",
    filters: [{ label: "All", value: "" }, { label: "Unread", value: "false" }, { label: "Read", value: "true" }],
    filterKey: "isRead",
    card: (raw) => {
      const item = raw as ContactMessage;
      return { title: item.subject, subtitle: `${item.name} · ${item.email}`, status: item.isRead ? "reviewed" : "pending", meta: [item.message.slice(0, 100), formatDate(item.createdAt)] };
    },
    actions: (raw) => {
      const item = raw as ContactMessage;
      return [
        { label: item.isRead ? "Mark unread" : "Mark read", tone: "primary", method: "PATCH", path: `/api/admin/contact-messages/${item.id}`, body: { isRead: !item.isRead } },
        deleteAction("message", `/api/admin/contact-messages/${item.id}`),
      ];
    },
  },
  users: {
    title: "Users",
    subtitle: "Accounts and access roles",
    endpoint: "/api/admin/users",
    responseKey: "users",
    filters: [{ label: "All", value: "" }, { label: "Admins", value: "admin" }, { label: "Users", value: "user" }],
    filterKey: "role",
    card: (raw) => {
      const item = raw as AdminUser;
      return { title: `${item.firstName} ${item.lastName}`, subtitle: `@${item.username} · ${item.email}`, status: item.role, secondaryStatus: item.emailVerified ? "verified" : "pending", meta: [item.lastLoginAt ? `Last login ${formatDate(item.lastLoginAt)}` : "Never signed in"] };
    },
    detailPath: (raw) => `/api/admin/users/${raw.id}`,
    detailKey: "user",
    actions: (raw, detail) => {
      const item = { ...(raw as AdminUser), ...detail } as AdminUser;
      const nextRole = item.role === "admin" ? "user" : "admin";
      return [
        { label: nextRole === "admin" ? "Promote to admin" : "Remove admin", tone: nextRole === "admin" ? "primary" : "danger", method: "PATCH", path: `/api/admin/users/${item.id}`, confirm: `Change this account to ${nextRole}?`, body: { ...item, role: nextRole, password: "", confirmPassword: "" } },
        deleteAction("user", `/api/admin/users/${item.id}`),
      ];
    },
  },
  teams: {
    title: "Teams",
    subtitle: "Saved teams and rosters",
    endpoint: "/api/admin/teams",
    responseKey: "teams",
    card: (raw) => {
      const item = raw as TeamSummary;
      return { title: item.name, subtitle: `${item.teamTag || "No tag"} · ${item.organizationName}`, status: "verified", meta: [`Captain: ${item.captainName}`, `${item.memberCount} members`, formatDate(item.updatedAt)] };
    },
    detailPath: (raw) => `/api/admin/teams/${raw.id}`,
    detailKey: "team",
    actions: (raw) => [
      { label: "Change organization", tone: "secondary", method: "PATCH", path: `/api/admin/teams/${raw.id}/organization`, inputLabel: "Organization name (or Independent)", buildBody: (organizationName) => ({ organizationName }) },
      deleteAction("team", `/api/admin/teams/${raw.id}`),
    ],
  },
  tournaments: {
    title: "Tournaments",
    subtitle: "Events, capacity and brackets",
    endpoint: "/api/admin/tournaments",
    responseKey: "tournaments",
    filters: ["", "draft", "registration_open", "ongoing", "completed", "cancelled"].map((value) => ({ label: value ? humanize(value) : "All", value })),
    card: (raw) => {
      const item = raw as TournamentSummary;
      return { title: item.title, subtitle: `${humanize(item.game)} · ${item.slug}`, status: item.status, secondaryStatus: item.isPublished ? "published" : "unpublished", meta: [`${item.capacityUsed ?? item.registrationCount}/${item.maxTeams || "∞"} capacity`, item.prizePool || "No prize pool", formatDate(item.startDate)] };
    },
    detailPath: (raw) => `/api/admin/tournaments/${raw.id}`,
    detailKey: "tournament",
    actions: (raw) => [
      { label: "Generate bracket", tone: "primary", method: "POST", path: `/api/admin/tournaments/${raw.id}/bracket/generate`, confirm: "Generate a native bracket from approved teams?" },
      deleteAction("tournament", `/api/admin/tournaments/${raw.id}`),
    ],
  },
  products: {
    title: "Products",
    subtitle: "Merchandise catalogue",
    endpoint: "/api/admin/products",
    responseKey: "products",
    searchable: false,
    card: (raw) => {
      const item = raw as ProductSummary;
      const variants = Array.isArray(item.variants) ? item.variants as Array<{ price?: number; stock?: number | null }> : [];
      const price = variants[0]?.price || 0;
      const stock = variants.reduce((total, variant) => total + (variant.stock || 0), 0);
      return { title: item.name, subtitle: item.slug, status: item.status, meta: [formatMoney(price, item.currency), `${variants.length} variants · ${stock} tracked stock`] };
    },
    actions: (raw, detail) => {
      const item = { ...raw, ...detail };
      return ["draft", "active", "archived"].filter((status) => status !== item.status).map((status) => ({ label: `Set ${status}`, tone: status === "archived" ? "danger" : "primary", method: "PATCH", path: `/api/admin/products/${item.id}`, body: { ...item, status } })) as RecordAction[];
    },
  },
  series: {
    title: "Event series",
    subtitle: "Tournament collections",
    endpoint: "/api/admin/event-series",
    responseKey: "series",
    searchable: false,
    card: (item) => ({ title: String(item.name || item.title || "Series"), subtitle: String(item.slug || ""), status: item.isPublished ? "published" : "draft", meta: [String(item.description || "").slice(0, 100)] }),
    actions: (item) => [deleteAction("series", `/api/admin/event-series/${item.id}`)],
  },
  games: {
    title: "Game categories",
    subtitle: "Games available to tournaments",
    endpoint: "/api/admin/game-categories",
    responseKey: "categories",
    searchable: false,
    card: (raw) => {
      const item = raw as GameCategorySummary;
      return {
        title: item.displayName,
        subtitle: item.slug,
        status: item.isPublished ? "published" : "draft",
        meta: [`${item.tournamentCount || 0} tournaments`],
      };
    },
    actions: (item) => [deleteAction("game category", `/api/admin/game-categories/${item.id}`)],
  },
  rulebooks: {
    title: "Rulebooks",
    subtitle: "Competition rule documents",
    endpoint: "/api/rulebooks",
    responseKey: "rulebooks",
    searchable: false,
    card: (item) => ({ title: String(item.title || item.name || "Rulebook"), subtitle: String(item.slug || ""), status: item.isPublished === false ? "draft" : "published", meta: [formatDate(String(item.updatedAt || item.createdAt || ""))] }),
    actions: (item) => [deleteAction("rulebook", `/api/admin/rulebooks/${item.id}`)],
  },
};

export default function ResourceRoute() {
  const { kind } = useLocalSearchParams<{ kind: string }>();
  const config = configs[kind || ""];
  if (!config) {
    return <OperationsScreen<Identified> title="Unknown resource" subtitle="This section is not configured." endpoint="/api/health" responseKey="items" mapCard={() => ({ title: "Unknown" })} />;
  }
  return (
    <OperationsScreen<Identified>
      title={config.title}
      subtitle={config.subtitle}
      endpoint={config.endpoint}
      responseKey={config.responseKey}
      filters={config.filters}
      filterKey={config.filterKey}
      searchable={config.searchable}
      mapCard={config.card}
      detailPath={config.detailPath}
      detailKey={config.detailKey}
      actions={config.actions}
    />
  );
}
