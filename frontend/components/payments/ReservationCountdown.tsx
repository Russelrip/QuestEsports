"use client";

import { useEffect, useRef, useState } from "react";

const getRemainingMilliseconds = (expiresAt: string) =>
  Math.max(0, new Date(expiresAt).getTime() - Date.now());

const formatCountdown = (remainingMilliseconds: number) => {
  const totalSeconds = Math.ceil(remainingMilliseconds / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const time = [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
  return days > 0 ? `${days}d ${time}` : time;
};

export default function ReservationCountdown({
  expiresAt,
  label = "Time left to pay",
  onExpire,
  compact = false,
}: {
  expiresAt?: string | null;
  label?: string;
  onExpire?: () => void;
  compact?: boolean;
}) {
  const [remaining, setRemaining] = useState<number | null>(null);
  const expirationReported = useRef(false);
  const onExpireRef = useRef(onExpire);

  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    if (!expiresAt) return;
    expirationReported.current = false;
    const update = () => {
      const nextRemaining = getRemainingMilliseconds(expiresAt);
      setRemaining(nextRemaining);
      if (nextRemaining === 0 && !expirationReported.current) {
        expirationReported.current = true;
        onExpireRef.current?.();
      }
    };
    const initialTimer = window.setTimeout(update, 0);
    const timer = window.setInterval(update, 1000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [expiresAt]);

  if (!expiresAt) return null;
  const expired = remaining === 0;

  return (
    <div
      className={compact
        ? `text-xs font-semibold ${expired ? "text-rose-200" : "text-amber-100"}`
        : `border p-4 ${expired ? "border-rose-300/30 bg-rose-400/10" : "border-amber-300/25 bg-amber-400/[0.06]"}`}
      role="timer"
      aria-live="polite"
    >
      <span className={compact ? "" : "text-xs uppercase tracking-[0.18em] text-slate-400"}>
        {expired ? "Payment window expired" : label}
      </span>
      {!expired ? (
        <strong className={compact ? "ml-2 tabular-nums" : "mt-2 block text-3xl tabular-nums text-white"}>
          {remaining === null ? "--:--:--" : formatCountdown(remaining)}
        </strong>
      ) : null}
    </div>
  );
}
