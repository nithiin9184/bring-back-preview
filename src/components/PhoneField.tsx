import { ChevronDown } from "lucide-react";
import { COUNTRIES, type Country } from "@/lib/auth/countries";

type Props = {
  country: Country;
  onCountryChange: (country: Country) => void;
  value: string;
  onValueChange: (value: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
};

export function PhoneField({
  country,
  onCountryChange,
  value,
  onValueChange,
  invalid,
  disabled,
  autoFocus,
  inputRef,
}: Props) {
  return (
    <div
      className={`focus-blue flex h-11 items-center rounded-[23px] border bg-surface pl-2 pr-1 shadow-soft transition-[border-color,box-shadow] ${
        invalid ? "border-red-400" : "border-line"
      } ${disabled ? "opacity-70" : ""}`}
    >
      <div className="relative flex items-center gap-1 rounded-[18px] px-2 py-1 text-[14px] text-ink-2">
        <span className="text-[12px] font-semibold text-ink-3">{country.iso}</span>
        <span className="font-medium text-ink">{country.dial}</span>
        <ChevronDown size={14} strokeWidth={2} className="text-ink-3" />
        <select
          aria-label="Country code"
          disabled={disabled}
          value={country.iso}
          onChange={(e) => {
            const next = COUNTRIES.find((c) => c.iso === e.target.value);
            if (next) onCountryChange(next);
          }}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        >
          {COUNTRIES.map((c) => (
            <option key={c.iso} value={c.iso}>
              {c.name} ({c.dial})
            </option>
          ))}
        </select>
      </div>
      <span className="mx-1 h-5 w-px bg-line" />
      <input
        ref={inputRef}
        inputMode="numeric"
        autoComplete="tel-national"
        autoFocus={autoFocus}
        disabled={disabled}
        maxLength={country.length ?? 14}
        value={value}
        onChange={(e) => onValueChange(e.target.value.replace(/\D/g, ""))}
        placeholder="Mobile number"
        aria-label="Mobile number"
        aria-invalid={invalid ? true : undefined}
        className="h-full w-full bg-transparent px-2 text-[14px] text-ink outline-none placeholder:text-placeholder"
      />
    </div>
  );
}
