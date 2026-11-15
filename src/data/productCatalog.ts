import {
  INITIAL_PRODUCT_CATEGORIES,
  INITIAL_PRODUCT_GROUPS,
  INITIAL_PRODUCT_ITEMS,
  GroupProductItem,
  ProductCategory,
  ProductGroup,
} from './initialProductsSeed';
import { getSupabaseClient } from '../utils/supabaseClient';

export interface CatalogProduct {
  id: string;
  name: string;
  category: string;
  categoryId?: string;
  groupId?: string;
  groupName?: string;
  details?: string;
  description?: string;
  unit: string;
  price: number; // Base / Consumidor Final
  priceClienteFinal: number;
  priceRevenda: number;
  priceConstrutora: number;
  priceDistribuidor: number;
  custo?: number; // Custo do produto (salvo separadamente, visão exclusiva da Diretoria)
  defaultSubtitle?: string;
}

export type ProductSearchCategoryBucket =
  | 'piso'
  | 'rodape'
  | 'ripado'
  | 'insumo'
  | 'manta'
  | 'outro';

/**
 * REGRA OFICIAL FÊNIX WORLD — TIPO DE CLIENTE E TABELA DE PREÇO
 * O Tipo de Cliente determina automaticamente qual tabela de preço deve ser utilizada nos produtos.
 *
 * REGRAS OFICIAIS:
 * - Cliente Final → Preço Cliente Final
 * - Engenheiro → Preço Cliente Final
 * - Arquiteto → Preço Cliente Final
 * - Revenda → Preço Revenda
 * - Instalador → Preço Revenda
 * - Construtora → Preço Construtora
 */
export type OfficialPriceTier = 'Cliente Final' | 'Revenda' | 'Construtora' | 'Distribuidor';

export function getPriceTierFromClientType(
  tierOrClientType?: string
): OfficialPriceTier {
  if (!tierOrClientType) return 'Cliente Final';
  const clean = tierOrClientType.trim().toLowerCase();

  // Construtora → Preço Construtora
  if (clean.includes('construtor') || clean.includes('construtora')) {
    return 'Construtora';
  }

  // Revenda & Instalador → Preço Revenda
  if (
    clean.includes('revenda') ||
    clean.includes('instalador') ||
    clean.includes('instalac') ||
    clean.includes('instalaç')
  ) {
    return 'Revenda';
  }

  // Distribuidor (se presente em cadastros específicos)
  if (clean.includes('distribuidor')) {
    return 'Distribuidor';
  }

  // Cliente Final, Engenheiro, Arquiteto, Consumidor Final → Preço Cliente Final
  return 'Cliente Final';
}

/**
 * Normalizes client type or tier string into standard price tier
 */
export function normalizePriceTier(
  tierOrClientType?: string
): OfficialPriceTier {
  return getPriceTierFromClientType(tierOrClientType);
}

/**
 * Retorna o rótulo oficial da tabela de preço para exibição no sistema
 */
export function getOfficialPriceTableLabel(tierOrClientType?: string): string {
  const tier = getPriceTierFromClientType(tierOrClientType);
  switch (tier) {
    case 'Construtora':
      return 'Preço Construtora';
    case 'Revenda':
      return 'Preço Revenda';
    case 'Distribuidor':
      return 'Preço Distribuidor';
    case 'Cliente Final':
    default:
      return 'Preço Cliente Final';
  }
}

// Cache em memória alimentado pelo Supabase (fonte oficial, sem gravar em localStorage)
const supabaseCatalogCache: {
  items: GroupProductItem[] | null;
  categories: ProductCategory[] | null;
  groups: ProductGroup[] | null;
  lastFetchedAt: number;
  inFlight: Promise<{
    items: GroupProductItem[];
    categories: ProductCategory[];
    groups: ProductGroup[];
  }> | null;
} = {
  items: null,
  categories: null,
  groups: null,
  lastFetchedAt: 0,
  inFlight: null,
};

