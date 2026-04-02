import * as Blockly from 'blockly';

const OPERATOR_BLOCK_STYLE = {
  colourPrimary: '#59C059',
  colourSecondary: '#46B946',
  colourTertiary: '#389438',
};

export const POCHA_BLOCKLY_THEME = Blockly.Theme.defineTheme('pochacoding_zelos', {
  name: 'pochacoding_zelos',
  base: Blockly.Themes.Zelos,
  startHats: true,
  blockStyles: {
    logic_blocks: OPERATOR_BLOCK_STYLE,
    math_blocks: OPERATOR_BLOCK_STYLE,
  },
});
