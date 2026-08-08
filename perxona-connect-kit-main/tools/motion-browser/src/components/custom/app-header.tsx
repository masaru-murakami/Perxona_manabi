import * as React from "react";
import { ChevronDown, LogOut } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface AppHeaderProps extends React.HTMLAttributes<HTMLElement> {
  title?: string;
  account?: {
    name: string;
    avatarSrc?: string;
  };
  onProfile?: () => void;
  onSettings?: () => void;
  onSignOut?: () => void;
}

export function AppHeader({
  title = "Perxona Connect Kit",
  account,
  onSignOut,
  className,
  ...props
}: AppHeaderProps) {
  return (
    <header
      className={cn(
        "flex h-[90px] items-center gap-4 bg-transparent px-10",
        "bg-[linear-gradient(0deg,_rgba(0,0,0,0)_0%,_#5C5C5C_155%)]",
        className,
      )}
      {...props}
    >
      <h1 className="flex-1 truncate text-h4 text-[#f9fafb]">{title}</h1>

      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={account ? `Account: ${account.name}` : "Account"}
          className={cn(
            "flex items-center gap-1 rounded-full border border-border bg-white py-0.5 pl-0.5 pr-2",
            "transition-colors hover:bg-grey-100 data-[state=open]:bg-grey-100",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          )}
        >
          <span className="flex size-6 items-center justify-center overflow-hidden rounded-full bg-grey-300 text-[11px] font-semibold text-grey-600">
            {account?.avatarSrc ? (
              <img
                src={account.avatarSrc}
                alt=""
                className="size-full object-cover"
              />
            ) : (
              (account?.name?.charAt(0).toUpperCase() ?? "A")
            )}
          </span>
          <ChevronDown className="size-4 text-grey-600" />
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-48">
          {account ? (
            <DropdownMenuLabel>{account.name}</DropdownMenuLabel>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onSignOut} className="text-red-500 ">
            <LogOut className="size-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
