/**
 * Free-text RxC pharmacy string → structured segments. Pure, no I/O.
 * Canonical shape: "The Drug Store - 91 E Croy Hailey ID 83333"
 * (name " - " street city ST ZIP), but every segment may be missing and the
 * dash separator is optional. City detection without commas is a single-token
 * heuristic — multi-word cities land in `street`; downstream matching relies
 * on zip + name + street number, so that loss is acceptable.
 */
import type { ParsedPharmacyText } from "./contracts";

const ZIP_RE = /^(\d{5})(?:-\d{4})?$/;
const STATE_RE = /^[A-Z]{2}$/;

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

function containsAddressSignal(s: string): boolean {
  return s
    .split(" ")
    .some((token) => ZIP_RE.test(token) || STATE_RE.test(token));
}

interface TailParts {
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

function parseAddressTail(tail: string): TailParts {
  const out: TailParts = { street: null, city: null, state: null, zip: null };
  const commaParts = tail
    .split(",")
    .map(collapse)
    .filter((p) => p !== "");

  const tokens = collapse(commaParts.join(" ")).split(" ").filter(Boolean);
  if (tokens.length === 0) return out;

  const last = tokens[tokens.length - 1];
  if (last !== undefined && ZIP_RE.test(last)) {
    out.zip = last.slice(0, 5);
    tokens.pop();
  }
  const maybeState = tokens[tokens.length - 1];
  if (maybeState !== undefined && STATE_RE.test(maybeState)) {
    out.state = maybeState;
    tokens.pop();
  }
  if (tokens.length === 0) return out;

  if (commaParts.length >= 2) {
    // Comma-delimited: first part is the street, second is the (possibly
    // multi-word) city. State/zip were already consumed above.
    const street = commaParts[0] ?? "";
    out.street = street === "" ? null : street;
    const cityPart = commaParts[1] ?? "";
    const cityTokens = cityPart
      .split(" ")
      .filter((t) => !ZIP_RE.test(t) && !STATE_RE.test(t));
    out.city = cityTokens.length > 0 ? cityTokens.join(" ") : null;
    return out;
  }

  if (tokens.length === 1) {
    const only = tokens[0] ?? "";
    if (/^\d/.test(only)) out.street = only;
    else out.city = only;
    return out;
  }

  // A digit-led tail needs at least number + street word before a trailing
  // token can plausibly be a city ("91 E Croy Hailey" yes, "501 Main" no).
  if (/^\d/.test(tokens[0] ?? "") && tokens.length < 3) {
    out.street = tokens.join(" ");
    return out;
  }
  const cityToken = tokens[tokens.length - 1] ?? "";
  if (/^\d/.test(cityToken)) {
    out.street = tokens.join(" ");
  } else {
    out.city = cityToken;
    out.street = tokens.slice(0, -1).join(" ");
  }
  return out;
}

export function parsePharmacyText(raw: string): ParsedPharmacyText {
  const cleaned = collapse(raw);
  const result: ParsedPharmacyText = {
    name: cleaned,
    street: null,
    city: null,
    state: null,
    zip: null,
    raw,
  };
  if (cleaned === "") return result;

  let name = cleaned;
  let tail = "";

  const dashSplit = cleaned.split(/\s+[-–—]\s+/);
  if (dashSplit.length >= 2) {
    name = dashSplit[0] ?? cleaned;
    tail = dashSplit.slice(1).join(" ");
  } else {
    // No explicit separator: split at the first street-number token, but only
    // when the tail actually looks like an address (has a state or zip).
    const m = cleaned.match(/^(.*?[^\d\s])\s+(\d+\s+.+)$/);
    if (m && m[1] !== undefined && m[2] !== undefined && containsAddressSignal(m[2])) {
      name = m[1];
      tail = m[2];
    }
  }

  result.name = collapse(name);
  if (tail !== "") {
    const parts = parseAddressTail(tail);
    result.street = parts.street;
    result.city = parts.city;
    result.state = parts.state;
    result.zip = parts.zip;
  }
  return result;
}
