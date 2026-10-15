"use client";

import { Delete, LockKeyhole, Tablet } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Locale } from "@naqdi/i18n";
import { Badge, Button, Field, Input, useToast } from "@/components/ui";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { formatMinor, parseMajor } from "@/lib/money";
import {
  getDeviceToken,
  posApi,
  PosError,
  setDeviceToken,
  setPosLostHandlers,
  setSessionToken,
  type PosBusiness,
  type PosOutlet,
  type PosSession,
  type PosUserLite,
  type ShiftView,
} from "@/lib/posClient";
import { RegisterSw } from "./RegisterSw";
import { Sell } from "./Sell";

export interface Ctx {
  session: PosSession;
  fmt: (minor: number) => string;
  can: (privilege: string) => boolean;
  exponent: number;
}

type Stage = "loading" | "activate" | "pin" | "shift" | "sell";

export function PosApp() {
  return (
    <>
      <RegisterSw />
      <PosFlow />
    </>
  );
}

function PosFlow() {
  const t = useTranslations("cashier");
  const toast = useToast();
  const locale = useLocale() as Locale;
  const [stage, setStage] = useState<Stage>("loading");
  const [outlet, setOutlet] = useState<{ outlet: PosOutlet; business: PosBusiness; deviceName: string } | null>(null);
  const [session, setSession] = useState<PosSession | null>(null);
  const [shift, setShift] = useState<ShiftView | null>(null);

  const toPin = useCallback(() => {
    setSessionToken(null);
    setSession(null);
    setShift(null);
    setStage("pin");
  }, []);

  const toActivate = useCallback(() => {
    setDeviceToken(null);
    setSessionToken(null);
    setSession(null);
    setOutlet(null);
    setStage("activate");
  }, []);

  useEffect(() => {
    setPosLostHandlers(
      () => {
        toast(t("deviceLost"), "error");
        toActivate();
      },
      () => {
        toast(t("sessionLost"), "error");
        toPin();
      },
    );
    return () => setPosLostHandlers(null, null);
  }, [toast, t, toActivate, toPin]);

  useEffect(() => {
    setStage(getDeviceToken() ? "pin" : "activate");
  }, []);

  const ctx: Ctx | null = session
    ? {
        session,
        exponent: session.business.currencyExponent,
        fmt: (m) => formatMinor(m, session.business.currencyExponent, session.business.currency, locale),
        can: (p) => session.user.privileges.includes(p),
      }
    : null;

  if (stage === "loading") return <div className="grid min-h-screen place-items-center text-muted">{t("loading")}</div>;

  if (stage === "activate")
    return (
      <ActivateScreen
        onDone={(info) => {
          setOutlet(info);
          setStage("pin");
        }}
      />
    );

  if (stage === "pin" || !session || !ctx)
    return (
      <PinScreen
        outlet={outlet}
        onOutlet={setOutlet}
        onDeviceLost={toActivate}
        onSession={async (s) => {
          setSessionToken(s.accessToken);
          setSession(s);
          try {
            const cur = await posApi<{ shift: ShiftView | null }>("/shifts/current");
            setShift(cur.shift);
            setStage(cur.shift ? "sell" : "shift");
          } catch {
            setStage("shift");
          }
        }}
      />
    );

  if (stage === "shift" || !shift)
    return (
      <OpenShiftScreen
        ctx={ctx}
        onOpened={(s) => {
          setShift(s);
          setStage("sell");
        }}
        onLogout={toPin}
      />
    );

  return <Sell ctx={ctx} shift={shift} onShift={setShift} onShiftClosed={() => setStage("shift")} onLogout={toPin} />;
}

// ------------------------------------------------------------------------------------------------

