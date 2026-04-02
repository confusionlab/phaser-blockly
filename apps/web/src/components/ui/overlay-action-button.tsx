import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const overlayActionButtonVariants = cva(
  "inline-flex items-center justify-center rounded-full transition-[background-color,color,box-shadow,opacity,transform] duration-150 outline-none disabled:cursor-not-allowed disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      tone: {
        dark:
          "text-white/78 hover:bg-white/14 hover:text-white focus-visible:ring-2 focus-visible:ring-white/55",
        light:
          "text-slate-700/88 hover:bg-white/22 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-slate-950/18",
      },
      size: {
        compact: "size-6",
        default: "size-8",
      },
      emphasis: {
        default: "",
        positive: "",
        danger: "bg-red-500 text-white hover:bg-red-400",
      },
      selected: {
        true: "",
        false: "",
      },
    },
    defaultVariants: {
      tone: "dark",
      size: "default",
      emphasis: "default",
      selected: false,
    },
    compoundVariants: [
      {
        tone: "dark",
        emphasis: "positive",
        className: "text-emerald-300 hover:bg-emerald-400/14 hover:text-emerald-200",
      },
      {
        tone: "light",
        emphasis: "positive",
        className: "text-emerald-700 hover:bg-emerald-500/12 hover:text-emerald-800",
      },
      {
        tone: "dark",
        emphasis: "default",
        selected: true,
        className: "bg-white/16 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] hover:bg-white/16 hover:text-white",
      },
      {
        tone: "light",
        emphasis: "default",
        selected: true,
        className: "bg-white/42 text-slate-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.72),0_8px_18px_-14px_rgba(15,23,42,0.22)] hover:bg-white/42 hover:text-slate-950",
      },
    ],
  },
)

export interface OverlayActionButtonProps
  extends React.ComponentProps<"button">,
    VariantProps<typeof overlayActionButtonVariants> {
  label: string
  pressed?: boolean
}

export const OverlayActionButton = React.forwardRef<HTMLButtonElement, OverlayActionButtonProps>(
  function OverlayActionButton(
    {
      className,
      emphasis = "default",
      label,
      pressed,
      selected = false,
      size = "default",
      title,
      tone = "dark",
      type = "button",
      ...props
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        aria-label={label}
        aria-pressed={pressed}
        className={cn(overlayActionButtonVariants({ tone, size, emphasis, selected, className }))}
        data-slot="overlay-action-button"
        type={type}
        title={title ?? label}
        {...props}
      />
    )
  },
)
