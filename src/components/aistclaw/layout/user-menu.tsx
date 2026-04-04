import { LogOut, Building2, ChevronDown, Check, User, KeyRound, Info } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@aistclaw/stores/use-auth-store";
import { useTenants } from "@aistclaw/hooks/use-tenants";
import { ROUTES, LOCAL_STORAGE_KEYS } from "@aistclaw/lib/constants";
import { Popover } from "radix-ui";
import { useState } from "react";
import { ConfirmDialog } from "@aistclaw/components/shared/confirm-dialog";
import { AboutDialog } from "./about-dialog";

export function UserMenu() {
  const { t } = useTranslation("topbar");
  const { t: tt } = useTranslation("tenants");
  const logout = useAuthStore((s) => s.logout);
  const userId = useAuthStore((s) => s.userId);
  const { currentTenant, currentTenantName, tenants, isOwner, isMultiTenant, currentTenantId } = useTenants();
  const [open, setOpen] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const navigate = useNavigate();

  const tenantLabel = currentTenant?.name || currentTenantName || "";

  const handleSwitchTenant = (_tenantId: string, slug: string) => {
    // Always set TENANT_ID so WS and HTTP both resolve the correct tenant.
    localStorage.setItem(LOCAL_STORAGE_KEYS.TENANT_ID, slug);
    // Non-owner: also set TENANT_HINT for browser pairing backward compat (Path 3a).
    if (!isOwner) {
      localStorage.setItem(LOCAL_STORAGE_KEYS.TENANT_HINT, slug);
    }
    window.location.reload();
  };

  return (
    <>
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          className="flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground region-no-drag"
          title={userId || t("logout")}
        >
          <User className="h-4 w-4 shrink-0" />
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-[100] w-56 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95 pointer-events-auto"
        >
          {/* Tenant name */}
          {tenantLabel && (
            <div className="px-2 py-1.5 text-sm font-medium truncate border-b mb-1">
              {tenantLabel}
            </div>
          )}

          {/* Tenant section */}
          {isMultiTenant && (
            <>
              <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                {tt("currentTenant")}
              </div>
              {tenants.map((tenant) => (
                <button
                  key={tenant.id}
                  onClick={() => {
                    if (tenant.id !== currentTenantId) {
                      handleSwitchTenant(tenant.id, tenant.slug);
                    }
                    setOpen(false);
                  }}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                >
                  <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate text-left">{tenant.name}</span>
                  {tenant.id === currentTenantId && (
                    <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                  )}
                </button>
              ))}
              <div className="my-1 border-t" />
            </>
          )}

          {/* Tenants */}
          {isMultiTenant && (
            <button
              onClick={() => { setOpen(false); navigate(ROUTES.TENANTS); }}
              className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
            >
              <Building2 className="h-3.5 w-3.5 shrink-0" />
              <span>{tt("title")}</span>
            </button>
          )}

          {/* API Keys shortcut */}
          <button
            onClick={() => { setOpen(false); navigate(ROUTES.API_KEYS); }}
            className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
          >
            <KeyRound className="h-3.5 w-3.5 shrink-0" />
            <span>{t("apiKeys")}</span>
          </button>

          {/* About */}
          <button
            onClick={() => { setOpen(false); setShowAbout(true); }}
            className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
          >
            <Info className="h-3.5 w-3.5 shrink-0" />
            <span>{t("about.menuItem")}</span>
          </button>

          <div className="my-1 border-t" />

          {/* Logout */}
          <button
            onClick={() => { setOpen(false); setShowLogoutConfirm(true); }}
            className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-destructive hover:bg-accent"
          >
            <LogOut className="h-3.5 w-3.5 shrink-0" />
            <span>{t("logout")}</span>
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>

    <ConfirmDialog
      open={showLogoutConfirm}
      onOpenChange={setShowLogoutConfirm}
      title={t("logout")}
      description={t("logoutConfirm")}
      confirmLabel={t("logout")}
      variant="destructive"
      onConfirm={() => { setShowLogoutConfirm(false); logout(); }}
    />

    <AboutDialog open={showAbout} onOpenChange={setShowAbout} />
    </>
  );
}
