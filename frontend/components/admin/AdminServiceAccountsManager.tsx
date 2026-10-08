"use client";

import { useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/admin/AdminShell";
import AdminUserStaffRoles from "@/components/admin/AdminUserStaffRoles";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import EmptyState from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { useToastStore } from "@/hooks/useToastStore";
import { formatSriLankaDateTime } from "@/lib/date-time";
import {
  createServiceAccount,
  fetchServiceAccounts,
  issueServiceToken,
  revokeServiceToken,
  type ServiceAccount,
  type ServiceAccountList,
  type ServiceToken,
} from "@/lib/service-accounts";
import { isSuperAdmin } from "@/lib/staff-permissions";
import { cn } from "@/lib/utils";

const formatWhen = (value: string | null) =>
  value ? formatSriLankaDateTime(value, { dateStyle: "medium", timeStyle: "short" }) : "Never";

const STATUS_STYLES: Record<ServiceToken["status"], string> = {
  active: "border-emerald-300/30 bg-emerald-400/10 text-emerald-100",
  expired: "border-slate-300/20 bg-white/5 text-slate-300",
  revoked: "border-red-300/30 bg-red-400/10 text-red-100",
};

// A token freshly issued is held here and nowhere else: it is not in the list
// response, not in local storage, and is dropped the moment it is dismissed or
// another account is opened. The server cannot show it again.
type IssuedToken = { accountId: string; tokenName: string; token: string };

// Accounts for bots and agents. A service account is never an admin, so what it
// can open is exactly the staff roles given to it here, and it signs in only
// with the tokens issued here. Super admin only, as the backend enforces.
export default function AdminServiceAccountsManager() {
  const { user } = useAuth();
  const canManage = isSuperAdmin(user);
  const showToast = useToastStore((state) => state.showToast);

  const [list, setList] = useState<ServiceAccountList | null>(null);
  const [loadError, setLoadError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [tokenName, setTokenName] = useState("");
  const [tokenDays, setTokenDays] = useState("");
  const [issued, setIssued] = useState<IssuedToken | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const next = await fetchServiceAccounts();
    setList(next);
    return next;
  }, []);

  useEffect(() => {
    if (!canManage) return;
    load().catch((error) => setLoadError(error instanceof Error ? error.message : "Could not load service accounts."));
  }, [canManage, load]);

  const selected = list?.accounts.find((account) => account.id === selectedId) ?? null;

  const replaceAccount = (account: ServiceAccount) =>
    setList((current) => current && {
      ...current,
      accounts: current.accounts.map((existing) => (existing.id === account.id ? account : existing)),
    });

  const select = (accountId: string) => {
    if (issued && !window.confirm("The token you just issued will not be shown again. Leave it?")) return;
    setIssued(null);
    setSelectedId(accountId);
    setTokenName("");
    setTokenDays("");
  };

  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    try {
      const account = await createServiceAccount(newName);
      await load();
      setNewName("");
      setIssued(null);
      setSelectedId(account.id);
      showToast({ tone: "success", title: "Service account created", description: `${account.name} can reach nothing until you give it a role.` });
    } catch (error) {
      showToast({ tone: "error", title: "Unable to create service account", description: error instanceof Error ? error.message : "Request failed." });
    } finally {
      setBusy(false);
    }
  };

  const issue = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || !list) return;
    setBusy(true);
    try {
      const expiresInDays = tokenDays ? Number(tokenDays) : list.tokenDays.default;
      const result = await issueServiceToken(selected.id, { name: tokenName, expiresInDays });
      replaceAccount(result.account);
      setIssued({ accountId: selected.id, tokenName, token: result.token });
      setTokenName("");
      setTokenDays("");
    } catch (error) {
      showToast({ tone: "error", title: "Unable to issue token", description: error instanceof Error ? error.message : "Request failed." });
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (token: ServiceToken) => {
    if (!selected) return;
    if (!window.confirm(`Revoke "${token.name}" (${token.tokenPrefix}…)? Anything using it stops working on its next request.`)) return;
    setBusy(true);
    try {
      replaceAccount(await revokeServiceToken(selected.id, token.id));
      showToast({ tone: "success", title: "Token revoked", description: `${token.name} no longer authenticates.` });
    } catch (error) {
      showToast({ tone: "error", title: "Unable to revoke token", description: error instanceof Error ? error.message : "Request failed." });
    } finally {
      setBusy(false);
    }
  };

  const copyIssued = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.token);
      showToast({ tone: "success", title: "Token copied", description: "Put it in the bot's secret store now." });
    } catch {
      showToast({ tone: "error", title: "Copy failed", description: "Select the token and copy it by hand." });
    }
  };

  return (
    <AdminShell
      title="Service Accounts"
      description="Accounts for bots and agents. Each one can open only the areas its roles grant, signs in only with a token, and is recorded in the audit log as a bot."
    >
      {!canManage ? (
        <Card className="border-amber-300/20 bg-amber-400/5 p-4 text-sm text-amber-100">
          Only a super admin can see or manage service accounts, because a token is a standing credential.
        </Card>
      ) : loadError ? (
        <EmptyState description={loadError} />
      ) : !list ? (
        <EmptyState description="Loading service accounts…" />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          <Card className="h-fit p-4 sm:p-5">
            <h3 className="mb-3 text-lg text-white">Accounts <span className="text-slate-500">— {list.accounts.length}</span></h3>
            {list.accounts.length === 0 ? (
              <p className="px-1 py-4 text-sm text-slate-400">No service accounts yet.</p>
            ) : (
              <ul className="mb-4 grid gap-1">
                {list.accounts.map((account) => {
                  const active = account.tokens.filter((token) => token.status === "active").length;
                  return (
                    <li key={account.id}>
                      <button
                        type="button"
                        aria-current={account.id === selectedId ? "true" : undefined}
                        onClick={() => select(account.id)}
                        className={cn(
                          "flex w-full min-w-0 items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition",
                          account.id === selectedId ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5 hover:text-white"
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate">{account.name}</span>
                        <span className="shrink-0 text-xs text-slate-500" title={`${active} active token${active === 1 ? "" : "s"}`}>
                          {active} active
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <form className="grid gap-3 border-t border-white/10 pt-4" onSubmit={create}>
              <FormField label="New service account" htmlFor="service-account-name" hint="Name it after what it is, such as Roster Agent.">
                <Input
                  id="service-account-name"
                  value={newName}
                  maxLength={60}
                  required
                  onChange={(event) => setNewName(event.target.value)}
                />
              </FormField>
              <Button type="submit" variant="secondary" disabled={busy || !newName.trim()}>Create account</Button>
            </form>
          </Card>

          {!selected ? (
            <EmptyState
              title="Choose a service account"
              description="Give it roles for the areas it needs, then issue a token for each place it runs."
            />
          ) : (
            <div className="grid gap-6">
              <Card className="p-6 sm:p-8">
                <h3 className="text-2xl text-white">{selected.name}</h3>
                <p className="mt-1 text-sm text-slate-400">
                  @{selected.username} · created {formatWhen(selected.createdAt)}. It can never be an admin, cannot sign in with a
                  password, and is not shown under Users.
                </p>
              </Card>

              <AdminUserStaffRoles
                userId={selected.id}
                username={selected.username}
                isAdmin={false}
                canManage={canManage}
                onSaved={() => void load()}
              />

              <Card className="p-6 sm:p-8">
                <h3 className="text-2xl text-white">Tokens</h3>
                <p className="mt-1 text-sm text-slate-400">
                  One token per place the bot runs, so one can be revoked without stopping the others. The bot sends it as{" "}
                  <code className="text-slate-200">Authorization: Bearer &lt;token&gt;</code> with no session cookie.
                </p>

                {issued && issued.accountId === selected.id ? (
                  <div role="status" className="mt-5 border border-amber-300/30 bg-amber-400/[0.08] p-4">
                    <p className="text-sm font-semibold text-amber-100">
                      Copy &quot;{issued.tokenName}&quot; now. It will not be shown again.
                    </p>
                    <code className="mt-3 block break-all rounded bg-black/40 p-3 text-xs text-white select-all">{issued.token}</code>
                    <div className="mt-3 flex flex-wrap gap-3">
                      <Button type="button" onClick={() => void copyIssued()}>Copy token</Button>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          if (window.confirm("Have you stored the token? It cannot be shown again.")) setIssued(null);
                        }}
                      >
                        I&apos;ve stored it
                      </Button>
                    </div>
                  </div>
                ) : null}

                <form className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-end" onSubmit={issue}>
                  <FormField label="Where it will be used" htmlFor="service-token-name">
                    <Input
                      id="service-token-name"
                      placeholder="claude-code on russel-pc"
                      value={tokenName}
                      maxLength={60}
                      required
                      onChange={(event) => setTokenName(event.target.value)}
                    />
                  </FormField>
                  <FormField label="Expires in (days)" htmlFor="service-token-days">
                    <Input
                      id="service-token-days"
                      type="number"
                      min={1}
                      max={list.tokenDays.max}
                      placeholder={String(list.tokenDays.default)}
                      value={tokenDays}
                      onChange={(event) => setTokenDays(event.target.value)}
                    />
                  </FormField>
                  <Button type="submit" disabled={busy || !tokenName.trim()}>Issue token</Button>
                </form>

                {selected.tokens.length === 0 ? (
                  <p className="mt-5 text-sm text-slate-400">No tokens issued yet.</p>
                ) : (
                  <ul className="mt-5 grid gap-3">
                    {selected.tokens.map((token) => (
                      <li key={token.id} className="flex flex-col gap-3 border border-white/10 bg-black/15 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-2 text-sm text-white">
                            <span className="truncate font-semibold">{token.name}</span>
                            <code className="text-xs text-slate-400">{token.tokenPrefix}…</code>
                            <span className={cn("rounded-full border px-2 py-0.5 text-xs", STATUS_STYLES[token.status])}>{token.status}</span>
                          </p>
                          <p className="mt-1 text-xs text-slate-400">
                            Issued {formatWhen(token.createdAt)}{token.createdBy ? ` by @${token.createdBy.username}` : ""} ·{" "}
                            {token.status === "revoked" ? `revoked ${formatWhen(token.revokedAt)}` : `expires ${formatWhen(token.expiresAt)}`} · last used{" "}
                            {formatWhen(token.lastUsedAt)}{token.lastUsedIp ? ` from ${token.lastUsedIp}` : ""}
                          </p>
                        </div>
                        {token.status === "active" ? (
                          <Button type="button" variant="danger" disabled={busy} onClick={() => void revoke(token)}>Revoke</Button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          )}
        </div>
      )}
    </AdminShell>
  );
}
