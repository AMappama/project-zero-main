import { useState } from "react";
function surname(name: string) {
  if (/^会员\s*\d+$/.test(name) || name === "—" || name.trim() === "") return "客";
  return Array.from(name.replace(/\s/g, ""))[0] ?? "客";
}

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
      <span aria-hidden="true" className={`grid ${box} shrink-0 place-items-center rounded-full border-2 border-white bg-[linear-gradient(135deg,#EAD9C6,#D9BFA3)] font-bold text-[#8A6B45] shadow-card`}>
        客
      </span>
    );
  }
  return (
    <span className={`grid ${box} shrink-0 place-items-center rounded-full border-2 border-white bg-[linear-gradient(135deg,#EAD9C6,#D9BFA3)] font-bold text-[#8A6B45] shadow-card`}>
      {surname(name)}
    </span>
  );
}
