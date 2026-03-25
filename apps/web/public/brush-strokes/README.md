Vector stroke brush bitmap dab format

- Place brush textures in this folder and reference them with a root-relative path such as `/brush-strokes/my-marker.png`.
- Use a transparent PNG or WebP.
- Treat the image as a single brush tip or dab, not a seamless ribbon.
- The image can be square or slightly wider than tall, depending on the brush look you want.
- Center the pigment in the frame and keep transparent padding tight so spacing stays predictable.
- Recommended starting sizes:
  - `64x64`
  - `96x72`
  - `128x96`
- Use grayscale or neutral alpha detail when possible because the renderer tints the dab with the selected stroke color at runtime.
- The renderer rotates and scatters the dab along the sampled path, so irregular edges and internal grain work better than a perfectly clean silhouette.
