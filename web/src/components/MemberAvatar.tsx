import { useState } from "react";
import { nameAbbr } from "../memberProfile";

export function MemberAvatar({ name, src, size = "md" }: { name: string; src?: string; size?: "md" | "lg" }) {
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
  return (
    <span className={`grid ${box} shrink-0 place-items-center rounded-full bg-[#E9E2F5] font-semibold tracking-[-0.04em] text-[#675385] ring-1 ring-black/[0.04]`}>
      {nameAbbr(name)}
    </span>
  );
}
