export type Country = {
  iso: string;
  name: string;
  dial: string;
  flag: string;
  /** Exact national number length, when the country has a fixed mobile length. */
  length?: number;
};

export const COUNTRIES: Country[] = [
  { iso: "IN", name: "India", dial: "+91", flag: "🇮🇳", length: 10 },
  { iso: "US", name: "United States", dial: "+1", flag: "🇺🇸", length: 10 },
  { iso: "GB", name: "United Kingdom", dial: "+44", flag: "🇬🇧" },
  { iso: "AE", name: "United Arab Emirates", dial: "+971", flag: "🇦🇪" },
  { iso: "SG", name: "Singapore", dial: "+65", flag: "🇸🇬", length: 8 },
  { iso: "AU", name: "Australia", dial: "+61", flag: "🇦🇺" },
  { iso: "CA", name: "Canada", dial: "+1", flag: "🇨🇦", length: 10 },
  { iso: "NP", name: "Nepal", dial: "+977", flag: "🇳🇵" },
  { iso: "BD", name: "Bangladesh", dial: "+880", flag: "🇧🇩" },
  { iso: "LK", name: "Sri Lanka", dial: "+94", flag: "🇱🇰" },
];

export const DEFAULT_COUNTRY: Country = COUNTRIES[0]!;

export function findCountry(iso: string): Country {
  return COUNTRIES.find((c) => c.iso === iso) ?? DEFAULT_COUNTRY;
}

/** Returns an error message, or null when the national number is valid. */
export function validateNationalNumber(country: Country, national: string): string | null {
  const digits = national.replace(/\D/g, "");
  if (!digits) return "Enter your mobile number.";
  if (country.iso === "IN") {
    if (digits.length !== 10) return "Indian mobile numbers are 10 digits.";
    if (!/^[6-9]/.test(digits)) return "Indian mobile numbers start with 6, 7, 8 or 9.";
    return null;
  }
  if (country.length && digits.length !== country.length) {
    return `This number should be ${country.length} digits.`;
  }
  if (digits.length < 6 || digits.length > 14) return "Enter a valid mobile number.";
  return null;
}

export function toE164(country: Country, national: string): string {
  return `${country.dial}${national.replace(/\D/g, "")}`;
}

export function formatPhone(e164: string): string {
  const country = COUNTRIES.find((c) => e164.startsWith(c.dial));
  if (!country) return e164;
  return `${country.dial} ${e164.slice(country.dial.length)}`;
}
