/**
 * Halaman masuk Seblak POS: email + kata sandi (+ ID outlet bila email
 * terdaftar di beberapa outlet). Pesan error dari API ditampilkan manusiawi.
 */
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { CircleAlert, Eye, EyeOff, Store } from "lucide-react";
import { useAuth } from "../../app/auth";
import { isApiError } from "../../lib/api";
import { fieldError, humanError } from "../../lib/format";

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [outletId, setOutletId] = useState("");
  const [showOutlet, setShowOutlet] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const user = await login(email.trim(), password, outletId.trim() || undefined);
      navigate(user.role === "kitchen" ? "/dapur" : "/kasir", { replace: true });
    } catch (err) {
      // Server meminta outlet_id bila email ada di beberapa outlet.
      if (isApiError(err) && fieldError(err, "outlet_id")) {
        setShowOutlet(true);
      }
      setError(humanError(err));
    } finally {
      setBusy(false);
    }
  };

  const inputCls =
    "min-h-[48px] w-full rounded-md border border-line bg-surface px-3 text-base text-ink placeholder:text-muted focus:border-primary";

  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-md rounded-lg border border-line bg-surface p-6 shadow-sm sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-md bg-primary text-white">
            <Store size={24} aria-hidden />
          </span>
          <div>
            <h1 className="font-display text-h1 font-bold text-ink">Seblak POS</h1>
            <p className="text-sm text-muted">Masuk untuk mulai berjualan</p>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-4 flex items-start gap-2 rounded-md bg-danger-bg px-3 py-2.5 text-sm font-medium text-danger"
          >
            <CircleAlert size={18} aria-hidden className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-semibold text-ink">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nama@usaha.id"
              className={inputCls}
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1.5 block text-sm font-semibold text-ink">
              Kata Sandi
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Kata sandi akun"
                className={`${inputCls} pr-12`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
                className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:bg-subtle"
              >
                {showPassword ? <EyeOff size={20} aria-hidden /> : <Eye size={20} aria-hidden />}
              </button>
            </div>
          </div>

          {showOutlet ? (
            <div>
              <label htmlFor="outlet" className="mb-1.5 block text-sm font-semibold text-ink">
                ID Outlet
              </label>
              <input
                id="outlet"
                type="text"
                value={outletId}
                onChange={(e) => setOutletId(e.target.value)}
                placeholder="ID outlet tempat akun terdaftar"
                className={inputCls}
              />
              <p className="mt-1 text-xs text-muted">
                Email Anda terdaftar di lebih dari satu outlet; isi ID outlet yang benar.
              </p>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowOutlet(true)}
              className="self-start text-sm font-semibold text-primary-text hover:underline"
            >
              Masuk dengan ID outlet tertentu
            </button>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-2 min-h-[52px] rounded-md bg-primary px-4 font-display text-base font-bold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Memeriksa…" : "Masuk"}
          </button>
        </form>
      </div>
    </div>
  );
}
