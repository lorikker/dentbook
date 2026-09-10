"use client";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";

type FormValues = { name: string; email: string; locale: "sq" | "en" };

const inputClass =
  "border border-ink-line bg-ink-surface px-3.5 py-3 text-cream outline-none placeholder:text-muted-2 focus:border-accent";

export function ProfileForm({ initial }: { initial: FormValues }) {
  const t = useTranslations("Profile");
  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({ defaultValues: initial });
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");

  async function onSubmit(values: FormValues) {
    setStatus("idle");
    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    setStatus(res.ok ? "success" : "error");
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex max-w-md flex-col gap-3">
      <input {...register("name", { required: true })} placeholder={t("name")} className={inputClass} />
      {errors.name && <p className="text-sm text-coral">{t("required")}</p>}
      <input {...register("email")} placeholder={t("email")} className={inputClass} />
      <select {...register("locale")} className={inputClass}>
        <option value="sq">Shqip</option>
        <option value="en">English</option>
      </select>
      <button type="submit" className="bg-accent px-5 py-3.5 text-base font-bold text-ink transition-colors hover:bg-accent-hover">
        {t("save")}
      </button>
      {status === "success" && <p className="text-sm text-accent">{t("success")}</p>}
      {status === "error" && <p className="text-sm text-coral">{t("error")}</p>}
    </form>
  );
}
