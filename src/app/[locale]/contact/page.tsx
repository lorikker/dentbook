"use client";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { Container } from "@/components/Container";

type FormValues = { name: string; email: string; message: string };

const inputClass =
  "border border-ink-line bg-ink-surface px-3.5 py-3 text-cream outline-none placeholder:text-muted-2 focus:border-accent";

export default function ContactPage() {
  const t = useTranslations("Contact");
  const { register, handleSubmit, formState: { errors }, reset } = useForm<FormValues>();
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");

  async function onSubmit(values: FormValues) {
    setStatus("idle");
    const res = await fetch("/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    if (res.ok) { setStatus("success"); reset(); } else { setStatus("error"); }
  }

  return (
    <div className="bg-ink text-cream">
      <Container size="narrow" className="py-16">
        <h1 className="font-display text-4xl font-bold tracking-tight">{t("title")}</h1>
        <form onSubmit={handleSubmit(onSubmit)} className="mt-8 flex max-w-md flex-col gap-3">
          <input {...register("name", { required: true })} placeholder={t("name")} className={inputClass} />
          {errors.name && <p className="text-sm text-coral">{t("required")}</p>}
          <input {...register("email", { required: true, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ })}
                 placeholder={t("email")} className={inputClass} />
          {errors.email && <p className="text-sm text-coral">{t("invalidEmail")}</p>}
          <textarea {...register("message", { required: true })} rows={4}
                    placeholder={t("message")} className={inputClass} />
          {errors.message && <p className="text-sm text-coral">{t("required")}</p>}
          <button type="submit" className="bg-accent px-5 py-3.5 text-base font-bold text-ink transition-colors hover:bg-accent-hover">
            {t("submit")}
          </button>
          {status === "success" && <p className="text-sm text-accent">{t("success")}</p>}
          {status === "error" && <p className="text-sm text-coral">{t("error")}</p>}
        </form>
      </Container>
    </div>
  );
}
