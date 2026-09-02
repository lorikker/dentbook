"use client";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { Button } from "@/components/Button";

type FormValues = { name: string; email: string; message: string };

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
    <main className="mx-auto w-full max-w-md p-8">
      <h1 className="mb-4 text-2xl font-bold">{t("title")}</h1>
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-2">
        <input {...register("name", { required: true })} placeholder={t("name")} className="rounded border p-2" />
        {errors.name && <p className="text-sm text-red-600">{t("required")}</p>}
        <input {...register("email", { required: true, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ })}
               placeholder={t("email")} className="rounded border p-2" />
        {errors.email && <p className="text-sm text-red-600">{t("invalidEmail")}</p>}
        <textarea {...register("message", { required: true })} rows={4}
                  placeholder={t("message")} className="rounded border p-2" />
        {errors.message && <p className="text-sm text-red-600">{t("required")}</p>}
        <Button type="submit">{t("submit")}</Button>
        {status === "success" && <p className="text-sm text-green-600">{t("success")}</p>}
        {status === "error" && <p className="text-sm text-red-600">{t("error")}</p>}
      </form>
    </main>
  );
}
