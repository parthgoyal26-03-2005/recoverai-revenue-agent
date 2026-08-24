export function Header() {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-slate-200 bg-white/80 px-4 pl-16 backdrop-blur sm:px-6 lg:pl-6">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-slate-500">
          Acme Retail Pvt Ltd
        </p>
      </div>
      <div className="flex items-center gap-3">
        <span className="hidden rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 sm:inline">
          Simulation Mode
        </span>
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-700">
          AR
        </span>
      </div>
    </header>
  );
}
