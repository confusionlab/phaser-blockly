import { useRef, useEffect, useState, useCallback } from 'react';
import * as Blockly from 'blockly';
import { BLOCK_CATEGORIES } from './blockCategories';
import './toolbox'; // Ensure custom blocks are registered before creating palette blocks

interface BlockPaletteProps {
  workspace: Blockly.WorkspaceSvg | null;
  disabled?: boolean;
}

export function BlockPalette({ workspace: mainWorkspace, disabled }: BlockPaletteProps) {
  const paletteRef = useRef<HTMLDivElement>(null);
  const flyoutWorkspaceRef = useRef<Blockly.WorkspaceSvg | null>(null);
  const categoryYRef = useRef<Map<string, number>>(new Map());
  const blockTypesRef = useRef<Map<string, string>>(new Map()); // blockId -> blockType
  const [activeCategory, setActiveCategory] = useState(BLOCK_CATEGORIES[0].id);
  const [paletteReady, setPaletteReady] = useState(false);
  const isScrollingRef = useRef(false);

  // Drag state stored in ref to be accessible across event handlers
  const dragStateRef = useRef<{
    blockType: string | null;
    startX: number;
    startY: number;
    isDragging: boolean;
    dragImage: HTMLElement | null;
  }>({
    blockType: null,
    startX: 0,
    startY: 0,
    isDragging: false,
    dragImage: null,
  });

  // Update active category based on scroll position
  const updateActiveCategory = useCallback(() => {
    const flyoutWs = flyoutWorkspaceRef.current;
    if (!flyoutWs) return;

    const metrics = flyoutWs.getMetrics();
    const scrollY = metrics.viewTop;

    // Find which category we're in based on scroll position
    let currentCategory = BLOCK_CATEGORIES[0].id;
    for (const category of BLOCK_CATEGORIES) {
      const catY = categoryYRef.current.get(category.id) || 0;
      // Account for the workspace scale
      const scaledCatY = catY * 0.7; // startScale is 0.7
      if (-scrollY >= scaledCatY - 50) {
        currentCategory = category.id;
      }
    }
    setActiveCategory(currentCategory);
  }, []);

  // Initialize the flyout workspace with actual block visuals
  useEffect(() => {
    if (!paletteRef.current) return;

    // Clean up existing workspace
    if (flyoutWorkspaceRef.current) {
      flyoutWorkspaceRef.current.dispose();
      flyoutWorkspaceRef.current = null;
    }

    // Clear block types map
    blockTypesRef.current.clear();

    try {
      // Create a workspace for showing block previews
      const flyoutWorkspace = Blockly.inject(paletteRef.current, {
        scrollbars: { horizontal: false, vertical: true },
        zoom: { controls: false, wheel: false, startScale: 0.7 },
        trashcan: false,
        move: {
          scrollbars: { horizontal: false, vertical: true },
          drag: false,
          wheel: true
        },
        sounds: false,
        readOnly: false,
        horizontalLayout: false,
      });

      flyoutWorkspaceRef.current = flyoutWorkspace;

      // Get the SVG to add category labels
      const svg = flyoutWorkspace.getParentSvg();
      const blockCanvas = svg.querySelector('.blocklyBlockCanvas');

      // Populate blocks for each category
      let y = 20;
      BLOCK_CATEGORIES.forEach((category) => {
        categoryYRef.current.set(category.id, y);

        // Add category label as SVG text
        if (blockCanvas) {
          const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          label.setAttribute('x', '15');
          label.setAttribute('y', String(y + 12));
          label.setAttribute('fill', category.colour);
          label.setAttribute('font-size', '11');
          label.setAttribute('font-weight', '600');
          label.setAttribute('font-family', 'Nunito, sans-serif');
          label.textContent = `${category.icon} ${category.name}`;
          blockCanvas.appendChild(label);
        }

        y += 25; // Space after label

        category.blocks.forEach((blockType) => {
          try {
            const block = flyoutWorkspace.newBlock(blockType);
            block.initSvg();
            block.render();
            block.moveBy(15, y);

            // Store the mapping of block ID to block type
            blockTypesRef.current.set(block.id, blockType);

            // Make blocks non-movable and non-deletable in palette
            block.setMovable(false);
            block.setDeletable(false);

            const height = block.getHeightWidth().height;
            y += height + 10;
          } catch (e) {
            console.warn('Could not create palette block:', blockType, e);
          }
        });

        y += 30; // Extra space between categories
      });

      // Track scroll position for category highlighting
      flyoutWorkspace.addChangeListener((event) => {
        if (event.type === Blockly.Events.VIEWPORT_CHANGE && !isScrollingRef.current) {
          updateActiveCategory();
        }
      });

      // Mark palette as ready (defer to avoid cascading renders)
      requestAnimationFrame(() => setPaletteReady(true));

    } catch (e) {
      console.error('Failed to create palette workspace:', e);
      requestAnimationFrame(() => setPaletteReady(false));
    }

    return () => {
      setPaletteReady(false);
      if (flyoutWorkspaceRef.current) {
        flyoutWorkspaceRef.current.dispose();
        flyoutWorkspaceRef.current = null;
      }
    };
  }, [updateActiveCategory]);

  // Create block in main workspace
  const createBlockInMainWorkspace = useCallback((blockType: string, clientX?: number, clientY?: number) => {
    if (!mainWorkspace) return;

    const newBlock = mainWorkspace.newBlock(blockType);
    newBlock.initSvg();
    newBlock.render();

    const mainWsEl = mainWorkspace.getInjectionDiv();
    const rect = mainWsEl.getBoundingClientRect();

    // Check if we have valid coordinates over the workspace
    const hasValidCoords = clientX !== undefined && clientY !== undefined &&
      clientX >= rect.left && clientX <= rect.right &&
      clientY >= rect.top && clientY <= rect.bottom;

    if (hasValidCoords && clientX !== undefined && clientY !== undefined) {
      // Convert screen coordinates to workspace coordinates
      const metrics = mainWorkspace.getMetrics();
      const scale = mainWorkspace.getScale();
      const relX = clientX - rect.left;
      const relY = clientY - rect.top;
      const wsX = metrics.viewLeft + relX / scale;
      const wsY = metrics.viewTop + relY / scale;
      newBlock.moveTo(new Blockly.utils.Coordinate(wsX, wsY));
    } else {
      // Position in center of visible area
      const metrics = mainWorkspace.getMetrics();
      const centerX = metrics.viewLeft + metrics.viewWidth / 3;
      const centerY = metrics.viewTop + metrics.viewHeight / 3;
      newBlock.moveTo(new Blockly.utils.Coordinate(centerX, centerY));
    }

    Blockly.common.setSelected(newBlock as Blockly.BlockSvg);
  }, [mainWorkspace]);

  // Handle mouse events for drag detection
  useEffect(() => {
    if (disabled) return;

    // Track last mouse position globally
    const trackMousePosition = (e: MouseEvent) => {
      (window as unknown as { _lastMouseEvent?: MouseEvent })._lastMouseEvent = e;
    };
    document.addEventListener('mousemove', trackMousePosition);
    document.addEventListener('mousedown', trackMousePosition);

    const handleMouseMove = (e: MouseEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState.blockType) return;

      const dx = e.clientX - dragState.startX;
      const dy = e.clientY - dragState.startY;

      // Start dragging if moved more than threshold
      if (!dragState.isDragging && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
        dragState.isDragging = true;

        // Remove any existing drag image first
        const existingDragImage = document.getElementById('block-drag-image');
        if (existingDragImage) {
          existingDragImage.remove();
        }

        // Create drag image
        const flyoutWs = flyoutWorkspaceRef.current;
        const dragImage = document.createElement('div');
        dragImage.id = 'block-drag-image';
        dragImage.style.cssText = `
          position: fixed;
          left: ${e.clientX - 30}px;
          top: ${e.clientY - 15}px;
          pointer-events: none;
          z-index: 100000;
          opacity: 0.9;
          filter: drop-shadow(2px 4px 6px rgba(0,0,0,0.3));
        `;

        let createdSvg = false;

        if (flyoutWs) {
          const blocks = flyoutWs.getAllBlocks(false);
          const selectedBlock = blocks.find(b => blockTypesRef.current.get(b.id) === dragState.blockType);
          if (selectedBlock) {
            const blockSvg = selectedBlock.getSvgRoot();
            if (blockSvg) {
              // Get the parent SVG element to copy defs (gradients, filters)
              const parentSvg = flyoutWs.getParentSvg();
              const defs = parentSvg.querySelector('defs');

              // Create SVG container
              const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
              svg.setAttribute('width', '300');
              svg.setAttribute('height', '150');
              svg.style.cssText = 'overflow: visible;';
              svg.setAttribute('class', 'blocklySvg');

              // Copy defs for gradients and filters
              if (defs) {
                svg.appendChild(defs.cloneNode(true));
              }

              // Clone the block group with all children
              const svgClone = blockSvg.cloneNode(true) as SVGGElement;
              // Reset any existing transform and position it in view
              svgClone.setAttribute('transform', 'translate(15, 15) scale(0.85)');
              svg.appendChild(svgClone);

              dragImage.appendChild(svg);
              createdSvg = true;
            }
          }
        }

        // Fallback: create a simple visual indicator if SVG clone failed
        if (!createdSvg) {
          const fallback = document.createElement('div');
          fallback.style.cssText = `
            width: 100px;
            height: 40px;
            background: linear-gradient(135deg, #4C97FF 0%, #3373CC 100%);
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 12px;
            font-weight: bold;
            font-family: sans-serif;
          `;
          fallback.textContent = dragState.blockType?.split('_').pop() || 'Block';
          dragImage.appendChild(fallback);
        }

        document.body.appendChild(dragImage);
        dragState.dragImage = dragImage;
      }

      // Update drag image position
      if (dragState.isDragging && dragState.dragImage) {
        dragState.dragImage.style.left = `${e.clientX - 30}px`;
        dragState.dragImage.style.top = `${e.clientY - 15}px`;
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState.blockType) return;

      const blockType = dragState.blockType;
      const isDragging = dragState.isDragging;

      // Clean up drag image
      if (dragState.dragImage) {
        dragState.dragImage.remove();
      }

      // Reset drag state
      dragStateRef.current = {
        blockType: null,
        startX: 0,
        startY: 0,
        isDragging: false,
        dragImage: null,
      };

      // Create block at appropriate position
      if (isDragging) {
        createBlockInMainWorkspace(blockType, e.clientX, e.clientY);
      } else {
        createBlockInMainWorkspace(blockType);
      }

      // Deselect in palette
      setTimeout(() => {
        if (flyoutWorkspaceRef.current) {
          const selectedBlock = Blockly.common.getSelected();
          if (selectedBlock && 'unselect' in selectedBlock) {
            (selectedBlock as Blockly.BlockSvg).unselect();
          }
        }
      }, 50);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', trackMousePosition);
      document.removeEventListener('mousedown', trackMousePosition);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [disabled, createBlockInMainWorkspace]);

  // Listen for block selection in palette workspace
  useEffect(() => {
    if (!paletteReady || !mainWorkspace || disabled) return;
    const flyoutWs = flyoutWorkspaceRef.current;
    if (!flyoutWs) return;

    const handleBlockSelected = (event: Blockly.Events.Abstract) => {
      if (event.type !== Blockly.Events.SELECTED) return;

      const selectEvent = event as Blockly.Events.Selected;
      if (!selectEvent.newElementId) return;

      const blockType = blockTypesRef.current.get(selectEvent.newElementId);
      if (!blockType) return;

      // Get current mouse position from the last known position
      const lastMouseEvent = (window as unknown as { _lastMouseEvent?: MouseEvent })._lastMouseEvent;
      const startX = lastMouseEvent?.clientX ?? 0;
      const startY = lastMouseEvent?.clientY ?? 0;

      // Start tracking for potential drag
      dragStateRef.current = {
        blockType,
        startX,
        startY,
        isDragging: false,
        dragImage: null,
      };
    };

    flyoutWs.addChangeListener(handleBlockSelected);

    return () => {
      flyoutWs.removeChangeListener(handleBlockSelected);
    };
  }, [mainWorkspace, disabled, paletteReady]);

  const scrollToCategory = useCallback((categoryId: string) => {
    const flyoutWs = flyoutWorkspaceRef.current;
    if (!flyoutWs) return;

    const y = categoryYRef.current.get(categoryId);
    if (y === undefined) return;

    // Mark that we're programmatically scrolling
    isScrollingRef.current = true;
    setActiveCategory(categoryId);

    // Get current scroll position
    const metrics = flyoutWs.getMetrics();
    const currentScrollY = metrics.viewTop;
    const targetScrollY = -(y * 0.7 - 20); // Account for scale and padding

    // Animate the scroll
    const startTime = performance.now();
    const duration = 300; // ms

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Ease out cubic
      const easeProgress = 1 - Math.pow(1 - progress, 3);

      const newScrollY = currentScrollY + (targetScrollY - currentScrollY) * easeProgress;
      flyoutWs.scroll(0, newScrollY);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        isScrollingRef.current = false;
      }
    };

    requestAnimationFrame(animate);
  }, []);

  const handleCreateVariable = useCallback(() => {
    if (!mainWorkspace) return;
    Blockly.Variables.createVariableButtonHandler(mainWorkspace, undefined, '');
  }, [mainWorkspace]);

  return (
    <div className={`flex h-full ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      {/* Category anchors - left sidebar */}
      <div className="w-12 bg-gray-100 border-r border-gray-200 flex flex-col py-2 gap-1 shrink-0">
        {BLOCK_CATEGORIES.map((category) => (
          <button
            key={category.id}
            onClick={() => scrollToCategory(category.id)}
            className={`w-10 h-10 mx-auto rounded-lg flex items-center justify-center text-lg transition-all duration-200 ${
              activeCategory === category.id
                ? 'ring-2 ring-offset-1 ring-current shadow-sm'
                : 'hover:bg-gray-200'
            }`}
            style={{
              backgroundColor: activeCategory === category.id ? category.colour + '30' : undefined,
              color: activeCategory === category.id ? category.colour : undefined,
            }}
            title={category.name}
          >
            {category.icon}
          </button>
        ))}

        {/* Create Variable button at bottom */}
        <div className="mt-auto">
          <button
            onClick={handleCreateVariable}
            className="w-10 h-10 mx-auto rounded-lg flex items-center justify-center text-lg transition-all hover:bg-orange-100"
            style={{ color: '#FF8C1A' }}
            title="Create Variable"
          >
            +
          </button>
        </div>
      </div>

      {/* Flyout workspace showing actual blocks */}
      <div
        ref={paletteRef}
        className="flex-1 bg-gray-50 palette-workspace"
        style={{
          cursor: disabled ? 'not-allowed' : 'pointer',
          overflowX: 'hidden',
        }}
      />

      {/* CSS to hide horizontal scrollbar and prevent horizontal scroll */}
      <style>{`
        .palette-workspace .blocklyScrollbarHorizontal {
          display: none !important;
        }
        .palette-workspace > svg {
          overflow-x: hidden !important;
        }
        .palette-workspace .blocklyMainBackground {
          cursor: pointer;
        }
        .palette-workspace .blocklyDraggable {
          cursor: pointer !important;
        }
        .palette-workspace .blocklyDraggable:hover {
          filter: brightness(1.05);
        }
      `}</style>
    </div>
  );
}
