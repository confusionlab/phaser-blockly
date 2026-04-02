import * as React from "react"

import { cn } from "@/lib/utils"

export type DisclosureButtonProps = React.ComponentProps<"button">

export const DisclosureButton = React.forwardRef<HTMLButtonElement, DisclosureButtonProps>(function DisclosureButton(
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
      className={cn(
        "-mx-1 flex self-stretch shrink-0 items-center justify-center rounded px-1 transition-opacity disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        className,
      )}
      data-slot="disclosure-button"
      type={type}
      {...props}
    />
  )
})
