"use client"


import Color from "color"
import { PipetteIcon } from "@/components/ui/icons"
import * as Slider from "@radix-ui/react-slider"
import {
  type ComponentProps,
  createContext,
  type HTMLAttributes,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

interface ColorPickerContextValue {
  hue: number
  saturation: number
  lightness: number
  alpha: number
  mode: string
  setColor: (value: Parameters<typeof Color>[0]) => void
  setHue: (hue: number) => void
  setSaturation: (saturation: number) => void
  setLightness: (lightness: number) => void
  setAlpha: (alpha: number) => void
  setHsl: (hue: number, saturation: number, lightness: number) => void
  setHsla: (hue: number, saturation: number, lightness: number, alpha: number) => void
  setMode: (mode: string) => void
}

const ColorPickerContext = createContext<ColorPickerContextValue | undefined>(undefined)
const SATURATION_EPSILON = 0.01
const STATE_EPSILON = 0.001

interface ColorState {
  hue: number
  saturation: number
  lightness: number
  alpha: number
}

interface EyeDropperSelectionResult {
  sRGBHex: string
}

interface EyeDropperInstance {
  open: () => Promise<EyeDropperSelectionResult>
}

interface EyeDropperConstructor {
  new (): EyeDropperInstance
}

type EyeDropperCapableWindow = Window &
  typeof globalThis & {
    EyeDropper?: EyeDropperConstructor
  }

const DEFAULT_COLOR_STATE: ColorState = {
  hue: 0,
  saturation: 100,
  lightness: 50,
  alpha: 100,
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

const getEyeDropperConstructor = (): EyeDropperConstructor | null => {
  if (typeof window === "undefined") {
    return null
  }

  const browserWindow = window as EyeDropperCapableWindow
  return typeof browserWindow.EyeDropper === "function" ? browserWindow.EyeDropper : null
}

const supportsEyeDropper = () => getEyeDropperConstructor() !== null

const normalizeHue = (value: number, fallbackHue: number) => {
  if (!Number.isFinite(value)) {
    return fallbackHue
  }
  return ((value % 360) + 360) % 360
}

const normalizeState = (state: ColorState, fallback: ColorState): ColorState => ({
  hue: normalizeHue(state.hue, fallback.hue),
  saturation: clamp(state.saturation, 0, 100),
  lightness: clamp(state.lightness, 0, 100),
  alpha: clamp(state.alpha, 0, 100),
})

const isStateEqual = (a: ColorState, b: ColorState) =>
  Math.abs(a.hue - b.hue) < STATE_EPSILON &&
  Math.abs(a.saturation - b.saturation) < STATE_EPSILON &&
  Math.abs(a.lightness - b.lightness) < STATE_EPSILON &&
  Math.abs(a.alpha - b.alpha) < STATE_EPSILON

const parseColorToState = (
  input: Parameters<typeof Color>[0] | undefined,
  fallback: ColorState,
): ColorState => {
  try {
    const color = Color(input)
    const hsl = color.hsl()
    const hue = normalizeHue(hsl.hue(), fallback.hue)
    const saturation = Number.isFinite(hsl.saturationl()) ? hsl.saturationl() : fallback.saturation
    const lightness = Number.isFinite(hsl.lightness()) ? hsl.lightness() : fallback.lightness
    const alpha = Number.isFinite(color.alpha()) ? color.alpha() * 100 : fallback.alpha
    return normalizeState({ hue, saturation, lightness, alpha }, fallback)
  } catch {
    return fallback
  }
}

export const useColorPicker = () => {
  const context = useContext(ColorPickerContext)

  if (!context) {
    throw new Error("useColorPicker must be used within a ColorPickerProvider")
  }

  return context
}

export type ColorPickerProps = HTMLAttributes<HTMLDivElement> & {
  value?: Parameters<typeof Color>[0]
  defaultValue?: Parameters<typeof Color>[0]
  onChange?: (value: Parameters<typeof Color.rgb>[0]) => void
}

export const ColorPicker = ({
  value,
  defaultValue = "#000000",
  onChange,
  className,
  ...props
}: ColorPickerProps) => {
  const initialState = useMemo(
    () => parseColorToState(value ?? defaultValue, DEFAULT_COLOR_STATE),
    [value, defaultValue],
  )
  const [colorState, setColorState] = useState<ColorState>(initialState)
  const colorStateRef = useRef(colorState)
  const [mode, setMode] = useState("hex")

  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const emitChange = useCallback((state: ColorState) => {
    if (onChangeRef.current) {
      const color = Color.hsl(state.hue, state.saturation, state.lightness).alpha(state.alpha / 100)
      const rgba = color.rgb().array()
      onChangeRef.current([rgba[0], rgba[1], rgba[2], state.alpha / 100])
    }
  }, [])

  const applyState = useCallback(
    (nextState: ColorState, notify: boolean) => {
      setColorState(prevState => {
        const normalized = normalizeState(nextState, prevState)
        if (isStateEqual(prevState, normalized)) {
          colorStateRef.current = prevState
          return prevState
        }
        colorStateRef.current = normalized
        if (notify) {
          emitChange(normalized)
        }
        return normalized
      })
    },
    [emitChange],
  )

  const updateState = useCallback(
    (updater: (prevState: ColorState) => ColorState, notify = true) => {
      const nextState = updater(colorStateRef.current)
      applyState(nextState, notify)
    },
    [applyState],
  )

  const setColorAndNotify = useCallback(
    (nextColor: Parameters<typeof Color>[0]) => {
      const parsed = parseColorToState(nextColor, colorStateRef.current)
      applyState(parsed, true)
    },
    [applyState],
  )

  // Sync state when parent controls `value`.
  useEffect(() => {
    if (value === undefined) {
      return
    }
    const parsed = parseColorToState(value, colorStateRef.current)
    applyState(parsed, false)
  }, [value, applyState])

  const setHueAndNotify = useCallback(
    (hue: number) => updateState(prevState => ({ ...prevState, hue })),
    [updateState],
  )
  const setSaturationAndNotify = useCallback(
    (saturation: number) => updateState(prevState => ({ ...prevState, saturation })),
    [updateState],
  )
  const setLightnessAndNotify = useCallback(
    (lightness: number) => updateState(prevState => ({ ...prevState, lightness })),
    [updateState],
  )
  const setAlphaAndNotify = useCallback(
    (alpha: number) => updateState(prevState => ({ ...prevState, alpha })),
    [updateState],
  )
  const setHslAndNotify = useCallback(
    (hue: number, saturation: number, lightness: number) =>
      updateState(prevState => ({ ...prevState, hue, saturation, lightness })),
    [updateState],
  )
  const setHslaAndNotify = useCallback(
    (hue: number, saturation: number, lightness: number, alpha: number) =>
      updateState(() => ({ hue, saturation, lightness, alpha })),
    [updateState],
  )

  return (
    <ColorPickerContext.Provider
      value={{
        hue: colorState.hue,
        saturation: colorState.saturation,
        lightness: colorState.lightness,
        alpha: colorState.alpha,
        mode,
        setColor: setColorAndNotify,
        setHue: setHueAndNotify,
        setSaturation: setSaturationAndNotify,
        setLightness: setLightnessAndNotify,
        setAlpha: setAlphaAndNotify,
        setHsl: setHslAndNotify,
        setHsla: setHslaAndNotify,
        setMode,
      }}
    >
      <div className={cn("flex size-full flex-col gap-4", className)} {...(props as any)} />
    </ColorPickerContext.Provider>
  )
}

export type ColorPickerSelectionProps = HTMLAttributes<HTMLDivElement>

export const ColorPickerSelection = memo(({ className, ...props }: ColorPickerSelectionProps) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [positionX, setPositionX] = useState(0)
  const [positionY, setPositionY] = useState(0)
  const { hue, saturation, lightness, setHsl } = useColorPicker()

  // Sync cursor position from HSL values (convert HSL to HSV for visual position)
  useEffect(() => {
    if (isDragging) return

    const s_hsl = Math.max(0, Math.min(1, saturation / 100))
    const l = Math.max(0, Math.min(1, lightness / 100))

    // HSL to HSV conversion
    const v = l + s_hsl * Math.min(l, 1 - l)
    const s_hsvRaw = v === 0 ? 0 : 2 * (1 - l / v)
    const s_hsv = Math.abs(s_hsvRaw) < SATURATION_EPSILON ? 0 : s_hsvRaw

    // x = saturation in HSV, y = 1 - value
    const newX = Math.max(0, Math.min(1, s_hsv))
    const newY = Math.max(0, Math.min(1, 1 - v))

    setPositionX(newX)
    setPositionY(newY)
  }, [saturation, lightness, isDragging])

  const backgroundGradient = useMemo(() => {
    return `linear-gradient(0deg, rgba(0,0,0,1), rgba(0,0,0,0)),
            linear-gradient(90deg, rgba(255,255,255,1), rgba(255,255,255,0)),
            hsl(${hue}, 100%, 50%)`
  }, [hue])

  const updateFromPointerEvent = useCallback(
    (event: PointerEvent) => {
      if (!containerRef.current) {
        return
      }
      const rect = containerRef.current.getBoundingClientRect()
      const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
      const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
      setPositionX(x)
      setPositionY(y)

      // The visual picker uses HSV color model:
      // x = saturation (0 = grey/white, 1 = fully saturated)
      // y = inverse value (0 = bright, 1 = dark)
      const s_hsv = Math.max(0, Math.min(1, x))
      const v = Math.max(0, Math.min(1, 1 - y))

      // Convert HSV to HSL
      const l = v * (1 - s_hsv / 2)
      let s_hsl = 0
      if (s_hsv > SATURATION_EPSILON && l > SATURATION_EPSILON && l < 1 - SATURATION_EPSILON) {
        s_hsl = (v - l) / Math.min(l, 1 - l)
      }

      setHsl(hue, Math.max(0, Math.min(100, s_hsl * 100)), Math.max(0, Math.min(100, l * 100)))
    },
    [hue, setHsl],
  )

  useEffect(() => {
    const handlePointerUp = () => setIsDragging(false)
    const handlePointerMove = (event: PointerEvent) => {
      if (!isDragging) {
        return
      }
      updateFromPointerEvent(event)
    }

    if (isDragging) {
      window.addEventListener("pointermove", handlePointerMove)
      window.addEventListener("pointerup", handlePointerUp)
    }

    return () => {
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
    }
  }, [isDragging, updateFromPointerEvent])

  return (
    <div
      className={cn("relative size-full cursor-crosshair rounded", className)}
      onPointerDown={e => {
        e.preventDefault()
        setIsDragging(true)
        updateFromPointerEvent(e.nativeEvent)
      }}
      ref={containerRef}
      style={{
        background: backgroundGradient,
      }}
      {...(props as any)}
    >
      <div
        className="-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute h-4 w-4 rounded-full border-2 border-white"
        style={{
          left: `${positionX * 100}%`,
          top: `${positionY * 100}%`,
          boxShadow: "0 0 0 1px rgba(0,0,0,0.5)",
        }}
      />
    </div>
  )
})

ColorPickerSelection.displayName = "ColorPickerSelection"

export type ColorPickerHueProps = ComponentProps<typeof Slider.Root>

export const ColorPickerHue = ({ className, ...props }: ColorPickerHueProps) => {
  const { hue, setHue } = useColorPicker()

  return (
    <Slider.Root
      className={cn("relative flex h-4 w-full touch-none", className)}
      max={360}
      onValueChange={([hue]) => setHue(hue)}
      step={1}
      value={[hue]}
      {...(props as any)}
    >
      <Slider.Track className="relative my-0.5 h-3 w-full grow rounded-full bg-[linear-gradient(90deg,#FF0000,#FFFF00,#00FF00,#00FFFF,#0000FF,#FF00FF,#FF0000)]">
        <Slider.Range className="absolute h-full" />
      </Slider.Track>
      <Slider.Thumb className="block h-4 w-4 rounded-full border border-primary/50 bg-background shadow transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" />
    </Slider.Root>
  )
}

export type ColorPickerAlphaProps = ComponentProps<typeof Slider.Root>

export const ColorPickerAlpha = ({ className, ...props }: ColorPickerAlphaProps) => {
  const { alpha, setAlpha } = useColorPicker()

  return (
    <Slider.Root
      className={cn("relative flex h-4 w-full touch-none", className)}
      max={100}
      onValueChange={([alpha]) => setAlpha(alpha)}
      step={1}
      value={[alpha]}
      {...(props as any)}
    >
      <Slider.Track
        className="relative my-0.5 h-3 w-full grow rounded-full"
        style={{
          background:
            'url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMUlEQVQ4T2NkYGAQYcAP3uCTZhw1gGGYhAGBZIA/nYDCgBDAm9BGDWAAJyRCgLaBCAAgXwixzAS0pgAAAABJRU5ErkJggg==") left center',
        }}
      >
        <div className="absolute inset-0 rounded-full bg-gradient-to-r from-transparent to-black/50" />
        <Slider.Range className="absolute h-full rounded-full bg-transparent" />
      </Slider.Track>
      <Slider.Thumb className="block h-4 w-4 rounded-full border border-primary/50 bg-background shadow transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" />
    </Slider.Root>
  )
}

export type ColorPickerEyeDropperProps = ComponentProps<typeof Button>

export const ColorPickerEyeDropper = ({ className, ...props }: ColorPickerEyeDropperProps) => {
  const { setColor } = useColorPicker()
  const eyeDropperSupported = supportsEyeDropper()

  const handleEyeDropper = async () => {
    const EyeDropper = getEyeDropperConstructor()
    if (!EyeDropper) {
      return
    }

    try {
      const eyeDropper = new EyeDropper()
      const result = await eyeDropper.open()
      setColor(result.sRGBHex)
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return
      }
      console.error("EyeDropper failed:", error)
    }
  }

  if (!eyeDropperSupported) {
    return null
  }

  return (
    <Button
      aria-label="Pick color from screen"
      className={cn("shrink-0 text-muted-foreground", className)}
      onClick={handleEyeDropper}
      size="icon"
      title="Pick color from screen"
      type="button"
      variant="outline"
      {...(props as any)}
    >
      <PipetteIcon size={16} />
    </Button>
  )
}

