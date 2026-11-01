// Sign in, registration and password reset, sharing one split editorial layout.
import { AnimatePresence, motion, useAnimationControls } from "motion/react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "../components/ui";
import { LedgerField } from "../motion/FlowCanvas";
import { EASE, TextLines } from "../motion/primitives";
import { api } from "../services/api";
import { useAuth } from "../services/AuthContext";

function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[1.15fr_1fr]">
      <aside className="relative flex min-h-[320px] flex-col justify-between overflow-hidden bg-accent p-6 text-paper sm:p-10 lg:min-h-screen lg:p-14">
        <LedgerField />
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }} className="relative">
          <Link to="/" className="text-[clamp(1.4rem,2.4vw,2.25rem)] font-extrabold tracking-[0.14em]">RETAILIQ</Link>
          <div className="eyebrow mt-1 !text-paper/60">India</div>
        </motion.div>
        <div className="relative mt-10 max-w-2xl">
          <TextLines
            as="h1"
            delay={0.15}
            lines={["Understand your", "retail business", "beyond the numbers."]}
            className="text-[clamp(2.1rem,4.3vw,4.25rem)] leading-[1.03] font-medium tracking-[-0.04em]"
          />
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: EASE, delay: 0.6 }}
            className="mt-6 max-w-md text-[15px] leading-relaxed text-paper/75"
          >
            A data warehouse, OLAP studio and mining laboratory for Indian retail, with every rupee traceable from raw transaction to insight.
          </motion.p>
        </div>
      </aside>
      <main className="flex items-center justify-center bg-paper px-6 py-12 sm:px-12">
        <motion.div
          className="w-full max-w-[400px]"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.7, ease: EASE, delay: 0.1 }}
        >
          {children}
        </motion.div>
      </main>
    </div>
  );
}

function TextInput({ label, type = "text", value, onChange, autoComplete, error, right, autoFocus }: {
  label: string; type?: string; value: string; onChange: (v: string) => void; autoComplete?: string; error?: string; right?: ReactNode; autoFocus?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <label className="block">
      <span className="eyebrow block">{label}</span>
      <span className="relative mt-1 block">
        <input
          type={type}
          value={value}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          aria-invalid={Boolean(error)}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="h-11 w-full border-b border-muted bg-transparent pr-14 text-[16px] tracking-tight outline-none"
        />
        <motion.span
          className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-accent"
          initial={false}
          animate={{ scaleX: focused ? 1 : 0 }}
          transition={{ duration: 0.3, ease: EASE }}
        />
        {right && <span className="absolute top-1/2 right-0 -translate-y-1/2">{right}</span>}
      </span>
      <AnimatePresence>
        {error && (
          <motion.span
            className="mt-1 block overflow-hidden text-[12.5px] text-danger"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
          >
            {error}
          </motion.span>
        )}
      </AnimatePresence>
    </label>
  );
}

function PasswordInput(props: { label: string; value: string; onChange: (v: string) => void; autoComplete: string; error?: string }) {
  const [show, setShow] = useState(false);
  return (
    <TextInput
      {...props}
      type={show ? "text" : "password"}
      right={
        <button type="button" onClick={() => setShow((s) => !s)} aria-pressed={show} className="num text-[11px] text-muted underline-offset-2 hover:text-ink hover:underline">
          {show ? "Hide" : "Show"}
        </button>
      }
    />
  );
}

const RULES = [
  { label: "8 characters", test: (p: string) => p.length >= 8 },
  { label: "Uppercase letter", test: (p: string) => /[A-Z]/.test(p) },
  { label: "Lowercase letter", test: (p: string) => /[a-z]/.test(p) },
  { label: "Number", test: (p: string) => /\d/.test(p) },
];
const passwordValid = (p: string) => RULES.every((r) => r.test(p));

function PasswordChecklist({ password }: { password: string }) {
  return (
    <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
      {RULES.map((rule) => {
        const ok = rule.test(password);
        return (
          <li key={rule.label} className={`num flex items-center gap-1.5 text-[11px] transition-colors ${ok ? "text-accent" : "text-muted"}`}>
            <span className="relative inline-block size-2 border border-current">
              <motion.span className="absolute inset-0 bg-current" initial={false} animate={{ scale: ok ? 1 : 0 }} transition={{ duration: 0.2 }} />
            </span>
            {rule.label}
          </li>
        );
      })}
    </ul>
  );
}

// A form error shakes once, so it cannot be missed.
function useShake() {
  const controls = useAnimationControls();
  return { controls, shake: () => controls.start({ x: [0, -7, 6, -4, 3, 0], transition: { duration: 0.38 } }) };
}