function normalizePayloadArray<T>(raw: unknown): T[] | null {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw as T[];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as T[]) : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Returns all active products from in-memory Supabase cache (with safe fallback).
 */
export function getOfficialProducts(): GroupProductItem[] {
  if (Array.isArray(supabaseCatalogCache.items) && supabaseCatalogCache.items.length > 0) {
    return supabaseCatalogCache.items.filter((p) => p.active !== false);
  }
  if (typeof window === 'undefined') return INITIAL_PRODUCT_ITEMS;
  try {
    const raw = localStorage.getItem('fenix_product_items_data');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.filter((p) => p.active !== false);
      }
    }
  } catch (err) {
    console.error('Erro ao ler produtos em memória local:', err);
  }
  return INITIAL_PRODUCT_ITEMS;
}

/**
 * Returns all official categories from Supabase cache (with safe fallback)
 */
export function getOfficialCategories(): ProductCategory[] {
  if (Array.isArray(supabaseCatalogCache.categories) && supabaseCatalogCache.categories.length > 0) {
    return supabaseCatalogCache.categories;
  }
  if (typeof window === 'undefined') return INITIAL_PRODUCT_CATEGORIES;
  try {
    const raw = localStorage.getItem('fenix_product_categories_data');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (err) {
    console.error('Erro ao ler categorias:', err);
  }
  return INITIAL_PRODUCT_CATEGORIES;
}

/**
 * Returns all official product groups/brands from Supabase cache (with safe fallback)
 */
export function getOfficialGroups(): ProductGroup[] {
  if (Array.isArray(supabaseCatalogCache.groups) && supabaseCatalogCache.groups.length > 0) {
    return supabaseCatalogCache.groups;
  }
  if (typeof window === 'undefined') return INITIAL_PRODUCT_GROUPS;
  try {
    const raw = localStorage.getItem('fenix_product_groups_data');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (err) {
    console.error('Erro ao ler grupos de produtos:', err);
  }
  return INITIAL_PRODUCT_GROUPS;
}

/**
 * Safely parses any number, numeric string, or BRL currency string to a clean number
 */
export function safeParsePrice(val: any): number {
  if (typeof val === 'number') {
    return isNaN(val) ? 0 : val;
  }
  if (!val) return 0;
  if (typeof val === 'string') {
    const clean = val.replace('R$', '').trim();
    if (clean.includes(',')) {
      const normalized = clean.replace(/\./g, '').replace(',', '.');
      const num = parseFloat(normalized);
      return isNaN(num) ? 0 : num;
    }
    const num = parseFloat(clean);
    return isNaN(num) ? 0 : num;
  }
  return 0;
}

/**
 * Calculates the exact price for a product according to client type / table tier:
 * - Construtora → aplicar preço da Construtora
 * - Consumidor Final → aplicar preço do Consumidor Final
 * - Revenda → aplicar preço de Revenda
 * - Distribuidor → aplicar preço de Distribuidor
 */
export function getProductTierPrice(
  prod: {
    price?: number | string;
    priceClienteFinal?: number | string;
    priceRevenda?: number | string;
    priceConstrutora?: number | string;
    priceDistribuidor?: number | string;
  },
  tierOrClientType: string = 'Cliente Final'
): number {
  const tier = normalizePriceTier(tierOrClientType);
  const pCF = safeParsePrice(prod.priceClienteFinal);
  const pBase = safeParsePrice(prod.price);
  const baseClienteFinal = pCF > 0 ? pCF : (pBase > 0 ? pBase : 0);

  if (tier === 'Construtora') {
    const pConst = safeParsePrice(prod.priceConstrutora);
    if (pConst > 0) {
      return pConst;
    }
    // Fallback se não configurado
    return Math.round(baseClienteFinal * 0.90 * 100) / 100;
  }

  if (tier === 'Distribuidor') {
    const pDist = safeParsePrice(prod.priceDistribuidor);
    if (pDist > 0) {
      return pDist;
    }
    const pRev = safeParsePrice(prod.priceRevenda);
    if (pRev > 0) {
      return Math.round(pRev * 0.95 * 100) / 100;
    }
    return Math.round(baseClienteFinal * 0.78 * 100) / 100;
  }

  if (tier === 'Revenda') {
    const pRev = safeParsePrice(prod.priceRevenda);
    if (pRev > 0) {
      return pRev;
    }
    return Math.round(baseClienteFinal * 0.82 * 100) / 100;
  }

  // Preço Cliente Final (Cliente Final, Engenheiro, Arquiteto, Consumidor Final)
  return baseClienteFinal;
}

function mapItemsToCatalogProducts(
  officialList: GroupProductItem[],
  categories: ProductCategory[],
  groups: ProductGroup[]
): CatalogProduct[] {
  const catMap = new Map(categories.map((c) => [c.id, c.name]));
  const groupMap = new Map(groups.map((g) => [g.id, g.name]));

  return officialList
    .filter((item) => item.active !== false)
    .map((item) => {
      const resolvedCat = catMap.get(item.categoryId);
      const categoryName = resolvedCat || item.categoryName || 'Geral';
      const resolvedGroup = groupMap.get(item.groupId);
      const groupName = resolvedGroup || item.groupName || '';

      const pCF = safeParsePrice(item.priceClienteFinal);
      const pBase = safeParsePrice(item.price);
      const priceCF = pCF > 0 ? pCF : (pBase > 0 ? pBase : 0);

      const pRev = safeParsePrice(item.priceRevenda);
      const priceRev = pRev > 0 ? pRev : Math.round(priceCF * 0.82 * 100) / 100;

      const pConst = safeParsePrice(item.priceConstrutora);
      const priceConst = pConst > 0 ? pConst : Math.round(priceCF * 0.90 * 100) / 100;

      const pDist = safeParsePrice(item.priceDistribuidor);
      const priceDist = pDist > 0 ? pDist : Math.round(priceRev * 0.95 * 100) / 100;

      return {
        id: item.id,
        name: item.name,
        category: categoryName,
        categoryId: item.categoryId,
        groupId: item.groupId,
        groupName,
        details: item.details,
        description: item.description,
        unit: item.unit || 'unidades',
        price: priceCF,
        priceClienteFinal: priceCF,
        priceRevenda: priceRev,
        priceConstrutora: priceConst,
        priceDistribuidor: priceDist,
      };
    });
}

/**
 * Returns dynamic product catalog array mapped for select inputs and search
 */
export function getDynamicProductCatalog(): CatalogProduct[] {
  return mapItemsToCatalogProducts(
    getOfficialProducts(),
    getOfficialCategories(),
    getOfficialGroups()
  );
}

// Legacy static export compatibility
export const CRM_PRODUCT_CATALOG: CatalogProduct[] = getDynamicProductCatalog();

/**
 * Normaliza texto para busca (minúsculas, sem acentos, espaços colapsados).
 */
export function normalizeSearchText(text?: string | null): string {
  if (!text) return '';
  return String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const INSUMO_NAME_OR_CAT_REGEX =
  /\b(cola|colas|primer|primers|massa|massas|autonivelante|autonivelantes|endurecedor|contrapiso|cordao de solda|suporte|perfil de arremate|calafetar|bisnaga|selante|adesivo|desempenadeira|espatula|bico|rolete|insumo|insumos)\b/;

/**
 * Classifica o produto em seu bucket oficial pela categoria real (e proteção anti-insumo).
 */
export function classifyProductCategory(prod: {
  name?: string;
  category?: string;
  categoryName?: string;
}): ProductSearchCategoryBucket {
  const cat = normalizeSearchText(prod.category || prod.categoryName);
  const name = normalizeSearchText(prod.name);

  if (
    /\b(cola|primer|massa|autonivelante|endurecedor|insumo|adesivo|selante|calafetar|acessorio|ferramenta)\b/.test(
      cat
    )
  ) {
    return 'insumo';
  }

  if (/\b(manta|hospitalar)\b/.test(cat)) {
    return 'manta';
  }

  if (INSUMO_NAME_OR_CAT_REGEX.test(name)) {
    return 'insumo';
  }

  if (cat.includes('rodape')) {
    return 'rodape';
  }

  if (cat.includes('ripado')) {
    return 'ripado';
  }

  if (
    (cat.includes('piso') && cat.includes('vinil')) ||
    cat === 'piso' ||
    cat === 'pisos' ||
    (cat.includes('piso') && !cat.includes('manta') && !cat.includes('contra'))
  ) {
    return 'piso';
  }

  // Fallback caso categoria venha vazia/Geral
  if (!cat || cat === 'geral') {
    if (name.includes('rodape')) return 'rodape';
    if (name.includes('ripado')) return 'ripado';
    if ((name.startsWith('piso ') || (name.includes('piso') && name.includes('vinil'))) && !name.includes('manta')) {
      return 'piso';
    }
  }

  return 'outro';
}

const EXPLICIT_INSUMO_TOKENS = new Set([
  'cola',
  'colas',
  'primer',
  'primers',
  'massa',
  'massas',
  'autonivelante',
  'autonivelantes',
  'endurecedor',
  'contrapiso',
  'insumo',
  'insumos',
  'manta',
  'cordao',
  'suporte',
  'perfil',
  'calafetar',
  'adesivo',
  'bisnaga',
]);

/**
 * Identifica se o termo de busca solicita uma categoria específica (PISO, RODAPÉ, RIPADO).
 */
export function detectSearchCategoryIntent(
  rawQuery: string
): 'piso' | 'rodape' | 'ripado' | null {
  const q = normalizeSearchText(rawQuery);
  if (!q) return null;
  const tokens = q.split(/\s+/).filter(Boolean);

  // Se o usuário pediu explicitamente um insumo/manta (ex: "cola piso", "primer contrapiso"), não restringe ao bucket principal
  if (tokens.some((t) => EXPLICIT_INSUMO_TOKENS.has(t))) {
    return null;
  }

  if (tokens.some((t) => t === 'rodape' || t === 'rodapes' || (t.length >= 5 && t.startsWith('rodap')))) {
    return 'rodape';
  }

  if (tokens.some((t) => t === 'ripado' || t === 'ripados' || (t.length >= 5 && t.startsWith('ripad')))) {
    return 'ripado';
  }

  if (
    tokens.some(
      (t) =>
        t === 'piso' ||
        t === 'pisos' ||
        t === 'vinilico' ||
        t === 'vinilicos' ||
        (t.length >= 5 && t.startsWith('vinil'))
    )
  ) {
    return 'piso';
  }

  return null;
}

/**
 * Filtra lista de produtos respeitando categoria real + nome + marca (groupName) + modelo (details/description).
 */
export function filterCatalogProducts<
  T extends {
    name: string;
    category?: string;
    categoryId?: string;
    groupName?: string;
    details?: string;
    description?: string;
    defaultSubtitle?: string;
  }
>(
  catalog: T[],
  rawQuery: string,
  options?: {
    categoryIdOrName?: string;
    limit?: number;
  }
): T[] {
  const normalizedCatFilter = normalizeSearchText(options?.categoryIdOrName);
  const hasCatFilter = Boolean(options?.categoryIdOrName && normalizedCatFilter !== 'all');

  let base = catalog;
  if (hasCatFilter && options?.categoryIdOrName) {
    const target = options.categoryIdOrName;
    base = base.filter(
      (p) =>
        p.categoryId === target ||
        normalizeSearchText(p.category) === normalizedCatFilter
    );
  }

  const q = normalizeSearchText(rawQuery);
  if (!q) {
    return options?.limit ? base.slice(0, options.limit) : base;
  }

  const intent = detectSearchCategoryIntent(rawQuery);
  const tokens = q.split(/\s+/).filter(Boolean);

  const scored: { item: T; score: number }[] = [];

  for (const prod of base) {
    const bucket = classifyProductCategory(prod);
    if (intent && bucket !== intent) {
      continue;
    }

    const brand =
      prod.groupName && normalizeSearchText(prod.groupName) !== 'sem grupo'
        ? prod.groupName
        : '';

    const normName = normalizeSearchText(prod.name);
    const normBrand = normalizeSearchText(brand);
    const normModel = normalizeSearchText(
      [prod.details || '', prod.description || '', prod.defaultSubtitle || ''].join(' ')
    );
    const normCat = normalizeSearchText(prod.category);

    const searchable = [normName, normBrand, normModel, normCat].filter(Boolean).join(' ');

    // Evita falso positivo de substring ("piso" dentro de "contrapiso") em buscas gerais
    const allTokensMatch = tokens.every((tok) => {
      if (tok === 'piso' || tok === 'pisos') {
        return /\bpisos?\b/.test(searchable) || bucket === 'piso';
      }
      return searchable.includes(tok);
    });

    if (!allTokensMatch) continue;

    let score = 1;
    if (normName.startsWith(q)) score += 60;
    else if (normName.includes(q)) score += 35;
    if (normBrand && normBrand.includes(q)) score += 25;
    if (normModel && normModel.includes(q)) score += 20;
    if (normCat.includes(q)) score += 10;

    scored.push({ item: prod, score });
  }

  scored.sort((a, b) => b.score - a.score);
  const finalResults = scored.map((s) => s.item);
  return options?.limit ? finalResults.slice(0, options.limit) : finalResults;
}

/**
 * Consulta catálogo oficial atualizado diretamente no Supabase (sem gravar em localStorage).
 */
export async function fetchCatalogFromSupabase(forceRefresh = false): Promise<{
  catalog: CatalogProduct[];
  categories: ProductCategory[];
  groups: ProductGroup[];
}> {
  const cacheAge = Date.now() - supabaseCatalogCache.lastFetchedAt;
  if (
    !forceRefresh &&
    supabaseCatalogCache.items &&
    supabaseCatalogCache.categories &&
    cacheAge < 15000
  ) {
    return {
      catalog: mapItemsToCatalogProducts(
        supabaseCatalogCache.items,
        supabaseCatalogCache.categories,
        supabaseCatalogCache.groups || []
      ),
      categories: supabaseCatalogCache.categories,
      groups: supabaseCatalogCache.groups || [],
    };
  }

  const client = getSupabaseClient();
  if (!client) {
    return {
      catalog: getDynamicProductCatalog(),
      categories: getOfficialCategories(),
      groups: getOfficialGroups(),
    };
  }

  if (supabaseCatalogCache.inFlight && !forceRefresh) {
    const resolved = await supabaseCatalogCache.inFlight;
    return {
      catalog: mapItemsToCatalogProducts(resolved.items, resolved.categories, resolved.groups),
      categories: resolved.categories,
      groups: resolved.groups,
    };
  }

  const runFetch = async () => {
    try {
      const { data, error } = await client
        .from('fenix_kv_store')
        .select('key, data')
        .in('key', [
          'fenix_product_items_data',
          'fenix_product_categories_data',
          'fenix_product_groups_data',
        ]);

      if (!error && Array.isArray(data)) {
        const itemsRow = data.find((r) => r.key === 'fenix_product_items_data');
        const catsRow = data.find((r) => r.key === 'fenix_product_categories_data');
        const groupsRow = data.find((r) => r.key === 'fenix_product_groups_data');

        const itemsArr = normalizePayloadArray<GroupProductItem>(itemsRow?.data);
        const catsArr = normalizePayloadArray<ProductCategory>(catsRow?.data);
        const groupsArr = normalizePayloadArray<ProductGroup>(groupsRow?.data);

        if (itemsArr && itemsArr.length > 0) {
          supabaseCatalogCache.items = itemsArr;
        }
        if (catsArr && catsArr.length > 0) {
          supabaseCatalogCache.categories = catsArr;
        }
        if (groupsArr) {
          supabaseCatalogCache.groups = groupsArr;
        }
        supabaseCatalogCache.lastFetchedAt = Date.now();
      }
    } catch (err) {
      console.error('Erro ao consultar catálogo de produtos no Supabase:', err);
    } finally {
      supabaseCatalogCache.inFlight = null;
    }

    return {
      items: getOfficialProducts(),
      categories: getOfficialCategories(),
      groups: getOfficialGroups(),
    };
  };

  supabaseCatalogCache.inFlight = runFetch();
  const resolved = await supabaseCatalogCache.inFlight;

  return {
    catalog: mapItemsToCatalogProducts(resolved.items, resolved.categories, resolved.groups),
    categories: resolved.categories,
    groups: resolved.groups,
  };
}

/**
 * Executa a busca de produtos diretamente na camada de consulta ao Supabase,
 * já retornando resultados filtrados por categoria real, nome, marca e modelo.
 */
export async function searchProductsInSupabase(
  query: string,
  options?: {
    categoryIdOrName?: string;
    limit?: number;
    forceRefresh?: boolean;
  }
): Promise<CatalogProduct[]> {
  const { catalog } = await fetchCatalogFromSupabase(options?.forceRefresh ?? false);
  return filterCatalogProducts(catalog, query, {
    categoryIdOrName: options?.categoryIdOrName,
    limit: options?.limit,
  });
}

/**
 * Finds price, category and default unit for a product from the official PRODUTOS database.
 */
export function getProductDetailsFromCatalog(
  productName: string,
  tierOrClientType: string = 'Cliente Final'
): {
  id?: string;
  name: string;
  category: string;
  unit: string;
  price: number;
  defaultSubtitle?: string;
} {
  const cleanName = productName.trim().toLowerCase();
  const catalog = getDynamicProductCatalog();

  // 1. Exact name match
  const exact = catalog.find((p) => p.name.trim().toLowerCase() === cleanName);
  if (exact) {
    return {
      id: exact.id,
      name: exact.name,
      category: exact.category,
      unit: exact.unit,
      price: safeParsePrice(getProductTierPrice(exact, tierOrClientType)),
      defaultSubtitle: exact.defaultSubtitle,
    };
  }

  // 2. Exact match on id
  const byId = catalog.find((p) => p.id === productName);
  if (byId) {
    return {
      id: byId.id,
      name: byId.name,
      category: byId.category,
      unit: byId.unit,
      price: safeParsePrice(getProductTierPrice(byId, tierOrClientType)),
      defaultSubtitle: byId.defaultSubtitle,
    };
  }

  // 3. Partial match
  const partial = catalog.find((p) => {
    const pName = p.name.toLowerCase();
    return cleanName.includes(pName) || pName.includes(cleanName);
  });
  if (partial) {
    return {
      id: partial.id,
      name: partial.name,
      category: partial.category,
      unit: partial.unit,
      price: safeParsePrice(getProductTierPrice(partial, tierOrClientType)),
      defaultSubtitle: partial.defaultSubtitle,
    };
  }

  // 4. Fallback search by words
  const words = cleanName.split(/\s+/).filter((w) => w.length > 3);
  if (words.length > 0) {
    const matchByWords = catalog.find((p) => {
      const pLow = p.name.toLowerCase();
      return words.filter((w) => pLow.includes(w)).length >= 2;
    });
    if (matchByWords) {
      return {
        id: matchByWords.id,
        name: matchByWords.name,
        category: matchByWords.category,
        unit: matchByWords.unit,
        price: safeParsePrice(getProductTierPrice(matchByWords, tierOrClientType)),
        defaultSubtitle: matchByWords.defaultSubtitle,
      };
    }
  }

  return {
    name: productName,
    category: 'Geral',
    unit: 'unidades',
    price: 0,
  };
}