export type ColorPickerOutputProps = ComponentProps<typeof SelectTrigger>

const formats = ["hex", "rgb", "css", "hsl"]

export const ColorPickerOutput = ({ className, ...props }: ColorPickerOutputProps) => {
  const { mode, setMode } = useColorPicker()

  return (
    <Select onValueChange={setMode} value={mode}>
      <SelectTrigger className="h-8 w-20 shrink-0 text-xs" {...(props as any)}>
        <SelectValue placeholder="Mode" />
      </SelectTrigger>
      <SelectContent>
        {formats.map(format => (
          <SelectItem className="text-xs" key={format} value={format}>
            {format.toUpperCase()}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

type PercentageInputProps = ComponentProps<typeof Input>

const PercentageInput = ({ className, ...props }: PercentageInputProps) => {
  return (
    <div className="relative">
      <Input
        readOnly
        type="text"
        {...(props as any)}
        className={cn(
          "h-8 w-[3.25rem] rounded-l-none bg-secondary px-2 text-xs shadow-none",
          className,
        )}
      />
      <span className="-translate-y-1/2 absolute top-1/2 right-2 text-muted-foreground text-xs">
        %
      </span>
    </div>
  )
}

export type ColorPickerFormatProps = HTMLAttributes<HTMLDivElement>

export const ColorPickerFormat = ({ className, ...props }: ColorPickerFormatProps) => {
  const { hue, saturation, lightness, alpha, mode } = useColorPicker()
  const color = Color.hsl(hue, saturation, lightness, alpha / 100)

  if (mode === "hex") {
    const hex = color.hex()

    return (
      <div
        className={cn(
          "-space-x-px relative flex w-full items-center rounded-md shadow-sm",
          className,
        )}
        {...(props as any)}
      >
        <Input
          className="h-8 rounded-r-none bg-secondary px-2 text-xs shadow-none"
          readOnly
          type="text"
          value={hex}
        />
        <PercentageInput value={alpha} />
      </div>
    )
  }

  if (mode === "rgb") {
    const rgb = color
      .rgb()
      .array()
      .map(value => Math.round(value))

    return (
      <div
        className={cn("-space-x-px flex items-center rounded-md shadow-sm", className)}
        {...(props as any)}
      >
        {rgb.map((value, index) => (
          <Input
            className={cn(
              "h-8 rounded-r-none bg-secondary px-2 text-xs shadow-none",
              index && "rounded-l-none",
              className,
            )}
            key={index}
            readOnly
            type="text"
            value={value}
          />
        ))}
        <PercentageInput value={alpha} />
      </div>
    )
  }

  if (mode === "css") {
    const rgb = color
      .rgb()
      .array()
      .map(value => Math.round(value))

    return (
      <div className={cn("w-full rounded-md shadow-sm", className)} {...(props as any)}>
        <Input
          className="h-8 w-full bg-secondary px-2 text-xs shadow-none"
          readOnly
          type="text"
          value={`rgba(${rgb.join(", ")}, ${alpha}%)`}
          {...(props as any)}
        />
      </div>
    )
  }

  if (mode === "hsl") {
    const hsl = color
      .hsl()
      .array()
      .map(value => Math.round(value))

    return (
      <div
        className={cn("-space-x-px flex items-center rounded-md shadow-sm", className)}
        {...(props as any)}
      >
        {hsl.map((value, index) => (
          <Input
            className={cn(
              "h-8 rounded-r-none bg-secondary px-2 text-xs shadow-none",
              index && "rounded-l-none",
              className,
            )}
            key={index}
            readOnly
            type="text"
            value={value}
          />
        ))}
        <PercentageInput value={alpha} />
      </div>
    )
  }

  return null
}

export type CompactColorPickerProps = Omit<ColorPickerProps, "children">

export const CompactColorPicker = memo(({ className, ...props }: CompactColorPickerProps) => {
  const eyeDropperSupported = supportsEyeDropper()

  return (
    <ColorPicker className={cn("w-48", className)} {...props}>
      <ColorPickerSelection className="mb-2 h-32 rounded" />
      <ColorPickerHue />
      {eyeDropperSupported ? (
        <div className="mt-2 flex justify-end">
          <ColorPickerEyeDropper />
        </div>
      ) : null}
    </ColorPicker>
  )
})

CompactColorPicker.displayName = "CompactColorPicker"

// Demo
export function Demo() {
  return (
    <div className="fixed inset-0 flex items-center justify-center p-8">
      <ColorPicker defaultValue="#6366f1" className="h-auto w-64">
        <ColorPickerSelection className="h-40 rounded-lg" />
        <ColorPickerHue />
        <ColorPickerAlpha />
        <div className="flex items-center gap-2">
          <ColorPickerEyeDropper />
          <ColorPickerOutput />
          <ColorPickerFormat />
        </div>
      </ColorPicker>
    </div>
  )
}
