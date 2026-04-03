import * as React from "react"

import { Button, type ButtonProps } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const iconButtonSizeMap = {
  xs: "icon-xs",
  sm: "icon-sm",
  md: "icon",
  lg: "icon-lg",
} as const satisfies Record<string, NonNullable<ButtonProps["size"]>>

export interface IconButtonProps extends Omit<ButtonProps, "aria-label" | "children" | "size" | "title"> {
  children: React.ReactNode
  label: string
  pressed?: boolean
  size?: keyof typeof iconButtonSizeMap
  title?: string
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    children,
    className,
    label,
    pressed,
    shape = "default",
    size = "md",
    title,
    variant = "ghost",
    ...props
  },
  ref,
) {
  return (
    <Button
      ref={ref}
      aria-label={label}
      aria-pressed={pressed}
      className={cn("p-0", className)}
      data-state={pressed ? "on" : "off"}
      shape={shape}
      size={iconButtonSizeMap[size]}
      title={title ?? label}
      variant={variant}
      {...props}
    >
      {children}
    </Button>
  )
})
