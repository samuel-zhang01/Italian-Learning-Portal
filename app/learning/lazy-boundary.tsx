import { Component, type ReactNode } from "react";

type Props = { children: ReactNode; t: (en: string, it: string) => string };
export class LearningRouteBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    const { t } = this.props;
    return <section className="workspace" role="alert">
      <h1>{t("This section could not load.", "Questa sezione non si è caricata.")}</h1>
      <p>{t("Your saved practice is still on this device. Reload to try again, or choose another section above.", "La pratica salvata è ancora su questo dispositivo. Ricarica per riprovare, oppure scegli un’altra sezione qui sopra.")}</p>
      <button className="button primary" onClick={() => window.location.reload()}>{t("Reload this section", "Ricarica questa sezione")}</button>
    </section>;
  }
}
