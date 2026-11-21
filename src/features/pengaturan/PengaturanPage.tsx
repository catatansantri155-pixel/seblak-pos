/**
 * Halaman Pengaturan — profil outlet dari GET /outlets/me. Kolom yang
 * bisa diubah persis yang didukung API (name, address, phone,
 * tax_rate_bp, currency) dan hanya oleh owner (PATCH /outlets/me
 * owner-only di server). Peran lain melihat profil secara baca-saja.
 */
import { useCallback, useEffect, useState } from "react";
import { CircleAlert, CircleCheck } from "lucide-react";
import { useAuth } from "../../app/auth";
import { getOutlet, patchOutlet, type Outlet } from "../../lib/api";
import { humanError, roleLabel } from "../../lib/format";

export default function PengaturanPage() {
  const { user } = useAuth();
  const isOwner = user?.role === "owner";

  const [outlet, setOutlet] = useState<Outlet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [taxBp, setTaxBp] = useState("");
  const [currency, setCurrency] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fillForm = useCallback((o: Outlet) => {
    setName(o.name);
    setAddress(o.address ?? "");
    setPhone(o.phone ?? "");
    setTaxBp(String(o.tax_rate_bp));
    setCurrency(o.currency);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const o = await getOutlet();
      setOutlet(o);
      fillForm(o);
    } catch (err) {
      setError(humanError(err));
    } finally {
      setLoading(false);
    }
  }, [fillForm]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSave = async () => {
    setFormError(null);
    setSuccess(null);
    if (!name.trim()) {
      setFormError("Nama outlet tidak boleh kosong.");
      return;
    }
    const tax = Number.parseInt(taxBp.replace(/[^\d]/g, ""), 10);
    if (!Number.isFinite(tax) || tax < 0 || tax > 10_000) {
      setFormError("Tarif pajak harus antara 0 dan 10000 basis point (0%–100%).");
      return;
    }
    if (!currency.trim()) {
      setFormError("Mata uang tidak boleh kosong.");
      return;
    }
    setSaving(true);
    try {
      const updated = await patchOutlet({
        name: name.trim(),
        address: address.trim() ? address.trim() : null,
        phone: phone.trim() ? phone.trim() : null,
        tax_rate_bp: tax,
        currency: currency.trim().toUpperCase(),
      });
      setOutlet(updated);
      fillForm(updated);
      setSuccess("Pengaturan outlet tersimpan.");
    } catch (err) {
      setFormError(humanError(err));
    } finally {
      setSaving(false);
    }
  };

  const taxPercent = outlet ? outlet.tax_rate_bp / 100 : 0;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
      {error && (
        <div role="alert" className="mb-4 flex items-start gap-2 rounded-md bg-danger-bg px-3 py-2.5 text-sm font-medium text-danger">
          <CircleAlert size={18} aria-hidden className="mt-0.5 shrink-0" />
          <span>Belum bisa memuat profil outlet: {error}</span>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted">Memuat pengaturan…</p>
      ) : outlet ? (
        <div className="grid gap-8 lg:grid-cols-2">
          <section aria-label="Profil outlet" className="h-fit rounded-lg border border-line bg-surface p-5">
            <h2 className="font-display text-h2 font-bold text-ink">Profil Outlet</h2>
            <dl className="mt-4 space-y-2.5 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-secondary">Nama outlet</dt>
                <dd className="text-right font-semibold text-ink">{outlet.name}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-secondary">Alamat</dt>
                <dd className="text-right font-semibold text-ink">{outlet.address ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-secondary">Telepon</dt>
                <dd className="text-right font-semibold text-ink">{outlet.phone ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-secondary">Tarif pajak</dt>
                <dd className="numeric text-right font-semibold text-ink">
                  {taxPercent}% ({outlet.tax_rate_bp} bp)
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-secondary">Mata uang</dt>
                <dd className="text-right font-semibold text-ink">{outlet.currency}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-secondary">Status</dt>
                <dd className="text-right font-semibold text-ink">
                  {outlet.is_active ? "Aktif" : "Nonaktif"}
                </dd>
              </div>
            </dl>

            {isOwner ? (
              <div className="mt-6 border-t border-line pt-5">
                <h3 className="font-display text-h3 font-semibold text-ink">Ubah Profil</h3>
                {formError && (
                  <div role="alert" className="mt-3 flex items-start gap-2 rounded-md bg-danger-bg px-3 py-2.5 text-sm font-medium text-danger">
                    <CircleAlert size={18} aria-hidden className="mt-0.5 shrink-0" />
                    <span>{formError}</span>
                  </div>
                )}
                {success && (
                  <div role="status" className="mt-3 flex items-start gap-2 rounded-md bg-success-bg px-3 py-2.5 text-sm font-medium text-success">
                    <CircleCheck size={18} aria-hidden className="mt-0.5 shrink-0" />
                    <span>{success}</span>
                  </div>
                )}
                <div className="mt-4 space-y-3">
                  <div>
                    <label htmlFor="out-name" className="mb-1.5 block text-sm font-semibold text-ink">Nama outlet</label>
                    <input
                      id="out-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="min-h-[48px] w-full rounded-md border border-line bg-surface px-3 text-base text-ink focus:border-primary"
                    />
                  </div>
                  <div>
                    <label htmlFor="out-address" className="mb-1.5 block text-sm font-semibold text-ink">Alamat</label>
                    <input
                      id="out-address"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="Alamat outlet"
                      className="min-h-[48px] w-full rounded-md border border-line bg-surface px-3 text-base text-ink placeholder:text-muted focus:border-primary"
                    />
                  </div>
                  <div>
                    <label htmlFor="out-phone" className="mb-1.5 block text-sm font-semibold text-ink">Telepon</label>
                    <input
                      id="out-phone"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="Nomor telepon outlet"
                      className="min-h-[48px] w-full rounded-md border border-line bg-surface px-3 text-base text-ink placeholder:text-muted focus:border-primary"
                    />
                  </div>
                  <div>
                    <label htmlFor="out-tax" className="mb-1.5 block text-sm font-semibold text-ink">
                      Tarif pajak (basis point)
                    </label>
                    <input
                      id="out-tax"
                      inputMode="numeric"
                      value={taxBp}
                      onChange={(e) => setTaxBp(e.target.value.replace(/[^\d]/g, ""))}
                      className="numeric min-h-[48px] w-full rounded-md border border-line bg-surface px-3 text-base text-ink focus:border-primary"
                    />
                    <p className="mt-1 text-xs text-muted">
                      100 bp = 1%. Contoh: pajak 11% diisi 1100. Pajak dihitung server pada
                      setiap pesanan.
                    </p>
                  </div>
                  <div>
                    <label htmlFor="out-currency" className="mb-1.5 block text-sm font-semibold text-ink">Mata uang</label>
                    <input
                      id="out-currency"
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value)}
                      className="min-h-[48px] w-full rounded-md border border-line bg-surface px-3 text-base uppercase text-ink focus:border-primary"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => void onSave()}
                    disabled={saving}
                    className="min-h-[52px] w-full rounded-md bg-primary px-4 font-display text-base font-bold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {saving ? "Menyimpan…" : "Simpan Pengaturan"}
                  </button>
                </div>
              </div>
            ) : (
              <p className="mt-5 border-t border-line pt-4 text-sm text-secondary">
                Hanya pemilik yang dapat mengubah profil outlet. Anda masuk sebagai{" "}
                {user ? roleLabel(user.role) : "—"}.
              </p>
            )}
          </section>

          <section aria-label="Akun saya" className="h-fit rounded-lg border border-line bg-surface p-5">
            <h2 className="font-display text-h2 font-bold text-ink">Akun Saya</h2>
            {user ? (
              <dl className="mt-4 space-y-2.5 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-secondary">Nama</dt>
                  <dd className="text-right font-semibold text-ink">{user.name}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-secondary">Email</dt>
                  <dd className="break-all text-right font-semibold text-ink">{user.email}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-secondary">Peran</dt>
                  <dd className="text-right font-semibold text-ink">{roleLabel(user.role)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-secondary">ID Outlet</dt>
                  <dd className="break-all text-right font-mono text-xs font-semibold text-ink">
                    {user.outlet_id}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="mt-3 text-sm text-secondary">Sesi tidak tersedia.</p>
            )}
            <p className="mt-5 border-t border-line pt-4 text-xs text-muted">
              Kata sandi akun hanya bisa diatur ulang oleh pemilik lewat halaman Pengguna.
            </p>
          </section>
        </div>
      ) : null}
    </div>
  );
}
