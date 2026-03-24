Vector stroke brush texture format

- Place brush textures in this folder and reference them with a root-relative path such as `/brush-strokes/my-marker.png`.
- Use a transparent PNG or WebP.
- Treat the image as a horizontal strip:
  - Width = travel direction along the stroke.
  - Height = cross-section of the stroke.
- The left and right edges should tile seamlessly.
- Do not bake rounded end caps into the strip; the renderer repeats the strip along the sampled path.
- Keep empty transparent padding small so spacing stays predictable.
- Recommended starting sizes:
  - `256x64`
  - `384x96`
  - `512x128`
- High-contrast alpha detail works best. The renderer tints the strip with the selected stroke color at runtime.
