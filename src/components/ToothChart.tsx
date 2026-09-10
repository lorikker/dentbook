"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ToothIcon } from "@/components/ToothIcon";

const UPPER = ["18", "17", "16", "15", "14", "13", "12", "11"];
const LOWER = ["48", "47", "46", "45", "44", "43", "42", "41"];
const NAME_KEYS = [
  "wisdom", "molar2", "molar1", "premolar2", "premolar1", "canine", "lateralIncisor", "centralIncisor",
];

function ToothButton({
  code, name, selected, flip, onSelect,
}: { code: string; name: string; selected: boolean; flip?: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      title={name}
      className={[
        "grid place-items-center gap-1 border py-2 transition-colors hover:border-accent",
        selected ? "border-accent bg-accent text-ink" : "border-ink-line bg-ink text-muted-2",
      ].join(" ")}
    >
      {!flip && <ToothIcon className="h-5 w-5" />}
      <span className="text-[10.5px] font-semibold tracking-[0.04em]">{code}</span>
      {flip && <ToothIcon className="h-5 w-5" flip />}
    </button>
  );
}

export function ToothChart() {
  const t = useTranslations("Home.chart");
  const [tooth, setTooth] = useState<{ code: string; name: string } | null>(null);

  return (
    <div className="border border-ink-line bg-ink-surface">
      <div className="flex items-center justify-between border-b border-ink-line px-4.5 py-3.5">
        <div className="text-xs font-bold tracking-[0.13em] text-muted">{t("kicker")}</div>
        <div className="text-xs tracking-[0.08em] text-muted-2">{t("notation")}</div>
      </div>

      <div className="relative overflow-hidden p-4.5">
        <div
          aria-hidden="true"
          className="animate-db-scan absolute left-0 right-0 h-px bg-accent shadow-[0_0_14px_1px_rgba(157,184,245,0.5)]"
        />
        <div className="mb-2.5 text-[11px] font-semibold tracking-[0.12em] text-muted-2">{t("upper")}</div>
        <div className="grid grid-cols-8 gap-1.5">
          {UPPER.map((code, i) => {
            const name = t(`teeth.${NAME_KEYS[i]}`);
            return (
              <ToothButton
                key={code}
                code={code}
                name={name}
                selected={tooth?.code === code}
                onSelect={() => setTooth({ code, name })}
              />
            );
          })}
        </div>

        <div className="mt-4.5 mb-2.5 text-[11px] font-semibold tracking-[0.12em] text-muted-2">{t("lower")}</div>
        <div className="grid grid-cols-8 gap-1.5">
          {LOWER.map((code, i) => {
            const name = t(`teeth.${NAME_KEYS[i]}`);
            return (
              <ToothButton
                key={code}
                code={code}
                name={name}
                selected={tooth?.code === code}
                flip
                onSelect={() => setTooth({ code, name })}
              />
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3.5 border-t border-ink-line bg-ink px-4.5 py-3.5">
        <div>
          <div className="text-xs font-semibold tracking-[0.1em] text-muted-2">{t("selected")}</div>
          <div className="mt-0.5 text-base font-semibold text-cream">
            {tooth ? `${tooth.code} — ${tooth.name}` : t("none")}
          </div>
        </div>
        <Link
          href="/clinics"
          className="whitespace-nowrap bg-cream px-4.5 py-3 text-sm font-bold text-ink transition-colors hover:bg-white"
        >
          {t("cta")} →
        </Link>
      </div>
    </div>
  );
}
