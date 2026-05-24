"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { apiFetch, apiFetchJson, UserSession, getApiErrorMessage } from "@/lib/auth";

const formatSessionName = (session: UserSession) => {
  const agent = session.userAgent?.trim();
  if (agent) {
    return agent;
  }

  return session.isCurrent ? "Current device" : "Unknown device";
};

const formatTimestamp = (value?: string | null) => {
  if (!value) {
    return "Unknown";
  }

  return new Date(value).toLocaleString();
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
      const data = await response.json();

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
    try {
      const response = await apiFetch("/api/sessions/revoke-others", {
        method: "POST",
      });
      const data = await response.json();

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
        <Button type="button" variant="ghost" onClick={revokeOthers}>
          Revoke Other Sessions
        </Button>
      </div>

      {message ? <p className="mt-4 text-sm text-slate-300">{message}</p> : null}

      {isLoading ? (
        <p className="mt-5 text-sm text-slate-400">Loading active sessions...</p>
      ) : sessions.length === 0 ? (
        <p className="mt-5 text-sm text-slate-400">No active sessions found.</p>
      ) : (
        <div className="mt-5 grid gap-4">
          {sessions.map((session) => (
            <div key={session.id} className="rounded-[20px] border border-white/8 bg-black/20 p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-medium text-white">{formatSessionName(session)}</p>
                  <p className="mt-2 text-sm text-slate-400">
                    Last seen {formatTimestamp(session.lastSeenAt)}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    Started {formatTimestamp(session.createdAt)}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    Expires {formatTimestamp(session.expiresAt)}
                  </p>
                  {session.ipAddress ? (
                    <p className="mt-1 text-sm text-slate-500">IP {session.ipAddress}</p>
                  ) : null}
                </div>

                {session.isCurrent ? (
                  <span className="rounded-full bg-emerald-400/10 px-3 py-2 text-xs font-medium text-emerald-200">
                    Current session
                  </span>
                ) : (
                  <Button type="button" variant="secondary" onClick={() => revokeSession(session.id)}>
                    Revoke
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
