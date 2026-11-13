import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, Package, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { quantity } from "@/lib/format";
import type { Product } from "@/lib/types";

export function SaleProductPicker({
  id = "sale-product",
  products,
  value,
  selectedProduct,
  disabled = false,
  onValueChange,
}: {
  id?: string;
  products: Product[];
  value: string;
  selectedProduct?: Product;
  disabled?: boolean;
  onValueChange: (productId: string) => void;
}) {
  const instanceId = useId();
  const listId = `${id}-list-${instanceId}`;
  const statusId = `${id}-status-${instanceId}`;
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightedId, setHighlightedId] = useState(value);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const choices = useMemo(
    () =>
      products.filter(
        (product) =>
          product.isActive !== false &&
          (!normalizedQuery ||
            product.name.toLocaleLowerCase().includes(normalizedQuery) ||
            product.sku.toLocaleLowerCase().includes(normalizedQuery)),
      ),
    [products, normalizedQuery],
  );
  const selected = products.find((product) => product.id === value) ?? selectedProduct;
  const foundIndex = choices.findIndex((product) => product.id === highlightedId);
  const highlightedIndex = foundIndex < 0 ? 0 : foundIndex;
  const expanded = open && !disabled;
  const activeOptionId = choices.length ? `${listId}-option-${highlightedIndex}` : undefined;

  function close(returnFocus = false) {
    setOpen(false);
    setQuery("");
    if (returnFocus) trigger.current?.focus({ preventScroll: true });
  }
  function show(position: "selected" | "first" | "last" = "selected") {
    if (disabled) return;
    setQuery("");
    const activeProducts = products.filter((product) => product.isActive !== false);
    setHighlightedId(
      position === "last"
        ? (activeProducts.at(-1)?.id ?? "")
        : position === "first"
          ? (activeProducts[0]?.id ?? "")
          : value,
    );
    setOpen(true);
  }
  function choose(product: Product) {
    onValueChange(product.id);
    close(true);
  }
  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" && expanded) {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End", "Enter"].includes(event.key)) return;
    if ((event.key === "Home" || event.key === "End") && event.target === search.current) return;
    if (event.key === "Enter" && !expanded) return;
    event.preventDefault();
    event.stopPropagation();
    if (!expanded) {
      show(event.key === "ArrowUp" || event.key === "End" ? "last" : "first");
      return;
    }
    if (event.key === "Enter") {
      if (choices[highlightedIndex]) choose(choices[highlightedIndex]);
      return;
    }
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? choices.length - 1
          : event.key === "ArrowDown"
            ? Math.min(choices.length - 1, highlightedIndex + 1)
            : Math.max(0, highlightedIndex - 1);
    setHighlightedId(choices[nextIndex]?.id ?? "");
  }
  useEffect(() => {
    if (!expanded) return;
    search.current?.focus({ preventScroll: true });
    search.current?.scrollIntoView({ block: "nearest" });
    function closeOutside(event: Event) {
      if (!container.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("pointerdown", closeOutside, true);
    document.addEventListener("focusin", closeOutside);
    return () => {
      document.removeEventListener("pointerdown", closeOutside, true);
      document.removeEventListener("focusin", closeOutside);
    };
  }, [expanded]);
  useEffect(() => {
    if (expanded && activeOptionId)
      document.getElementById(activeOptionId)?.scrollIntoView({ block: "nearest" });
  }, [expanded, activeOptionId]);

  return (
    <div
      ref={container}
      className="min-w-0"
      data-sale-product-picker-open={expanded ? "true" : "false"}
      onKeyDown={handleKeyDown}
    >
      <button
        ref={trigger}
        id={id}
        type="button"
        disabled={disabled}
        data-product-id={value}
        aria-haspopup="listbox"
        aria-expanded={expanded}
        aria-controls={expanded ? listId : undefined}
        className="flex min-h-16 w-full min-w-0 items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5 text-left shadow-sm outline-none transition-colors hover:border-primary/50 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50 aria-expanded:border-primary aria-expanded:ring-2 aria-expanded:ring-ring/15"
        onClick={() => (expanded ? close() : show())}
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Package className="size-5" aria-hidden="true" />
        </span>
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="text-sm font-medium [overflow-wrap:anywhere]">
            {selected?.name ?? "Choose a product"}
          </span>
          <span className="text-xs text-muted [overflow-wrap:anywhere]">
            {selected?.sku ?? "Search by name or SKU"}
          </span>
        </span>
        <ChevronDown
          className={`size-4 shrink-0 text-muted transition-transform ${expanded ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      {expanded && (
        <div className="mt-2 min-w-0 overflow-hidden rounded-xl border border-primary/25 bg-surface shadow-lg">
          <div className="border-b border-border bg-surface-2/50 p-2.5">
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-3.5 left-3 size-4 text-muted"
                aria-hidden="true"
              />
              <Input
                ref={search}
                id={`${id}-search`}
                type="search"
                role="combobox"
                aria-label="Search products"
                aria-autocomplete="list"
                aria-expanded={expanded}
                aria-controls={listId}
                aria-activedescendant={activeOptionId}
                aria-describedby={statusId}
                placeholder="Search product name or SKU"
                autoComplete="off"
                value={query}
                className="bg-surface pl-9 text-base sm:text-sm"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setHighlightedId("");
                }}
              />
            </div>
            <p id={statusId} role="status" className="mt-2 px-1 text-xs text-muted">
              {choices.length} {choices.length === 1 ? "product" : "products"} available
            </p>
          </div>
          <div
            id={listId}
            role="listbox"
            aria-label="Products"
            className="max-h-[min(30dvh,12.5rem)] overflow-y-auto p-1.5"
          >
            {choices.length ? (
              choices.map((product, index) => (
                <button
                  type="button"
                  role="option"
                  id={`${listId}-option-${index}`}
                  key={product.id}
                  data-product-id={product.id}
                  aria-selected={product.id === value}
                  tabIndex={-1}
                  className={`flex w-full min-w-0 items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${index === highlightedIndex ? "border-primary/20 bg-primary/10" : "border-transparent hover:bg-surface-2"}`}
                  onPointerMove={() => setHighlightedId(product.id)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(product)}
                >
                  <span className="grid min-w-0 flex-1 gap-1">
                    <span className="text-sm font-medium [overflow-wrap:anywhere]">
                      {product.name}
                    </span>
                    <span className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted [overflow-wrap:anywhere]">
                      <span>{product.sku}</span>
                      <span className={product.currentStock <= 0 ? "text-warning" : "text-primary"}>
                        {product.currentStock <= 0
                          ? "Out of stock"
                          : `${quantity(product.currentStock)} ${product.unit} on hand`}
                      </span>
                    </span>
                  </span>
                  {product.id === value && (
                    <Check className="size-4 shrink-0 text-primary" aria-hidden="true" />
                  )}
                </button>
              ))
            ) : (
              <div className="px-4 py-7 text-center">
                <Search className="mx-auto mb-2 size-5 text-muted" aria-hidden="true" />
                <p className="text-sm font-medium">No matching products</p>
                <p className="mt-1 text-xs text-muted">Try another product name or SKU.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
