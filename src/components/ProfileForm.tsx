"use client";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { Button } from "@/components/Button";

type FormValues = { name: string; email: string; locale: "sq" | "en" };

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
    <form onSubmit={handleSubmit(onSubmit)} className="flex max-w-md flex-col gap-2">
      <input {...register("name", { required: true })} placeholder={t("name")} className="rounded border p-2" />
      {errors.name && <p className="text-sm text-red-600">{t("required")}</p>}
      <input {...register("email")} placeholder={t("email")} className="rounded border p-2" />
      <select {...register("locale")} className="rounded border p-2">
        <option value="sq">Shqip</option>
        <option value="en">English</option>
      </select>
      <Button type="submit">{t("save")}</Button>
      {status === "success" && <p className="text-sm text-green-600">{t("success")}</p>}
      {status === "error" && <p className="text-sm text-red-600">{t("error")}</p>}
    </form>
  );
}