function FormError({ message }: { message: string | null }) {
  return (
    <AnimatePresence>
      {message && (
        <motion.div
          role="alert"
          className="overflow-hidden border-l-2 border-danger bg-card px-3 py-2 text-[13px] leading-snug text-danger"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
        >
          {message}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const SubmitButton = ({ busy, children }: { busy: boolean; children: ReactNode }) => (
  <Button variant="primary" type="submit" busy={busy} className="!h-12 w-full !text-[14px]">{children}</Button>
);

export function LoginPage() {
  const { user, ready, signIn } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { controls, shake } = useShake();
  const target = (location.state as { from?: string } | null)?.from ?? "/overview";

  if (ready && user && !busy) return <Navigate to={target} replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next: typeof errors = {};
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) next.email = "Enter a valid email address.";
    if (!password) next.password = "Enter your password.";
    setErrors(next);
    setFailure(null);
    if (Object.keys(next).length) {
      shake();
      return;
    }
    setBusy(true);
    try {
      await signIn(email, password, remember);
      navigate(target, { replace: true });
    } catch (error) {
      setFailure((error as Error).message);
      shake();
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <h2 className="text-[clamp(1.9rem,3vw,2.6rem)] font-medium tracking-[-0.035em]">Welcome back</h2>
      <p className="mt-1 text-[14px] text-muted">Sign in to your RetailIQ workspace.</p>
      <motion.form animate={controls} onSubmit={submit} noValidate className="mt-8 space-y-5">
        <FormError message={failure} />
        <TextInput label="Email address" type="email" autoComplete="email" autoFocus value={email} onChange={setEmail} error={errors.email} />
        <PasswordInput label="Password" autoComplete="current-password" value={password} onChange={setPassword} error={errors.password} />
        <div className="flex items-center justify-between gap-3 text-[13px]">
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="size-3.5 accent-accent" />
            Remember me
          </label>
          <Link to="/forgot-password" className="text-accent underline-offset-2 hover:underline">Forgot password?</Link>
        </div>
        <SubmitButton busy={busy}>{busy ? "Signing in" : "Sign in"}</SubmitButton>
      </motion.form>
      <p className="mt-6 text-[13.5px] text-muted">
        New to RetailIQ? <Link to="/register" className="font-semibold text-accent underline-offset-2 hover:underline">Create an account</Link>
      </p>
    </AuthLayout>
  );
}

export function RegisterPage() {
  const { user, ready, register } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { controls, shake } = useShake();

  if (ready && user && !busy) return <Navigate to="/overview" replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (name.trim().length < 2) next.name = "Enter your full name.";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) next.email = "Enter a valid email address.";
    if (!passwordValid(password)) next.password = "This password does not meet the requirements.";
    if (confirm !== password) next.confirm = "The passwords do not match.";
    setErrors(next);
    setFailure(null);
    if (Object.keys(next).length) {
      shake();
      return;
    }
    setBusy(true);
    try {
      await register(name, email, password);
      navigate("/overview", { replace: true });
    } catch (error) {
      setFailure((error as Error).message);
      shake();
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <h2 className="text-[clamp(1.9rem,3vw,2.6rem)] font-medium tracking-[-0.035em]">Create your account</h2>
      <p className="mt-1 text-[14px] text-muted">Accounts are stored locally. Passwords are saved only as salted hashes.</p>
      <motion.form animate={controls} onSubmit={submit} noValidate className="mt-7 space-y-4">
        <FormError message={failure} />
        <TextInput label="Full name" autoComplete="name" autoFocus value={name} onChange={setName} error={errors.name} />
        <TextInput label="Email address" type="email" autoComplete="email" value={email} onChange={setEmail} error={errors.email} />
        <div>
          <PasswordInput label="Password" autoComplete="new-password" value={password} onChange={setPassword} error={errors.password} />
          <PasswordChecklist password={password} />
        </div>
        <PasswordInput label="Confirm password" autoComplete="new-password" value={confirm} onChange={setConfirm} error={errors.confirm} />
        <SubmitButton busy={busy}>{busy ? "Creating account" : "Create account"}</SubmitButton>
      </motion.form>
      <p className="mt-6 text-[13.5px] text-muted">
        Already registered? <Link to="/login" className="font-semibold text-accent underline-offset-2 hover:underline">Sign in</Link>
      </p>
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setError("Enter a valid email address.");
      return;
    }
    setError(undefined);
    setBusy(true);
    try {
      await api.forgotPassword(email);
      setSent(true);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <h2 className="text-[clamp(1.9rem,3vw,2.6rem)] font-medium tracking-[-0.035em]">Reset your password</h2>
      {sent ? (
        <div className="mt-6 space-y-3 text-[14px] leading-relaxed">
          <p>If an account exists for that email, a reset link has been created. It works for 30 minutes.</p>
          <p className="text-muted">This local installation has no email service, so the link is printed in the terminal running the API server.</p>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="mt-7 space-y-5">
          <p className="text-[14px] text-muted">Enter your email and RetailIQ will create a reset link.</p>
          <TextInput label="Email address" type="email" autoComplete="email" autoFocus value={email} onChange={setEmail} error={error} />
          <SubmitButton busy={busy}>Create reset link</SubmitButton>
        </form>
      )}
      <p className="mt-6 text-[13.5px]"><Link to="/login" className="font-semibold text-accent underline-offset-2 hover:underline">Back to sign in</Link></p>
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [failure, setFailure] = useState<string | null>(token ? null : "This reset link is incomplete. Request a new one.");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { document.title = "RetailIQ India"; }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!passwordValid(password)) {
      setFailure("This password does not meet the requirements.");
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      await api.resetPassword(token, password);
      setDone(true);
    } catch (reason) {
      setFailure((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <h2 className="text-[clamp(1.9rem,3vw,2.6rem)] font-medium tracking-[-0.035em]">Choose a new password</h2>
      {done ? (
        <p className="mt-6 text-[14px]">Your password has been changed, and other sessions are signed out. <Link to="/login" className="font-semibold text-accent hover:underline">Sign in</Link></p>
      ) : (
        <form onSubmit={submit} noValidate className="mt-7 space-y-5">
          <FormError message={failure} />
          <div>
            <PasswordInput label="New password" autoComplete="new-password" value={password} onChange={setPassword} />
            <PasswordChecklist password={password} />
          </div>
          <SubmitButton busy={busy}>Change password</SubmitButton>
        </form>
      )}
    </AuthLayout>
  );
}
