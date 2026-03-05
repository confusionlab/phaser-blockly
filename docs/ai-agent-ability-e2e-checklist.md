# AI Agent Ability E2E Checklist

Last updated: 2026-03-05
Target project for live checks: `AI Test`
Runtime target: Electron desktop (`codex_oauth`, no OpenRouter spend)

## Scope

This checklist tracks real end-to-end verification of AI agent abilities in the desktop runtime.
Each item must include a short note about what was tested and the observed result.

## Preflight

- [ ] Electron desktop launches with desktop bridge (`window.desktopAssistant`) available.
- [ ] Clerk session is active in desktop runtime.
- [ ] Codex OAuth status is ready for signed-in user (`hasCodexToken=true`, `codexAvailable=true`).
- [ ] Assistant turn transport succeeds in desktop runtime.

## Project Ops

- [ ] `rename_project`
  - Notes:
- [ ] `create_scene`
  - Notes:
- [ ] `rename_scene`
  - Notes:
- [ ] `reorder_scenes`
  - Notes:
- [ ] `create_object`
  - Notes:
- [ ] `rename_object`
  - Notes:
- [ ] `set_object_property`
  - Notes:
- [ ] `set_object_physics`
  - Notes:
- [ ] `set_object_collider_type`
  - Notes:
- [ ] `create_folder`
  - Notes:
- [ ] `rename_folder`
  - Notes:
- [ ] `move_object_to_folder`
  - Notes:
- [ ] `add_costume_from_image_url`
  - Notes:
- [ ] `add_costume_text_circle`
  - Notes:
- [ ] `rename_costume`
  - Notes:
- [ ] `reorder_costumes`
  - Notes:
- [ ] `set_current_costume`
  - Notes:
- [ ] `validate_project`
  - Notes:

## Semantic Ops (Blockly Code Edits)

- [ ] `create_event_flow`
  - Notes:
- [ ] `append_actions`
  - Notes:
- [ ] `replace_action`
  - Notes:
- [ ] `set_block_field`
  - Notes:
- [ ] `ensure_variable`
  - Notes:
- [ ] `ensure_message`
  - Notes:
- [ ] `retarget_reference`
  - Notes:
- [ ] `delete_subtree`
  - Notes:

## Tool-Call Grounding Abilities

- [ ] `list_scenes`
  - Notes:
- [ ] `get_scene`
  - Notes:
- [ ] `list_scene_folders`
  - Notes:
- [ ] `list_scene_objects`
  - Notes:
- [ ] `get_object`
  - Notes:
- [ ] `list_object_costumes`
  - Notes:
- [ ] `list_components`
  - Notes:
- [ ] `get_component`
  - Notes:
- [ ] `list_messages`
  - Notes:
- [ ] `list_global_variables`
  - Notes:
- [ ] `search_blocks`
  - Notes:
- [ ] `get_block_type`
  - Notes:

## Run Log

- 2026-03-05: Checklist initialized.
