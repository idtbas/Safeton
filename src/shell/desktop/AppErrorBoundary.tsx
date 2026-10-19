import { Bug, RotateCcw } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { t } from '../../os/i18n';
import { useNotificationStore } from '../../os/notifications/store';
import { Button } from '../../ui';

/**
 * Isolates application crashes: a failing app shows a crash report inside its own window and
 * can be restarted, while the rest of the system keeps running.
 */
export class AppErrorBoundary extends Component<
  { appTitle: string; children: ReactNode },
  { error: Error | null; key: number }
> {
  override state = { error: null as Error | null, key: 0 };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    useNotificationStore.getState().push({
      severity: 'error',
      title: t('crash.title', { app: this.props.appTitle }),
      body: error.message,
      source: 'kernel',
    });
    console.error(error, info.componentStack);
  }

  override render() {
    if (this.state.error)
      return (
        <div className="ap-crash" role="alert">
          <Bug size={28} strokeWidth={1.5} />
          <strong>{t('crash.title', { app: this.props.appTitle })}</strong>
          <span className="mono">{this.state.error.message}</span>
          <Button
            icon={<RotateCcw size={14} />}
            onClick={() => this.setState((s) => ({ error: null, key: s.key + 1 }))}
          >
            {t('crash.restart')}
          </Button>
        </div>
      );
    return (
      <div key={this.state.key} style={{ display: 'contents' }}>
        {this.props.children}
      </div>
    );
  }
}
