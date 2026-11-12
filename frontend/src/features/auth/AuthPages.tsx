import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Form';
import { ApiError } from '@/lib/api/client';
import { AuthLayout } from './AuthLayout';
import { useAuth } from './store';

/** Only same-app paths are accepted as redirect targets (prevents open redirects via ?next=). */
export function safeNext(raw: string | null): string {
  if (!raw) return '/app/overview';
  try {
    const decoded = decodeURIComponent(raw);
    return decoded.startsWith('/app') && !decoded.startsWith('//') ? decoded : '/app/overview';
  } catch {
    return '/app/overview';
  }
}

function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || error.status !== 422 || !Array.isArray(error.details)) return {};
  const out: Record<string, string> = {};
  for (const d of error.details as { loc?: unknown[]; msg?: string }[]) {
    const field = d.loc?.[d.loc.length - 1];
    if (typeof field === 'string' && d.msg) out[field] = d.msg.replace(/^Value error, /, '');
  }
  return out;
}

function describe(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof ApiError) {
    if (error.isUnavailable) return 'The ASTRION API is unreachable. Start the backend and try again.';
    if (error.status === 422) return null; // shown inline per field
    return error.message;
  }
  return 'Something went wrong. Please try again.';
}

function PasswordInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={show ? 'text' : 'password'} className="pr-10" />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        aria-label={show ? 'Hide password' : 'Show password'}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-faint hover:text-ink"
      >
        {show ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
}

function Banner({ tone, children }: { tone: 'info' | 'error' | 'offline'; children: React.ReactNode }) {
  const styles = {
    info: 'border-cyan/30 bg-cyan/[0.05] text-ink',
    error: 'border-conflict/30 bg-conflict/[0.06] text-conflict',
    offline: 'border-caution/30 bg-caution/[0.05] text-ink',
  }[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`mb-5 flex items-start gap-2.5 rounded-md border px-3.5 py-2.5 text-[0.8rem] leading-relaxed ${styles}`}
    >
      {tone === 'offline' && <WifiOff size={14} className="mt-0.5 shrink-0 text-caution" />}
      <span>{children}</span>
    </div>
  );
}

export function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const status = useAuth((s) => s.status);
  const login = useAuth((s) => s.login);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const next = safeNext(params.get('next'));
  const reason = params.get('reason');

  useEffect(() => {
    document.title = 'Sign in · ASTRION';
  }, []);

  if (status === 'authenticated' && !pending) return <Navigate to={next} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await login({ email: email.trim(), password });
      navigate(next, { replace: true });
    } catch (err) {
      setError(err);
      setPending(false);
    }
  };

  const errs = fieldErrors(error);
  return (
    <AuthLayout
      title="Sign in"
      subtitle="Welcome back to your intelligence workspace."
      footer={
        <>
          New to ASTRION?{' '}
          <Link to={`/register${params.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`} className="text-cyan hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      {reason === 'expired' && !error && <Banner tone="info">Your session expired. Sign in again to continue where you left off.</Banner>}
      {(reason === 'offline' || status === 'offline') && !error && (
        <Banner tone="offline">The ASTRION API is currently unreachable. You can still sign in once the backend is running.</Banner>
      )}
      {describe(error) && <Banner tone="error">{describe(error)}</Banner>}
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Email" htmlFor="login-email" error={errs.email}>
          <Input id="login-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" htmlFor="login-password" error={errs.password}>
          <PasswordInput id="login-password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending || !email || !password}>
          {pending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthLayout>
  );
}

export function RegisterPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const status = useAuth((s) => s.status);
  const register = useAuth((s) => s.register);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const next = safeNext(params.get('next'));

  useEffect(() => {
    document.title = 'Create account · ASTRION';
  }, []);

  if (status === 'authenticated' && !pending) return <Navigate to={next} replace />;

  const tooShort = password.length > 0 && password.length < 12;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (tooShort) return;
    setPending(true);
    setError(null);
    try {
      await register({ email: email.trim(), password, display_name: name.trim() });
      navigate(next, { replace: true });
    } catch (err) {
      setError(err);
      setPending(false);
    }
  };

  const errs = fieldErrors(error);
  return (
    <AuthLayout
      title="Create your account"
      subtitle="Your workspaces, sources and documents are private to your account."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="text-cyan hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      {describe(error) && <Banner tone="error">{describe(error)}</Banner>}
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Name" htmlFor="reg-name" error={errs.display_name}>
          <Input id="reg-name" autoComplete="name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Email" htmlFor="reg-email" error={errs.email}>
          <Input id="reg-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field
          label="Password"
          htmlFor="reg-password"
          error={tooShort ? 'Use at least 12 characters.' : errs.password}
          hint="At least 12 characters. A passphrase works well."
        >
          <PasswordInput
            id="reg-password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={tooShort}
          />
        </Field>
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending || !name || !email || !password || tooShort}>
          {pending ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
    </AuthLayout>
  );
}
