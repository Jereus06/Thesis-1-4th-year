import type { Product, Sale, Settings } from "@/lib/types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:3001/api/v1";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type Envelope<T> = { data: T };
type ApiProduct = Omit<Product, "currentStock" | "safetyStock" | "unitCost"> & {
  currentStock: string;
  safetyStock: string;
  unitCost: string;
  isActive: boolean;
};
type ApiSale = {
  id: string;
  productId: string;
  saleDate: string;
  quantity: string;
};

export type SessionUser = {
  userId: string;
  businessId: string;
  email: string;
  displayName: string;
  role: "owner" | "staff";
};

export const api = {
  signIn: (businessId: string, email: string, password: string) =>
    request<SessionUser>("/auth/sign-in", {
      method: "POST",
      body: { businessId, email, password },
    }),
  signOut: () => request<{ signedOut: boolean }>("/auth/sign-out", { method: "POST" }),
  me: () => request<SessionUser>("/auth/me"),
  products: async (businessId: string) =>
    (await request<ApiProduct[]>(`/businesses/${businessId}/products`)).map(toProduct),
  createProduct: async (businessId: string, product: Omit<Product, "id">) =>
    toProduct(
      await request<ApiProduct>(`/businesses/${businessId}/products`, {
        method: "POST",
        body: product,
      }),
    ),
  updateProduct: async (businessId: string, productId: string, patch: Partial<Product>) =>
    toProduct(
      await request<ApiProduct>(`/businesses/${businessId}/products/${productId}`, {
        method: "PATCH",
        body: withoutStock(patch),
      }),
    ),
  sales: async (businessId: string) =>
    (await request<ApiSale[]>(`/businesses/${businessId}/sales`)).map(toSale),
  recordSale: async (businessId: string, productId: string, date: string, qty: number) =>
    toSale(
      await request<ApiSale>(`/businesses/${businessId}/sales`, {
        method: "POST",
        body: { productId, saleDate: date, quantity: String(qty) },
      }),
    ),
  receiveStock: (businessId: string, productId: string, qty: number, date: string) =>
    request(`/businesses/${businessId}/inventory-movements`, {
      method: "POST",
      body: {
        productId,
        movementDate: date,
        movementType: "receipt",
        quantityDelta: String(qty),
      },
    }),
  settings: (businessId: string) =>
    request<Record<string, unknown>>(`/businesses/${businessId}/settings`),
  updateSettings: (businessId: string, settings: Settings) =>
    request(`/businesses/${businessId}/settings`, {
      method: "PUT",
      body: {
        movingAverageWindow: settings.maWindow,
        forecastHorizonDays: settings.forecastHorizon,
        targetCoverDays: settings.coverDays,
        minimumHistoryWeeks: settings.minWeeks,
        minimumNonzeroDays: 100,
        topNProducts: settings.topNProducts,
        cvFolds: settings.cvFolds,
        timezone: "Asia/Manila",
      },
    }),
};

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (!new Set(["GET", "HEAD", "OPTIONS"]).has(method)) {
    const csrf = cookie("stockcast_csrf");
    if (csrf) headers["x-csrf-token"] = csrf;
  }
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    credentials: "include",
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload = (await response.json().catch(() => null)) as
    | Envelope<T>
    | { detail?: string; error?: { code?: string; message?: string } }
    | null;
  if (!response.ok) {
    const failure = payload as {
      detail?: string;
      error?: { code?: string; message?: string };
    } | null;
    const message = failure?.error?.message ?? failure?.detail;
    const code = failure?.error?.code;
    throw new ApiError(
      response.status,
      code ?? "request_failed",
      message ?? `Request failed (${response.status})`,
    );
  }
  return (payload as Envelope<T>).data;
}

function cookie(name: string) {
  const item = document.cookie
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : null;
}
function toProduct(value: ApiProduct): Product {
  return {
    ...value,
    currentStock: Number(value.currentStock),
    safetyStock: Number(value.safetyStock),
    unitCost: Number(value.unitCost),
  };
}
function toSale(value: ApiSale): Sale {
  return {
    id: value.id,
    productId: value.productId,
    date: value.saleDate,
    qty: Number(value.quantity),
  };
}
function withoutStock(patch: Partial<Product>) {
  const { currentStock: _currentStock, id: _id, ...allowed } = patch;
  return allowed;
}
