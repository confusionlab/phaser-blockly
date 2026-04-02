import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from '@/components/ui/icons';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type ProductMenuActionItem = {
  kind: 'action';
  id: string;
  label: string;
  shortcut?: string;
  keywords?: readonly string[];
  disabled?: boolean;
  onSelect: () => void;
};

type ProductMenuToggleItem = {
  kind: 'toggle';
  id: string;
  label: string;
  shortcut?: string;
  keywords?: readonly string[];
  checked: boolean;
  onToggle: () => void;
};

type ProductMenuSubmenuItem = {
  kind: 'submenu';
  id: string;
  label: string;
  keywords?: readonly string[];
  children: ProductMenuItem[];
};

type ProductMenuSeparatorItem = {
  kind: 'separator';
  id: string;
};

type ProductMenuItem = ProductMenuActionItem | ProductMenuToggleItem | ProductMenuSubmenuItem | ProductMenuSeparatorItem;

type ProductMenuSearchResult = {
  id: string;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  breadcrumb: string | null;
  onSelect: () => void;
};

interface ProductMenuProps {
  isDarkMode: boolean;
  showAdvancedBlocks: boolean;
  hasProject: boolean;
  onExportProject: () => void;
  onGoToDashboard: () => void;
  onOpenHistory: () => void;
  onToggleAdvancedBlocks: () => void;
  onToggleTheme: () => void;
}

function matchesQuery(label: string, keywords: readonly string[] | undefined, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;

  const haystack = [label, ...(keywords ?? [])].join(' ').toLowerCase();
  return haystack.includes(normalizedQuery);
}

function collectAllActions(items: readonly ProductMenuItem[], parents: readonly string[]): ProductMenuSearchResult[] {
  const results: ProductMenuSearchResult[] = [];

  for (const item of items) {
    if (item.kind === 'separator') {
      continue;
    }

    if (item.kind === 'submenu') {
      results.push(...collectAllActions(item.children, [...parents, item.label]));
      continue;
    }

    results.push({
      id: item.id,
      label: item.label,
      shortcut: item.shortcut,
      disabled: item.kind === 'action' ? item.disabled : false,
      breadcrumb: parents.length > 0 ? parents.join(' / ') : null,
      onSelect: item.kind === 'action' ? item.onSelect : item.onToggle,
    });
  }

  return results;
}

function collectSearchResults(
  items: readonly ProductMenuItem[],
  query: string,
  parents: readonly string[] = [],
): ProductMenuSearchResult[] {
  const results: ProductMenuSearchResult[] = [];
  const seenIds = new Set<string>();

  for (const item of items) {
    if (item.kind === 'separator') {
      continue;
    }

    if (item.kind === 'submenu') {
      const submenuMatches = matchesQuery(item.label, item.keywords, query);
      const subtreeResults = submenuMatches
        ? collectAllActions(item.children, [...parents, item.label])
        : collectSearchResults(item.children, query, [...parents, item.label]);

      for (const result of subtreeResults) {
        if (seenIds.has(result.id)) {
          continue;
        }
        seenIds.add(result.id);
        results.push(result);
      }
      continue;
    }

    if (!matchesQuery(item.label, item.keywords, query)) {
      continue;
    }

    if (seenIds.has(item.id)) {
      continue;
    }
    seenIds.add(item.id);
    results.push({
      id: item.id,
      label: item.label,
      shortcut: item.shortcut,
      disabled: item.kind === 'action' ? item.disabled : false,
      breadcrumb: parents.length > 0 ? parents.join(' / ') : null,
      onSelect: item.kind === 'action' ? item.onSelect : item.onToggle,
    });
  }

  return results;
}

function renderHierarchicalItems(items: readonly ProductMenuItem[]): React.ReactNode {
  return items.map((item) => {
    if (item.kind === 'separator') {
      return <DropdownMenuSeparator key={item.id} />;
    }

    if (item.kind === 'submenu') {
      return (
        <DropdownMenuSub key={item.id}>
          <DropdownMenuSubTrigger className="rounded-xl px-3 py-2 text-[13px]">
            <span className="truncate">{item.label}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-[260px] rounded-2xl p-1.5 shadow-xl">
            {renderHierarchicalItems(item.children)}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      );
    }

    if (item.kind === 'toggle') {
      return (
        <DropdownMenuCheckboxItem
          key={item.id}
          checked={item.checked}
          onCheckedChange={() => item.onToggle()}
          className="rounded-xl py-2 pr-3 pl-9 text-[13px]"
        >
          <span className="truncate">{item.label}</span>
          {item.shortcut ? <DropdownMenuShortcut>{item.shortcut}</DropdownMenuShortcut> : null}
        </DropdownMenuCheckboxItem>
      );
    }

    return (
      <DropdownMenuItem
        key={item.id}
        disabled={item.disabled}
        onSelect={item.onSelect}
        className="rounded-xl px-3 py-2 text-[13px]"
      >
        <span className="truncate">{item.label}</span>
        {item.shortcut ? <DropdownMenuShortcut>{item.shortcut}</DropdownMenuShortcut> : null}
      </DropdownMenuItem>
    );
  });
}

