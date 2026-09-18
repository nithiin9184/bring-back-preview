/**
 * Debounced username availability state.
 *
 * All normalisation/validation/lookup logic stays in the username service; this
 * hook only sequences requests and guards against out-of-order responses.
 */

import { useEffect, useRef, useState } from "react";
import {
  checkUsernameAvailability,
  validateUsername,
  type UsernameValidation,
} from "./username-service";

export type UsernameStatus = "idle" | "invalid" | "checking" | "available" | "taken" | "error";

export type UsernameAvailability = {
  status: UsernameStatus;
  /** Validation message for an invalid format, otherwise undefined. */
  error?: string;
  /** True only once a check has confirmed the username is free. */
  canSubmit: boolean;
};

export function useUsernameAvailability(username: string, delay = 400): UsernameAvailability {
  const validation: UsernameValidation = validateUsername(username);
  const [status, setStatus] = useState<UsernameStatus>("idle");
  // Monotonic request id: only the newest lookup may write state.
  const requestId = useRef(0);

  useEffect(() => {
    const current = ++requestId.current;

    if (!username) {
      setStatus("idle");
      return;
    }
    if (!validation.valid) {
      setStatus("invalid");
      return;
    }

    setStatus("checking");
    const timer = setTimeout(() => {
      checkUsernameAvailability(username)
        .then((free) => {
          if (requestId.current !== current) return;
          setStatus(free ? "available" : "taken");
        })
        .catch(() => {
          if (requestId.current !== current) return;
          setStatus("error");
        });
    }, delay);

    return () => clearTimeout(timer);
  }, [username, validation.valid, delay]);

  return {
    status,
    ...(status === "invalid" && validation.error ? { error: validation.error } : {}),
    canSubmit: status === "available",
  };
}
