import fs from "node:fs";
import path from "node:path";
import { Cursor } from "@cursor/sdk";
import { catalogPath, openCodeConfigPath, writePrivateFile } from "./config.mjs";

const CACHE_VERSION = 1;

export function normalizeCatalog(input) {
  if (!Array.isArray(input)) throw new Error("Cursor returned an invalid model catalog");
  const seen = new Set();
  const models = input.flatMap((item) => {
    const id = cleanId(item?.id);
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const variants = normalizeVariants(item?.variants);
    const fallback = variants.find((variant) => variant.isDefault) || variants[0] || { params: [], displayName: item?.displayName || id, isDefault: true };
    return [{
      id,
      displayName: cleanText(item?.displayName) || id,
      description: cleanText(item?.description),
      aliases: uniqueStrings(item?.aliases).filter((alias) => alias !== id),
      parameters: normalizeParameters(item?.parameters),
      variants: variants.length ? variants : [fallback]
    }];
  });
  if (!models.length) throw new Error("Cursor returned an empty model catalog");
  return models;
}

export function buildRegistry(catalog) {
  const selections = new Map();
  const models = [];
  for (const model of catalog) {
    const variants = nameVariants(model.variants);
    const defaultVariant = variants.find((variant) => variant.isDefault) || variants[0];
    const selection = { id: model.id, ...(defaultVariant.params.length ? { params: defaultVariant.params } : {}) };
    selections.set(model.id, selection);
    for (const alias of model.aliases) if (!selections.has(alias)) selections.set(alias, selection);
    for (const variant of variants) {
      const variantSelection = { id: model.id, ...(variant.params.length ? { params: variant.params } : {}) };
      selections.set(`${model.id}@${variant.id}`, variantSelection);
    }
    models.push({ ...model, variants, selection });
  }
  return { models, selections };
}

export function resolveSelection(registry, requestedModel, requestBody = {}) {
  const requested = cleanId(String(requestedModel || "").split("/").filter(Boolean).at(-1));
  const base = registry.selections.get(requested);
  if (!base) return null;
  const supplied = requestBody.cursorParams ?? requestBody.cursor_params;
  if (supplied === undefined) return base;
  let params;
  try {
    params = normalizeParamValues(supplied);
  } catch {
    return null;
  }
  const model = registry.models.find((item) => item.id === base.id);
  const match = model?.variants.find((variant) => sameParams(variant.params, params));
  return match ? { id: base.id, ...(params.length ? { params } : {}) } : null;
}

export function providerModels(registry, { exposeVariantAliases = false } = {}) {
  const result = {};
  for (const model of registry.models) {
    const hasSelectableVariants = model.variants.length > 1 || model.variants.some((variant) => variant.params.length);
    result[model.id] = {
      name: model.displayName,
      limit: modelLimits(model),
      modalities: { input: ["text"], output: ["text"] },
      ...(hasSelectableVariants ? {
        variants: Object.fromEntries(model.variants.map((variant) => [variant.id, {
          cursor_params: variant.params
        }]))
      } : {})
    };
    if (exposeVariantAliases && hasSelectableVariants) {
      for (const variant of model.variants) {
        result[`${model.id}@${variant.id}`] = {
          id: model.id,
          name: `${model.displayName} · ${variant.displayName}`,
          limit: modelLimits(model),
          modalities: { input: ["text"], output: ["text"] },
          options: { cursor_params: variant.params }
        };
      }
    }
  }
  return result;
}

export function readCachedCatalog() {
  try {
    const cache = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
    if (cache.version !== CACHE_VERSION) return null;
    return { fetchedAt: cache.fetchedAt, catalog: normalizeCatalog(cache.models), source: "cache" };
  } catch {
    return null;
  }
}

export async function fetchCatalog() {
  let models;
  try {
    models = await Cursor.models.list();
  } catch (error) {
    if (error?.code === "unauthenticated" || error?.name === "AuthenticationError") {
      throw new Error("Cursor authentication failed. Run `npm run setup` to sign in, or check CURSOR_API_KEY.");
    }
    throw error;
  }
  const catalog = normalizeCatalog(models);
  const fetchedAt = new Date().toISOString();
  writePrivateFile(catalogPath, `${JSON.stringify({ version: CACHE_VERSION, fetchedAt, models: catalog }, null, 2)}\n`);
  return { fetchedAt, catalog, source: "cursor" };
}

export async function loadCatalog() {
  try {
    return await fetchCatalog();
  } catch (error) {
    const cached = readCachedCatalog();
    if (cached) return { ...cached, error: error.message };
    throw error;
  }
}

