"use client";

import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/auth";

const contactSchema = z.object({
  name: z.string().min(1, "Name is required."),
  email: z.string().email("Please enter a valid email address."),
  subject: z.string().min(1, "Subject is required."),
  message: z.string().min(10, "Please include a bit more detail."),
});

type ContactFormValues = z.infer<typeof contactSchema>;

export default function ContactForm() {
  const form = useForm<ContactFormValues>({
    resolver: zodResolver(contactSchema),
    defaultValues: {
      name: "",
      email: "",
      subject: "",
      message: "",
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const response = await apiFetch("/api/contact", {
        method: "POST",
        json: values,
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        form.setError("root", { message: data.message || "Failed to send message." });
        return;
      }

      form.reset();
      form.setError("root", { message: "Message sent successfully. We’ll get back to you soon." });
    } catch (error) {
      console.error("Error submitting contact form:", error);
      form.setError("root", { message: "Something went wrong. Please try again." });
    }
  });

  return (
    <Card className="p-6 sm:p-8">
      <div className="mb-6">
        <p className="text-xs uppercase tracking-[0.28em] text-cyan-200/80">Contact Form</p>
        <h2 className="mt-3 text-3xl text-white">Send us a message</h2>
      </div>

      <form className="grid gap-5" onSubmit={onSubmit}>
        <FormField label="Name" htmlFor="contactName" error={form.formState.errors.name?.message} required>
          <Input id="contactName" {...form.register("name")} />
        </FormField>
        <FormField label="Email" htmlFor="contactEmail" error={form.formState.errors.email?.message} required>
          <Input id="contactEmail" type="email" {...form.register("email")} />
        </FormField>
        <FormField label="Subject" htmlFor="contactSubject" error={form.formState.errors.subject?.message} required>
          <Input id="contactSubject" {...form.register("subject")} />
        </FormField>
        <FormField label="Message" htmlFor="contactMessage" error={form.formState.errors.message?.message} required>
          <Textarea id="contactMessage" rows={6} {...form.register("message")} />
        </FormField>
        {form.formState.errors.root?.message ? <p className="text-sm text-slate-300">{form.formState.errors.root.message}</p> : null}
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "Sending..." : "Send Message"}
        </Button>
      </form>
    </Card>
  );
}
