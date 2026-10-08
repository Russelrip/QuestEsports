import { adminRequest } from "@/lib/admin";

// Accounts for bots and agents. Mirrors the payloads of
// backend/src/modules/service-accounts/service-account.service.js; every route
// is super admin only, and the backend is what enforces that.

export type ServiceTokenStatus = "active" | "expired" | "revoked";

export type ServiceToken = {
  id: string;
  name: string;
  tokenPrefix: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  revokedAt: string | null;
  status: ServiceTokenStatus;
  createdBy: { id: string; username: string } | null;
};

export type ServiceAccount = {
  id: string;
  name: string;
  username: string;
  createdAt: string;
  staffRoles: Array<{ id: string; name: string; color: string | null; permissions: string[] }>;
  tokens: ServiceToken[];
};

export type ServiceAccountList = {
  accounts: ServiceAccount[];
  tokenDays: { default: number; max: number };
};

const basePath = "/api/v1/admin/service-accounts";

export const fetchServiceAccounts = async () =>
  (await adminRequest<{ data: ServiceAccountList }>(basePath)).data;

export const createServiceAccount = async (name: string) =>
  (await adminRequest<{ data: ServiceAccount }>(basePath, { method: "POST", json: { name } })).data;

// The response is the only time the token is ever readable.
export const issueServiceToken = async (accountId: string, input: { name: string; expiresInDays: number }) =>
  (await adminRequest<{ data: { token: string; account: ServiceAccount } }>(
    `${basePath}/${encodeURIComponent(accountId)}/tokens`,
    { method: "POST", json: input }
  )).data;

export const revokeServiceToken = async (accountId: string, tokenId: string) =>
  (await adminRequest<{ data: ServiceAccount }>(
    `${basePath}/${encodeURIComponent(accountId)}/tokens/${encodeURIComponent(tokenId)}`,
    { method: "DELETE" }
  )).data;
