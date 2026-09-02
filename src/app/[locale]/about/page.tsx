import { getTranslations } from "next-intl/server";

const team = [
  { name: "Arta Krasniqi", role: "Founder & Product" },
  { name: "Blerim Gashi", role: "Engineering" },
  { name: "Dea Morina", role: "Clinic Partnerships" },
];

export default async function AboutPage() {
  const t = await getTranslations("About");

  return (
    <main className="mx-auto w-full max-w-3xl p-8">
      <h1 className="mb-4 text-2xl font-bold">{t("title")}</h1>
      <p className="mb-8 text-gray-600">{t("intro")}</p>
      <h2 className="mb-3 text-lg font-semibold">{t("teamTitle")}</h2>
      <ul className="flex flex-col gap-2">
        {team.map((member) => (
          <li key={member.name} className="rounded border p-3">
            <p className="font-medium">{member.name}</p>
            <p className="text-sm text-gray-600">{member.role}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
