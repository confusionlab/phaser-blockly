import * as React from "react"

import { cn } from "@/lib/utils"

export type ScrimButtonProps = React.ComponentProps<"button">

export const ScrimButton = React.forwardRef<HTMLButtonElement, ScrimButtonProps>(function ScrimButton(
  {
    className,
    type = "button",
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn("absolute inset-0 bg-surface-scrim backdrop-blur-[3px]", className)}
      data-slot="scrim-button"
      type={type}
      {...props}
    />
  )
})
