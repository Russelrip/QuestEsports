"use client";

import Link from "next/link";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Section } from "@/components/ui/section";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const registrationSchema = z.object({
  teamName: z.string().min(1, "Team name is required."),
  captainName: z.string().min(1, "Captain name is required."),
  captainEmail: z.string().email("Enter a valid email address."),
  captainPhone: z.string().min(1, "Captain phone is required."),
  teamSize: z.string().min(1, "Select a team size."),
  tournament: z.string().min(1, "Select a tournament."),
  teamBio: z.string().optional(),
  terms: z.boolean().refine((value) => value, { message: "You must agree to continue." }),
});

type RegistrationFormValues = z.infer<typeof registrationSchema>;

export default function RegistrationForm() {
  const form = useForm<RegistrationFormValues>({
    resolver: zodResolver(registrationSchema),
    defaultValues: {
      teamName: "",
      captainName: "",
      captainEmail: "",
      captainPhone: "",
      teamSize: "",
      tournament: "",
      teamBio: "",
      terms: false,
    },
  });

  const onSubmit = form.handleSubmit(async () => {
    form.setValue("teamName", "");
    form.setError("root", {
      message: "This legacy registration page has been replaced. Continue with the full tournament registration flow instead.",
    });
  });

  return (
    <Section className="pt-6">
      <div className="grid gap-6 lg:grid-cols-[0.82fr_1.18fr]">
        <Card className="p-6 sm:p-8">
          <p className="text-xs uppercase tracking-[0.28em] text-cyan-200/80">Registration Flow</p>
          <h2 className="mt-3 text-3xl text-white">This page now guides teams into the real tournament registration workflow.</h2>
          <p className="mt-4 text-sm leading-7 text-slate-300">
            The simple legacy form no longer matches the production team registration system. Use the tournament registration flow for roster members, saved teams, and invite confirmations.
          </p>
          <div className="mt-6">
            <Link href="/tournament-registration" className={buttonClassName({})}>
              Open Tournament Registration
            </Link>
          </div>
        </Card>

        <Card className="p-6 sm:p-8">
          <form className="grid gap-5" onSubmit={onSubmit}>
            <FormField label="Team Name" htmlFor="teamName" error={form.formState.errors.teamName?.message} required>
              <Input id="teamName" {...form.register("teamName")} />
            </FormField>
            <div className="grid gap-5 sm:grid-cols-2">
              <FormField label="Captain Name" htmlFor="captainName" error={form.formState.errors.captainName?.message} required>
                <Input id="captainName" {...form.register("captainName")} />
              </FormField>
              <FormField label="Captain Email" htmlFor="captainEmail" error={form.formState.errors.captainEmail?.message} required>
                <Input id="captainEmail" type="email" {...form.register("captainEmail")} />
              </FormField>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <FormField label="Captain Phone" htmlFor="captainPhone" error={form.formState.errors.captainPhone?.message} required>
                <Input id="captainPhone" {...form.register("captainPhone")} />
              </FormField>
              <FormField label="Team Size" htmlFor="teamSize" error={form.formState.errors.teamSize?.message} required>
                <Select id="teamSize" {...form.register("teamSize")}>
                  <option value="">Select team size</option>
                  <option value="5">5 Players</option>
                  <option value="6">6 Players</option>
                  <option value="7">7 Players</option>
                </Select>
              </FormField>
            </div>
            <FormField label="Tournament" htmlFor="tournament" error={form.formState.errors.tournament?.message} required>
              <Select id="tournament" {...form.register("tournament")}>
                <option value="">Select a tournament</option>
                <option value="valorant">Valorant Open Series</option>
                <option value="valorant-women">Valorant Women&apos;s Championship</option>
                <option value="showdown">Valorant Showdown</option>
              </Select>
            </FormField>
            <FormField label="Team Bio" htmlFor="teamBio">
              <Textarea id="teamBio" rows={4} placeholder="Tell us about your team..." {...form.register("teamBio")} />
            </FormField>
            <label className="flex items-start gap-3 rounded-2xl border border-white/8 bg-white/4 px-4 py-3 text-sm text-slate-300">
              <input type="checkbox" className="mt-1 size-4 accent-cyan-300" {...form.register("terms")} />
              <span>
                I agree to the{" "}
                <Link href="/terms-of-service" className="text-cyan-200 transition hover:text-cyan-100">
                  Terms of Service
                </Link>{" "}
                and the{" "}
                <Link href="/privacy-policy" className="text-cyan-200 transition hover:text-cyan-100">
                  Privacy Policy
                </Link>
                .
              </span>
            </label>
            {form.formState.errors.terms?.message ? <p className="text-sm text-rose-300">{form.formState.errors.terms.message}</p> : null}
            {form.formState.errors.root?.message ? <p className="text-sm text-slate-300">{form.formState.errors.root.message}</p> : null}
            <Button type="submit">Continue</Button>
          </form>
        </Card>
      </div>
    </Section>
  );
}
