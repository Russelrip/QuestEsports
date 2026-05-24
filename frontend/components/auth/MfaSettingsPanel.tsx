"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { QRCodeSVG } from "qrcode.react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { apiFetchJson, getApiErrorMessage } from "@/lib/auth";

const setupSchema = z.object({
  code: z.string().min(1, "Verification code is required."),
});

const disableSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required."),
  code: z.string().optional(),
  backupCode: z.string().optional(),
});

type SetupValues = z.infer<typeof setupSchema>;
type DisableValues = z.infer<typeof disableSchema>;

type MfaSetupState = {
  secret: string;
  otpauthUrl: string;
};

export default function MfaSettingsPanel() {
  const { user, refreshUser } = useAuth();
  const [setup, setSetup] = useState<MfaSetupState | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [statusMessage, setStatusMessage] = useState("");
  const [isStarting, setIsStarting] = useState(false);

  const setupForm = useForm<SetupValues>({
    resolver: zodResolver(setupSchema),
    defaultValues: { code: "" },
  });

  const disableForm = useForm<DisableValues>({
    resolver: zodResolver(disableSchema),
    defaultValues: {
      currentPassword: "",
      code: "",
      backupCode: "",
    },
  });

  const handleStartSetup = async () => {
    try {
      setIsStarting(true);
      setStatusMessage("");
      const { response, data } = await apiFetchJson<{
        success?: boolean;
        message?: string;
        secret?: string;
        otpauthUrl?: string;
      }>("/api/mfa/setup");

      const errorMessage = getApiErrorMessage(response, data, "Could not start MFA setup.");
      if (errorMessage || !data.secret || !data.otpauthUrl) {
        setStatusMessage(errorMessage || "Could not start MFA setup.");
        return;
      }

      setSetup({
        secret: data.secret,
        otpauthUrl: data.otpauthUrl,
      });
      setBackupCodes([]);
    } catch (error) {
      console.error("MFA setup start failed:", error);
      setStatusMessage("Something went wrong while preparing MFA.");
    } finally {
      setIsStarting(false);
    }
  };

  const handleVerifySetup = setupForm.handleSubmit(async (values) => {
    try {
      const { response, data } = await apiFetchJson<{
        success?: boolean;
        message?: string;
        user?: typeof user;
        backupCodes?: string[];
      }>("/api/mfa/verify-setup", {
        method: "POST",
        json: values,
      });

      const errorMessage = getApiErrorMessage(response, data, "Could not enable MFA.");
      if (errorMessage) {
        setupForm.setError("root", { message: errorMessage });
        return;
      }

      if (data.user) {
        refreshUser(data.user);
      }
      setBackupCodes(data.backupCodes || []);
      setSetup(null);
      setStatusMessage(data.message || "Multi-factor authentication enabled.");
      setupForm.reset();
    } catch (error) {
      console.error("MFA setup verification failed:", error);
      setupForm.setError("root", { message: "Something went wrong while enabling MFA." });
    }
  });

  const handleDisable = disableForm.handleSubmit(async (values) => {
    try {
      const { response, data } = await apiFetchJson<{
        success?: boolean;
        message?: string;
        user?: typeof user;
      }>("/api/mfa/disable", {
        method: "POST",
        json: values,
      });

      const errorMessage = getApiErrorMessage(response, data, "Could not disable MFA.");
      if (errorMessage) {
        disableForm.setError("root", { message: errorMessage });
        return;
      }

      if (data.user) {
        refreshUser(data.user);
      }
      setBackupCodes([]);
      setStatusMessage(data.message || "Multi-factor authentication disabled.");
      disableForm.reset();
    } catch (error) {
      console.error("MFA disable failed:", error);
      disableForm.setError("root", { message: "Something went wrong while disabling MFA." });
    }
  });

  const handleRegenerateBackupCodes = async () => {
    const values = disableForm.getValues();

    try {
      const { response, data } = await apiFetchJson<{
        success?: boolean;
        message?: string;
        backupCodes?: string[];
      }>("/api/mfa/backup-codes/regenerate", {
        method: "POST",
        json: values,
      });

      const errorMessage = getApiErrorMessage(response, data, "Could not regenerate backup codes.");
      if (errorMessage) {
        disableForm.setError("root", { message: errorMessage });
        return;
      }

      setBackupCodes(data.backupCodes || []);
      setStatusMessage(data.message || "Backup codes regenerated successfully.");
    } catch (error) {
      console.error("Backup code regeneration failed:", error);
      disableForm.setError("root", { message: "Something went wrong while regenerating backup codes." });
    }
  };

  return (
    <div className="rounded-[24px] border border-white/8 bg-white/5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-2xl text-white">Multi-Factor Authentication</h3>
          <p className="mt-2 text-sm text-slate-400">
            Protect your account with an authenticator app and one-time backup codes.
          </p>
        </div>
        <span className={`rounded-full px-3 py-2 text-xs font-medium ${user?.mfaEnabled ? "bg-emerald-400/10 text-emerald-200" : "bg-amber-400/10 text-amber-200"}`}>
          {user?.mfaEnabled ? "Enabled" : "Not Enabled"}
        </span>
      </div>

      {statusMessage ? <p className="mt-4 text-sm text-slate-300">{statusMessage}</p> : null}

      {!user?.mfaEnabled ? (
        <div className="mt-5 grid gap-5">
          {!setup ? (
            <Button type="button" onClick={handleStartSetup} disabled={isStarting}>
              {isStarting ? "Preparing..." : "Start MFA Setup"}
            </Button>
          ) : (
            <div className="grid gap-5">
              <div className="rounded-[20px] border border-cyan-300/20 bg-cyan-400/8 p-4 text-sm text-slate-200">
                <p>Scan this QR code with your authenticator app, then enter the 6-digit code it generates.</p>

                <div className="mt-5 flex justify-center">
                  <div className="rounded-[24px] border border-white/12 bg-white p-4 shadow-[0_16px_40px_rgba(0,0,0,0.18)]">
                    <QRCodeSVG
                      value={setup.otpauthUrl}
                      size={192}
                      bgColor="#ffffff"
                      fgColor="#111827"
                      includeMargin
                      title="Quest Esports MFA setup QR code"
                    />
                  </div>
                </div>

                <div className="mt-5 rounded-[16px] border border-white/10 bg-black/20 p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Manual Setup Key</p>
                  <p className="mt-3 break-all font-mono text-cyan-100">{setup.secret}</p>
                </div>

                <details className="mt-4 rounded-[16px] border border-white/10 bg-black/15 p-4">
                  <summary className="cursor-pointer text-sm font-medium text-white">
                    Show advanced setup URI
                  </summary>
                  <p className="mt-3 break-all text-xs text-slate-400">{setup.otpauthUrl}</p>
                </details>
              </div>

              <form className="grid gap-5" onSubmit={handleVerifySetup}>
                <FormField label="Verification Code" htmlFor="setupCode" error={setupForm.formState.errors.code?.message} required>
                  <Input id="setupCode" inputMode="numeric" autoComplete="one-time-code" {...setupForm.register("code")} />
                </FormField>

                {setupForm.formState.errors.root?.message ? (
                  <p className="text-sm text-rose-300">{setupForm.formState.errors.root.message}</p>
                ) : null}

                <div className="flex flex-wrap gap-3">
                  <Button type="submit" disabled={setupForm.formState.isSubmitting}>
                    {setupForm.formState.isSubmitting ? "Enabling..." : "Enable MFA"}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setSetup(null)}>
                    Cancel
                  </Button>
                </div>
              </form>
            </div>
          )}
        </div>
      ) : (
        <form className="mt-5 grid gap-5" onSubmit={handleDisable}>
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField label="Current Password" htmlFor="disableMfaPassword" error={disableForm.formState.errors.currentPassword?.message} required>
              <Input id="disableMfaPassword" type="password" {...disableForm.register("currentPassword")} />
            </FormField>
            <FormField label="Authenticator Code" htmlFor="disableMfaCode">
              <Input id="disableMfaCode" inputMode="numeric" autoComplete="one-time-code" {...disableForm.register("code")} />
            </FormField>
          </div>

          <FormField label="Backup Code" htmlFor="disableMfaBackupCode" hint="Use instead of the authenticator code if needed">
            <Input id="disableMfaBackupCode" {...disableForm.register("backupCode")} />
          </FormField>

          {disableForm.formState.errors.root?.message ? (
            <p className="text-sm text-rose-300">{disableForm.formState.errors.root.message}</p>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <Button type="submit" variant="secondary" disabled={disableForm.formState.isSubmitting}>
              {disableForm.formState.isSubmitting ? "Disabling..." : "Disable MFA"}
            </Button>
            <Button type="button" variant="ghost" onClick={handleRegenerateBackupCodes}>
              Regenerate Backup Codes
            </Button>
          </div>
        </form>
      )}

      {backupCodes.length > 0 ? (
        <div className="mt-5 rounded-[20px] border border-amber-300/20 bg-amber-400/8 p-4">
          <p className="text-sm font-medium text-white">Save these backup codes now.</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {backupCodes.map((code) => (
              <div key={code} className="rounded-2xl border border-white/8 bg-black/20 px-3 py-2 font-mono text-sm text-slate-100">
                {code}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
