import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./app/auth";
import AppShell from "./app/AppShell";
import type { Role } from "./lib/api";
import LoginPage from "./features/auth/LoginPage";
import KasirPage from "./features/kasir/KasirPage";
import DapurPage from "./features/dapur/DapurPage";
import OrdersPage from "./features/orders/OrdersPage";
import ShiftPage from "./features/shift/ShiftPage";
import LaporanPage from "./features/laporan/LaporanPage";
import StokPage from "./features/stok/StokPage";
import PromoPage from "./features/promo/PromoPage";
import UsersPage from "./features/pengguna/UsersPage";
import PengaturanPage from "./features/pengaturan/PengaturanPage";

/** Gerbang rute terproteksi: belum login -> /login. */
function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas">
        <p className="text-sm font-medium text-muted">Memeriksa sesi…</p>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** Gerbang peran: konsisten dengan menu AppShell & penegakan server. */
function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Halaman awal mengikuti peran: dapur langsung ke antrean dapur. */
function RoleHome() {
  const { user } = useAuth();
  if (user?.role === "kitchen") return <Navigate to="/dapur" replace />;
  return <Navigate to="/kasir" replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            element={
              <RequireAuth>
                <AppShell />
              </RequireAuth>
            }
          >
            <Route index element={<RoleHome />} />
            <Route path="/kasir" element={<KasirPage />} />
            <Route path="/dapur" element={<DapurPage />} />
            <Route path="/pesanan" element={<OrdersPage />} />
            <Route path="/shift" element={<ShiftPage />} />
            <Route
              path="/laporan"
              element={
                <RequireRole roles={["owner", "manager"]}>
                  <LaporanPage />
                </RequireRole>
              }
            />
            <Route
              path="/stok"
              element={
                <RequireRole roles={["owner", "manager", "cashier"]}>
                  <StokPage />
                </RequireRole>
              }
            />
            <Route
              path="/promo"
              element={
                <RequireRole roles={["owner", "manager"]}>
                  <PromoPage />
                </RequireRole>
              }
            />
            <Route
              path="/pengguna"
              element={
                <RequireRole roles={["owner", "manager"]}>
                  <UsersPage />
                </RequireRole>
              }
            />
            <Route path="/pengaturan" element={<PengaturanPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
