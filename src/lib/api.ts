import type { Product, Sale, Settings } from "@/lib/types";

const API_URL = import.meta.env.VITE_API_URL ?? "/api/v1";

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

export type AuthOptions = {
  signUpEnabled: boolean;
  googleEnabled: boolean;
};

export type BusinessRegistration = {
  businessName: string;
  businessLocation?: string;
  dataOrigin: "demo" | "partner";
};

export type SignUpRequest = BusinessRegistration & {
  displayName: string;
  email: string;
  password: string;
};

export type GooglePending = { email: string; displayName: string };

export const api = {
  authOptions: () => request<AuthOptions>("/auth/options"),
  signUp: (details: SignUpRequest) =>
    request<SessionUser>("/auth/sign-up", { method: "POST", body: details }),
  startGoogle: (intent: "sign-in" | "link") =>
    request<{ url: string }>("/auth/google/start", { method: "POST", body: { intent } }),
  googlePending: () => request<GooglePending | null>("/auth/google/pending"),
  completeGoogle: (details: BusinessRegistration) =>
    request<SessionUser>("/auth/google/complete", { method: "POST", body: details }),

  signIn: (businessId: string | undefined, email: string, password: string) =>
    request<SessionUser>("/auth/sign-in", {
      method: "POST",
      body: { businessId, email, password },
    }),
  signOut: () => request<{ signedOut: boolean }>("/auth/sign-out", { method: "POST" }),
  me: () => request<SessionUser>("/auth/me"),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ changed: boolean }>("/auth/password/change", {
      method: "POST",
      body: { currentPassword, newPassword },
    }),
  requestRecovery: (email: string) =>
    request<{ accepted: boolean }>("/auth/password/recovery", { method: "POST", body: { email } }),
  completeRecovery: (token: string, newPassword: string) =>
    request<{ changed: boolean }>("/auth/password/recovery/complete", {
      method: "POST",
      body: { token, newPassword },
    }),
  members: () => request<AccountMember[]>("/auth/members"),
  acceptInvitation: (token: string, password: string) =>
    request<SessionUser>("/auth/staff/invitations/accept", {
      method: "POST",
      body: { token, password },
    }),
  inviteStaff: (email: string, displayName: string) =>
    request("/auth/staff/invitations", { method: "POST", body: { email, displayName } }),
  setMemberActive: (userId: string, isActive: boolean) =>
    request(`/auth/members/${userId}`, { method: "PATCH", body: { isActive } }),
  business: (businessId: string) =>
    request<{ name: string; location: string | null; dataOrigin: "demo" | "partner" }>(
      `/businesses/${businessId}`,
    ),
  updateBusiness: (businessId: string, name: string, location: string) =>
    request(`/businesses/${businessId}`, { method: "PATCH", body: { name, location } }),
  products: async (businessId: string) =>
    (await request<ApiProduct[]>(`/businesses/${businessId}/products`)).map(toProduct),
  createProduct: async (businessId: string, product: Omit<Product, "id">) =>
    toProduct(
      await request<ApiProduct>(`/businesses/${businessId}/products`, {
        method: "POST",
        body: product,
        idempotencyKey: crypto.randomUUID(),
      }),
    ),
  updateProduct: async (businessId: string, productId: string, patch: Partial<Product>) =>
    toProduct(
      await request<ApiProduct>(`/businesses/${businessId}/products/${productId}`, {
        method: "PATCH",
        body: patch,
      }),
    ),
  sales: async (businessId: string) =>
    (await allPages<ApiSale>(`/businesses/${businessId}/sales`)).map(toSale),
  importInventory: (businessId: string, rows: Omit<Product, "id">[]) =>
    request<{ created: number; updated: number }>(`/businesses/${businessId}/inventory-imports`, {
      method: "POST",
      body: { rows },
      idempotencyKey: crypto.randomUUID(),
    }),
  importSales: (businessId: string, rows: { sku: string; saleDate: string; quantity: string }[]) =>
    request<{ acceptedRows: number; rejectedRows: number; errors: unknown[] }>(
      `/businesses/${businessId}/data-imports`,
      {
        method: "POST",
        body: { source: "csv", rows },
      },
    ),
  dataQuality: (businessId: string) =>
    request<DataQualityEntry[]>(`/businesses/${businessId}/data-quality`),
  saveDataQuality: (
    businessId: string,
    entry: Pick<DataQualityEntry, "productId" | "classificationDate" | "classification" | "note">,
  ) =>
    request<DataQualityEntry>(`/businesses/${businessId}/data-quality`, {
      method: "PUT",
      body: entry,
    }),
  deleteDataQuality: (businessId: string, productId: string | null, classificationDate: string) =>
    request<{ deleted: boolean }>(`/businesses/${businessId}/data-quality`, {
      method: "DELETE",
      body: { productId, classificationDate },
    }),
  dashboard: (businessId: string) =>
    request<ApiDashboard>(`/businesses/${businessId}/forecast-dashboard`),
  refreshForecast: (businessId: string) =>
    request<ApiForecastRun>(`/businesses/${businessId}/forecast-refresh`, { method: "POST" }),
  exportUrl: (businessId: string, kind: "sales" | "inventory-movements" | "data-quality") =>
    `${API_URL}/businesses/${businessId}/exports/${kind}.csv`,
  recordSale: async (businessId: string, productId: string, date: string, qty: number) =>
    toSale(
      await request<ApiSale>(`/businesses/${businessId}/sales`, {
        method: "POST",
        body: { productId, saleDate: date, quantity: String(qty) },
        idempotencyKey: crypto.randomUUID(),
      }),
    ),
  receiveStock: (businessId: string, productId: string, qty: number, date: string) =>
    request(`/businesses/${businessId}/inventory-movements`, {
      method: "POST",
      idempotencyKey: crypto.randomUUID(),
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
        businessName: settings.storeName,
        businessLocation: settings.storeLocation,
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
  options: { method?: string; body?: unknown; idempotencyKey?: string } = {},
): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;
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
    Envelope<T> | { detail?: unknown; error?: { code?: string; message?: string } } | null;
  if (!response.ok) {
    const failure = payload as {
      detail?: unknown;
      error?: { code?: string; message?: string };
    } | null;
    const detail = failure?.detail;
    const message =
      failure?.error?.message ??
      (typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? detail
              .map(
                (item: { loc?: string[]; msg?: string }) =>
                  `${item.loc?.slice(1).join(".") ?? "Input"}: ${item.msg ?? "Invalid value"}`,
              )
              .join("; ")
          : undefined);
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
async function allPages<T>(path: string): Promise<T[]> {
  const result: T[] = [];
  for (let offset = 0; ; offset += 200) {
    const page = await request<T[]>(`${path}?limit=200&offset=${offset}`);
    result.push(...page);
    if (page.length < 200) return result;
  }
}

export type ApiForecastRun = {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  createdAt: string;
  timing: {
    queueWaitMs?: number;
    preparationMs?: number;
    trainingMs?: number;
    evaluationMs?: number;
    persistenceMs?: number;
    totalProcessingMs?: number;
  };
  finalTestStart: string;
  finalTestEnd: string;
  failureMessage: string | null;
  configuration: Record<string, unknown>;
};
export type ApiDashboard = {
  stale: boolean;
  run: ApiForecastRun | null;
  latestRun: ApiForecastRun | null;
  asOf: string;
  message: string;
  summaries: Record<
    string,
    {
      historyDays: number;
      nonzeroDays: number;
      eligible: boolean;
      operatingMethod: string;
      fallbackReason?: string;
      xgbWeight?: number;
      parameters?: { max_depth: number; learning_rate: number; n_estimators: number };
      effectiveFolds?: number;
      earlyStoppingUsed?: boolean;
      unknownDays?: number;
      excludedDays?: number;
      qualityWarnings?: string[];
    }
  >;
  predictions: {
    productId: string;
    predictionDate: string;
    method: string;
    datasetSplit: string;
    predictedQuantity: string;
    actualQuantity: string | null;
    lowerBound: string | null;
    upperBound: string | null;
  }[];
  metrics: {
    productId: string;
    method: string;
    datasetSplit: string;
    mae: string;
    rmse: string;
    observationCount: number;
  }[];
  recommendations: {
    productId: string;
    method: string;
    confidenceLevel: "low" | "medium" | "high";
    demandAvailable: boolean;
    unavailableReason: string | null;
    daily_demand: string | null;
    demand_during_lead_time: string | null;
    reorder_point: string | null;
    target_stock: string | null;
    suggested_quantity: string;
    days_of_cover: string | null;
    status: "stockout" | "reorder" | "watch" | "healthy";
  }[];
};

export type DataQualityClassification =
  "confirmed_zero" | "business_closed" | "full_stockout" | "partial_stockout" | "incomplete";
export type DataQualityEntry = {
  id: string;
  productId: string | null;
  sku: string | null;
  productName: string | null;
  classificationDate: string;
  classification: DataQualityClassification;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};
