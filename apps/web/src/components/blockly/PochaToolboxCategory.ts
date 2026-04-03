import * as Blockly from 'blockly';
import { ContinuousCategory } from '@blockly/continuous-toolbox';

function setCategoryColour(element: Element | null, colour: string): void {
  if (!(element instanceof HTMLElement)) return;
  element.style.setProperty('--pocha-blockly-category-color', colour);
}

function setCategorySelected(element: Element | null, selected: boolean): void {
  if (!(element instanceof HTMLElement)) return;
  element.dataset.selected = selected ? 'true' : 'false';
}

function addClassIfPresent(element: Element, className: string | undefined): void {
  if (!className) return;
  element.classList.add(className);
}

export class PochaToolboxCategory extends ContinuousCategory {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  protected override makeDefaultCssConfig_(): Blockly.ToolboxCategory.CssConfig {
    return {
      container: 'pochaBlocklyCategory',
      row: 'pochaBlocklyCategoryButton',
      rowcontentcontainer: 'pochaBlocklyCategoryContent',
      icon: 'pochaBlocklyCategoryIcon',
      label: 'pochaBlocklyCategoryLabel',
      selected: 'pochaBlocklyCategoryButtonSelected',
    };
  }

  // eslint-disable-next-line @typescript-eslint/naming-convention
  override createDom_(): HTMLDivElement {
    const container = super.createDom_();
    container.dataset.categoryName = this.getName().toLowerCase().replace(/\s+/g, '-');
    this.syncCategoryColour_();
    this.syncCategorySelection_(false);
    return container;
  }

  // eslint-disable-next-line @typescript-eslint/naming-convention
  override createLabelDom_(name: string): Element {
    const label = document.createElement('div');
    label.setAttribute('id', `${this.getId()}.label`);
    label.textContent = name;
    addClassIfPresent(label, this.cssConfig_.label);
    return label;
  }

  // eslint-disable-next-line @typescript-eslint/naming-convention
  override createIconDom_(): Element {
    const icon = document.createElement('div');
    addClassIfPresent(icon, this.cssConfig_.icon);

    const accent = document.createElement('div');
    accent.classList.add('pochaBlocklyCategoryAccent');

    const core = document.createElement('div');
    core.classList.add('pochaBlocklyCategoryAccentCore');

    accent.appendChild(core);
    icon.appendChild(accent);
    setCategoryColour(icon, this.colour_);
    return icon;
  }

  override refreshTheme(): void {
    super.refreshTheme();
    this.syncCategoryColour_();
  }

  override setSelected(isSelected: boolean): void {
    if (!this.rowDiv_ || !this.htmlDiv_) return;

    this.syncCategorySelection_(isSelected);
    Blockly.utils.aria.setState(
      this.htmlDiv_,
      Blockly.utils.aria.State.SELECTED,
      isSelected,
    );
  }

  // eslint-disable-next-line @typescript-eslint/naming-convention
  override addColourBorder_() {
    // We render the category accent inside our custom icon instead.
  }

  // eslint-disable-next-line @typescript-eslint/naming-convention
  private syncCategoryColour_(): void {
    setCategoryColour(this.htmlDiv_, this.colour_);
    setCategoryColour(this.rowDiv_, this.colour_);
    setCategoryColour(this.iconDom_, this.colour_);
    setCategoryColour(this.labelDom_, this.colour_);
  }

  // eslint-disable-next-line @typescript-eslint/naming-convention
  private syncCategorySelection_(isSelected: boolean): void {
    setCategorySelected(this.htmlDiv_, isSelected);
    setCategorySelected(this.rowDiv_, isSelected);

    if (isSelected) {
      if (this.rowDiv_) {
        addClassIfPresent(this.rowDiv_, this.cssConfig_.selected);
      }
    } else if (this.rowDiv_ && this.cssConfig_.selected) {
      this.rowDiv_.classList.remove(this.cssConfig_.selected);
    }
  }
}