function getFirstEnabledResult(results: readonly ProductMenuSearchResult[]): ProductMenuSearchResult | null {
  return results.find((result) => !result.disabled) ?? null;
}

export function ProductMenu({
  isDarkMode,
  showAdvancedBlocks,
  hasProject,
  onExportProject,
  onGoToDashboard,
  onOpenHistory,
  onToggleAdvancedBlocks,
  onToggleTheme,
}: ProductMenuProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const menuItems = useMemo<ProductMenuItem[]>(() => {
    const items: ProductMenuItem[] = [
      {
        kind: 'action',
        id: 'go-to-dashboard',
        label: 'Go to Dashboard',
        keywords: ['home', 'projects', 'dashboard'],
        onSelect: onGoToDashboard,
      },
      { kind: 'separator', id: 'primary-separator' },
    ];

    if (hasProject) {
      items.push({
        kind: 'submenu',
        id: 'project',
        label: 'Project',
        keywords: ['export', 'history', 'version'],
        children: [
          {
            kind: 'action',
            id: 'export-project',
            label: 'Download to Computer',
            keywords: ['download', 'backup', 'export', 'computer'],
            onSelect: onExportProject,
          },
          {
            kind: 'action',
            id: 'version-history',
            label: 'Version History',
            keywords: ['history', 'restore', 'checkpoint', 'revisions'],
            onSelect: onOpenHistory,
          },
        ],
      });
    }

    items.push({
      kind: 'submenu',
      id: 'blocks',
      label: 'Blocks',
      keywords: ['blocks', 'toolbox', 'advanced', 'beginner', 'simple'],
      children: [
        {
          kind: 'toggle',
          id: 'toggle-advanced-blocks',
          label: 'Advanced',
          keywords: ['advanced', 'blocks', 'toolbox', 'show', 'hide'],
          checked: showAdvancedBlocks,
          onToggle: onToggleAdvancedBlocks,
        },
      ],
    });

    items.push({
      kind: 'submenu',
      id: 'appearance',
      label: 'Appearance',
      keywords: ['theme', 'dark', 'light', 'mode'],
      children: [
        {
          kind: 'action',
          id: 'toggle-theme',
          label: isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode',
          keywords: ['theme', 'dark', 'light', 'mode'],
          onSelect: onToggleTheme,
        },
      ],
    });

    return items;
  }, [
    hasProject,
    isDarkMode,
    onToggleAdvancedBlocks,
    onExportProject,
    onGoToDashboard,
    onOpenHistory,
    showAdvancedBlocks,
    onToggleTheme,
  ]);

  const normalizedQuery = searchQuery.trim();
  const searchResults = useMemo(
    () => (normalizedQuery ? collectSearchResults(menuItems, normalizedQuery) : []),
    [menuItems, normalizedQuery],
  );

  useEffect(() => {
    if (open) {
      return;
    }

    setSearchQuery('');
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [open]);

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();

    if (event.key !== 'Enter' || !normalizedQuery) {
      return;
    }

    const firstResult = getFirstEnabledResult(searchResults);
    if (!firstResult) {
      return;
    }

    event.preventDefault();
    firstResult.onSelect();
    setOpen(false);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-colors',
            open ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/70',
          )}
          aria-label="Open workspace menu"
        >
          <span className="font-semibold text-primary">PochaCoding</span>
          <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        side="bottom"
        sideOffset={10}
        className="w-[320px] overflow-hidden rounded-2xl border-border/80 p-0 shadow-2xl"
      >
        <div className="border-b border-border/70 px-3 py-3" onKeyDown={(event) => event.stopPropagation()}>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Type to search..."
              className="h-10 rounded-xl border-border/70 bg-background/80 pr-3 pl-9 text-sm shadow-none"
              aria-label="Search workspace menu"
            />
          </div>
        </div>

        <div className="max-h-[min(70vh,420px)] overflow-y-auto p-1.5">
          {normalizedQuery ? (
            searchResults.length > 0 ? (
              searchResults.map((result) => (
                <DropdownMenuItem
                  key={result.id}
                  disabled={result.disabled}
                  onSelect={result.onSelect}
                  className="rounded-xl px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px]">{result.label}</div>
                    {result.breadcrumb ? (
                      <div className="truncate text-[11px] text-muted-foreground">{result.breadcrumb}</div>
                    ) : null}
                  </div>
                  {result.shortcut ? <DropdownMenuShortcut>{result.shortcut}</DropdownMenuShortcut> : null}
                </DropdownMenuItem>
              ))
            ) : (
              <div className="px-3 py-6 text-sm text-muted-foreground">No matching menu items.</div>
            )
          ) : (
            renderHierarchicalItems(menuItems)
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
