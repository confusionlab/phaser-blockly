# Assistant Logic Tools Architecture

## Goal

Make assistant-authored game logic robust by removing Blockly XML from the model-facing interface. The assistant should reason in a typed logic program, and the app should compile that program into Blockly XML internally for the editor and runtime.

## Boundary

- Model-facing tools use structured JSON only.
- Blockly XML remains an internal persistence and editor/runtime format.
- Read paths shown to the model do not include raw Blockly XML.
- Validation happens on the structured logic program before any project state is mutated.

## Model-Facing Contract

New assistant write tools:

- `set_object_logic`
- `set_component_logic`

Each tool accepts:

- `logic.formatVersion`
- `logic.scripts[]`

Each script has a typed trigger:

- `on_start`
- `forever`
- `on_key_pressed`
- `on_clicked`

Each script contains typed actions. Actions are intentionally constrained to canonical primitives the compiler can always lower into valid Blockly:

- `set_velocity`
- `set_velocity_x`
- `set_velocity_y`
- `change_x`
- `change_y`
- `wait`
- `broadcast`
- `if`

Conditions are also typed:

- `key_pressed`
- `touching_ground`
- `all`
- `any`
- `not`

## Compiler

The compiler is deterministic and owned by the app:

- structured logic program -> canonical Blockly XML

Compiler rules:

- `forever` compiles to `event_game_start -> event_forever`
- movement and physics actions compile to PochaCoding block ids only
- keys are normalized to the editor dropdown values
- numeric inputs become canonical `math_number` value inputs
- invalid structured programs are rejected before staging

## Read Model

The assistant sees a sanitized snapshot and sanitized read-tool payloads:

- no raw `blocklyXml`
- object/component logic exposed as summaries only
- read payloads indicate whether logic exists and which structured tool should be used to edit it

This prevents the model from drifting back into XML generation even when inspecting existing state.

## Compatibility

- Existing project data still stores Blockly XML.
- Legacy `set_object_blockly_xml` and `set_component_blockly_xml` operations may remain internally for compatibility, but they are not exposed to the model.
- Existing XML normalization remains a migration aid for old data, not the primary assistant contract.

## Follow-Up

The next expansion step is a decompiler for the compiler-owned Blockly subset so read tools can return a structured logic program, not just a summary, when the stored XML originated from the structured tool path.