const Frame = ({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) => (
  <div className="grid min-h-screen place-items-center p-4">
    <div className="w-full max-w-md space-y-5 rounded-2xl border border-line bg-surface p-6 shadow-sm">
      {children}
      <div className="flex justify-center">{footer ?? <LanguageSwitcher />}</div>
    </div>
  </div>
);

function ActivateScreen({ onDone }: { onDone: (info: { outlet: PosOutlet; business: PosBusiness; deviceName: string }) => void }) {
  const t = useTranslations("cashier");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await posApi<{ deviceToken: string; device: { name: string }; outlet: PosOutlet; business: PosBusiness }>("/devices/activate", {
        method: "POST",
        json: { code },
        auth: false,
      });
      setDeviceToken(res.deviceToken);
      onDone({ outlet: res.outlet, business: res.business, deviceName: res.device.name });
    } catch (err) {
      setError(err instanceof PosError ? err.message : t("network"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Frame>
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-soft text-brand">
          <Tablet size={22} aria-hidden />
        </span>
        <div>
          <h1 className="text-xl font-semibold">{t("activateTitle")}</h1>
          <p className="text-sm text-muted">{t("activateHelp")}</p>
        </div>
      </div>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label={t("activationCode")} error={error || undefined}>
          {(id) => (
            <Input
              id={id}
              dir="ltr"
              autoFocus
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              className="h-12 text-center font-mono text-xl tracking-widest"
              value={code}
              maxLength={9}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              invalid={Boolean(error)}
              placeholder="XXXX-XXXX"
            />
          )}
        </Field>
        <Button type="submit" className="h-11 w-full" disabled={busy || code.replace(/[^A-Z0-9]/gi, "").length < 8}>
          {t("activate")}
        </Button>
      </form>
    </Frame>
  );
}

function PinScreen({
  outlet,
  onOutlet,
  onSession,
  onDeviceLost,
}: {
  outlet: { outlet: PosOutlet; business: PosBusiness; deviceName: string } | null;
  onOutlet: (o: { outlet: PosOutlet; business: PosBusiness; deviceName: string }) => void;
  onSession: (s: PosSession) => void;
  onDeviceLost: () => void;
}) {
  const t = useTranslations("cashier");
  const [users, setUsers] = useState<PosUserLite[] | null>(null);
  const [picked, setPicked] = useState<PosUserLite | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setUsers((await posApi<{ items: PosUserLite[] }>("/users", { auth: false })).items);
    } catch (err) {
      if (err instanceof PosError && err.status === 401) onDeviceLost();
      else setError(err instanceof PosError ? err.message : t("network"));
    }
  }, [onDeviceLost, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = useCallback(
    async (value: string) => {
      if (!picked) return;
      setBusy(true);
      setError("");
      try {
        const res = await posApi<{ accessToken: string; user: PosSession["user"]; outlet: PosOutlet; business: PosBusiness }>("/auth/pin", {
          method: "POST",
          json: { userId: picked.id, pin: value },
          auth: false,
        });
        onOutlet({ outlet: res.outlet, business: res.business, deviceName: outlet?.deviceName ?? "" });
        onSession({ accessToken: res.accessToken, user: res.user, outlet: res.outlet, business: res.business });
      } catch (err) {
        setPin("");
        if (err instanceof PosError && err.code === "locked") {
          const secs = Number(err.extra?.retryAfterSeconds ?? 0);
          setError(t("locked", { minutes: Math.max(1, Math.ceil(secs / 60)) }));
          void load();
        } else setError(err instanceof PosError ? err.message : t("network"));
      } finally {
        setBusy(false);
      }
    },
    [picked, onOutlet, onSession, outlet, load, t],
  );

  const press = (d: string) => {
    if (busy || pin.length >= 6) return;
    setPin(pin + d);
  };

  return (
    <Frame>
      <div className="text-center">
        <h1 className="text-xl font-semibold">{outlet?.outlet.name ?? t("pinTitle")}</h1>
        <p className="text-sm text-muted">{picked ? t("enterPin", { name: picked.name }) : t("pickUser")}</p>
      </div>

      {!picked ? (
        <div className="space-y-2">
          {error ? (
            <p role="alert" className="text-center text-sm text-danger">
              {error}
            </p>
          ) : null}
          {users === null && !error ? <p className="text-center text-muted">{t("loading")}</p> : null}
          {users?.length === 0 ? <p className="rounded-lg bg-warn-soft p-3 text-center text-sm">{t("noUsers")}</p> : null}
          <div className="grid gap-2 sm:grid-cols-2">
            {users?.map((u) => (
              <button
                key={u.id}
                type="button"
                disabled={u.locked}
                onClick={() => {
                  setPicked(u);
                  setPin("");
                  setError("");
                }}
                className="flex min-h-14 items-center justify-between gap-2 rounded-xl border border-line px-4 py-3 text-start hover:border-brand hover:bg-surface-2 disabled:opacity-50"
              >
                <span className="font-medium">{u.name}</span>
                {u.locked ? <LockKeyhole size={16} aria-label={t("lockedBadge")} /> : null}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex justify-center gap-3" aria-label={t("pinDots", { count: pin.length })} role="img">
            {Array.from({ length: 6 }).map((_, i) => (
              <span key={i} className={`h-3.5 w-3.5 rounded-full border ${i < pin.length ? "border-brand bg-brand" : "border-line"}`} />
            ))}
          </div>
          {error ? (
            <p role="alert" className="text-center text-sm text-danger">
              {error}
            </p>
          ) : null}
          <div className="mx-auto grid max-w-64 grid-cols-3 gap-2" dir="ltr">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
              <button key={d} type="button" onClick={() => press(d)} className="h-14 rounded-xl border border-line text-xl font-medium hover:bg-surface-2 active:bg-brand-soft">
                {d}
              </button>
            ))}
            <button type="button" onClick={() => setPin(pin.slice(0, -1))} aria-label={t("backspace")} className="grid h-14 place-items-center rounded-xl border border-line hover:bg-surface-2">
              <Delete size={20} aria-hidden />
            </button>
            <button type="button" onClick={() => press("0")} className="h-14 rounded-xl border border-line text-xl font-medium hover:bg-surface-2 active:bg-brand-soft">
              0
            </button>
            <button
              type="button"
              disabled={pin.length < 4 || busy}
              onClick={() => void submit(pin)}
              className="h-14 rounded-xl bg-brand text-base font-semibold text-white disabled:opacity-40"
            >
              {t("signIn")}
            </button>
          </div>
          <div className="text-center">
            <Button
              variant="ghost"
              onClick={() => {
                setPicked(null);
                setPin("");
                setError("");
              }}
            >
              {t("otherUser")}
            </Button>
          </div>
        </div>
      )}
    </Frame>
  );
}

function OpenShiftScreen({ ctx, onOpened, onLogout }: { ctx: Ctx; onOpened: (s: ShiftView) => void; onLogout: () => void }) {
  const t = useTranslations("cashier");
  const [cash, setCash] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const canOpen = ctx.can("shift.manage");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const minor = parseMajor(cash || "0", ctx.exponent);
    if (minor === null) return setError(t("invalidAmount"));
    setBusy(true);
    setError("");
    try {
      const res = await posApi<{ shift: ShiftView }>("/shifts/open", { method: "POST", json: { openingCash: minor } });
      onOpened(res.shift);
    } catch (err) {
      setError(err instanceof PosError ? err.message : t("network"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Frame footer={<Button variant="ghost" onClick={onLogout}>{t("logout")}</Button>}>
      <div>
        <h1 className="text-xl font-semibold">{t("openShiftTitle")}</h1>
        <p className="text-sm text-muted">{ctx.session.user.name} · {ctx.session.outlet.name}</p>
      </div>
      {canOpen ? (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label={t("openingCash")} hint={t("openingCashHint")} error={error || undefined}>
            {(id) => <Input id={id} inputMode="decimal" dir="ltr" autoFocus className="h-12 text-start text-xl" value={cash} onChange={(e) => setCash(e.target.value)} placeholder="0" invalid={Boolean(error)} />}
          </Field>
          <Button type="submit" className="h-11 w-full" disabled={busy}>
            {t("openShift")}
          </Button>
        </form>
      ) : (
        <Badge tone="warn">{t("noShiftPrivilege")}</Badge>
      )}
    </Frame>
  );
}
