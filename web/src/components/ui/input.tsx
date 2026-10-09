import * as React from "react";
import { cn } from "../../lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-10 w-full rounded-[9px] border border-input bg-white px-3 py-1 text-[13px] font-semibold shadow-none transition-[border-color,box-shadow] duration-150 file:border-0 file:bg-transparent file:text-sm placeholder:text-[#8A8177] focus-visible:border-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/15 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
