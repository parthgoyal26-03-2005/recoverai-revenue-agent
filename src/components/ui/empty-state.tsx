import type { ComponentType } from "react";

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon?: ComponentType<{ className?: string }>;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center border border-dashed border-[#242424] bg-black px-6 py-10 text-center">
      {Icon && (
        <span className="border border-[#242424] bg-black p-2.5 text-[#6F7A89]">
          <Icon className="h-5 w-5" />
        </span>
      )}
      <p className="mt-3 text-sm font-semibold text-[#F7F9FC]">{title}</p>
      <p className="mt-1 max-w-md text-[13px] leading-relaxed text-[#A3ADBD]">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
