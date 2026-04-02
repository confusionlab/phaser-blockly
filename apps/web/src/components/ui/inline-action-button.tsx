import * as React from "react"

import { Button, type ButtonProps } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type InlineActionButtonSize = "sm" | "md"

export interface InlineActionButtonProps extends Omit<ButtonProps, "shape" | "size" | "variant"> {
  icon?: React.ReactNode
  size?: InlineActionButtonSize
}

const sizeClassNames: Record<InlineActionButtonSize, string> = {
  sm: "h-8 px-2 text-xs",
  md: "h-10 px-3 text-xs",
}

export const InlineActionButton = React.forwardRef<HTMLButtonElement, InlineActionButtonProps>(
  function InlineActionButton(
    {
      children,
      className,
      icon,
      size = "sm",
      ...props
    },
    ref,
  ) {
    return (
      <Button
        ref={ref}
        className={cn("inspector-inline-button", sizeClassNames[size], className)}
        shape="default"
        size="sm"
        variant="outline"
        {...props}
      >
        {icon}
        {children}
      </Button>
    )
  },
)
