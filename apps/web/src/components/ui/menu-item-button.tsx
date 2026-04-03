import * as React from "react"

import { Button, type ButtonProps } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type MenuItemButtonIntent = "default" | "destructive" | "accent"

export interface MenuItemButtonProps extends Omit<ButtonProps, "shape" | "size" | "variant"> {
  icon?: React.ReactNode
  intent?: MenuItemButtonIntent
}

const intentClassNames: Record<MenuItemButtonIntent, string> = {
  default: "",
  destructive: "text-destructive hover:text-destructive focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/30",
  accent: "text-purple-600 hover:text-purple-600 dark:text-purple-400 dark:hover:text-purple-400",
}

export const MenuItemButton = React.forwardRef<HTMLButtonElement, MenuItemButtonProps>(function MenuItemButton(
  {
    children,
    className,
    icon,
    intent = "default",
    ...props
  },
  ref,
) {
  return (
    <Button
      ref={ref}
      className={cn("h-8 w-full justify-start px-3 font-normal shadow-none", intentClassNames[intent], className)}
      shape="none"
      size="sm"
      variant="ghost"
      {...props}
    >
      {icon}
      {children}
    </Button>
  )
})
