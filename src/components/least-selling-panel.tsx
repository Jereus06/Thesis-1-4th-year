import { useMemo, useState } from "react";
import { Search, TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { quantity } from "@/lib/format";
import { useAppStore } from "@/lib/store";

export function LeastSellingPanel() {
  const products = useAppStore((state) => state.products);
  const sales = useAppStore((state) => state.sales);
  const [ranking, setRanking] = useState<"least" | "best">("least");
  const [search, setSearch] = useState("");
  const rows = useMemo(() => {
    const soldByProduct = new Map<string, number>();
    for (const sale of sales) {
      soldByProduct.set(sale.productId, (soldByProduct.get(sale.productId) ?? 0) + sale.qty);
    }
    const query = search.trim().toLowerCase();
    return products
      .filter((product) => product.isActive !== false)
      .filter(
        (product) =>
          !query ||
          [product.name, product.sku, product.category].some((value) =>
            value.toLowerCase().includes(query),
          ),
      )
      .map((product) => ({
        product,
        sold: soldByProduct.get(product.id) ?? 0,
      }))
      .sort((a, b) =>
        ranking === "least"
          ? a.sold - b.sold || a.product.name.localeCompare(b.product.name)
          : b.sold - a.sold || a.product.name.localeCompare(b.product.name),
      );
  }, [products, sales, ranking, search]);

  const isLeastSelling = ranking === "least";
  const title = isLeastSelling ? "Least selling items" : "Best selling items";
  const description = isLeastSelling
    ? "Active products ranked by total quantity sold, with products that have no sales first."
    : "Active products ranked by total quantity sold, with the highest-selling items first.";

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              {isLeastSelling ? (
                <TrendingDown className="size-5 text-warning" aria-hidden="true" />
              ) : (
                <TrendingUp className="size-5 text-primary" aria-hidden="true" />
              )}
              {title}
            </CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <div className="flex gap-2" aria-label="Sales ranking">
            <Button
              type="button"
              size="sm"
              variant={isLeastSelling ? "default" : "outline"}
              aria-pressed={isLeastSelling}
              onClick={() => setRanking("least")}
            >
              Least selling
            </Button>
            <Button
              type="button"
              size="sm"
              variant={isLeastSelling ? "outline" : "default"}
              aria-pressed={!isLeastSelling}
              onClick={() => setRanking("best")}
            >
              Best selling
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="relative mb-4 max-w-sm">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Search selling items"
            placeholder="Search by name, SKU or category"
            className="rounded-xl pr-3 pl-10 [&::-webkit-search-cancel-button]:appearance-none"
          />
        </div>
        {rows.length ? (
          <div className="overflow-x-auto">
            <table aria-label="Least selling items" className="w-full text-left text-sm">
              <thead className="text-xs tracking-wide text-muted uppercase">
                <tr>
                  <th scope="col" className="pb-2 font-medium">
                    Product
                  </th>
                  <th scope="col" className="pb-2 font-medium">
                    SKU
                  </th>
                  <th scope="col" className="px-4 pb-2 text-center whitespace-nowrap font-medium">
                    Quantity sold
                  </th>
                  <th scope="col" className="px-4 pb-2 text-center whitespace-nowrap font-medium">
                    Current stock
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ product, sold }) => (
                  <tr key={product.id} className="border-t border-border">
                    <td className="py-3 pr-3">{product.name}</td>
                    <td className="py-3 pr-3 text-muted">{product.sku}</td>
                    <td className="px-4 py-3 text-center tabular">{quantity(sold)}</td>
                    <td className="px-4 py-3 text-center tabular">
                      {quantity(product.currentStock)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted">
            {products.some((product) => product.isActive !== false)
              ? "No products match your search."
              : "No active products are available."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
