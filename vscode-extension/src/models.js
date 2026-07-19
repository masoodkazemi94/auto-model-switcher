"use strict";

// Model filtering, sorting, favorites, and expiration helpers used by both the
// provider (model picker) and the Quick Pick UI.

const {
  getDirectSort,
  getFavoriteModels,
  getIncludeModels,
  getExcludeModels,
  getIncludeProviders,
  getExcludeProviders,
  getMinimumContextWindow,
  getHideExpiringWithinDays,
} = require("./config");

function daysUntil(dateString) {
  if (!dateString) return Infinity;
  const then = new Date(dateString).getTime();
  if (Number.isNaN(then)) return Infinity;
  return (then - Date.now()) / (24 * 60 * 60 * 1000);
}

// Returns true if a direct model should be hidden by include/exclude/min-context
// or expiration filters. Routing tiers are never filtered here.
function isFilteredOut(model) {
  if (!model.direct) return false;

  const minContext = getMinimumContextWindow();
  if (minContext > 0 && (model.contextLength ?? 0) < minContext) return true;

  const hideDays = getHideExpiringWithinDays();
  if (hideDays > 0 && daysUntil(model.expirationDate) <= hideDays) return true;

  const includes = getIncludeModels();
  const excludes = getExcludeModels();
  if (includes.length && !includes.includes(model.id) && !includes.includes(model.modelId)) return true;
  if (excludes.length && (excludes.includes(model.id) || excludes.includes(model.modelId))) return true;

  const includeProviders = getIncludeProviders();
  const excludeProviders = getExcludeProviders();
  if (includeProviders.length && !includeProviders.includes(model.provider)) return true;
  if (excludeProviders.length && excludeProviders.includes(model.provider)) return true;

  return false;
}

function sortDirectModels(models) {
  const sort = getDirectSort();
  const favorites = new Set(getFavoriteModels());

  const decorated = models.map((model) => ({ model, favorite: favorites.has(model.id) || favorites.has(model.modelId) }));

  decorated.sort((a, b) => {
    // Favorites always float to the top regardless of sort mode.
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    switch (sort) {
      case "name":
        return a.model.name.localeCompare(b.model.name);
      case "provider":
        return (a.model.provider ?? "").localeCompare(b.model.provider ?? "")
          || a.model.name.localeCompare(b.model.name);
      case "context":
        return (b.model.contextLength ?? 0) - (a.model.contextLength ?? 0)
          || a.model.name.localeCompare(b.model.name);
      case "output":
        return (b.model.maxOutputTokens ?? 0) - (a.model.maxOutputTokens ?? 0)
          || a.model.name.localeCompare(b.model.name);
      case "expiration":
        return (daysUntil(a.model.expirationDate) === daysUntil(b.model.expirationDate))
          ? a.model.name.localeCompare(b.model.name)
          : daysUntil(a.model.expirationDate) - daysUntil(b.model.expirationDate);
      case "recommended":
      default:
        // Recommended: keep the metadata order (already ranked by the updater),
        // but treat primary/fallback tiers slightly above plain direct entries.
        return 0;
    }
  });

  return decorated.map((entry) => entry.model);
}

// Apply include/exclude, sorting, and favorites to the direct model list.
function filterAndSortDirectModels(directModels) {
  return sortDirectModels(directModels.filter((model) => !isFilteredOut(model)));
}

function isFavorite(modelId) {
  const favorites = new Set(getFavoriteModels());
  return favorites.has(modelId) || favorites.has(modelId.replace(/^openrouter\//, ""));
}

module.exports = {
  daysUntil,
  filterAndSortDirectModels,
  isFilteredOut,
  isFavorite,
  sortDirectModels,
};
