import { useState } from "react";
import { nameAbbr } from "../memberProfile";

export function MemberAvatar({
  name,
  src,
  size = "md",
  placeholder = false,
}: {
  name: string;
  src?: string;
  size?: "md" | "lg";
  placeholder?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const box = size === "lg" ? "h-24 w-24 text-2xl" : "h-11 w-11 text-[13px]";
  if (src && !failed) {
    return (
      <img
        src={src}
        alt={name}
        className={`${box} shrink-0 rounded-full object-cover ring-1 ring-black/[0.06]`}
        onError={() => setFailed(true)}
      />
    );
  }
  if (placeholder) {
    return (
      <span aria-hidden="true" className={`grid ${box} shrink-0 place-items-center rounded-full bg-secondary ring-1 ring-black/[0.04]`}>
        <span className="h-2 w-2 rounded-full bg-secondary-foreground/40" />
      </span>
    );
  }
  return (
    <span className={`grid ${box} shrink-0 place-items-center rounded-full bg-secondary font-semibold tracking-[-0.04em] text-secondary-foreground ring-1 ring-black/[0.04]`}>
      {nameAbbr(name)}
    </span>
  );
}
