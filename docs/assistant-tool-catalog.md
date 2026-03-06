# Assistant Tool Catalog

## Curation Rules

The assistant toolset should stay small, distinct, and composable.

- Add a tool only when it enables a capability the assistant cannot do reliably today.
- Avoid alias tools that overlap existing mutations with different names.
- Prefer read tools that narrow context before mutation.
- Keep mutation tools orthogonal: create, inspect, move, rename, update.
- Do not add fine-grained Blockly mutation tools until the logic model is semantic instead of raw XML.

## Implemented Tool Surface

### Progress and inspection

- `emit_progress`
- `get_project_summary`
- `get_scene`
- `get_folder`
- `get_object`
- `get_component`
- `search_entities`
- `list_references`
- `inspect_validation_issues`

### Project and scene mutation

- `update_project_settings`
- `create_scene`
- `delete_scene`
- `rename_scene`
- `reorder_scenes`
- `update_scene_properties`

### Folder mutation

- `create_folder`
- `delete_folder`
- `rename_folder`
- `move_folder`

### Object mutation

- `create_object`
- `delete_object`
- `rename_object`
- `move_object`
- `duplicate_object`
- `update_object_properties`
- `set_object_blockly_xml`

### Component mutation

- `make_component`
- `delete_component`
- `add_component_instance`
- `detach_from_component`
- `rename_component`
- `update_component_properties`
- `set_component_blockly_xml`

## Reliability Guardrails

- Mutation operations that create or duplicate entities now carry stable ids in the stored change-set.
- Follow-up operations in the same run must target ids returned by tool results, not guessed names.
- After `duplicate_object`, the original object should remain unchanged unless the user explicitly requests otherwise.
- The assistant should prefer `get_scene`, `get_folder`, `get_object`, and `get_component` over broad search when the target is already known.
- The assistant should call `list_references` before risky delete or move operations when impact is unclear.

## Intentionally Deferred

- Alias-style tools such as `move_scene`, `reparent_object`, and `reorder_object`
- Refresh-only tools such as `refresh_preview` and `refresh_codegen`
- Fine-grained Blockly block mutation tools
- Broad variable, asset, sound, or costume mutation tools that are not yet modeled cleanly
