Vector texture materials

Named vector materials live in this folder. Each material gets its own directory:

- `/vector-materials/<name>/texture.png`
- `/vector-materials/<name>/texture.webp`
- `/vector-materials/<name>/texture.svg`

If the material is also used for stamped vector strokes, add a dab mask in the same folder:

- `/vector-materials/<name>/dab-mask.png`
- `/vector-materials/<name>/dab-mask.webp`
- `/vector-materials/<name>/dab-mask.svg`

How it works

- `texture.*` is the canonical grain or pigment texture shared by fill and stroke when they use the same material name
- `dab-mask.*` is only the stroke silhouette; it shapes each stamped dab but does not replace the shared grain
- Assets should stay grayscale or neutral because the renderer tints them with the selected vector color at runtime

Practical guidance

- Make `texture.*` seamless on both axes so fill tiling does not show seams
- Keep `dab-mask.*` on a transparent background with a tight frame around the painted shape
- SVG, PNG, and WebP all work; SVG is convenient for starter assets and iteration
