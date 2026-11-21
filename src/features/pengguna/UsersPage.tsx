/**
 * Halaman Pengguna — daftar akun outlet. Aksi tulis (tambah, nonaktifkan,
 * atur ulang kata sandi) hanya untuk owner; manager hanya melihat daftar
 * (server menegakkan hal yang sama: buat/nonaktif/reset -> owner saja).
 */
import { useCallback, useEffect, useState } from "react";
import { CircleAlert, CircleCheck, UserRound } from "lucide-react";
import { useAuth } from "../../app/auth";
import {
  createUser,
  isApiError,
  listUsers,
  patchUser,
  resetUserPassword,
  type ManagedUser,
  type Role,
} from "../../lib/api";
import { formatDateTime, humanError, roleLabel } from "../../lib/format";

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "cashier", label: "Kasir" },
  { value: "kitchen", label: "Dapur" },
  { value: "manager", label: "Manager" },
  { value: "owner", label: "Pemilik" },
];

export default function UsersPage() {
  const { user: meUser } = useAuth();
  const isOwner = meUser?.role === "owner";

  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("cashier");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [confirmDisableId, setConfirmDisableId] = useState<string | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await listUsers();
      setUsers(page.items);
    } catch (err) {
      setError(humanError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const friendlyError = (err: unknown): string => {
    if (isApiError(err) && err.code === "CONFLICT") {
      return "Email sudah dipakai di outlet ini. Gunakan email lain.";
    }
    return humanError(err);
  };

  const onCreate = async () => {
    setFormError(null);
    setSuccess(null);
    if (!name.trim() || !email.trim() || password.length < 6) {
      setFormError("Nama, email, dan kata sandi awal (minimal 6 karakter) wajib diisi.");
      return;
    }
    setCreating(true);
    try {
      await createUser({
        name: name.trim(),
        email: email.trim(),
        password,
        role,
      });
      setSuccess(`Pengguna ${name.trim()} (${roleLabel(role)}) berhasil dibuat.`);
      setName("");
      setEmail("");
      setPassword("");
      setRole("cashier");
      await load();
    } catch (err) {
      setFormError(friendlyError(err));
    } finally {
      setCreating(false);
    }
  };

  const toggleActive = async (target: ManagedUser) => {
    setRowError(null);
    setSuccess(null);
    setBusyId(target.id);
    try {
      await patchUser(target.id, { is_active: !target.is_active });
      setConfirmDisableId(null);
      setSuccess(
        target.is_active
          ? `${target.name} dinonaktifkan. Sesi aktifnya ikut dicabut.`
          : `${target.name} diaktifkan kembali.`,
      );
      await load();
    } catch (err) {
      setRowError(friendlyError(err));
    } finally {
      setBusyId(null);
    }
  };

  const onResetPassword = async (target: ManagedUser) => {
    setRowError(null);
    setSuccess(null);
    if (newPassword.length < 6) {
      setRowError("Kata sandi baru minimal 6 karakter.");
      return;
    }
    setBusyId(target.id);
    try {
      await resetUserPassword(target.id, newPassword);
      setResettingId(null);
      setNewPassword("");
      setSuccess(
        `Kata sandi ${target.name} diatur ulang. Semua sesi lamanya dicabut — ia harus masuk lagi.`,
      );
    } catch (err) {
      setRowError(friendlyError(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      {error && (
        <div role="alert" className="mb-4 flex items-start gap-2 rounded-md bg-danger-bg px-3 py-2.5 text-sm font-medium text-danger">
          <CircleAlert size={18} aria-hidden className="mt-0.5 shrink-0" />
          <span>Belum bisa memuat daftar pengguna: {error}</span>
        </div>
      )}
      {success && (
        <div role="status" className="mb-4 flex items-start gap-2 rounded-md bg-success-bg px-3 py-2.5 text-sm font-medium text-success">
          <CircleCheck size={18} aria-hidden className="mt-0.5 shrink-0" />
          <span>{success}</span>
        </div>
      )}
      {rowError && (
        <div role="alert" className="mb-4 flex items-start gap-2 rounded-md bg-danger-bg px-3 py-2.5 text-sm font-medium text-danger">
          <CircleAlert size={18} aria-hidden className="mt-0.5 shrink-0" />
          <span>{rowError}</span>
        </div>
      )}

      <div className={`grid gap-8 ${isOwner ? "lg:grid-cols-[minmax(0,1fr)_360px]" : ""}`}>
        <section aria-label="Daftar pengguna">
          <h2 className="font-display text-h2 font-bold text-ink">Daftar Pengguna</h2>
          {!isOwner && (
            <p className="mt-1 text-sm text-secondary">
              Anda masuk sebagai manager: daftar ini hanya untuk dilihat. Mengelola pengguna
              adalah hak pemilik.
            </p>
          )}
          {loading ? (
            <p className="mt-3 text-sm text-muted">Memuat pengguna…</p>
          ) : users.length === 0 ? (
            <div className="mt-3 flex flex-col items-center rounded-lg border border-dashed border-line-strong bg-surface px-6 py-12 text-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-subtle text-muted">
                <UserRound size={32} aria-hidden />
              </span>
              <p className="mt-4 font-display text-h2 font-bold text-ink">Belum ada pengguna</p>
              <p className="mt-1 max-w-sm text-sm text-secondary">
                Tambahkan akun untuk kasir, dapur, atau manager lewat formulir di samping.
              </p>
            </div>
          ) : (
            <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-surface">
              {users.map((u) => (
                <li key={u.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-ink">
                        {u.name}
                        {meUser?.id === u.id && (
                          <span className="ml-2 text-xs font-medium text-muted">(Anda)</span>
                        )}
                      </p>
                      <p className="truncate text-sm text-secondary">{u.email}</p>
                      <p className="text-xs text-muted">
                        {roleLabel(u.role)} · sejak {formatDateTime(u.created_at)}
                      </p>
                    </div>
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${
                        u.is_active
                          ? "bg-success-bg text-success"
                          : "bg-subtle text-muted"
                      }`}
                    >
                      {u.is_active ? "Aktif" : "Nonaktif"}
                    </span>
                    {isOwner && meUser?.id !== u.id && (
                      <div className="flex gap-2">
                        {u.is_active ? (
                          confirmDisableId === u.id ? (
                            <span className="flex items-center gap-2 text-sm">
                              <span className="font-medium text-danger">Nonaktifkan?</span>
                              <button
                                type="button"
                                onClick={() => void toggleActive(u)}
                                disabled={busyId === u.id}
                                className="min-h-[36px] rounded-md bg-danger px-2.5 font-semibold text-white disabled:opacity-60"
                              >
                                Ya
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDisableId(null)}
                                className="min-h-[36px] rounded-md border border-line px-2.5 font-semibold text-secondary"
                              >
                                Batal
                              </button>
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDisableId(u.id)}
                              className="min-h-[40px] rounded-md border border-line px-3 text-sm font-semibold text-danger hover:bg-danger-bg"
                            >
                              Nonaktifkan
                            </button>
                          )
                        ) : (
                          <button
                            type="button"
                            onClick={() => void toggleActive(u)}
                            disabled={busyId === u.id}
                            className="min-h-[40px] rounded-md border border-line px-3 text-sm font-semibold text-primary-text hover:bg-subtle disabled:opacity-60"
                          >
                            Aktifkan
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setResettingId(resettingId === u.id ? null : u.id);
                            setNewPassword("");
                            setRowError(null);
                          }}
                          className="min-h-[40px] rounded-md border border-line px-3 text-sm font-semibold text-secondary hover:bg-subtle"
                        >
                          Atur Ulang Kata Sandi
                        </button>
                      </div>
                    )}
                  </div>
                  {isOwner && resettingId === u.id && (
                    <div className="mt-3 flex flex-wrap items-end gap-2 rounded-md bg-subtle p-3">
                      <div className="min-w-[200px] flex-1">
                        <label htmlFor={`reset-${u.id}`} className="mb-1.5 block text-sm font-semibold text-ink">
                          Kata sandi baru untuk {u.name}
                        </label>
                        <input
                          id={`reset-${u.id}`}
                          type="password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="Minimal 6 karakter"
                          autoComplete="new-password"
                          className="min-h-[44px] w-full rounded-md border border-line bg-surface px-3 text-base text-ink placeholder:text-muted focus:border-primary"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => void onResetPassword(u)}
                        disabled={busyId === u.id}
                        className="min-h-[44px] rounded-md bg-primary px-4 text-sm font-bold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {busyId === u.id ? "Menyimpan…" : "Simpan Kata Sandi"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setResettingId(null)}
                        className="min-h-[44px] rounded-md border border-line px-3 text-sm font-semibold text-secondary"
                      >
                        Batal
                      </button>
                      <p className="w-full text-xs text-muted">
                        Menyimpan kata sandi baru mencabut semua sesi aktif pengguna ini.
                      </p>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {isOwner && (
          <section aria-label="Tambah pengguna" className="h-fit rounded-lg border border-line bg-surface p-5">
            <h2 className="font-display text-h2 font-bold text-ink">Tambah Pengguna</h2>
            {formError && (
              <div role="alert" className="mt-3 flex items-start gap-2 rounded-md bg-danger-bg px-3 py-2.5 text-sm font-medium text-danger">
                <CircleAlert size={18} aria-hidden className="mt-0.5 shrink-0" />
                <span>{formError}</span>
              </div>
            )}
            <div className="mt-4 space-y-3">
              <div>
                <label htmlFor="nu-name" className="mb-1.5 block text-sm font-semibold text-ink">Nama</label>
                <input
                  id="nu-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Nama pengguna"
                  autoComplete="off"
                  className="min-h-[48px] w-full rounded-md border border-line bg-surface px-3 text-base text-ink placeholder:text-muted focus:border-primary"
                />
              </div>
              <div>
                <label htmlFor="nu-email" className="mb-1.5 block text-sm font-semibold text-ink">Email</label>
                <input
                  id="nu-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="nama@contoh.id"
                  autoComplete="off"
                  className="min-h-[48px] w-full rounded-md border border-line bg-surface px-3 text-base text-ink placeholder:text-muted focus:border-primary"
                />
              </div>
              <div>
                <label htmlFor="nu-role" className="mb-1.5 block text-sm font-semibold text-ink">Peran</label>
                <select
                  id="nu-role"
                  value={role}
                  onChange={(e) => setRole(e.target.value as Role)}
                  className="min-h-[48px] w-full rounded-md border border-line bg-surface px-3 text-base text-ink focus:border-primary"
                >
                  {ROLE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="nu-password" className="mb-1.5 block text-sm font-semibold text-ink">Kata sandi awal</label>
                <input
                  id="nu-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimal 6 karakter"
                  autoComplete="new-password"
                  className="min-h-[48px] w-full rounded-md border border-line bg-surface px-3 text-base text-ink placeholder:text-muted focus:border-primary"
                />
              </div>
              <button
                type="button"
                onClick={() => void onCreate()}
                disabled={creating}
                className="min-h-[52px] w-full rounded-md bg-primary px-4 font-display text-base font-bold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {creating ? "Membuat…" : "Buat Pengguna"}
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
