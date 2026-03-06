# Assistant E2E Prompts

Real app verification run on March 6, 2026 against the web editor and live Convex assistant flow.

## Passed Prompts

### Scene, folder, and object chain

Prompt:

```text
Create a new scene called Training Ground. In that scene, create a folder called Actors and add a new object inside it named Hero at x 180 and y 220.
```

Observed result:

- Assistant used `create_scene`, `create_folder`, and `create_object`
- `Training Ground` appeared in the scene picker
- `Actors` appeared in the scene hierarchy
- `Hero` appeared under `Actors` with position `x=180`, `y=220`

### Folder inspection plus create

Prompt:

```text
Inspect the Actors folder in Training Ground, then add a new object inside it named Guide at x 240 and y 180.
```

Observed result:

- Assistant used `get_folder` and `create_object`
- `Guide` appeared under `Actors`

### References plus duplicate on explicit copy target

Prompt:

```text
Before changing anything, inspect references for the Guide object in Training Ground. Then duplicate Guide. Leave the original Guide unchanged. Rename only the new copy to Guide Support and move only the new copy to x 320 and y 180 in the same Actors folder.
```

Observed result:

- Assistant used `list_references`, `duplicate_object`, `rename_object`, and `update_object_properties`
- Original `Guide` stayed present
- New `Guide Support` appeared under `Actors`

### References plus duplicate on normal prompt

Prompt:

```text
Before changing anything, inspect references for the Guide Support object in Training Ground. Then duplicate Guide Support, rename the copy to Guide Support 2, and move the copy to x 360 and y 180 in the same Actors folder.
```

Observed result:

- Assistant used `list_references`, `duplicate_object`, `rename_object`, and `update_object_properties`
- Original `Guide Support` stayed present
- New `Guide Support 2` appeared under `Actors`

## Regression Found And Fixed

Initial prompt:

```text
Create a new scene called Battle Arena. In that scene, create a folder called Actors and add a new object inside it named XYZ at x 180 and y 220. Then rename Scene 1 to Intro Playground.
```

Initial failure:

- The new scene was created, but the nested folder and object were missing after client replay

Root cause:

- Backend staging generated ids for newly created entities, but the stored change-set did not persist those ids
- Client replay therefore targeted ids that did not exist locally

Fix:

- Materialize stable ids for `create_scene`, `create_folder`, `create_object`, and `duplicate_object` before storing the change-set
- Apply follow-up duplicate edits to the newly created duplicate id, not the original
