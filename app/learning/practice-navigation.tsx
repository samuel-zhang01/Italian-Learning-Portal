type Props = { active: "vocabulary" | "verbs" | "grammar"; t: (en: string, it: string) => string; go: (route: string) => void };
export function PracticeNavigation({ active, t, go }: Props) {
  return <nav className="practice-switcher" aria-label={t("Practice areas", "Aree di pratica")}>
    {([
      ["vocabulary", "vocab-boost", t("Vocabulary", "Vocabolario")],
      ["verbs", "games?mode=verbs", t("Verbs", "Verbi")],
      ["grammar", "grammar", t("Grammar", "Grammatica")],
    ] as const).map(([id, route, title]) => <button key={id} aria-current={active === id ? "page" : undefined} onClick={() => go(route)}>{title}</button>)}
  </nav>;
}
