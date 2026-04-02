import * as React from "react"

import { cn } from "@/lib/utils"

export type DragHandleButtonProps = React.ComponentProps<"button">

export const DragHandleButton = React.forwardRef<HTMLButtonElement, DragHandleButtonProps>(function DragHandleButton(
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
        "absolute inset-y-4 z-20 w-4 -translate-x-1/2 cursor-ew-resize rounded-full border border-white/70 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-white/80",
        className,
      )}
      data-slot="drag-handle-button"
      type={type}
      {...props}
    />
  )
})
