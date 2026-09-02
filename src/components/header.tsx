function currentAiLabel(): string {
  const selected = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (selected === "gemini" && process.env.GEMINI_API_KEY) return "Gemini";
  if (selected === "groq" && process.env.GROQ_API_KEY) return "Groq";
  if (!selected && process.env.GEMINI_API_KEY) return "Gemini";
  if (!selected && process.env.GROQ_API_KEY) return "Groq";
  if (selected === "gemini") return "Gemini";
  if (selected === "groq") return "Groq";
  return "Mock";
}

function currentRecoveryLabel(): string {
  const selected = process.env.PAYMENT_PROVIDER?.trim().toLowerCase();
  if (selected === "razorpay") return "Razorpay Test Mode";
  return "Simulation Mode";
}

export function Header() {
  const aiLabel = currentAiLabel();
  const recoveryLabel = currentRecoveryLabel();
  const isMock = aiLabel === "Mock";

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-slate-200 bg-white/80 px-4 pl-16 backdrop-blur sm:px-6 lg:pl-6">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-slate-500">
          Acme Retail Pvt Ltd
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span
          className={`hidden rounded-full px-2.5 py-1 text-xs font-medium sm:inline ${
            isMock
              ? "bg-amber-100 text-amber-800"
              : "bg-violet-100 text-violet-700"
          }`}
          title={`AI Provider: ${aiLabel}`}
        >
          AI: {isMock ? "Mock / Demo" : aiLabel}
        </span>
        <span
          className={`hidden rounded-full px-2.5 py-1 text-xs font-medium sm:inline ${
            recoveryLabel === "Razorpay Test Mode"
              ? "bg-emerald-100 text-emerald-800"
              : "bg-slate-100 text-slate-600"
          }`}
          title={`Payment Provider: ${recoveryLabel}`}
        >
          Recovery: {recoveryLabel}
        </span>
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-700">
          AR
        </span>
      </div>
    </header>
  );
}
