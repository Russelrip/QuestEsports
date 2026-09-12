"use client";

import { formatSriLankaDateTime } from "@/lib/date-time";
import Link from "next/link";
import SupportHelpLink from "@/components/support/SupportHelpLink";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetchJson } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button, buttonClassName } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCartStore } from "@/hooks/useCartStore";
import ReservationCountdown from "@/components/payments/ReservationCountdown";

const MAX_PROOF_SIZE = 5 * 1024 * 1024;
const ALLOWED_PROOF_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type UploadPhase = "idle" | "uploading" | "confirming" | "complete" | "failed";

type PaymentStatus = {
  orderId: string;
  status:
    | "created"
    | "pending"
    | "paid"
    | "cancelled"
    | "failed"
    | "charged_back"
    | "expired"
    | "review_required"
    | "refunded";
  amount: number;
  currency: string;
  purpose: "tournament_registration" | "merchandise_order" | "ticket_order";
  statusMessage?: string | null;
  provider: string;
  registration?: {
    expiresAt?: string | null;
    assignedSlotNumber?: number | null;
    contactLink?: string | null;
  } | null;
  ticketOrder?: { expiresAt: string } | null;
  bankTransfer?: {
    reference: string;
    assignedSlotNumber: number | null;
    amount: number;
    currency: string;
    expiresAt: string | null;
    proofSubmitted: boolean;
    bankAccount: {
      bankName: string;
      branch?: string | null;
      accountName: string;
      accountNumber: string;
    };
  } | null;
};

