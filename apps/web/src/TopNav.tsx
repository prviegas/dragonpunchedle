import { useEffect, useRef, useState, type ReactNode } from "react";
import type { User } from "./api";
import { TOWER_HASH } from "./arcadeRules";
import { DASHBOARD_HASH } from "./Dashboard";
import { HISTORY_HASH } from "./History";
import { PROFILE_HASH } from "./Profile";

// The header's two rows. The top one: the logo, How to play, and the account
// (one button with a menu, so it never grows). The second: the game's three
// places as tabs, which fit on one line even on a phone.

export type Place = "today" | "history" | "arcade" | "profile" | "dashboard" | "other";

// Remembered per browser: once a player has opened their profile, stop
// pointing at it. Storage can be unavailable (private windows), so every
// access is wrapped; without it the hint simply shows.
const SEEN_PROFILE_KEY = "dragonpunchedle:seen-profile";

function readSeenProfile(): boolean {
  try {
    return localStorage.getItem(SEEN_PROFILE_KEY) === "1";
  } catch {
    return false;
  }
}

function useSeenProfile(place: Place): boolean {
  const [seen, setSeen] = useState(readSeenProfile);
  useEffect(() => {
    if (place !== "profile" || seen) return;
    setSeen(true);
    try {
      localStorage.setItem(SEEN_PROFILE_KEY, "1");
    } catch {
      // Not remembered: the hint shows again next visit.
    }
  }, [place, seen]);
  return seen;
}

interface TopNavProps {
  place: Place;
  user: User | null;
  streak: number;
  canSeeDashboard: boolean;
  onHelp: () => void;
  onLogIn: () => void;
  onLogOut: () => void;
}

export function TopNav({ place, user, streak, canSeeDashboard, onHelp, onLogIn, onLogOut }: TopNavProps) {
  const seenProfile = useSeenProfile(place);
  const tab = (target: Place, href: string, label: ReactNode) => (
    <a className="tab-link" href={href} aria-current={place === target ? "page" : undefined}>
      {label}
    </a>
  );

  return (
    <header className="topbar">
      <div className="topbar-row">
        <h1 className="logo">
          <a href="#">
            Dragon<span className="logo-punch">punched</span>le
          </a>
        </h1>
        <div className="topbar-actions">
          <button type="button" className="icon-button" onClick={onHelp} aria-label="How to play" title="How to play">
            ?
          </button>
          {user ? (
            <AccountMenu
              user={user}
              streak={streak}
              canSeeDashboard={canSeeDashboard}
              profileIsNew={!seenProfile}
              onLogOut={onLogOut}
            />
          ) : (
            <button type="button" className="button button--small" onClick={onLogIn}>
              Log in
            </button>
          )}
        </div>
      </div>
      <nav className="tabs-nav" aria-label="Game modes">
        {tab("today", "#", "Today")}
        {tab("history", HISTORY_HASH, "Past rounds")}
        {tab(
          "arcade",
          TOWER_HASH,
          <>
            Tower <span className="nav-new">New</span>
          </>,
        )}
        {/* A guest only sees the dashboard on a local dev server; logged in, it's in the account menu. */}
        {!user && canSeeDashboard && tab("dashboard", DASHBOARD_HASH, "Dashboard")}
      </nav>
    </header>
  );
}

interface AccountMenuProps {
  user: User;
  streak: number;
  canSeeDashboard: boolean;
  profileIsNew: boolean;
  onLogOut: () => void;
}

function AccountMenu({ user, streak, canSeeDashboard, profileIsNew, onLogOut }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const firstItem = useRef<HTMLAnchorElement>(null);

  // Closes on a click outside, on Escape, and whenever the page changes.
  useEffect(() => {
    if (!open) return;
    firstItem.current?.focus();
    const onPointer = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        box.current?.querySelector<HTMLButtonElement>(".account-button")?.focus();
      }
    };
    const onHash = () => setOpen(false);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("hashchange", onHash);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("hashchange", onHash);
    };
  }, [open]);

  return (
    <div className="account-menu" ref={box}>
      <button
        type="button"
        className="account-button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
      >
        {streak > 0 && (
          <span className="streak" title={`${streak}-day streak`}>
            {streak}
            <span className="visually-hidden">-day streak,</span>
          </span>
        )}
        <span className="account-button-name">{user.username}</span>
        {/* Phones: just the initial, so the top row fits. */}
        <span className="account-avatar" aria-hidden="true">
          {user.username.slice(0, 1).toUpperCase()}
        </span>
        {profileIsNew && (
          <span className="account-dot">
            <span className="visually-hidden">, something new</span>
          </span>
        )}
        <span className="account-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="account-dropdown" role="menu">
          <a ref={firstItem} className="account-item" role="menuitem" href={PROFILE_HASH}>
            Your profile {profileIsNew && <span className="nav-new nav-new--calm">New</span>}
          </a>
          {canSeeDashboard && (
            <a className="account-item" role="menuitem" href={DASHBOARD_HASH}>
              Dashboard
            </a>
          )}
          <button
            type="button"
            className="account-item"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onLogOut();
            }}
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
