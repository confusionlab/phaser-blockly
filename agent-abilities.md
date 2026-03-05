# Assistant Agent Abilities (Revised)

This document consolidates the AI agent abilities implemented for edit-mode tool calls.

## Supported edit payload contract

When `mode="edit"`, the assistant returns:

```json
{
  "proposedEdits": {
    "intentSummary": "string",
    "assumptions": ["string"],
    "semanticOps": [],
    "projectOps": []
  }
}
```

Both arrays are always present.

## Included abilities

### Project ops

- `rename_project`
- `create_scene`
- `rename_scene`
- `reorder_scenes`
- `create_object`
- `rename_object`
- `set_object_property` (`x`, `y`, `scaleX`, `scaleY`, `rotation`, `visible`)
- `set_object_physics`
- `set_object_collider_type` (type only; no collider size editing)
- `create_folder`
- `rename_folder`
- `move_object_to_folder`
- `add_costume_from_image_url`
- `add_costume_text_circle` (text inside a general circle mockup)
- `rename_costume`
- `reorder_costumes`
- `set_current_costume`
- `validate_project`

### Code-edit ops (Blockly semantic ops)

- `create_event_flow`
- `append_actions`
- `replace_action`
- `set_block_field`
- `ensure_variable`
- `ensure_message`
- `retarget_reference`
- `delete_subtree`

## Tool-call context abilities (for better grounding)

The assistant can gather project facts before proposing edits via:

- `list_scenes`
- `get_scene` (folders + optional object details)
- `list_scene_folders`
- `list_scene_objects`
- `get_object` (hierarchy, effective physics/collider, costumes, optional Blockly XML)
- `list_object_costumes`
- `list_components`
- `get_component`
- `list_messages`
- `list_global_variables`
- `search_blocks`
- `get_block_type`

## Explicitly excluded (per product decision)

- Multi-select move and hierarchy drag/drop automation
- Collider size editing
- Library tooling in assistant ops
- Sound preview play/stop and trim operations
- Project open/delete/import/export
- Project settings edits
