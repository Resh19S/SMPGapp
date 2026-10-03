import { Component, type ReactNode } from "react";
import styles from "./ErrorBoundary.module.css";

/** Last line of defence: if a page throws while rendering, show a way out
 * instead of a blank screen. Keyed by route in AppShell, so moving to another
 * page clears it. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("Page crashed:", error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className={styles.box} role="alert">
        <h1 className={styles.title}>Something went wrong on this page</h1>
        <p className={styles.text}>Your data is safe — nothing was lost. Reload to try again, or use the menu to go to another page.</p>
        <button className={styles.button} onClick={() => window.location.reload()}>
          Reload page
        </button>
      </div>
    );
  }
}
