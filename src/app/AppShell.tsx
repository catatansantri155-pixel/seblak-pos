/**
 * AppShell Seblak POS — mengikuti struktur Sinta (G1 §3):
 * - Desktop (>=1024px): sidebar kiri collapsible 264px <-> 72px.
 * - Tablet (768–1023px): rail ringkas 72px (ikon + label kecil).
 * - HP (<768px): header ringkas + bottom navigation (maks. 5 item).
 * - Header 64px sticky: judul bagian, status shift, nama pengguna + peran,
 *   tombol keluar.
 * Item aktif: latar oranye lembut + teks color.text.action + penanda bentuk
 * (garis/dot oranye), bukan warna saja. Menu yang belum dibangun (Menu)
 * tampil nonaktif dengan tanda "Segera". Menu G4 (Laporan, Stok, Promo,
 * Pengguna) dibatasi per peran persis seperti penegakan server; header
 * menampilkan lencana antrean sinkronisasi offline dari outbox kasir.
 */
import { useEffect, useState, type ComponentType } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  CalendarClock,
  ChartColumn,
  ChevronsLeft,
  ChevronsRight,
  CookingPot,
  LayoutGrid,
  LogOut,
  Package,
  ReceiptText,
  RefreshCw,
  Settings,
  Store,
  Tag,
  Users,
  UtensilsCrossed,
} from "lucide-react";
import { useAuth } from "./auth";
import { currentShift, type Role, type Shift } from "../lib/api";
import { outboxQueuedCount, subscribeOutbox } from "../lib/outbox";
import { formatTime, roleLabel } from "../lib/format";

interface NavItem {
  id: string;
  label: string;
  icon: ComponentType<{ size?: number | string; className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
  href?: string;
  soon?: boolean;
  /** Bila diisi, item hanya tampil untuk peran-peran ini. */
  roles?: Role[];
}

const NAV_ITEMS: NavItem[] = [
  { id: "kasir", label: "Kasir", icon: LayoutGrid, href: "/kasir" },
  { id: "dapur", label: "Dapur", icon: CookingPot, href: "/dapur" },
  { id: "pesanan", label: "Pesanan", icon: ReceiptText, href: "/pesanan" },
  { id: "shift", label: "Shift", icon: CalendarClock, href: "/shift" },
  { id: "laporan", label: "Laporan", icon: ChartColumn, href: "/laporan", roles: ["owner", "manager"] },
  { id: "stok", label: "Stok", icon: Package, href: "/stok", roles: ["owner", "manager", "cashier"] },
  { id: "promo", label: "Promo", icon: Tag, href: "/promo", roles: ["owner", "manager"] },
  { id: "pengguna", label: "Pengguna", icon: Users, href: "/pengguna", roles: ["owner", "manager"] },
  { id: "pengaturan", label: "Pengaturan", icon: Settings, href: "/pengaturan" },
  { id: "menu", label: "Menu", icon: UtensilsCrossed, soon: true },
];

function visibleNavItems(role: Role | undefined): NavItem[] {
  return NAV_ITEMS.filter(
    (i) => !i.roles || (role !== undefined && i.roles.includes(role)),
  );
}

/** Bottom navigation HP tetap 4 item inti (token Sinta: maks. 5). */
const MOBILE_CORE_IDS = ["kasir", "dapur", "pesanan", "shift"];

const TITLES: Record<string, string> = {
  "/kasir": "Kasir",
  "/dapur": "Dapur",
  "/pesanan": "Pesanan",
  "/shift": "Shift Kas",
  "/laporan": "Laporan",
  "/stok": "Stok",
  "/promo": "Promo",
  "/pengguna": "Pengguna",
  "/pengaturan": "Pengaturan",
};

function SoonBadge() {
  return (
    <span className="ml-auto rounded-full bg-subtle px-2 py-0.5 text-[11px] font-semibold text-muted">
      Segera
    </span>
  );
}

function SidebarContent({ collapsed }: { collapsed: boolean }) {
  const { user } = useAuth();
  const items = visibleNavItems(user?.role);
  return (
    <nav aria-label="Navigasi utama" className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-4">
      {items.map((item) => {
        const Icon = item.icon;
        if (item.soon || !item.href) {
          return (
            <span
              key={item.id}
              aria-disabled="true"
              title={collapsed ? `${item.label} (segera)` : undefined}
              className="flex min-h-[44px] cursor-not-allowed items-center gap-3 rounded-md px-3 text-sm font-semibold text-muted"
            >
              <Icon size={20} aria-hidden />
              {!collapsed && (
                <>
                  <span>{item.label}</span>
                  <SoonBadge />
                </>
              )}
            </span>
          );
        }
        return (
          <NavLink
            key={item.id}
            to={item.href}
            title={collapsed ? item.label : undefined}
            aria-label={collapsed ? item.label : undefined}
            className={({ isActive }) =>
              `relative flex min-h-[44px] items-center gap-3 rounded-md px-3 text-sm font-semibold transition-colors duration-150 ${
                isActive
                  ? "bg-primary-soft text-primary-text"
                  : "text-secondary hover:bg-subtle hover:text-ink"
              }`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span aria-hidden className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-full bg-primary" />
                )}
                <Icon size={20} aria-hidden />
                {!collapsed && <span>{item.label}</span>}
              </>
            )}
          </NavLink>
        );
      })}
    </nav>
  );
}

