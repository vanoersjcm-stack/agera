import { Component, type ErrorInfo, type ReactNode } from 'react';
import { t } from './i18n';

/** Shows a readable error instead of an empty (black) page when a screen fails to render. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Agera screen failed to render', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="callout render-error" role="alert">
        <h2>{t('This screen could not be shown')}</h2>
        <p>{t('Something went wrong while showing this screen. Reload the page to try again.')}</p>
        <pre>{error.message}</pre>
        <button type="button" className="primary" onClick={() => window.location.reload()}>{t('Reload page')}</button>
      </div>
    );
  }
}
