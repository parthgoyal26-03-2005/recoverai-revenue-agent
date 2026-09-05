"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  ArrowLeftRight,
  LayoutDashboard,
  ListChecks,
  Menu,
  ScrollText,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { clsx } from "clsx";

const GROUPS: {
  heading: string;
  items: { href: string; label: string; icon: typeof LayoutDashboard }[];
}[] = [
  {
    heading: "Overview",
    items: [{ href: "/", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    heading: "Recovery",
    items: [
      { href: "/cases", label: "Recovery Cases", icon: ListChecks },
      { href: "/copilot", label: "AI Copilot", icon: Sparkles },
      { href: "/policies", label: "Policies", icon: ShieldCheck },
    ],
  },
  {
    heading: "Operations",
    items: [
      { href: "/audit", label: "Audit Trail", icon: ScrollText },
      { href: "/settings/integrations", label: "Integrations", icon: Zap },
    ],
  },
];

function Mark() {
  return (
    <span className="flex h-8 w-8 items-center justify-center bg-[#5B7CFF]">
      <ArrowLeftRight className="h-4 w-4 text-white" strokeWidth={2.2} />
    </span>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  const nav = (
    <div className="space-y-5">
      {GROUPS.map((g) => (
        <div key={g.heading}>
          <p className="px-3 text-[10.5px] font-semibold tracking-[0.12em] text-[#6F7A89] uppercase">
            {g.heading}
          </p>
          <nav className="mt-1.5 flex flex-col">
            {g.items.map((item) => {
              const active = isActive(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={clsx(
                    "relative flex items-center gap-2.5 px-3 py-2 text-[13.5px] font-medium transition-colors duration-150",
                    active
                      ? "bg-[#0A0A0A] text-[#F7F9FC]"
                      : "text-[#A3ADBD] hover:bg-[#0A0A0A] hover:text-[#F7F9FC]"
                  )}
                >
                  {active && (
                    <span
                      aria-hidden
                      className="absolute top-0 left-0 h-full w-[2px] bg-[#5B7CFF]"
                    />
                  )}
                  <Icon className="h-[17px] w-[17px] shrink-0" strokeWidth={1.9} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      ))}
    </div>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed top-3 left-3 z-40 border border-[#1A1A1A] bg-black p-2 text-[#A3ADBD] lg:hidden"
        aria-label="Open navigation"
      >
        <Menu className="h-5 w-5" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/70 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <aside
        className={clsx(
          "fixed inset-y-0 left-0 z-40 flex w-[238px] shrink-0 flex-col border-r border-[#1A1A1A] bg-black transition-transform lg:static lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b border-[#171717] px-4 py-4">
          <div className="flex items-center gap-2.5">
            <Mark />
            <div>
              <p className="text-[14px] font-semibold tracking-tight text-[#F7F9FC]">
                RecoverAI
              </p>
              <p className="text-[11px] text-[#6F7A89]">Revenue Recovery Agent</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="p-1.5 text-[#6F7A89] hover:bg-[#0A0A0A] hover:text-white lg:hidden"
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">{nav}</div>
        <div className="border-t border-[#171717] p-4">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-[#A3ADBD]">
            <span className="pulse-dot circle h-1.5 w-1.5 bg-emerald-400" />
            Razorpay Test Mode
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-[#6F7A89]">
            AI Buildathon — Track 3 · No live payments
          </p>
        </div>
      </aside>
    </>
  );
}
