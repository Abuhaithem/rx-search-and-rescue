"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Loader2, Moon, Sun } from "lucide-react";
import { changePassword, updateDisplayName } from "@/server/actions/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

export function DisplayNameForm({ initialName }: { initialName: string }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [pending, startTransition] = useTransition();

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    startTransition(async () => {
      const result = await updateDisplayName(name);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Name updated");
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="flex items-end gap-3">
      <div className="flex-1 space-y-1.5">
        <Label htmlFor="settings-name">Display name</Label>
        <Input
          id="settings-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          minLength={2}
          required
          className="max-w-sm"
        />
        <p className="text-xs text-steel">Shown in the header and on every audit-trail entry.</p>
      </div>
      <Button type="submit" disabled={pending || name.trim() === initialName || name.trim().length < 2}>
        {pending ? <Loader2 className="animate-spin" /> : null}
        Save
      </Button>
    </form>
  );
}

export function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, startTransition] = useTransition();

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (next !== confirm) {
      toast.error("New passwords do not match");
      return;
    }
    startTransition(async () => {
      const result = await changePassword(current, next);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Password changed — other devices were signed out");
      setCurrent("");
      setNext("");
      setConfirm("");
    });
  };

  return (
    <form onSubmit={submit} className="max-w-sm space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="settings-current">Current password</Label>
        <PasswordInput
          id="settings-current"
          autoComplete="current-password"
          required
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="settings-new">New password</Label>
        <PasswordInput
          id="settings-new"
          autoComplete="new-password"
          required
          minLength={10}
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <p className="text-xs text-steel">At least 10 characters.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="settings-confirm">Confirm new password</Label>
        <PasswordInput
          id="settings-confirm"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={pending || !current || next.length < 10 || !confirm}>
        {pending ? <Loader2 className="animate-spin" /> : null}
        Change password
      </Button>
    </form>
  );
}

type Theme = "light" | "dark";

/** Cookie-backed so the server renders the right theme on first paint. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");
  useEffect(() => {
    setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
  }, []);

  const apply = (next: Theme) => {
    setTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    document.cookie = `rxsr_theme=${next}; path=/; max-age=31536000; samesite=lax`;
  };

  const options: { value: Theme; label: string; icon: React.ReactNode }[] = [
    { value: "light", label: "Light", icon: <Sun className="size-4" /> },
    { value: "dark", label: "Night", icon: <Moon className="size-4" /> },
  ];

  return (
    <div className="flex items-center gap-2" role="radiogroup" aria-label="App theme">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={theme === option.value}
          onClick={() => apply(option.value)}
          className={cn(
            "flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-semibold transition-colors",
            theme === option.value
              ? "border-harbor bg-deepwater text-white"
              : "border-mist bg-white text-steel hover:border-steel/50 hover:text-deepwater",
          )}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}