export default function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [shift, setShift] = useState<Shift | null>(null);
  const [shiftKnown, setShiftKnown] = useState(false);
  const [outboxCount, setOutboxCount] = useState<number>(() => outboxQueuedCount());

  // Lencana antrean offline: segarkan dari modul outbox setiap berubah.
  useEffect(() => {
    setOutboxCount(outboxQueuedCount());
    return subscribeOutbox(() => setOutboxCount(outboxQueuedCount()));
  }, [location.pathname]);

  const mobileItems = visibleNavItems(user?.role).filter(
    (i) => i.href && MOBILE_CORE_IDS.includes(i.id),
  );

  // Status shift untuk header: diperiksa saat shell tampil & setiap pindah halaman.
  useEffect(() => {
    let cancelled = false;
    currentShift()
      .then((s) => {
        if (!cancelled) {
          setShift(s);
          setShiftKnown(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setShift(null);
          setShiftKnown(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  const onLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  const title = TITLES[location.pathname] ?? "Seblak POS";

  return (
    <div className="min-h-dvh bg-canvas">
      {/* Sidebar desktop */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-line bg-surface transition-[width] duration-200 lg:flex ${
          collapsed ? "w-[72px]" : "w-[264px]"
        }`}
      >
        <div className="flex h-16 items-center gap-2 border-b border-line px-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary text-white">
            <Store size={20} aria-hidden />
          </span>
          {!collapsed && (
            <span className="font-display text-h3 font-bold text-ink">Seblak POS</span>
          )}
        </div>
        <SidebarContent collapsed={collapsed} />
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? "Lebarkan sidebar" : "Lipat sidebar"}
          className="m-3 flex min-h-[44px] items-center justify-center gap-2 rounded-md border border-line text-sm font-semibold text-secondary hover:bg-subtle"
        >
          {collapsed ? <ChevronsRight size={20} aria-hidden /> : <ChevronsLeft size={20} aria-hidden />}
          {!collapsed && <span>Lipat</span>}
        </button>
      </aside>

      {/* Rail tablet */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[72px] flex-col border-r border-line bg-surface md:flex lg:hidden">
        <div className="flex h-16 items-center justify-center border-b border-line">
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-white">
            <Store size={20} aria-hidden />
          </span>
        </div>
        <nav aria-label="Navigasi utama" className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 py-4">
          {visibleNavItems(user?.role).map((item) => {
            const Icon = item.icon;
            if (item.soon || !item.href) {
              return (
                <span
                  key={item.id}
                  aria-disabled="true"
                  className="flex min-h-[52px] cursor-not-allowed flex-col items-center justify-center gap-1 rounded-md text-muted"
                >
                  <Icon size={24} aria-hidden />
                  <span className="text-[11px] font-medium">{item.label}</span>
                </span>
              );
            }
            return (
              <NavLink
                key={item.id}
                to={item.href}
                className={({ isActive }) =>
                  `flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-md ${
                    isActive ? "bg-primary-soft text-primary-text" : "text-secondary hover:bg-subtle"
                  }`
                }
              >
                <Icon size={24} aria-hidden />
                <span className="text-[11px] font-semibold">{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
      </aside>

      {/* Kolom konten */}
      <div className={`md:pl-[72px] ${collapsed ? "lg:pl-[72px]" : "lg:pl-[264px]"}`}>
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-surface px-4 sm:px-6">
          <h1 className="font-display text-h2 font-bold text-ink">{title}</h1>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {outboxCount > 0 && (
              <button
                type="button"
                onClick={() => navigate("/kasir")}
                aria-label={`${outboxCount} checkout menunggu sinkronisasi — buka Kasir`}
                className="inline-flex min-h-[36px] items-center gap-2 rounded-full bg-warning-bg px-3 py-1.5 text-sm font-semibold text-warning hover:opacity-90"
              >
                <RefreshCw size={16} aria-hidden />
                <span className="numeric">{outboxCount}</span>
                <span className="hidden xl:inline">checkout menunggu sinkronisasi</span>
              </button>
            )}
            {shiftKnown &&
              (shift ? (
                <span className="hidden items-center gap-2 rounded-full bg-success-bg px-3 py-1.5 text-sm font-semibold text-success sm:inline-flex">
                  <span aria-hidden className="h-2 w-2 rounded-full bg-success" />
                  Shift terbuka · {formatTime(shift.opened_at)}
                </span>
              ) : (
                <span className="hidden items-center gap-2 rounded-full bg-warning-bg px-3 py-1.5 text-sm font-semibold text-warning sm:inline-flex">
                  <span aria-hidden className="h-2 w-2 rounded-full bg-warning" />
                  Shift belum dibuka
                </span>
              ))}
            {user && (
              <span className="hidden text-right leading-tight md:block">
                <span className="block text-sm font-semibold text-ink">{user.name}</span>
                <span className="block text-xs text-muted">
                  {roleLabel(user.role)} · Outlet {user.outlet_id.slice(0, 8)}…
                </span>
              </span>
            )}
            <button
              type="button"
              onClick={onLogout}
              aria-label="Keluar"
              className="flex min-h-[44px] items-center gap-2 rounded-md border border-line px-3 text-sm font-semibold text-secondary hover:bg-subtle"
            >
              <LogOut size={18} aria-hidden />
              <span className="hidden sm:inline">Keluar</span>
            </button>
          </div>
        </header>

        <main className="min-w-0 pb-24 md:pb-8">
          <Outlet />
        </main>
      </div>

      {/* Bottom navigation HP */}
      <nav
        aria-label="Navigasi utama"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="grid grid-cols-4">
          {mobileItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.id}
                to={item.href as string}
                className={({ isActive }) =>
                  `relative flex min-h-[64px] flex-col items-center justify-center gap-1 text-xs font-semibold ${
                    isActive ? "text-primary-text" : "text-muted"
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <span aria-hidden className="absolute top-0 h-1 w-10 rounded-full bg-primary" />
                    )}
                    <Icon size={24} aria-hidden />
                    <span>{item.label}</span>
                  </>
                )}
              </NavLink>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