export function syncOpenCodeConfig(registry, config, { backup = true, file = openCodeConfigPath } = {}) {
  const current = readJsonStrict(file, {});
  current.provider ||= {};
  const nextProvider = {
    name: "Cursor",
    npm: "@ai-sdk/openai-compatible",
    options: { baseURL: `http://${config.host}:${config.port}/v1`, apiKey: config.localToken },
    models: providerModels(registry, { exposeVariantAliases: config.exposeVariantAliases })
  };
  const existing = current.provider.cursorapi;
  if (JSON.stringify(existing) === JSON.stringify(nextProvider)) return { changed: false };
  current.provider.cursorapi = nextProvider;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let backupPath;
  if (backup && fs.existsSync(file)) {
    backupPath = `${file}.modelferry-backup.${Date.now()}`;
    fs.copyFileSync(file, backupPath);
  }
  const temporary = `${file}.modelferry-${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(current, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
  return { changed: true, backupPath };
}

export function catalogSummary(state, registry) {
  return {
    source: state.source,
    fetchedAt: state.fetchedAt,
    stale: state.source === "cache",
    error: state.error,
    models: registry.models.length,
    variants: registry.models.reduce((total, model) => total + model.variants.length, 0)
  };
}

function normalizeVariants(input) {
  if (!Array.isArray(input)) return [];
  return input.flatMap((variant) => {
    try {
      return [{
        params: normalizeParamValues(variant?.params || []),
        displayName: cleanText(variant?.displayName) || "Default",
        description: cleanText(variant?.description),
        isDefault: variant?.isDefault === true
      }];
    } catch {
      return [];
    }
  });
}

function normalizeParameters(input) {
  if (!Array.isArray(input)) return [];
  return input.flatMap((parameter) => {
    const id = cleanId(parameter?.id);
    if (!id || !Array.isArray(parameter.values)) return [];
    return [{ id, displayName: cleanText(parameter.displayName), values: parameter.values.flatMap((value) => {
      const normalized = cleanText(value?.value);
      return normalized ? [{ value: normalized, displayName: cleanText(value?.displayName) }] : [];
    }) }];
  });
}

function normalizeParamValues(input) {
  if (!Array.isArray(input)) throw new Error("Model parameters must be an array");
  const seen = new Set();
  return input.map((param) => {
    const id = cleanId(param?.id);
    const value = cleanText(param?.value);
    if (!id || !value || seen.has(id)) throw new Error("Invalid model parameter selection");
    seen.add(id);
    return { id, value };
  });
}

function nameVariants(variants) {
  const used = new Set();
  return variants.map((variant, index) => {
    const base = variantName(variant.params) || `standard${index ? `-${index + 1}` : ""}`;
    let id = base;
    for (let suffix = 2; used.has(id); suffix += 1) id = `${base}-${suffix}`;
    used.add(id);
    return { ...variant, id, displayName: variantLabel(variant.params, variant.displayName) };
  });
}

function variantName(params) {
  return params.flatMap(({ id, value }) => {
    if (id === "cyber" && value === "false") return [];
    if (id === "thinking") return [value === "true" ? "thinking" : "no-thinking"];
    if (id === "fast") return [value === "true" ? "fast" : "standard"];
    if (["reasoning", "effort", "context"].includes(id)) return [value];
    return [`${id}-${value}`];
  }).map(slug).filter(Boolean).join("-");
}

function variantLabel(params, fallback) {
  const pieces = params.flatMap(({ id, value }) => {
    if (id === "cyber" && value === "false") return [];
    if (id === "thinking") return [value === "true" ? "Thinking" : "No thinking"];
    if (id === "fast") return [value === "true" ? "Fast" : "Standard"];
    if (id === "context") return [value.toUpperCase()];
    return [title(value)];
  });
  return pieces.join(" · ") || fallback || "Default";
}

function modelLimits(model) {
  const contexts = model.parameters.find((parameter) => parameter.id === "context")?.values.map((item) => parseContext(item.value)).filter(Boolean) || [];
  return { context: contexts.length ? Math.max(...contexts) : 200_000, output: 65_536 };
}

function parseContext(value) {
  const match = String(value).toLowerCase().match(/^(\d+(?:\.\d+)?)(k|m)?$/);
  if (!match) return 0;
  return Math.round(Number(match[1]) * (match[2] === "m" ? 1_000_000 : match[2] === "k" ? 1_000 : 1));
}

function sameParams(left, right) {
  const sort = (items) => [...items].sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify(sort(left)) === JSON.stringify(sort(right));
}

function uniqueStrings(input) {
  return [...new Set((Array.isArray(input) ? input : []).map(cleanId).filter(Boolean))];
}

function cleanId(value) {
  return cleanText(value).toLowerCase();
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-|-$/g, "");
}

function title(value) {
  return String(value).replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function readJsonStrict(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
