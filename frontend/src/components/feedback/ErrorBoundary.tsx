import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  children: ReactNode;
  /** Shown in the fallback so users know which region failed. */
  region?: string;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

/** Contains render failures to one region so the rest of the product keeps working. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ASTRION] ${this.props.region ?? 'Region'} failed to render`, error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback) return this.props.fallback;
    return (
      <div role="alert" className="flex h-full min-h-[240px] flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="grid h-10 w-10 place-items-center rounded-full border border-conflict/30 bg-conflict/[0.06] text-conflict">
          <AlertTriangle size={17} />
        </div>
        <div>
          <p className="font-display text-sm font-medium text-ink">{this.props.region ?? 'This view'} hit an unexpected error</p>
          <p className="mt-1 max-w-md font-mono text-2xs text-ink-faint">{this.state.error.message}</p>
        </div>
        <button onClick={this.reset} className="rounded-md border border-line-strong px-3 py-1.5 text-xs text-ink hover:border-cyan/60">
          Try again
        </button>
      </div>
    );
  }
}
