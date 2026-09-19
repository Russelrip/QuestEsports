"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { adminRequest, formatAdminCompactDateTime } from "@/lib/admin";
import { type TicketEvent, type ScanResult } from "./ticket-model";
import { Info } from "./ticket-ui";

export function CheckInPanel({
  event,
  onAccepted,
}: {
  event: TicketEvent;
  onAccepted: () => Promise<void>;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const scanningRef = useRef(false);
  const lastPayloadRef = useRef("");
  const [payload, setPayload] = useState("");
  const [cameraOn, setCameraOn] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState("");

  const submitScan = useCallback(
    async (value: string) => {
      const normalized = value.trim();
      if (!normalized || scanningRef.current) return;
      scanningRef.current = true;
      try {
        const data = await adminRequest<{ scan: ScanResult }>(
          `/api/admin/ticket-events/${event.id}/scan`,
          { method: "POST", json: { payload: normalized } },
        );
        setResult(data.scan);
        setError("");
        if (data.scan.accepted) await onAccepted();
        if (navigator.vibrate)
          navigator.vibrate(data.scan.accepted ? 120 : [100, 80, 100]);
      } catch (nextError) {
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Ticket could not be checked.",
        );
      } finally {
        window.setTimeout(() => {
          scanningRef.current = false;
        }, 900);
      }
    },
    [event.id, onAccepted],
  );

  const stopCamera = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setCameraOn(false);
  }, []);
  const startCamera = async () => {
    setError("");
    try {
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      const reader = new BrowserQRCodeReader();
      if (!videoRef.current) return;
      controlsRef.current = await reader.decodeFromVideoDevice(
        undefined,
        videoRef.current,
        (scanResult) => {
          const text = scanResult?.getText();
          if (!text || text === lastPayloadRef.current) return;
          lastPayloadRef.current = text;
          window.setTimeout(() => {
            if (lastPayloadRef.current === text) lastPayloadRef.current = "";
          }, 2500);
          void submitScan(text);
        },
      );
      setCameraOn(true);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Camera scanning is unavailable. Use the Android app or paste a QR value.",
      );
      stopCamera();
    }
  };
  useEffect(() => stopCamera, [stopCamera]);
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_0.8fr]">
      <Card className="overflow-hidden p-5 sm:p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h4 className="text-2xl text-white">Camera scanner</h4>
            <p className="mt-1 text-sm text-slate-400">
              Scans are verified live against {event.title}.
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => (cameraOn ? stopCamera() : void startCamera())}
          >
            {cameraOn ? "Stop camera" : "Start camera"}
          </Button>
        </div>
        <video
          ref={videoRef}
          muted
          playsInline
          className="mt-5 aspect-[4/3] w-full bg-black object-cover"
        />
        <div className="mt-5 grid gap-3">
          <Input
            value={payload}
            onChange={(input) => setPayload(input.target.value)}
            placeholder="Or paste the QR payload…"
          />
          <Button
            type="button"
            disabled={!payload.trim()}
            onClick={() => void submitScan(payload)}
          >
            Verify and check in
          </Button>
        </div>
        {error ? <p className="mt-4 text-sm text-rose-300">{error}</p> : null}
      </Card>
      <Card
        className={`p-6 ${result?.accepted ? "border-emerald-300/30 bg-emerald-400/5" : result ? "border-rose-300/30 bg-rose-400/5" : ""}`}
      >
        <p className="text-xs uppercase tracking-[0.22em] text-slate-500">
          Latest scan
        </p>
        {result ? (
          <>
            <h4
              className={`mt-4 text-3xl ${result.accepted ? "text-emerald-200" : "text-rose-200"}`}
            >
              {result.accepted ? "Admit attendee" : "Do not admit"}
            </h4>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              {result.message}
            </p>
            {result.ticket ? (
              <dl className="mt-6 grid gap-3">
                <Info label="Ticket" value={result.ticket.ticketNumber} />
                <Info
                  label="Buyer"
                  value={result.ticket.buyerName || "Unknown"}
                />
                <Info
                  label="Status"
                  value={result.ticket.status.replaceAll("_", " ")}
                />
                {result.ticket.checkedInAt ? (
                  <Info
                    label="First check-in"
                    value={formatAdminCompactDateTime(
                      result.ticket.checkedInAt,
                    )}
                  />
                ) : null}
              </dl>
            ) : null}
          </>
        ) : (
          <p className="mt-4 text-sm text-slate-400">
            Start the camera and scan a Quest ticket.
          </p>
        )}
      </Card>
    </div>
  );
}
