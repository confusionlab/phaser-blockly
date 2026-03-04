export const PICK_FROM_STAGE = '__PICK_FROM_STAGE__';
export const COMPONENT_ANY_PREFIX = 'COMPONENT_ANY:';

export const OBJECT_SPECIAL_VALUES = ['EDGE', 'GROUND', 'MOUSE', 'MY_TYPE', 'MY_CLONES'] as const;
export const VALID_OBJECT_SPECIAL_VALUES = new Set<string>([...OBJECT_SPECIAL_VALUES, '']);

// Blocks that store object references directly in a field (not value inputs).
export const OBJECT_REFERENCE_BLOCKS: Readonly<Record<string, string>> = {
  object_from_dropdown: 'TARGET',
  sensing_touching: 'TARGET',
  sensing_touching_direction: 'TARGET',
  sensing_distance_to: 'TARGET',
  sensing_touching_object: 'TARGET',
  motion_point_towards: 'TARGET',
  camera_follow_object: 'TARGET',
  event_when_touching: 'TARGET',
  event_when_touching_direction: 'TARGET',
  motion_attach_to_dropdown: 'TARGET',
  motion_attach_dropdown_to_me: 'TARGET',
};

export const SOUND_REFERENCE_BLOCKS: Readonly<Record<string, string>> = {
  sound_play: 'SOUND',
  sound_play_until_done: 'SOUND',
};

export const VARIABLE_REFERENCE_BLOCKS: Readonly<Record<string, string>> = {
  typed_variable_get: 'VAR',
  typed_variable_set: 'VAR',
  typed_variable_change: 'VAR',
};

export const SCENE_REFERENCE_BLOCKS: Readonly<Record<string, string>> = {
  control_switch_scene: 'SCENE',
};

export const MESSAGE_REFERENCE_BLOCKS: Readonly<Record<string, string>> = {
  event_when_receive: 'MESSAGE',
  control_broadcast: 'MESSAGE',
  control_broadcast_wait: 'MESSAGE',
};

export const TYPE_REFERENCE_BLOCKS: Readonly<Record<string, string>> = {
  control_spawn_type_at: 'TYPE',
  sensing_type_literal: 'TYPE',
};
