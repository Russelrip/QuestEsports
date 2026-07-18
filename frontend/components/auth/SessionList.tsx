"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { apiFetch, apiFetchJson, UserSession, getApiErrorMessage } from "@/lib/auth";
import { readApiResponse } from "@/lib/api";

const parseSessionDevice = (session: UserSession) => {
  const agent = session.userAgent || "";
  const browserMatch =
    agent.match(/OPR\/(\d+)/)?.[1] ? ["Opera", agent.match(/OPR\/(\d+)/)?.[1]] :
    agent.match(/Edg(?:A|iOS)?\/(\d+)/)?.[1] ? ["Microsoft Edge", agent.match(/Edg(?:A|iOS)?\/(\d+)/)?.[1]] :
    agent.match(/Firefox\/(\d+)/)?.[1] ? ["Firefox", agent.match(/Firefox\/(\d+)/)?.[1]] :
    agent.match(/(?:Chrome|CriOS)\/(\d+)/)?.[1] ? ["Chrome", agent.match(/(?:Chrome|CriOS)\/(\d+)/)?.[1]] :
    agent.includes("Safari/") && agent.match(/Version\/(\d+)/)?.[1] ? ["Safari", agent.match(/Version\/(\d+)/)?.[1]] :
    ["Unknown browser", null];

  let device = "Unknown device";
  let platform = "Unknown platform";
  let type = "Device";
  if (/Android/i.test(agent)) {
    const model = agent.match(/Android[^;)]*;\s*([^;)]+?)(?:\s+Build\/|;|\))/i)?.[1]?.trim();
    const isSamsung = model?.startsWith("SM-");
    device = model ? `${isSamsung ? "Samsung phone" : "Android device"} (${model})` : "Android phone";
    platform = agent.match(/Android\s+([\d.]+)/i)?.[1] ? `Android ${agent.match(/Android\s+([\d.]+)/i)?.[1]}` : "Android";
    type = "Mobile";
  } else if (/iPhone/i.test(agent)) {
    device = "iPhone";
    platform = "iOS";
    type = "Mobile";
  } else if (/iPad/i.test(agent)) {
    device = "iPad";
    platform = "iPadOS";
    type = "Tablet";
  } else if (/Windows NT 10\.0/i.test(agent)) {
    device = "Windows computer";
    platform = "Windows 10 or 11";
    type = "Desktop";
  } else if (/Mac OS X/i.test(agent)) {
    device = "Mac";
    platform = "macOS";
    type = "Desktop";
  } else if (/Linux/i.test(agent)) {
    device = "Linux computer";
    platform = "Linux";
    type = "Desktop";
  }

  const [browser, version] = browserMatch;
  return { title: `${browser} on ${device}`, detail: `${type} · ${platform}${version ? ` · ${browser} ${version}` : ""}` };
};

const formatTimestamp = (value?: string | null) => {
  if (!value) {
    return "Unknown";
  }

  return new Date(value).toLocaleString();
};

