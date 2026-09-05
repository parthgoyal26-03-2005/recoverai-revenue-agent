import type { ReactNode } from "react";
import { clsx } from "clsx";

export function Card({
  children,
  className,
  hover = false,
}: {
  children: ReactNode;
  className?: string;
  hover?: boolean;
}) {
  return (
    <section
      className={clsx(
        "border border-[#1A1A1A] bg-black",
        hover && "card-lift",
        className
      )}
    >
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pt-5">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-tight text-[#F7F9FC]">
          {title}
        </h2>
        {subtitle && (
          <p className="mt-1 text-[12.5px] leading-relaxed text-[#A3ADBD]">
            {subtitle}
          </p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("px-5 py-5", className)}>{children}</div>;
}
