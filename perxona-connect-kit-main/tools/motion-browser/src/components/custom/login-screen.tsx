import * as React from "react";
import { Eye, EyeOff, Loader2, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export interface LoginScreenProps {
  onLogin: (email: string, password: string) => Promise<void>;
  isLoggingIn: boolean;
  error?: Error | null;
}

export function LoginScreen({ onLogin, isLoggingIn, error }: LoginScreenProps) {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || isLoggingIn) return;
    onLogin(email, password).catch(() => undefined);
  };

  return (
    <div className="flex min-h-svh items-center justify-center bg-gradient-to-b from-white via-blue-50 to-blue-300 p-6">
      <div className="flex w-full max-w-[420px] flex-col items-center gap-6">
        {/* Card */}
        <form
          onSubmit={handleSubmit}
          className={cn(
            "flex w-full flex-col items-center gap-6 rounded-3xl border border-white/60 bg-white/70 px-10 py-10 shadow-xl backdrop-blur-md",
          )}
        >
          <div className="flex flex-col items-center gap-2 size-10">
            {/* Logo */}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="100%"
              height="100%"
              viewBox="0 0 76 76"
              fill="none"
            >
              <path
                d="M65.9998 32.4613C65.9998 47.7828 54.7685 60.4581 40.1454 62.6013V62.4639C40.1895 58.2579 39.182 54.354 38.5082 50.3001C38.4054 49.6851 38.313 49.0637 38.2333 48.438C38.0171 46.7387 37.8681 44.7477 38.5082 43.0864C38.6279 42.7715 38.779 42.4692 38.9616 42.1818C39.4108 41.4758 40.0719 40.9453 40.8443 40.6346C42.1226 40.1231 44.6832 39.3305 44.509 37.5297C44.3957 36.363 43.2518 35.4605 42.5193 34.6637C40.8275 32.8143 39.1883 31.0494 37.8261 28.9379C37.1628 27.9107 36.6339 26.8539 36.1176 25.795C36 25.5244 35.8762 25.2581 35.7461 24.996C35.5257 24.5353 35.2927 24.083 35.0408 23.6349C34.9107 23.4024 34.7806 23.1678 34.642 22.9395L34.5182 22.7324C34.4154 22.559 34.3125 22.39 34.2013 22.2166C32.4214 19.4055 30.1441 16.9411 27.5057 14.9437C24.0614 12.3376 19.9853 10.5263 15.5503 9.78653C20.9088 4.94214 27.9864 2 35.7482 2C45.9783 2 55.0225 7.11704 60.4986 14.9416C63.9639 19.898 65.9977 25.9387 65.9977 32.4613H65.9998Z"
                fill="#0B65FF"
              />
              <path
                d="M33.0008 37.0964V74C23.4172 74 15.2629 67.8283 12.2489 59.2153C11.4408 56.9094 11 54.428 11 51.8452V14.9437C20.5837 14.9437 28.7379 21.1155 31.752 29.7284C32.5601 32.0343 33.0008 34.5157 33.0008 37.0985V37.0964Z"
                fill="#0B65FF"
              />
            </svg>
          </div>

          <h1 className="text-[28px] font-bold text-grey-900">Welcome back</h1>

          {/* Email */}
          <fieldset className="relative w-full">
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isLoggingIn}
              placeholder=" "
              className="peer w-full rounded-xl border border-grey-300 bg-transparent px-4 pb-3 pt-5 text-[15px] text-foreground outline-none transition-colors focus:border-primary"
            />
            <label
              htmlFor="email"
              className="pointer-events-none absolute left-4 top-1 text-[11px] text-grey-500 transition-all peer-placeholder-shown:top-4 peer-placeholder-shown:text-[15px] peer-focus:top-1 peer-focus:text-[11px] peer-focus:text-primary"
            >
              Email *
            </label>
          </fieldset>

          {/* Password */}
          <fieldset className="relative w-full">
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoggingIn}
              placeholder=" "
              className="peer w-full rounded-xl border border-grey-300 bg-transparent px-4 pb-3 pt-5 pr-12 text-[15px] text-foreground outline-none transition-colors focus:border-primary"
            />
            <label
              htmlFor="password"
              className="pointer-events-none absolute left-4 top-1 text-[11px] text-grey-500 transition-all peer-placeholder-shown:top-4 peer-placeholder-shown:text-[15px] peer-focus:top-1 peer-focus:text-[11px] peer-focus:text-primary"
            >
              Password *
            </label>
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPassword((s) => !s)}
              className="absolute right-4 top-[28px] -translate-y-1/2 flex items-center justify-center text-grey-500 hover:text-grey-700"
            >
              {showPassword ? (
                <Eye className="size-5" />
              ) : (
                <EyeOff className="size-5" />
              )}
            </button>
          </fieldset>

          {/* Error */}
          {error && (
            <p className="flex items-center gap-1.5 text-[13px] text-red-500">
              <TriangleAlert className="size-4" />
              {error.message}
            </p>
          )}

          {/* Login button */}
          <Button
            type="submit"
            disabled={!email || !password || isLoggingIn}
            className="h-12 w-full rounded-full text-[16px] font-bold"
          >
            {isLoggingIn ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Signing in…
              </>
            ) : (
              "Log in"
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
