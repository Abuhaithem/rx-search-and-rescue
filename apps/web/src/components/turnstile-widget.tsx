"use client";

import { useEffect, useRef } from "react";

interface TurnstileApi {
  render: (
    element: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
      theme: "light";
    },
  ) => string;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
    __rxsrTurnstileOnload?: () => void;
  }
}

const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=__rxsrTurnstileOnload&render=explicit";
const readyCallbacks: (() => void)[] = [];

function whenTurnstileReady(callback: () => void): void {
  if (window.turnstile) {
    callback();
    return;
  }
  readyCallbacks.push(callback);
  if (document.querySelector(`script[src="${SCRIPT_SRC}"]`)) return;
  window.__rxsrTurnstileOnload = () => {
    while (readyCallbacks.length > 0) readyCallbacks.shift()?.();
  };
  const script = document.createElement("script");
  script.src = SCRIPT_SRC;
  script.async = true;
  document.head.appendChild(script);
}

/**
 * Cloudflare Turnstile challenge. Reports the pass token via onToken;
 * expiry or challenge error reports null so callers can re-disable submit.
 */
export function TurnstileWidget({
  siteKey,
  onToken,
}: {
  siteKey: string;
  onToken: (token: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useEffect(() => {
    let widgetId: string | null = null;
    let cancelled = false;
    whenTurnstileReady(() => {
      if (cancelled || !containerRef.current || !window.turnstile) return;
      widgetId = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        callback: (token) => onTokenRef.current(token),
        "expired-callback": () => onTokenRef.current(null),
        "error-callback": () => onTokenRef.current(null),
        theme: "light",
      });
    });
    return () => {
      cancelled = true;
      if (widgetId !== null) window.turnstile?.remove(widgetId);
    };
  }, [siteKey]);

  return <div ref={containerRef} />;
}