export default function PaymentStatusCard({
  orderId,
  returnHref = "/profile",
  publicToken,
  clearCartOnPaid = false,
  checkoutCancelled = false,
}: {
  orderId: string;
  returnHref?: string;
  publicToken?: string;
  clearCartOnPaid?: boolean;
  checkoutCancelled?: boolean;
}) {
  const [payment, setPayment] = useState<PaymentStatus | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [proof, setProof] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>("idle");
  const [uploadError, setUploadError] = useState("");
  const [fileInputKey, setFileInputKey] = useState(0);
  const [copied, setCopied] = useState<"account" | "reference" | null>(null);
  const [deadlineReached, setDeadlineReached] = useState(false);
  const attempts = useRef(0);
  const clearCart = useCartStore((state) => state.clear);

  const loadStatus = useCallback(async () => {
    setRefreshing(true);
    try {
      const { response, data } = await apiFetchJson<{
        payment?: PaymentStatus;
        message?: string;
      }>(
        `/api/payments/${encodeURIComponent(orderId)}`,
        publicToken ? { headers: { "X-Order-Token": publicToken } } : {},
      );
      if (!response.ok || !data.payment)
        throw new Error(data.message || "Payment status could not be loaded.");
      setPayment(data.payment);
      setDeadlineReached(data.payment.status === "expired");
      setError("");
      return data.payment;
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Payment status could not be loaded.",
      );
      return null;
    } finally {
      setRefreshing(false);
    }
  }, [orderId, publicToken]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      if (document.visibilityState === "hidden") {
        timer = setTimeout(poll, 10_000);
        return;
      }
      const nextPayment = await loadStatus();
      if (cancelled) return;
      attempts.current += 1;
      if (
        nextPayment &&
        ["created", "pending", "review_required"].includes(
          nextPayment.status,
        ) &&
        attempts.current < 40
      ) {
        timer = setTimeout(
          poll,
          Math.min(2500 + attempts.current * 500, 10_000),
        );
      } else if (!nextPayment && attempts.current < 8) {
        timer = setTimeout(poll, Math.min(2500 * attempts.current, 15_000));
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [loadStatus]);

  const terminalSuccess = payment?.status === "paid";
  const reservationExpired = payment?.status === "expired" || deadlineReached;
  const contactHref = payment?.registration?.contactLink || "/contact";
  const isBankTransfer =
    payment?.provider === "bank_transfer" ? payment.bankTransfer || null : null;
  const isCash = payment?.provider === "cash";
  let statusTitle = payment
    ? payment.status.replace(/_/g, " ")
    : "Checking payment…";
  if (terminalSuccess) statusTitle = "Payment confirmed";
  else if (reservationExpired) statusTitle = "Reservation expired";
  else if (checkoutCancelled || payment?.status === "cancelled")
    statusTitle = "Payment cancelled";
  else if (payment?.status === "charged_back") statusTitle = "Payment reversed";
  else if (payment?.status === "failed") statusTitle = "Proof needs attention";
  else if (payment?.status === "refunded") statusTitle = "Payment refunded";
  else if (isBankTransfer?.proofSubmitted) statusTitle = "Proof under review";
  else if (isBankTransfer) statusTitle = "Bank transfer pending";
  else if (isCash) statusTitle = "Cash payment pending";

  const copyValue = async (kind: "account" | "reference", value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      window.setTimeout(
        () => setCopied((current) => (current === kind ? null : current)),
        1800,
      );
    } catch {
      setError("Copy was unavailable. Press and hold the value to copy it.");
    }
  };

  const uploadProof = async () => {
    if (!proof || !payment) return;
    setUploading(true);
    setUploadPhase("uploading");
    setUploadError("");
    const body = new FormData();
    body.append("proof", proof);
    try {
      const { response, data } = await apiFetchJson<{ message?: string }>(
        `/api/payments/${encodeURIComponent(payment.orderId)}/bank-transfer-proof`,
        {
          method: "POST",
          body,
          ...(publicToken
            ? { headers: { "X-Order-Token": publicToken } }
            : {}),
        },
      );
      if (!response.ok)
        throw new Error(data.message || "Payment proof could not be uploaded.");
      setUploadPhase("confirming");
      setProof(null);
      setFileInputKey((current) => current + 1);
      await loadStatus();
      setUploadPhase("complete");
    } catch (nextError) {
      setUploadPhase("failed");
      setUploadError(
        nextError instanceof Error
          ? nextError.message
          : "Payment proof could not be uploaded.",
      );
    } finally {
      setUploading(false);
    }
  };

  const selectProof = (file: File | null) => {
    setUploadPhase("idle");
    setUploadError("");
    if (!file) {
      setProof(null);
      return;
    }
    if (!ALLOWED_PROOF_TYPES.has(file.type)) {
      setProof(null);
      setUploadError("Choose a JPEG, PNG, or WebP screenshot.");
      setFileInputKey((current) => current + 1);
      return;
    }
    if (file.size > MAX_PROOF_SIZE) {
      setProof(null);
      setUploadError(
        "This screenshot is larger than 5 MB. Choose a smaller image.",
      );
      setFileInputKey((current) => current + 1);
      return;
    }
    setProof(file);
  };
  useEffect(() => {
    if (terminalSuccess && clearCartOnPaid) clearCart();
  }, [clearCart, clearCartOnPaid, terminalSuccess]);
  return (
    <Card className="mx-auto min-w-0 max-w-2xl overflow-hidden p-4 text-center sm:p-10">
      <p className="text-xs uppercase tracking-[0.28em] text-purple-200/80">
        Payment Status
      </p>
      <h2 className="mt-4 text-3xl capitalize text-white sm:text-4xl">
        {statusTitle}
      </h2>
      {payment ? (
        <p className="mt-4 break-words text-sm text-slate-300 sm:text-base">
          {payment.currency} {payment.amount.toFixed(2)} · Order{" "}
          <span className="break-all">{payment.orderId}</span>
        </p>
      ) : null}
      {(payment?.registration?.expiresAt || payment?.ticketOrder?.expiresAt) &&
      !terminalSuccess &&
      !reservationExpired ? (
        <div className="mt-7 text-left">
          <ReservationCountdown
            expiresAt={
              payment.registration?.expiresAt ||
              payment.ticketOrder?.expiresAt ||
              ""
            }
            label={
              isBankTransfer?.proofSubmitted
                ? "Admin review time remaining"
                : "Time left to pay"
            }
            onExpire={() => {
              setDeadlineReached(true);
              void loadStatus();
            }}
          />
        </div>
      ) : null}
      {reservationExpired ? (
        <div className="mt-7 border border-rose-300/30 bg-rose-400/10 p-5 text-left">
          <p className="font-semibold text-rose-100">
            Your payment window ran out and the reservation was released.
          </p>
          <p className="mt-2 text-sm leading-6 text-rose-100/75">
            Start a new order if capacity is still available, or contact an
            administrator if payment was already made.
          </p>
          <Link
            href={contactHref}
            className={buttonClassName({ className: "mt-4 w-full sm:w-auto" })}
          >
            Contact Admin
          </Link>
        </div>
      ) : null}
      {isBankTransfer && terminalSuccess ? (
        <div className="mt-7 text-left">
          <ProofJourney
            paymentStatus={payment?.status}
            proofSelected={false}
            proofSubmitted={isBankTransfer.proofSubmitted}
            uploadPhase="complete"
          />
        </div>
      ) : null}
      {isBankTransfer && !terminalSuccess && !reservationExpired ? (
        <div className="mt-7 grid gap-5 text-left">
          <ProofJourney
            paymentStatus={payment?.status}
            proofSelected={Boolean(proof)}
            proofSubmitted={isBankTransfer.proofSubmitted}
            uploadPhase={uploadPhase}
          />
          <div className="min-w-0 rounded-[22px] border border-purple-300/20 bg-purple-300/5 p-4 sm:p-5">
            <p className="text-xs uppercase tracking-[0.2em] text-purple-200">
              {isBankTransfer.assignedSlotNumber
                ? `Assigned slot #${isBankTransfer.assignedSlotNumber}`
                : "Entrance payment details"}
            </p>
            <dl className="mt-4 grid gap-3 text-sm text-slate-300 sm:grid-cols-2">
              <div className="min-w-0">
                <dt className="text-slate-500">Bank</dt>
                <dd className="break-words">
                  {isBankTransfer.bankAccount.bankName}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-slate-500">Branch</dt>
                <dd className="break-words">
                  {isBankTransfer.bankAccount.branch || "—"}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-slate-500">Account name</dt>
                <dd className="break-words">
                  {isBankTransfer.bankAccount.accountName}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-slate-500">Account number</dt>
                <dd className="break-all font-semibold text-white">
                  {isBankTransfer.bankAccount.accountNumber}
                </dd>
                <button
                  type="button"
                  className="mt-1 min-h-11 text-left text-xs text-purple-200 underline"
                  onClick={() =>
                    void copyValue(
                      "account",
                      isBankTransfer.bankAccount.accountNumber,
                    )
                  }
                >
                  {copied === "account" ? "Copied" : "Copy account number"}
                </button>
              </div>
              <div className="min-w-0">
                <dt className="text-slate-500">Exact amount</dt>
                <dd>
                  {isBankTransfer.currency} {isBankTransfer.amount.toFixed(2)}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-slate-500">Transfer reference</dt>
                <dd className="break-all text-base font-semibold tracking-wider text-white sm:text-lg">
                  {isBankTransfer.reference}
                </dd>
                <button
                  type="button"
                  className="mt-1 min-h-11 text-left text-xs text-purple-200 underline"
                  onClick={() =>
                    void copyValue("reference", isBankTransfer.reference)
                  }
                >
                  {copied === "reference" ? "Copied" : "Copy reference"}
                </button>
              </div>
            </dl>
            <p className="mt-4 text-xs leading-6 text-amber-100">
              Transfer the exact amount and include the reference. Never upload
              or share a password, PIN, OTP, card number, or banking login.
            </p>
            {isBankTransfer.expiresAt ? (
              <p className="mt-2 text-xs text-slate-400">
                Upload deadline:{" "}
                {formatSriLankaDateTime(isBankTransfer.expiresAt)}
              </p>
            ) : null}
          </div>
          {payment &&
          ["created", "pending", "review_required"].includes(payment.status) ? (
            <div
              className={`min-w-0 grid gap-4 border p-4 sm:p-5 ${uploadPhase === "failed" ? "border-rose-300/30 bg-rose-400/5" : isBankTransfer.proofSubmitted || uploadPhase === "complete" ? "border-emerald-300/25 bg-emerald-400/5" : "border-white/10 bg-white/[0.02]"}`}
            >
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-purple-200">
                  Upload checkpoint
                </p>
                <h3 className="mt-1 text-xl text-white">
                  {isBankTransfer.proofSubmitted || uploadPhase === "complete"
                    ? "Proof submitted — review in progress"
                    : uploadPhase === "failed"
                      ? "Upload interrupted"
                      : proof
                        ? "Receipt ready to submit"
                        : "Add your payment receipt"}
                </h3>
                <p className="mt-1 text-xs leading-6 text-slate-400">
                  JPEG, PNG, or WebP screenshot up to 5 MB. Quest confirms the
                  payment only after matching it against the bank account.
                </p>
              </div>
              {uploading || uploadPhase === "confirming" ? (
                <UploadActivity phase={uploadPhase} />
              ) : isBankTransfer.proofSubmitted ||
                uploadPhase === "complete" ? (
                <div
                  className="border border-emerald-300/20 bg-emerald-400/10 p-4"
                  role="status"
                  aria-live="polite"
                >
                  <div className="flex items-start gap-3">
                    <span
                      className="flex size-9 shrink-0 items-center justify-center border border-emerald-300/30 bg-emerald-300/10 font-bold text-emerald-200"
                      aria-hidden="true"
                    >
                      ✓
                    </span>
                    <div className="min-w-0">
                      <p className="font-semibold text-emerald-100">
                        Checkpoint reached
                      </p>
                      <p className="mt-1 text-xs leading-5 text-emerald-100/70">
                        Your reservation remains held while the team verifies the
                        transfer. You can replace the image below if you
                        uploaded the wrong receipt.
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}
              <div className="grid gap-3">
                <Input
                  key={fileInputKey}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={uploading}
                  onChange={(event) =>
                    selectProof(event.target.files?.[0] || null)
                  }
                />
                {proof ? (
                  <div className="flex min-w-0 items-center gap-3 border border-white/10 bg-black/20 p-3">
                    <span
                      className="flex size-10 shrink-0 items-center justify-center border border-purple-300/20 bg-purple-400/10 text-lg"
                      aria-hidden="true"
                    >
                      ▣
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-white">
                        {proof.name}
                      </p>
                      <p className="text-xs text-slate-500">
                        {formatFileSize(proof.size)} · Ready for secure upload
                      </p>
                    </div>
                  </div>
                ) : null}
              </div>
              {uploadError ? (
                <div
                  className="border border-rose-300/20 bg-rose-400/10 p-3 text-sm text-rose-100"
                  role="alert"
                >
                  <p className="font-semibold">Couldn’t submit this proof</p>
                  <p className="mt-1 text-xs leading-5 text-rose-100/75">
                    {uploadError}
                  </p>
                  {proof ? (
                    <p className="mt-1 text-xs text-rose-100/75">
                      Your selected file is still ready—retry when you’re
                      connected.
                    </p>
                  ) : null}
                </div>
              ) : null}
              <Button
                type="button"
                className="w-full"
                disabled={!proof || uploading}
                onClick={() => void uploadProof()}
              >
                {uploading
                  ? "Submitting proof…"
                  : uploadPhase === "failed"
                    ? "Try upload again"
                    : isBankTransfer.proofSubmitted
                      ? "Replace proof"
                      : "Submit proof securely"}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      {isCash && !terminalSuccess && !reservationExpired ? (
        <div className="mt-7 border border-amber-300/25 bg-amber-300/5 p-5 text-left">
          <p className="font-semibold text-amber-100">Pay cash at the entrance</p>
          <p className="mt-2 text-sm leading-6 text-amber-100/75">
            Show this order reference to Quest staff and pay the exact amount.
            Your QR tickets appear only after staff confirm the cash was collected.
          </p>
          <p className="mt-3 break-all text-sm font-semibold text-white">
            Reference: {payment?.orderId}
          </p>
        </div>
      ) : null}
      <p className="mt-4 text-sm leading-7 text-slate-400">
        {reservationExpired
          ? "This reservation cannot be restarted automatically. Create another order or contact an administrator."
          : terminalSuccess
            ? isBankTransfer
              ? "Quest E-sports verified the transfer against the bank account and confirmed your payment."
              : isCash
                ? "Quest staff confirmed the cash was collected and activated your tickets."
                : "The verified PayHere notification has been saved and your record is confirmed."
            : isCash
              ? payment?.statusMessage || "Waiting for Quest staff to confirm the cash payment."
              : checkoutCancelled
              ? "You returned before payment was confirmed. Review the order status before starting another checkout."
              : isBankTransfer
                ? payment?.statusMessage ||
                  "Complete the bank transfer and upload your receipt before the reservation expires."
                : payment?.status === "created" || payment?.status === "pending"
                  ? "Waiting for PayHere to notify the server. This page updates automatically."
                  : payment?.statusMessage ||
                    "Do not retry until the final status appears."}
      </p>
      {error ? <p className="mt-3 text-sm text-rose-300" role="alert">{error}</p> : null}
      {(error || uploadError || ["failed", "expired", "review_required"].includes(payment?.status || "")) && <SupportHelpLink subject="Payment issue" />}
      <div className="mt-7 grid gap-3 sm:flex sm:flex-wrap sm:justify-center">
        <Link
          href={returnHref}
          className={buttonClassName({
            variant: "secondary",
            className: "w-full sm:w-auto",
          })}
        >
          {terminalSuccess ? "Continue" : "Return"}
        </Link>
        {payment?.purpose === "tournament_registration" ? (
          <Link
            href="/profile"
            className={buttonClassName({
              variant: "ghost",
              className: "w-full sm:w-auto",
            })}
          >
            My registrations
          </Link>
        ) : null}
        {!terminalSuccess && !reservationExpired ? (
          <button
            type="button"
            disabled={refreshing}
            onClick={() => void loadStatus()}
            className={buttonClassName({
              variant: "ghost",
              className: "w-full sm:w-auto",
            })}
          >
            {refreshing ? "Refreshing…" : "Refresh status"}
          </button>
        ) : null}
      </div>
    </Card>
  );
}

function ProofJourney({
  paymentStatus,
  proofSelected,
  proofSubmitted,
  uploadPhase,
}: {
  paymentStatus?: PaymentStatus["status"];
  proofSelected: boolean;
  proofSubmitted: boolean;
  uploadPhase: UploadPhase;
}) {
  const isConfirmed = paymentStatus === "paid";
  const reviewFailed =
    paymentStatus === "failed" ||
    paymentStatus === "expired" ||
    paymentStatus === "cancelled" ||
    paymentStatus === "charged_back" ||
    paymentStatus === "refunded";
  const currentStep = isConfirmed
    ? 3
    : reviewFailed ||
        proofSubmitted ||
        uploadPhase === "confirming" ||
        uploadPhase === "complete"
      ? 2
      : proofSelected || uploadPhase === "uploading" || uploadPhase === "failed"
        ? 1
        : 0;
  const steps = [
    { label: "Transfer", hint: "Use reference" },
    { label: "Upload", hint: "Send receipt" },
    { label: "Review", hint: "Quest verifies" },
    { label: "Confirmed", hint: "Slot secured" },
  ];

  return (
    <div
      className="border border-white/10 bg-black/20 p-4 sm:p-5"
      aria-label="Payment progress"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-purple-200">
          Payment quest
        </p>
        <p className="text-xs text-slate-500">Step {currentStep + 1} of 4</p>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-1.5" aria-hidden="true">
        {steps.map((_, index) => (
          <span
            key={index}
            className={`h-1.5 ${index <= currentStep ? (reviewFailed && index === currentStep ? "bg-rose-400" : "bg-purple-400") : "bg-white/10"}`}
          />
        ))}
      </div>
      <ol className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {steps.map((step, index) => {
          const completed = isConfirmed
            ? index <= currentStep
            : index < currentStep;
          const active = index === currentStep;
          const failed = active && reviewFailed;
          return (
            <li
              key={step.label}
              aria-current={active ? "step" : undefined}
              className={`min-w-0 border p-3 ${failed ? "border-rose-300/30 bg-rose-400/10" : active ? "border-purple-300/30 bg-purple-400/10" : completed ? "border-emerald-300/20 bg-emerald-400/5" : "border-white/8 bg-white/[0.02]"}`}
            >
              <span
                className={`flex size-7 items-center justify-center border text-xs font-bold ${failed ? "border-rose-300/30 text-rose-200" : active ? "border-purple-300/40 text-purple-100" : completed ? "border-emerald-300/30 text-emerald-200" : "border-white/10 text-slate-600"}`}
                aria-hidden="true"
              >
                {completed ? "✓" : failed ? "!" : index + 1}
              </span>
              <p
                className={`mt-2 text-xs font-semibold ${failed ? "text-rose-100" : active ? "text-white" : completed ? "text-emerald-100" : "text-slate-500"}`}
              >
                {step.label}
              </p>
              <p className="mt-0.5 text-[10px] text-slate-600">
                {failed ? "Needs action" : step.hint}
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function UploadActivity({ phase }: { phase: UploadPhase }) {
  const confirming = phase === "confirming";
  return (
    <div
      className="border border-purple-300/25 bg-purple-400/10 p-4"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 size-8 shrink-0 animate-spin border-2 border-purple-200/20 border-t-purple-200"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-purple-100">
            {confirming
              ? "Confirming your checkpoint…"
              : "Submitting proof securely…"}
          </p>
          <p className="mt-1 text-xs leading-5 text-purple-100/65">
            {confirming
              ? "The upload arrived. We’re refreshing your review status now."
              : "Keep this page open while the receipt is encrypted and uploaded."}
          </p>
          <div className="mt-3 grid grid-cols-3 gap-1.5" aria-hidden="true">
            <span className="h-1.5 bg-purple-300" />
            <span
              className={`h-1.5 ${confirming ? "bg-purple-300" : "animate-pulse bg-purple-300/50"}`}
            />
            <span
              className={`h-1.5 ${confirming ? "animate-pulse bg-purple-300/50" : "bg-white/10"}`}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
