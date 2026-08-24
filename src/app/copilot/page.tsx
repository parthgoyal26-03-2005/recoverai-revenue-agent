export default function CopilotPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">AI Copilot</h1>
        <p className="text-sm text-slate-500">
          Ask questions about your revenue recovery performance
        </p>
      </div>

      <div className="flex min-h-[400px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center shadow-sm">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-100 text-violet-700">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            className="h-6 w-6"
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z"
            />
          </svg>
        </span>
        <h2 className="mt-4 text-base font-semibold text-slate-900">
          The AI Copilot is not connected yet
        </h2>
        <p className="mt-1 max-w-md text-sm text-slate-500">
          Once the AI layer is implemented, you will be able to ask things like
          &quot;How much revenue did we recover today?&quot; or &quot;What is
          causing the most payment failures?&quot;
        </p>
      </div>
    </div>
  );
}
