import { FlaskConical } from "lucide-react";
import { clsx } from "clsx";

function currentAiLabel(): { short: string; full: string; isMock: boolean } {
  const selected = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (selected === "gemini" && process.env.GEMINI_API_KEY)
    return { short: "Gemini", full: "AI: Gemini", isMock: false };
  if (selected === "groq" && process.env.GROQ_API_KEY)
    return { short: "Groq", full: "AI: Groq", isMock: false };
  if (!selected && process.env.GEMINI_API_KEY)
    return { short: "Gemini", full: "AI: Gemini", isMock: false };
  if (!selected && process.env.GROQ_API_KEY)
    return { short: "Groq", full: "AI: Groq", isMock: false };
  if (selected === "gemini") return { short: "Gemini", full: "AI: Gemini", isMock: false };
  if (selected === "groq") return { short: "Groq", full: "AI: Groq", isMock: false };
  return { short: "Demo", full: "AI: Demo", isMock: true };
}

function currentRecovery(): { label: string; isRazorpay: boolean } {
  const selected = process.env.PAYMENT_PROVIDER?.trim().toLowerCase();
  if (selected === "razorpay")
    return { label: "Razorpay Test", isRazorpay: true };
  return { label: "Simulation", isRazorpay: false };
}

export function Header() {
  const ai = currentAiLabel();
  const recovery = currentRecovery();

  return (
    <header className="sticky top-0 z-20 border-b border-[#171717] bg-black">
      <div className="mx-auto flex h-14 w-full max-w-[1200px] items-center justify-between gap-3 px-4 pl-16 sm:px-6 lg:px-8 lg:pl-8">
        <p className="truncate text-[13px] font-medium text-[#A3ADBD]">
          Acme Retail Pvt Ltd
        </p>
        <div className="flex items-center gap-2">
          <span
            title={ai.full}
            className={clsx(
              "hidden border bg-black px-2 py-1 text-[11px] font-semibold tracking-[0.04em] uppercase sm:inline",
              ai.isMock
                ? "border-amber-400/40 text-amber-300"
                : "border-[#5B7CFF]/50 text-[#9DB1FF]"
            )}
          >
            {ai.full}
          </span>
          <span
            title={`Recovery: ${recovery.isRazorpay ? "Razorpay Test Mode" : "Simulation Mode"}`}
            className={clsx(
              "hidden border bg-black px-2 py-1 text-[11px] font-semibold tracking-[0.04em] uppercase sm:inline",
              recovery.isRazorpay
                ? "border-emerald-400/40 text-emerald-300"
                : "border-white/15 text-[#A3ADBD]"
            )}
          >
            Recovery: {recovery.label}
          </span>
          <span className="inline-flex items-center gap-1 border border-white/15 bg-black px-2 py-1 text-[11px] font-semibold tracking-[0.04em] text-[#A3ADBD] uppercase">
            <FlaskConical className="h-3.5 w-3.5" />
            Test Mode
          </span>
        </div>
      </div>
    </header>
  );
}
