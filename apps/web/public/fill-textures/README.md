Fill textures

Put custom seamless fill textures in this folder and reference them with a root-relative path such as:

- `/fill-textures/my-paper.png`
- `/fill-textures/noise/grain.webp`

Recommended format

- PNG or WebP with transparency
- Seamless on both the X and Y axes
- Square tiles are easiest to reason about, but rectangular tiles also work
- Keep the texture neutral or grayscale when possible because tint is applied at runtime from the selected fill color
- Do not bake a background color into the asset unless you intentionally want that value to mix with tinting

How it maps

- The texture is tiled across the fill region instead of stretched
- The selected fill color tints the texture uniformly
- Vector fills keep the texture attached to the object transform
- Bitmap bucket fills sample the texture tile per pixel, so the fill stays seamless instead of stretching across the selected region

Practical tips

- Use medium-frequency detail that still looks good when tiled repeatedly
- Avoid very obvious tile edges or directional seams
- If you want a stronger look, increase contrast in the alpha/luminance of the texture rather than baking in color
