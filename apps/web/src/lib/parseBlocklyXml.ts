import * as Blockly from 'blockly';
import { normalizeBlocklyXml } from '../../../../packages/ui-shared/src/blocklyXml';

export function parseBlocklyXmlRoot(blocklyXml: string): Element | null {
  const normalizedXml = normalizeBlocklyXml(blocklyXml);
  if (!normalizedXml.trim()) {
    return null;
  }

  if (typeof DOMParser !== 'undefined') {
    try {
      const xmlDocument = new DOMParser().parseFromString(normalizedXml, 'text/xml');
      if (xmlDocument.getElementsByTagName('parsererror').length === 0) {
        return xmlDocument.documentElement;
      }
    } catch {
      // Fall back to Blockly parsing below.
    }
  }

  try {
    return Blockly.utils.xml.textToDom(normalizedXml) as Element;
  } catch {
    return null;
  }
}