const formatRelativeTime = (value?: string | null) => {
  if (!value) return "Unknown";
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (Math.abs(seconds) < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  return formatter.format(Math.round(hours / 24), "day");
};

export default function SessionList() {
  const [sessions, setSessions] = useState<UserSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState("");

  const loadSessions = async () => {
    try {
      setIsLoading(true);
      const { response, data } = await apiFetchJson<{
        success?: boolean;
        message?: string;
        sessions?: UserSession[];
      }>("/api/sessions");

      const errorMessage = getApiErrorMessage(response, data, "Failed to load sessions.");
      if (errorMessage) {
        setMessage(errorMessage);
        return;
      }

      setSessions(data.sessions || []);
      setMessage("");
    } catch (error) {
      console.error("Failed to load sessions:", error);
      setMessage("Something went wrong while loading active sessions.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadSessions();
  }, []);

  const revokeSession = async (sessionId: string) => {
    try {
      const response = await apiFetch(`/api/sessions/${sessionId}`, {
        method: "DELETE",
      });
      const data = await readApiResponse<{ success?: boolean; message?: string }>(
        response,
        "Failed to revoke the session."
      );

      if (!response.ok || !data.success) {
        setMessage(data.message || "Failed to revoke the session.");
        return;
      }

      setMessage(data.message || "Session revoked successfully.");
      await loadSessions();
    } catch (error) {
      console.error("Failed to revoke session:", error);
      setMessage("Something went wrong while revoking the session.");
    }
  };

  const revokeOthers = async () => {
    if (!window.confirm("Sign out every other device? You will stay signed in on this device.")) return;
    try {
      const response = await apiFetch("/api/sessions/revoke-others", {
        method: "POST",
      });
      const data = await readApiResponse<{ success?: boolean; message?: string }>(
        response,
        "Failed to revoke other sessions."
      );

      if (!response.ok || !data.success) {
        setMessage(data.message || "Failed to revoke other sessions.");
        return;
      }

      setMessage(data.message || "Other sessions were revoked.");
      await loadSessions();
    } catch (error) {
      console.error("Failed to revoke other sessions:", error);
      setMessage("Something went wrong while revoking the other sessions.");
    }
  };

  return (
    <div className="rounded-[24px] border border-white/8 bg-white/5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-2xl text-white">Active Sessions</h3>
          <p className="mt-2 text-sm text-slate-400">
            Review where your account is signed in and revoke devices you no longer trust.
          </p>
        </div>
        <Button type="button" variant="ghost" disabled={!sessions.some((session) => !session.isCurrent)} onClick={revokeOthers}>
          Sign out other devices
        </Button>
      </div>

      {message ? <p className="mt-4 text-sm text-slate-300">{message}</p> : null}

      {isLoading ? (
        <p className="mt-5 text-sm text-slate-400">Loading active sessions...</p>
      ) : sessions.length === 0 ? (
        <p className="mt-5 text-sm text-slate-400">No active sessions found.</p>
      ) : (
        <div className="mt-5 grid gap-4">
          {sessions.map((session) => {
            const device = parseSessionDevice(session);
            return (
            <div key={session.id} className={`rounded-[20px] border p-4 ${session.isCurrent ? "border-emerald-300/20 bg-emerald-400/[0.04]" : "border-white/8 bg-black/20"}`}>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-start gap-3">
                    <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/8 text-lg">{device.detail.startsWith("Mobile") ? "◧" : "▱"}</span>
                    <div>
                      <p className="font-medium text-white">{device.title}</p>
                      <p className="mt-1 text-sm text-slate-400">{device.detail}</p>
                    </div>
                  </div>
                  <dl className="mt-4 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
                    <div><dt className="text-slate-500">Last active</dt><dd className="text-slate-300" title={formatTimestamp(session.lastSeenAt)}>{session.isCurrent ? "Active now" : formatRelativeTime(session.lastSeenAt)}</dd></div>
                    <div><dt className="text-slate-500">Signed in</dt><dd className="text-slate-300" title={formatTimestamp(session.createdAt)}>{formatRelativeTime(session.createdAt)}</dd></div>
                    <div><dt className="text-slate-500">Session expires</dt><dd className="text-slate-300" title={formatTimestamp(session.expiresAt)}>{formatRelativeTime(session.expiresAt)}</dd></div>
                  {session.ipAddress ? (
                    <div><dt className="text-slate-500">Network address</dt><dd className="font-mono text-xs text-slate-300">{session.ipAddress}</dd></div>
                  ) : null}
                  </dl>
                </div>

                {session.isCurrent ? (
                  <span className="rounded-full bg-emerald-400/10 px-3 py-2 text-xs font-medium text-emerald-200">
                    This device
                  </span>
                ) : (
                  <Button type="button" variant="secondary" onClick={() => revokeSession(session.id)}>
                    Sign out
                  </Button>
                )}
              </div>
            </div>
          );})}
        </div>
      )}
    </div>
  );
}
