import { useTranslations } from "next-intl";

export default function Home() {
  const t = useTranslations("Home");
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-4xl font-bold">{t("title")}</h1>
      <p className="text-lg text-gray-600">{t("subtitle")}</p>
      <a href="#" className="rounded-lg bg-sky-600 px-6 py-3 text-white">
        {t("cta")}
      </a>
    </main>
  );
}
