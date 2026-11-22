import { PROVIDER_CATALOG_DATA } from "./providerCatalogData";
import { MODEL_REGISTRY_DATA } from "./providerModelsData";

export type ProviderCapability =
  | "chat"
  | "code"
  | "image_generation"
  | "image_editing"
  | "image_understanding"
  | "video_generation"
  | "image_to_video"
  | "audio"
  | "embeddings";

export type ProviderRole =
  | "first_party_api"
  | "model_host"
  | "open_weights_creator"
  | "no_public_api";

export type ModelCategory =
  | "text_chat"
  | "image_generation"
  | "video_generation";

export type ModelAccessType =
  | "paid"
  | "free"
  | "free_tier"
  | "open_weights_hosted"
  | "paid_open_weights"
  | "legacy_shutting_down"
  | "shut_down"
  | "research_limited"
  | "no_public_api";

export type ModelAvailability =
  | "active"
  | "pending_verification"
  | "dynamic_host"
  | "legacy"
  | "shut_down"
  | "unavailable";

export type EndpointVerificationStatus =
  | "verified_official"
  | "pending_verification"
  | "no_public_api";

export type ProviderOfficialLinks = {
  website: string | null;
  apiPlatform: string | null;
  docsUrl: string | null;
  apiKeyPage: string | null;
  usageDashboard: string | null;
  billingDashboard: string | null;
  modelsDocsUrl: string | null;
};

export type ProviderConnectionDetails = {
  apiBaseUrl: string | null;
  chatEndpoint: string | null;
  authMethod: string | null;
  passesThroughBackend: boolean;
  externalProxy: string | null;
  verificationStatus: EndpointVerificationStatus;
};

export type ProviderCatalogEntry = {
  id: string;
  name: string;
  shortDescription: string;
  role: ProviderRole;
  inOriginalProject: boolean;
  inCsvCatalog: boolean;
  capabilities: ProviderCapability[];
  accessTypes: ModelAccessType[];
  maxKeys: number;
  chatAdapterReady: boolean;
  officialLinks: ProviderOfficialLinks;
  connectionDetails: ProviderConnectionDetails;
  pricingSummary: string;
  usageLimitsNote: string;
};

export type ModelRegistryEntry = {
  id: string;
  providerId: string;
  creatorName: string;
  apiHosts: string[];
  modelName: string;
  modelId: string;
  category: ModelCategory;
  capabilities: ProviderCapability[];
  accessType: ModelAccessType;
  rawAccessType: string;
  availability: ModelAvailability;
  docsUrl: string;
  notes: string;
  lastVerifiedAt: string;
};

export type CatalogAuditSummary = {
  existingProjectProviders: number;
  csvProviderNames: number;
  totalCatalogProviders: number;
  verifiedOfficialProviders: number;
  chatAdapterReadyProviders: number;
  csvTotalModels: number;
  verifiedActiveModels: number;
  dynamicHostPlaceholders: number;
  pendingVerificationModels: number;
  legacyModels: number;
  shutDownModels: number;
  unavailableModels: number;
};

export const PROVIDER_CATALOG: ReadonlyArray<ProviderCatalogEntry> =
  PROVIDER_CATALOG_DATA;

export const MODEL_REGISTRY: ReadonlyArray<ModelRegistryEntry> =
  MODEL_REGISTRY_DATA;

const PROVIDER_BY_ID = new Map<string, ProviderCatalogEntry>(
  PROVIDER_CATALOG.map((entry) => [entry.id, entry]),
);

export function findCatalogProvider(
  providerId: string,
): ProviderCatalogEntry | null {
  const normalized = providerId.trim().toLowerCase();
  return PROVIDER_BY_ID.get(normalized) ?? null;
}

export function getCatalogProviderKeyLimit(providerId: string): number {
  const normalized = providerId.trim().toLowerCase();
  if (normalized === "openrouter") return 5;
  return PROVIDER_BY_ID.get(normalized)?.maxKeys ?? 3;
}

export function getModelsForProvider(
  providerId: string,
  includeInactive = false,
): ModelRegistryEntry[] {
  const normalized = providerId.trim().toLowerCase();
  return MODEL_REGISTRY.filter((model) => {
    if (model.providerId !== normalized) return false;
    if (!includeInactive) {
      return (
        model.availability === "active" ||
        model.availability === "pending_verification" ||
        model.availability === "dynamic_host"
      );
    }
    return true;
  });
}

export function isModelActiveForExecution(model: ModelRegistryEntry): boolean {
  return (
    model.availability === "active" ||
    model.availability === "pending_verification"
  );
}

export function queryModelRegistry(filters: {
  providerId?: string;
  category?: ModelCategory;
  capability?: ProviderCapability;
  accessType?: ModelAccessType;
  query?: string;
  includeInactive?: boolean;
}): ModelRegistryEntry[] {
  const q = filters.query?.trim().toLowerCase() ?? "";
  return MODEL_REGISTRY.filter((model) => {
    if (filters.providerId && model.providerId !== filters.providerId.toLowerCase()) {
      return false;
    }
    if (filters.category && model.category !== filters.category) {
      return false;
    }
    if (filters.capability && !model.capabilities.includes(filters.capability)) {
      return false;
    }
    if (filters.accessType && model.accessType !== filters.accessType) {
      return false;
    }
    if (!filters.includeInactive) {
      if (
        model.availability === "shut_down" ||
        model.availability === "legacy" ||
        model.availability === "unavailable"
      ) {
        return false;
      }
    }
    if (q) {
      const hay = [
        model.modelName,
        model.modelId,
        model.creatorName,
        model.providerId,
        ...model.apiHosts,
      ]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function getCatalogAuditSummary(): CatalogAuditSummary {
  const csvModels = MODEL_REGISTRY.filter((m) => m.id.startsWith("csv_"));
  return {
    existingProjectProviders: PROVIDER_CATALOG.filter((p) => p.inOriginalProject).length,
    csvProviderNames: PROVIDER_CATALOG.filter((p) => p.inCsvCatalog).length,
    totalCatalogProviders: PROVIDER_CATALOG.length,
    verifiedOfficialProviders: PROVIDER_CATALOG.filter(
      (p) => p.connectionDetails.verificationStatus === "verified_official",
    ).length,
    chatAdapterReadyProviders: PROVIDER_CATALOG.filter((p) => p.chatAdapterReady).length,
    csvTotalModels: csvModels.length,
    verifiedActiveModels: MODEL_REGISTRY.filter((m) => m.availability === "active").length,
    dynamicHostPlaceholders: csvModels.filter((m) => m.availability === "dynamic_host").length,
    pendingVerificationModels: csvModels.filter((m) => m.availability === "pending_verification").length,
    legacyModels: csvModels.filter((m) => m.availability === "legacy").length,
    shutDownModels: csvModels.filter((m) => m.availability === "shut_down").length,
    unavailableModels: csvModels.filter((m) => m.availability === "unavailable").length,
  };
}
