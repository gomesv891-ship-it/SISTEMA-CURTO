import {
  fetchCatalogFromSupabase,
  getDynamicProductCatalog,
  CatalogProduct,
  getProductTierPrice,
} from '../data/productCatalog';
import { getSupabaseClient, recordSelfSave, withTimeout } from './supabaseClient';
import { isUserRevoked } from './auth';

export const PROMOCOES_SUPABASE_KEY = 'fenix_promocoes_ativas_db';
const PROMOCOES_CACHE_KEY = 'fenix_promocoes_ativas_cache_v1';

export type PromoModality = 'cliente_final' | 'construtora' | 'revenda';
export type FixedPromoCategory = 'piso_vinilico' | 'rodapes' | 'ripados' | 'teto_vinilico' | 'outros';
export type PromoCategory = FixedPromoCategory | (string & {});
export type PromoCampaignStatus = 'ativa' | 'inativa' | 'encerrada';
export type PromoCategoryUnit =
  | 'm²'
  | 'ml'
  | 'barra'
  | 'régua'
  | 'caixa'
  | 'unidade'
  | 'rolo'
  | 'pacote';
export type PromoCategoryPricingType = 'unitario' | 'escalonado';

export const PROMO_CATEGORY_UNITS: PromoCategoryUnit[] = [
  'm²',
  'ml',
  'barra',
  'régua',
  'caixa',
  'unidade',
  'rolo',
  'pacote',
];

export const SEM_CATEGORIA_ID = 'sem_categoria';

export interface PromoTierDefaultRange {
  id: string;
  minQty: number;
  maxQty?: number | null;
}

export interface PromoCategoryConfig {
  id: string;
  label: string;
  unit: PromoCategoryUnit;
  pricingType: PromoCategoryPricingType;
  defaultRanges?: PromoTierDefaultRange[];
  order: number;
}

export interface PromoCustomCategory {
  id: string;
  label: string;
  pricingType: 'sqm' | 'simple';
  order: number;
}

export const PROMO_MODALITIES: { id: PromoModality; label: string; shortLabel: string; crmTier: string }[] = [
  { id: 'cliente_final', label: 'CLIENTE FINAL', shortLabel: 'Cliente Final', crmTier: 'Cliente Final' },
  { id: 'construtora', label: 'CONSTRUTORA', shortLabel: 'Construtora', crmTier: 'Construtora' },
  { id: 'revenda', label: 'REVENDA', shortLabel: 'Revenda', crmTier: 'Revenda' },
];

export const PROMO_CATEGORIES: { id: PromoCategory; label: string }[] = [
  { id: 'piso_vinilico', label: 'PISO VINÍLICO' },
  { id: 'rodapes', label: 'RODAPÉS' },
  { id: 'ripados', label: 'RIPADOS' },
  { id: 'teto_vinilico', label: 'TETO VINÍLICO' },
  { id: 'outros', label: 'OUTROS PRODUTOS' },
];

export function createDefaultPromoCategories(): PromoCategoryConfig[] {
  return [
    {
      id: 'piso_vinilico',
      label: 'Piso Vinílico',
      unit: 'm²',
      pricingType: 'unitario',
      order: 0,
    },
    {
      id: 'rodapes',
      label: 'Rodapés',
      unit: 'barra',
      pricingType: 'escalonado',
      defaultRanges: [
        { id: 'rng_rod_1', minQty: 30, maxQty: null },
        { id: 'rng_rod_2', minQty: 50, maxQty: null },
        { id: 'rng_rod_3', minQty: 100, maxQty: null },
      ],
      order: 1,
    },
    {
      id: 'ripados',
      label: 'Ripados',
      unit: 'barra',
      pricingType: 'escalonado',
      defaultRanges: [
        { id: 'rng_rip_1', minQty: 30, maxQty: null },
        { id: 'rng_rip_2', minQty: 50, maxQty: null },
        { id: 'rng_rip_3', minQty: 100, maxQty: null },
      ],
      order: 2,
    },
    {
      id: 'teto_vinilico',
      label: 'Teto Vinílico',
      unit: 'm²',
      pricingType: 'unitario',
      order: 3,
    },
    {
      id: 'outros',
      label: 'Outros Produtos',
      unit: 'unidade',
      pricingType: 'unitario',
      order: 4,
    },
  ];
}

export interface PromoSubcategory {
  id: string;
  category: PromoCategory;
  name: string;
  order: number;
}

export interface PromoLotGroup {
  id: string;
  name: string;
  order: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface PromoFloorLot {
  id: string;
  lotGroupId?: string;
  crmProductId?: string;
  description: string;
  pattern?: string;
  thickness?: string;
  subcategoryId?: string;
  sqmPerBox: number;
  initialBoxes: number;
  soldBoxes: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export const DEFAULT_ADMIN_LOT_GROUPS: {
  id: string;
  name: string;
  order: number;
  products: { seedId: string; name: string; defaultSqmPerBox: number }[];
}[] = [
  {
    id: 'grp_vinilforte_flexfloor',
    name: 'VINILFORTE / FLEXFLOOR',
    order: 0,
    products: [
      { seedId: 'lot_seed_lobato', name: 'Lobato', defaultSqmPerBox: 2.5 },
      { seedId: 'lot_seed_malta', name: 'Malta', defaultSqmPerBox: 2.5 },
      { seedId: 'lot_seed_carvalho_rustic', name: 'Carvalho Rustic', defaultSqmPerBox: 2.5 },
    ],
  },
  {
    id: 'grp_ospefloor',
    name: 'OSPEFLOOR',
    order: 1,
    products: [
      { seedId: 'lot_seed_pisera', name: 'Pisera', defaultSqmPerBox: 2.5 },
      { seedId: 'lot_seed_trenado', name: 'Trenado', defaultSqmPerBox: 2.5 },
    ],
  },
  {
    id: 'grp_vinilforte_placa',
    name: 'VINILFORTE PLACA',
    order: 2,
    products: [
      { seedId: 'lot_seed_turmalina', name: 'Turmalina', defaultSqmPerBox: 2.5 },
      { seedId: 'lot_seed_pinheiros', name: 'Pinheiros', defaultSqmPerBox: 2.5 },
    ],
  },
  {
    id: 'grp_vinilforte_linha_b',
    name: 'VINILFORTE LINHA B',
    order: 3,
    products: [
      { seedId: 'lot_seed_jacaranda', name: 'Jacarandá', defaultSqmPerBox: 2.5 },
    ],
  },
  {
    id: 'grp_vexa_clicado',
    name: 'VEXA CLICADO',
    order: 4,
    products: [
      { seedId: 'lot_seed_jatoba', name: 'Jatobá', defaultSqmPerBox: 2.5 },
    ],
  },
];

export interface PromoLotSale {
  id: string;
  saleToken: string;
  lotId: string;
  lotDescription: string;
  modality: PromoModality;
  boxesSold: number;
  sqmSold: number;
  unitPriceSqm?: number;
  totalValue?: number;
  customerName?: string;
  orderNumber?: string;
  notes?: string;
  soldBy: string;
  soldAt: string;
}

export interface PromoProgressiveTier {
  id?: string;
  minQty: number;
  maxQty?: number | null;
  label?: string;
  price: number;
}

export interface PromoOfferItem {
  id: string;
  category: PromoCategory;
  subcategoryId?: string;
  crmProductId?: string;
  lotId?: string; // Vinculado a PromoFloorLot quando category === 'piso_vinilico'
  description: string;
  specs?: string;
  active: boolean;
  order: number;
  // Piso Vinílico e Teto Vinílico (ou unitário m²)
  priceSqm?: number;
  // Escalonado (preço base opcional + N faixas min/max/price)
  priceNormal?: number;
  tiers?: PromoProgressiveTier[];
  // Unitário genérico
  price?: number;
}

export interface PromoTierQuantities {
  rodapes: [number, number, number];
  ripados: [number, number, number];
}

export type PromoSheetModel = 'oficial_colorido' | 'pb_economico' | 'compacto_a4';

export interface PromoSheetSettings {
  model: PromoSheetModel;
  includedCategories: Record<string, boolean>;
  showModalityLabel: boolean;
  showSubcategories: boolean;
  subcategoriesToggledByUser?: boolean;
  density: 'padrao' | 'compacto';
}

export interface PromoCampaign {
  id: string;
  name: string;
  badgeTopText?: string;
  badgeBottomText?: string;
  status: PromoCampaignStatus;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  validityText?: string;
  paymentConditionText?: string;
  showSubcategoriesOnSheet?: boolean;
  sheetSettings?: PromoSheetSettings;
  conditionsByModality: Record<PromoModality, string>;
  tierQuantitiesByModality: Record<PromoModality, PromoTierQuantities>;
  categories?: PromoCategoryConfig[];
  customCategories?: PromoCustomCategory[];
  subcategories: PromoSubcategory[];
  lotGroups?: PromoLotGroup[];
  lots: PromoFloorLot[];
  lotSales: PromoLotSale[];
  offersByModality: Record<PromoModality, PromoOfferItem[]>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
}

export interface LotMetrics {
  initialBoxes: number;
  soldBoxes: number;
  availableBoxes: number;
  sqmPerBox: number;
  initialSqm: number;
  soldSqm: number;
  availableSqm: number;
  isAvailable: boolean;
}

export function canManagePromocoes(userName?: string | null): boolean {
  if (!userName || isUserRevoked(userName)) return false;
  return true;
}

export function getDefaultTierQuantities(): PromoTierQuantities {
  return {
    rodapes: [30, 50, 100],
    ripados: [30, 50, 100],
  };
}

export function createEmptyOffersByModality(): Record<PromoModality, PromoOfferItem[]> {
  return {
    cliente_final: [],
    construtora: [],
    revenda: [],
  };
}

export function createEmptyConditionsByModality(): Record<PromoModality, string> {
  return {
    cliente_final: '',
    construtora: '',
    revenda: '',
  };
}

export function createEmptyTierQuantitiesByModality(): Record<PromoModality, PromoTierQuantities> {
  return {
    cliente_final: getDefaultTierQuantities(),
    construtora: getDefaultTierQuantities(),
    revenda: getDefaultTierQuantities(),
  };
}

export function getDefaultSheetSettings(showSubcategories = true): PromoSheetSettings {
  return {
    model: 'oficial_colorido',
    includedCategories: {
      piso_vinilico: true,
      rodapes: true,
      ripados: true,
      teto_vinilico: true,
      outros: true,
      [SEM_CATEGORIA_ID]: false,
    },
    showModalityLabel: false,
    showSubcategories,
    density: 'padrao',
  };
}

export function normalizePromoCategoryUnit(
  value: unknown,
  fallback: PromoCategoryUnit = 'unidade'
): PromoCategoryUnit {
  const s = String(value || '').trim().toLowerCase();
  if (s === 'm²' || s === 'm2') return 'm²';
  if (s === 'ml') return 'ml';
  if (s === 'barra' || s === 'barras') return 'barra';
  if (s === 'régua' || s === 'regua' || s === 'réguas' || s === 'reguas') return 'régua';
  if (s === 'caixa' || s === 'caixas') return 'caixa';
  if (s === 'unidade' || s === 'unidades' || s === 'un') return 'unidade';
  if (s === 'rolo' || s === 'rolos') return 'rolo';
  if (s === 'pacote' || s === 'pacotes' || s === 'pct') return 'pacote';
  return fallback;
}

export function pluralizePromoUnit(unit: PromoCategoryUnit | string, qty?: number): string {
  const norm = normalizePromoCategoryUnit(unit);
  if (norm === 'm²' || norm === 'ml') return norm;
  if (qty === 1) return norm;
  if (norm === 'barra') return 'barras';
  if (norm === 'régua') return 'réguas';
  if (norm === 'caixa') return 'caixas';
  if (norm === 'unidade') return 'unidades';
  if (norm === 'rolo') return 'rolos';
  if (norm === 'pacote') return 'pacotes';
  return norm;
}

export function formatTierRangeLabel(
  tier: { minQty: number; maxQty?: number | null; label?: string },
  unit: string
): string {
  const minQ = Math.max(1, Math.floor(Number(tier.minQty) || 1));
  return `+${minQ} ${pluralizePromoUnit(unit, minQ)}`;
}

export function getTierRangeSignature(tier: { minQty: number; maxQty?: number | null }): string {
  const minQ = Math.max(1, Math.floor(Number(tier.minQty) || 1));
  return `min_${minQ}`;
}

export function getCampaignCategories(campaign?: PromoCampaign | null): PromoCategoryConfig[] {
  if (!campaign) return createDefaultPromoCategories();
  if (Array.isArray(campaign.categories)) {
    return [...campaign.categories].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }
  const defaults = createDefaultPromoCategories();
  const custom: PromoCategoryConfig[] = (campaign.customCategories || []).map((c, idx) => ({
    id: c.id,
    label: c.label,
    unit: c.pricingType === 'sqm' ? 'm²' : 'unidade',
    pricingType: 'unitario',
    order: defaults.length + idx,
  }));
  return [...defaults, ...custom];
}

export function getOfferUnitPrice(
  offer: PromoOfferItem,
  category?: Pick<PromoCategoryConfig, 'unit' | 'pricingType'>
): number {
  if (category?.unit === 'm²') {
    const val = offer.priceSqm ?? offer.price ?? offer.priceNormal ?? 0;
    return Number.isFinite(Number(val)) ? Math.max(0, Number(val)) : 0;
  }
  const val = offer.price ?? offer.priceSqm ?? offer.priceNormal ?? 0;
  return Number.isFinite(Number(val)) ? Math.max(0, Number(val)) : 0;
}

/**
 * Resolve o preço unitário escalonado correspondente à quantidade total informada.
 * Regra comercial: faixas funcionam exclusivamente por quantidade mínima (sem intervalos fechados).
 * Quando a quantidade atingir uma faixa (totalQty >= minQty), o preço da maior faixa atingida
 * é aplicado a todas as unidades/barras do pedido.
 * Ex.: ao comprar 35 barras, todas recebem o preço da faixa +30 barras.
 */
export function resolveTierPriceForQuantity(
  offer: PromoOfferItem,
  totalQty: number
): { unitPrice: number; matchedTier?: PromoProgressiveTier } {
  const baseFallback = Math.max(
    0,
    Number(offer.priceNormal ?? offer.price ?? offer.priceSqm ?? 0) || 0
  );
  const sortedTiers = [...(offer.tiers || [])]
    .filter((t) => Number.isFinite(Number(t.minQty)) && Number(t.minQty) >= 1 && Number(t.price) >= 0)
    .sort((a, b) => Number(a.minQty) - Number(b.minQty));

  if (sortedTiers.length === 0 || !Number.isFinite(totalQty) || totalQty <= 0) {
    return { unitPrice: baseFallback };
  }

  const highestMatched = sortedTiers
    .filter((t) => totalQty >= Number(t.minQty))
    .pop();

  if (highestMatched) {
    return {
      unitPrice: Math.max(0, Number(highestMatched.price) || 0),
      matchedTier: highestMatched,
    };
  }

  return { unitPrice: baseFallback };
}

export function calculateEscalonadoTotal(
  offer: PromoOfferItem,
  totalQty: number
): { unitPrice: number; totalPrice: number; matchedTier?: PromoProgressiveTier } {
  const qty = Math.max(0, Number(totalQty) || 0);
  const { unitPrice, matchedTier } = resolveTierPriceForQuantity(offer, qty);
  return {
    unitPrice,
    totalPrice: Math.round(qty * unitPrice * 100) / 100,
    matchedTier,
  };
}

export function parseNumberFlexible(val: unknown): number {
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
  if (val === null || val === undefined) return 0;
  const cleaned = String(val).replace(/[R$\s m²]/gi, '').trim();
  if (!cleaned) return 0;
  if (cleaned.includes(',') && cleaned.includes('.')) {
    const n = parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }
  if (cleaned.includes(',')) {
    const n = parseFloat(cleaned.replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

export function formatCurrencyBRL(value?: number | null): string {
  const num = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatSqmBR(value?: number | null): string {
  const num = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return `${num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m²`;
}

export function formatDateBR(dateStr?: string): string {
  if (!dateStr) return '__/__/____';
  const clean = String(dateStr).trim().split('T')[0];
  const parts = clean.split('-');
  if (parts.length === 3 && parts[0].length === 4) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return clean;
}

export function getTodayIsoDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

export function computeLotMetrics(lot: Pick<PromoFloorLot, 'initialBoxes' | 'soldBoxes' | 'sqmPerBox' | 'active'>): LotMetrics {
  const initialBoxes = Math.max(0, Math.floor(Number(lot.initialBoxes) || 0));
  const soldBoxes = Math.max(0, Math.min(initialBoxes, Math.floor(Number(lot.soldBoxes) || 0)));
  const availableBoxes = Math.max(0, initialBoxes - soldBoxes);
  const sqmPerBox = Math.max(0, Number(lot.sqmPerBox) || 0);

  const initialSqm = Math.round(initialBoxes * sqmPerBox * 100) / 100;
  const soldSqm = Math.round(soldBoxes * sqmPerBox * 100) / 100;
  const availableSqm = Math.round(availableBoxes * sqmPerBox * 100) / 100;

  return {
    initialBoxes,
    soldBoxes,
    availableBoxes,
    sqmPerBox,
    initialSqm,
    soldSqm,
    availableSqm,
    isAvailable: lot.active !== false && availableBoxes > 0,
  };
}

export function splitCampaignBadgeTitle(
  name: string,
  badgeTopText?: string,
  badgeBottomText?: string
): { top: string; bottom: string } {
  const customTop = (badgeTopText || '').trim();
  const customBottom = (badgeBottomText || '').trim();
  if (customTop || customBottom) {
    return {
      top: (customTop || 'CAMPANHA').toUpperCase(),
      bottom: (customBottom || name || 'FÊNIX').toUpperCase(),
    };
  }

  const clean = (name || 'CAMPANHA PROMOCIONAL').trim();
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return {
      top: words.slice(0, Math.ceil(words.length / 2)).join(' ').toUpperCase(),
      bottom: words.slice(Math.ceil(words.length / 2)).join(' ').toUpperCase(),
    };
  }
  return {
    top: 'OFERTAS',
    bottom: clean.toUpperCase(),
  };
}

export function extractSqmPerBoxFromProductName(name: string): number {
  if (!name) return 0;
  const match = name.match(/(?:cx|caixa)\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*m/i)
    || name.match(/(\d+(?:[.,]\d+)?)\s*m²\s*(?:\/\s*cx|por\s*caixa)/i);
  if (match && match[1]) {
    const val = parseFloat(match[1].replace(',', '.'));
    return Number.isFinite(val) && val > 0 ? val : 0;
  }
  return 0;
}

export function detectPromoCategoryFromCrmProduct(category: string, name: string): PromoCategory {
  const text = `${category || ''} ${name || ''}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (text.includes('rodape') || text.includes('guarnicao')) {
    return 'rodapes';
  }
  if (text.includes('ripado')) {
    return 'ripados';
  }
  if (text.includes('teto') || text.includes('forro')) {
    return 'teto_vinilico';
  }
  if (text.includes('cola') || text.includes('primer') || text.includes('massa') || text.includes('autonivelante') || text.includes('acessorio') || text.includes('bisnaga') || text.includes('pu')) {
    return 'outros';
  }
  if (text.includes('piso') || text.includes('vinilico') || text.includes('clicado') || text.includes('flexfloor') || text.includes('vinilforte') || text.includes('vexa')) {
    return 'piso_vinilico';
  }
  return 'outros';
}

function buildDefaultRangesFromTuple(tuple?: [number, number, number]): PromoTierDefaultRange[] {
  const q1 = Math.max(2, Math.floor(Number(tuple?.[0]) || 30));
  const q2 = Math.max(q1 + 1, Math.floor(Number(tuple?.[1]) || 50));
  const q3 = Math.max(q2 + 1, Math.floor(Number(tuple?.[2]) || 100));
  return [
    { id: 'rng_1', minQty: q1, maxQty: null },
    { id: 'rng_2', minQty: q2, maxQty: null },
    { id: 'rng_3', minQty: q3, maxQty: null },
  ];
}

function normalizeDefaultRanges(rawRanges: any): PromoTierDefaultRange[] | undefined {
  if (!Array.isArray(rawRanges)) return undefined;
  const seen = new Set<number>();
  const cleaned: PromoTierDefaultRange[] = [];
  rawRanges
    .filter((r: any) => r && Number.isFinite(Number(r.minQty)))
    .forEach((r: any, idx: number) => {
      const minQty = Math.floor(Number(r.minQty) || 0);
      if (minQty < 2 || seen.has(minQty)) return;
      seen.add(minQty);
      cleaned.push({
        id: String(r.id || `rng_${idx}`),
        minQty,
        maxQty: null,
      });
    });
  cleaned.sort((a, b) => a.minQty - b.minQty);
  return cleaned;
}

function normalizeCampaign(raw: any): PromoCampaign | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim();
  if (!id) return null;

  const status: PromoCampaignStatus =
    raw.status === 'ativa' || raw.status === 'inativa' || raw.status === 'encerrada'
      ? raw.status
      : 'inativa';

  const customCategories: PromoCustomCategory[] = Array.isArray(raw.customCategories)
    ? raw.customCategories
        .filter((c: any) => c && c.id && typeof c.label === 'string' && c.label.trim())
        .map((c: any, idx: number) => ({
          id: String(c.id).trim(),
          label: String(c.label).trim(),
          pricingType: c.pricingType === 'sqm' ? 'sqm' : 'simple',
          order: Number(c.order ?? idx),
        }))
        .sort((a: PromoCustomCategory, b: PromoCustomCategory) => a.order - b.order)
    : [];

  const normalizeTQ = (tq: any): PromoTierQuantities => ({
    rodapes:
      Array.isArray(tq?.rodapes) && tq.rodapes.length === 3
        ? [
            Math.max(1, Math.floor(Number(tq.rodapes[0]) || 30)),
            Math.max(1, Math.floor(Number(tq.rodapes[1]) || 50)),
            Math.max(1, Math.floor(Number(tq.rodapes[2]) || 100)),
          ]
        : [30, 50, 100],
    ripados:
      Array.isArray(tq?.ripados) && tq.ripados.length === 3
        ? [
            Math.max(1, Math.floor(Number(tq.ripados[0]) || 30)),
            Math.max(1, Math.floor(Number(tq.ripados[1]) || 50)),
            Math.max(1, Math.floor(Number(tq.ripados[2]) || 100)),
          ]
        : [30, 50, 100],
  });

  const rawTQs = raw.tierQuantitiesByModality || {};
  const tierQuantitiesByModality: Record<PromoModality, PromoTierQuantities> = {
    cliente_final: normalizeTQ(rawTQs.cliente_final),
    construtora: normalizeTQ(rawTQs.construtora),
    revenda: normalizeTQ(rawTQs.revenda),
  };

  let categories: PromoCategoryConfig[];
  if (Array.isArray(raw.categories)) {
    categories = raw.categories
      .filter((c: any) => c && c.id && typeof c.label === 'string' && c.label.trim())
      .map((c: any, idx: number) => {
        const pricingType: PromoCategoryPricingType =
          c.pricingType === 'escalonado' ? 'escalonado' : 'unitario';
        const defaultRanges =
          pricingType === 'escalonado'
            ? normalizeDefaultRanges(c.defaultRanges) || [
                { id: 'rng_1', minQty: 30, maxQty: null },
                { id: 'rng_2', minQty: 50, maxQty: null },
                { id: 'rng_3', minQty: 100, maxQty: null },
              ]
            : undefined;
        return {
          id: String(c.id).trim(),
          label: String(c.label).trim(),
          unit: normalizePromoCategoryUnit(c.unit, 'unidade'),
          pricingType,
          ...(defaultRanges ? { defaultRanges } : {}),
          order: Number(c.order ?? idx),
        };
      })
      .sort((a: PromoCategoryConfig, b: PromoCategoryConfig) => a.order - b.order);
  } else {
    const baseDefaults = createDefaultPromoCategories().map((cat) => {
      if (cat.id === 'rodapes') {
        return {
          ...cat,
          defaultRanges: buildDefaultRangesFromTuple(tierQuantitiesByModality.revenda.rodapes),
        };
      }
      if (cat.id === 'ripados') {
        return {
          ...cat,
          defaultRanges: buildDefaultRangesFromTuple(tierQuantitiesByModality.revenda.ripados),
        };
      }
      return cat;
    });
    const migratedCustom: PromoCategoryConfig[] = customCategories.map((c, idx) => ({
      id: c.id,
      label: c.label,
      unit: c.pricingType === 'sqm' ? 'm²' : 'unidade',
      pricingType: 'unitario',
      order: baseDefaults.length + idx,
    }));
    categories = [...baseDefaults, ...migratedCustom];
  }

  const subcategories: PromoSubcategory[] = Array.isArray(raw.subcategories)
    ? raw.subcategories
        .filter((s: any) => s && typeof s.name === 'string' && s.name.trim())
        .map((s: any, idx: number) => ({
          id: String(s.id || `sub_${idx}`),
          category: String(s.category || '').trim() || 'piso_vinilico',
          name: String(s.name).trim(),
          order: Number(s.order ?? idx),
        }))
    : [];

  const lotSales: PromoLotSale[] = Array.isArray(raw.lotSales)
    ? raw.lotSales
        .filter((s: any) => s && s.id && s.lotId)
        .map((s: any) => ({
          id: String(s.id),
          saleToken: String(s.saleToken || s.id),
          lotId: String(s.lotId),
          lotDescription: String(s.lotDescription || ''),
          modality:
            s.modality === 'construtora' || s.modality === 'revenda' ? s.modality : 'cliente_final',
          boxesSold: Math.max(0, Math.floor(Number(s.boxesSold) || 0)),
          sqmSold: Math.max(0, Number(s.sqmSold) || 0),
          unitPriceSqm: s.unitPriceSqm !== undefined ? Number(s.unitPriceSqm) : undefined,
          totalValue: s.totalValue !== undefined ? Number(s.totalValue) : undefined,
          customerName: s.customerName ? String(s.customerName) : '',
          orderNumber: s.orderNumber ? String(s.orderNumber) : '',
          notes: s.notes ? String(s.notes) : '',
          soldBy: String(s.soldBy || 'Vanessa Gomes'),
          soldAt: String(s.soldAt || new Date().toISOString()),
        }))
    : [];

  const lotGroups: PromoLotGroup[] | undefined = Array.isArray(raw.lotGroups)
    ? raw.lotGroups
        .filter((g: any) => g && g.id && typeof g.name === 'string' && g.name.trim())
        .map((g: any, idx: number) => ({
          id: String(g.id),
          name: String(g.name).trim(),
          order: Number(g.order ?? idx),
          createdAt: g.createdAt ? String(g.createdAt) : undefined,
          updatedAt: g.updatedAt ? String(g.updatedAt) : undefined,
        }))
        .sort((a: PromoLotGroup, b: PromoLotGroup) => a.order - b.order)
    : undefined;

  const lots: PromoFloorLot[] = Array.isArray(raw.lots)
    ? raw.lots
        .filter((l: any) => l && l.id)
        .map((l: any) => {
          const initialBoxes = Math.max(0, Math.floor(Number(l.initialBoxes) || 0));
          const hasExplicitSoldBoxes =
            l.soldBoxes !== undefined && l.soldBoxes !== null && !Number.isNaN(Number(l.soldBoxes));
          const salesForLot = lotSales
            .filter((s) => s.lotId === String(l.id))
            .reduce((sum, s) => sum + s.boxesSold, 0);
          const rawSold = hasExplicitSoldBoxes ? Math.floor(Number(l.soldBoxes) || 0) : salesForLot;
          const soldBoxes = Math.min(initialBoxes, Math.max(0, rawSold));
          return {
            id: String(l.id),
            lotGroupId: l.lotGroupId ? String(l.lotGroupId) : undefined,
            crmProductId: l.crmProductId ? String(l.crmProductId) : undefined,
            description: String(l.description || 'Piso Vinílico'),
            pattern: l.pattern ? String(l.pattern) : '',
            thickness: l.thickness ? String(l.thickness) : '',
            subcategoryId: l.subcategoryId ? String(l.subcategoryId) : undefined,
            sqmPerBox: Math.max(0, Number(l.sqmPerBox) || 0),
            initialBoxes,
            soldBoxes,
            active: l.active !== false,
            createdAt: String(l.createdAt || new Date().toISOString()),
            updatedAt: String(l.updatedAt || new Date().toISOString()),
          };
        })
    : [];

  const normalizeOffersList = (arr: any): PromoOfferItem[] => {
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((o: any) => o && o.id)
      .map((o: any, idx: number) => {
        // Preserva o ID exato da categoria (incluindo 'sem_categoria' e categorias personalizadas/preservadas)
        const rawCat = String(o.category || '').trim();
        const category: PromoCategory = rawCat || SEM_CATEGORIA_ID;
        const rawTiers: PromoProgressiveTier[] | undefined = Array.isArray(o.tiers)
          ? o.tiers
              .filter((t: any) => t && Number.isFinite(Number(t?.minQty)))
              .map((t: any, tIdx: number) => ({
                id: t?.id ? String(t.id) : `tier_${idx}_${tIdx}`,
                minQty: Math.max(1, Math.floor(Number(t.minQty) || 1)),
                maxQty: null,
                label: t?.label ? String(t.label) : undefined,
                price: Math.max(0, Number(t?.price) || 0),
              }))
          : undefined;

        const minOneTier = rawTiers?.find((t) => t.minQty <= 1 && t.price > 0);
        const explicitNormal =
          o.priceNormal !== undefined ? Math.max(0, Number(o.priceNormal) || 0) : undefined;
        const resolvedPriceNormal =
          explicitNormal !== undefined && explicitNormal > 0
            ? explicitNormal
            : minOneTier
            ? minOneTier.price
            : explicitNormal;

        const seenMinQty = new Set<number>();
        const tiers: PromoProgressiveTier[] | undefined = rawTiers
          ? rawTiers
              .filter((t) => {
                if (t.minQty < 2 || seenMinQty.has(t.minQty)) return false;
                seenMinQty.add(t.minQty);
                return true;
              })
              .sort((a, b) => a.minQty - b.minQty)
          : undefined;

        return {
          id: String(o.id),
          category,
          subcategoryId: o.subcategoryId ? String(o.subcategoryId) : undefined,
          crmProductId: o.crmProductId ? String(o.crmProductId) : undefined,
          lotId: o.lotId ? String(o.lotId) : undefined,
          description: String(o.description || ''),
          specs: o.specs ? String(o.specs) : undefined,
          active: o.active !== false,
          order: Number(o.order ?? idx),
          priceSqm: o.priceSqm !== undefined ? Math.max(0, Number(o.priceSqm) || 0) : undefined,
          priceNormal: resolvedPriceNormal,
          tiers,
          price: o.price !== undefined ? Math.max(0, Number(o.price) || 0) : undefined,
        };
      });
  };

  const rawOffers = raw.offersByModality || {};
  const offersByModality: Record<PromoModality, PromoOfferItem[]> = {
    cliente_final: normalizeOffersList(rawOffers.cliente_final),
    construtora: normalizeOffersList(rawOffers.construtora),
    revenda: normalizeOffersList(rawOffers.revenda),
  };

  const rawCond = raw.conditionsByModality || {};
  const conditionsByModality: Record<PromoModality, string> = {
    cliente_final: typeof rawCond.cliente_final === 'string' ? rawCond.cliente_final : '',
    construtora: typeof rawCond.construtora === 'string' ? rawCond.construtora : '',
    revenda: typeof rawCond.revenda === 'string' ? rawCond.revenda : '',
  };

  const rawSheet = raw.sheetSettings || {};
  const sheetModel: PromoSheetModel =
    rawSheet.model === 'pb_economico' || rawSheet.model === 'compacto_a4'
      ? rawSheet.model
      : 'oficial_colorido';
  const rawIncluded = rawSheet.includedCategories || {};

  const hasAssignedPisoSubcategories =
    subcategories.some((s) => s.category === 'piso_vinilico') &&
    (lots.some((l) => Boolean(l.subcategoryId)) ||
      offersByModality.cliente_final.some(
        (o) => o.category === 'piso_vinilico' && Boolean(o.subcategoryId)
      ) ||
      offersByModality.construtora.some(
        (o) => o.category === 'piso_vinilico' && Boolean(o.subcategoryId)
      ) ||
      offersByModality.revenda.some(
        (o) => o.category === 'piso_vinilico' && Boolean(o.subcategoryId)
      ));

  const subcategoriesToggledByUser =
    rawSheet.subcategoriesToggledByUser !== undefined
      ? Boolean(rawSheet.subcategoriesToggledByUser)
      : undefined;

  const resolvedShowSubcategories =
    subcategoriesToggledByUser === true
      ? Boolean(
          rawSheet.showSubcategories !== undefined
            ? rawSheet.showSubcategories
            : raw.showSubcategoriesOnSheet
        )
      : rawSheet.showSubcategories === true || Boolean(raw.showSubcategoriesOnSheet)
      ? true
      : hasAssignedPisoSubcategories ||
        (rawSheet.showSubcategories === undefined && raw.showSubcategoriesOnSheet === undefined);

  const dynamicIncluded: Record<string, boolean> = {};
  categories.forEach((c) => {
    dynamicIncluded[c.id] = rawIncluded[c.id] !== false;
  });

  const sheetSettings: PromoSheetSettings = {
    model: sheetModel,
    includedCategories: {
      ...rawIncluded,
      ...dynamicIncluded,
      [SEM_CATEGORIA_ID]: rawIncluded[SEM_CATEGORIA_ID] === true,
    },
    showModalityLabel: Boolean(rawSheet.showModalityLabel),
    showSubcategories: resolvedShowSubcategories,
    subcategoriesToggledByUser,
    density: rawSheet.density === 'compacto' ? 'compacto' : 'padrao',
  };

  return {
    id,
    name: String(raw.name || 'Campanha Promocional'),
    badgeTopText: raw.badgeTopText ? String(raw.badgeTopText) : undefined,
    badgeBottomText: raw.badgeBottomText ? String(raw.badgeBottomText) : undefined,
    status,
    startDate: String(raw.startDate || getTodayIsoDate()),
    endDate: String(raw.endDate || getTodayIsoDate()),
    validityText: raw.validityText ? String(raw.validityText) : undefined,
    paymentConditionText: raw.paymentConditionText ? String(raw.paymentConditionText) : undefined,
    showSubcategoriesOnSheet: sheetSettings.showSubcategories,
    sheetSettings,
    conditionsByModality,
    tierQuantitiesByModality,
    categories,
    ...(customCategories.length > 0 ? { customCategories } : {}),
    subcategories,
    ...(lotGroups !== undefined ? { lotGroups } : {}),
    lots,
    lotSales,
    offersByModality,
    createdBy: String(raw.createdBy || 'Vanessa Gomes'),
    createdAt: String(raw.createdAt || new Date().toISOString()),
    updatedAt: String(raw.updatedAt || raw.createdAt || new Date().toISOString()),
    updatedBy: String(raw.updatedBy || raw.createdBy || 'Vanessa Gomes'),
    version: Math.max(1, Number(raw.version) || 1),
  };
}

export function parsePromocoesPayload(payload: unknown): PromoCampaign[] {
  let data = payload;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(data)) return [];

  const seen = new Set<string>();
  const list: PromoCampaign[] = [];
  for (const item of data) {
    const normalized = normalizeCampaign(item);
    if (normalized && !seen.has(normalized.id)) {
      seen.add(normalized.id);
      list.push(normalized);
    }
  }

  return list.sort((a, b) => {
    const rank = (s: PromoCampaignStatus) => (s === 'ativa' ? 0 : s === 'inativa' ? 1 : 2);
    const diff = rank(a.status) - rank(b.status);
    if (diff !== 0) return diff;
    return (b.updatedAt || '').localeCompare(a.updatedAt || '');
  });
}

function readCachedPromocoes(): PromoCampaign[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(PROMOCOES_CACHE_KEY);
    if (!raw) return [];
    return parsePromocoesPayload(raw);
  } catch {
    return [];
  }
}

function writeCachedPromocoes(campaigns: PromoCampaign[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(PROMOCOES_CACHE_KEY, JSON.stringify(campaigns));
  } catch {
    // ignore
  }
}

export async function fetchPromocoesFromSupabase(): Promise<{
  success: boolean;
  campaigns: PromoCampaign[];
  fromCache?: boolean;
  error?: string;
}> {
  const client = getSupabaseClient();
  if (!client) {
    return {
      success: false,
      campaigns: readCachedPromocoes(),
      fromCache: true,
      error: 'Conexão com o Supabase indisponível no momento.',
    };
  }

  try {
    const res = await withTimeout(
      client
        .from('fenix_kv_store')
        .select('data, updated_at')
        .eq('key', PROMOCOES_SUPABASE_KEY)
        .maybeSingle(),
      5000,
      { data: null, error: new Error('Tempo limite excedido ao carregar promoções.') } as any
    );

    if (res?.error) {
      return {
        success: false,
        campaigns: readCachedPromocoes(),
        fromCache: true,
        error: res.error.message || 'Erro ao buscar promoções no Supabase.',
      };
    }

    if (!res?.data || res.data.data === undefined || res.data.data === null) {
      writeCachedPromocoes([]);
      return { success: true, campaigns: [] };
    }

    const parsed = parsePromocoesPayload(res.data.data);
    writeCachedPromocoes(parsed);
    return { success: true, campaigns: parsed };
  } catch (err: any) {
    return {
      success: false,
      campaigns: readCachedPromocoes(),
      fromCache: true,
      error: err?.message || 'Falha ao consultar promoções no Supabase.',
    };
  }
}

export async function saveCampaignToSupabase(
  campaign: PromoCampaign,
  currentUser: string
): Promise<{
  success: boolean;
  campaigns: PromoCampaign[];
  savedCampaign?: PromoCampaign;
  error?: string;
}> {
  const client = getSupabaseClient();
  if (!client) {
    return {
      success: false,
      campaigns: readCachedPromocoes(),
      error: 'Sem conexão com o Supabase para salvar. Verifique sua internet.',
    };
  }

  try {
    const { data: remoteRow, error: fetchErr } = await client
      .from('fenix_kv_store')
      .select('data')
      .eq('key', PROMOCOES_SUPABASE_KEY)
      .maybeSingle();

    if (fetchErr) {
      return {
        success: false,
        campaigns: readCachedPromocoes(),
        error: fetchErr.message || 'Erro ao consultar campanhas no Supabase.',
      };
    }

    const remoteCampaigns = remoteRow?.data ? parsePromocoesPayload(remoteRow.data) : [];
    const existing = remoteCampaigns.find((c) => c.id === campaign.id);
    const nowIso = new Date().toISOString();

    // Preservar baixas remotas apenas quando o lote local não foi modificado mais recentemente
    let mergedLotSales = [...campaign.lotSales];
    let mergedLots = [...campaign.lots];
    if (existing) {
      const salesById = new Map<string, PromoLotSale>();
      existing.lotSales.forEach((s) => salesById.set(s.id, s));
      campaign.lotSales.forEach((s) => salesById.set(s.id, s));
      mergedLotSales = Array.from(salesById.values()).sort((a, b) =>
        (b.soldAt || '').localeCompare(a.soldAt || '')
      );

      mergedLots = campaign.lots.map((lot) => {
        const remoteLot = existing.lots.find((rl) => rl.id === lot.id);
        const localIsNewer =
          !remoteLot || (lot.updatedAt || '') > (remoteLot.updatedAt || '');
        const chosenSold = localIsNewer ? lot.soldBoxes : remoteLot.soldBoxes;
        return {
          ...lot,
          soldBoxes: Math.min(lot.initialBoxes, Math.max(0, Math.floor(Number(chosenSold) || 0))),
        };
      });
    }

    const savedCampaign: PromoCampaign = {
      ...campaign,
      lots: mergedLots,
      lotSales: mergedLotSales,
      createdBy: existing?.createdBy || campaign.createdBy || currentUser || 'Vanessa Gomes',
      createdAt: existing?.createdAt || campaign.createdAt || nowIso,
      updatedAt: nowIso,
      updatedBy: currentUser || 'Vanessa Gomes',
      version: (existing?.version || campaign.version || 0) + 1,
    };

    const updatedList = parsePromocoesPayload(
      existing
        ? remoteCampaigns.map((c) => (c.id === savedCampaign.id ? savedCampaign : c))
        : [savedCampaign, ...remoteCampaigns]
    );

    recordSelfSave(PROMOCOES_SUPABASE_KEY, nowIso);

    const { error: upsertErr } = await client.from('fenix_kv_store').upsert(
      {
        key: PROMOCOES_SUPABASE_KEY,
        data: updatedList,
        updated_at: nowIso,
        updated_by: currentUser || 'Vanessa Gomes',
      },
      { onConflict: 'key' }
    );

    if (upsertErr) {
      return {
        success: false,
        campaigns: remoteCampaigns,
        error: upsertErr.message || 'Erro ao salvar campanha no Supabase.',
      };
    }

    writeCachedPromocoes(updatedList);
    return {
      success: true,
      campaigns: updatedList,
      savedCampaign,
    };
  } catch (err: any) {
    return {
      success: false,
      campaigns: readCachedPromocoes(),
      error: err?.message || 'Erro inesperado ao salvar campanha.',
    };
  }
}

export async function duplicateCampaignInSupabase(
  campaignId: string,
  currentUser: string
): Promise<{
  success: boolean;
  campaigns: PromoCampaign[];
  duplicatedCampaign?: PromoCampaign;
  error?: string;
}> {
  const fetchRes = await fetchPromocoesFromSupabase();
  if (!fetchRes.success) {
    return { success: false, campaigns: fetchRes.campaigns, error: fetchRes.error };
  }

  const source = fetchRes.campaigns.find((c) => c.id === campaignId);
  if (!source) {
    return { success: false, campaigns: fetchRes.campaigns, error: 'Campanha não encontrada.' };
  }

  const nowIso = new Date().toISOString();
  const suffix = Date.now().toString(36);
  const subMap = new Map<string, string>();
  const newSubs: PromoSubcategory[] = source.subcategories.map((s, idx) => {
    const newId = `sub_${suffix}_${idx}`;
    subMap.set(s.id, newId);
    return { ...s, id: newId };
  });

  const groupMap = new Map<string, string>();
  const newLotGroups: PromoLotGroup[] | undefined = Array.isArray(source.lotGroups)
    ? source.lotGroups.map((g, idx) => {
        const newId = `grp_${suffix}_${idx}`;
        groupMap.set(g.id, newId);
        return {
          ...g,
          id: newId,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
      })
    : undefined;

  const lotMap = new Map<string, string>();
  const newLots: PromoFloorLot[] = source.lots.map((l, idx) => {
    const newId = `lot_${suffix}_${idx}`;
    lotMap.set(l.id, newId);
    return {
      ...l,
      id: newId,
      lotGroupId: l.lotGroupId ? groupMap.get(l.lotGroupId) || l.lotGroupId : undefined,
      subcategoryId: l.subcategoryId ? subMap.get(l.subcategoryId) || l.subcategoryId : undefined,
      soldBoxes: 0, // Nova campanha inicia com estoque limpo para o lote
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  });

  const cloneOffers = (items: PromoOfferItem[], mod: string): PromoOfferItem[] =>
    items.map((o, idx) => ({
      ...o,
      id: `off_${mod}_${suffix}_${idx}`,
      subcategoryId: o.subcategoryId ? subMap.get(o.subcategoryId) || o.subcategoryId : undefined,
      lotId: o.lotId ? lotMap.get(o.lotId) || o.lotId : undefined,
      tiers: o.tiers ? o.tiers.map((t) => ({ ...t })) : undefined,
    }));

  const clonedCategories: PromoCategoryConfig[] = getCampaignCategories(source).map((c) => ({
    ...c,
    defaultRanges: c.defaultRanges ? c.defaultRanges.map((r) => ({ ...r })) : undefined,
  }));

  const cloned: PromoCampaign = {
    ...source,
    id: `camp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: `${source.name} (Cópia)`,
    status: 'inativa',
    categories: clonedCategories,
    ...(source.customCategories ? { customCategories: source.customCategories.map((c) => ({ ...c })) } : {}),
    subcategories: newSubs,
    ...(newLotGroups !== undefined ? { lotGroups: newLotGroups } : {}),
    lots: newLots,
    lotSales: [],
    conditionsByModality: { ...source.conditionsByModality },
    tierQuantitiesByModality: {
      cliente_final: {
        rodapes: [...source.tierQuantitiesByModality.cliente_final.rodapes] as [number, number, number],
        ripados: [...source.tierQuantitiesByModality.cliente_final.ripados] as [number, number, number],
      },
      construtora: {
        rodapes: [...source.tierQuantitiesByModality.construtora.rodapes] as [number, number, number],
        ripados: [...source.tierQuantitiesByModality.construtora.ripados] as [number, number, number],
      },
      revenda: {
        rodapes: [...source.tierQuantitiesByModality.revenda.rodapes] as [number, number, number],
        ripados: [...source.tierQuantitiesByModality.revenda.ripados] as [number, number, number],
      },
    },
    offersByModality: {
      cliente_final: cloneOffers(source.offersByModality.cliente_final, 'cf'),
      construtora: cloneOffers(source.offersByModality.construtora, 'co'),
      revenda: cloneOffers(source.offersByModality.revenda, 'rv'),
    },
    createdBy: currentUser || 'Vanessa Gomes',
    createdAt: nowIso,
    updatedAt: nowIso,
    updatedBy: currentUser || 'Vanessa Gomes',
    version: 1,
  };

  const saveRes = await saveCampaignToSupabase(cloned, currentUser);
  return {
    success: saveRes.success,
    campaigns: saveRes.campaigns,
    duplicatedCampaign: saveRes.savedCampaign,
    error: saveRes.error,
  };
}

export async function deleteCampaignFromSupabase(
  campaignId: string,
  currentUser: string
): Promise<{
  success: boolean;
  campaigns: PromoCampaign[];
  error?: string;
}> {
  const client = getSupabaseClient();
  if (!client) {
    return {
      success: false,
      campaigns: readCachedPromocoes(),
      error: 'Sem conexão com o Supabase para excluir.',
    };
  }

  try {
    const { data: remoteRow, error: fetchErr } = await client
      .from('fenix_kv_store')
      .select('data')
      .eq('key', PROMOCOES_SUPABASE_KEY)
      .maybeSingle();

    if (fetchErr) {
      return {
        success: false,
        campaigns: readCachedPromocoes(),
        error: fetchErr.message || 'Erro ao consultar campanhas no Supabase.',
      };
    }

    const remoteCampaigns = remoteRow?.data ? parsePromocoesPayload(remoteRow.data) : [];
    const updatedList = remoteCampaigns.filter((c) => c.id !== campaignId);
    const nowIso = new Date().toISOString();

    recordSelfSave(PROMOCOES_SUPABASE_KEY, nowIso);

    const { error: upsertErr } = await client.from('fenix_kv_store').upsert(
      {
        key: PROMOCOES_SUPABASE_KEY,
        data: updatedList,
        updated_at: nowIso,
        updated_by: currentUser || 'Vanessa Gomes',
      },
      { onConflict: 'key' }
    );

    if (upsertErr) {
      return {
        success: false,
        campaigns: remoteCampaigns,
        error: upsertErr.message || 'Erro ao excluir campanha no Supabase.',
      };
    }

    writeCachedPromocoes(updatedList);
    return {
      success: true,
      campaigns: updatedList,
    };
  } catch (err: any) {
    return {
      success: false,
      campaigns: readCachedPromocoes(),
      error: err?.message || 'Erro inesperado ao excluir campanha.',
    };
  }
}

/**
 * Registra venda parcial ou total de um lote de piso vinílico com:
 * 1. Leitura do estado oficial mais recente no Supabase.
 * 2. Verificação de idempotência (saleToken) para evitar vendas duplicadas.
 * 3. Proteção estrita contra saldo negativo.
 */
export async function recordLotSaleInSupabase(params: {
  campaignId: string;
  lotId: string;
  modality: PromoModality;
  boxesSold: number;
  customerName?: string;
  orderNumber?: string;
  unitPriceSqm?: number;
  notes?: string;
  soldBy: string;
  saleToken: string;
}): Promise<{
  success: boolean;
  campaigns: PromoCampaign[];
  updatedCampaign?: PromoCampaign;
  error?: string;
}> {
  const client = getSupabaseClient();
  if (!client) {
    return {
      success: false,
      campaigns: readCachedPromocoes(),
      error: 'Conexão com o Supabase indisponível. Não é possível dar baixa no lote offline.',
    };
  }

  const boxes = Math.floor(Number(params.boxesSold) || 0);
  if (boxes <= 0) {
    return {
      success: false,
      campaigns: readCachedPromocoes(),
      error: 'Informe uma quantidade válida de caixas maior que zero.',
    };
  }

  try {
    const { data: remoteRow, error: fetchErr } = await client
      .from('fenix_kv_store')
      .select('data')
      .eq('key', PROMOCOES_SUPABASE_KEY)
      .maybeSingle();

    if (fetchErr) {
      return {
        success: false,
        campaigns: readCachedPromocoes(),
        error: fetchErr.message || 'Erro ao validar estoque no Supabase.',
      };
    }

    const remoteCampaigns = remoteRow?.data ? parsePromocoesPayload(remoteRow.data) : [];
    const targetCampaign = remoteCampaigns.find((c) => c.id === params.campaignId);
    if (!targetCampaign) {
      return {
        success: false,
        campaigns: remoteCampaigns,
        error: 'Campanha não encontrada no banco de dados.',
      };
    }

    // Prevenção de venda duplicada pelo token único da operação
    if (targetCampaign.lotSales.some((s) => s.saleToken === params.saleToken)) {
      return {
        success: true,
        campaigns: remoteCampaigns,
        updatedCampaign: targetCampaign,
      };
    }

    const targetLot = targetCampaign.lots.find((l) => l.id === params.lotId);
    if (!targetLot) {
      return {
        success: false,
        campaigns: remoteCampaigns,
        error: 'Lote de piso não encontrado.',
      };
    }

    const metrics = computeLotMetrics(targetLot);
    if (boxes > metrics.availableBoxes) {
      return {
        success: false,
        campaigns: remoteCampaigns,
        error: `Saldo insuficiente! Restam apenas ${metrics.availableBoxes} caixa(s) disponíveis neste lote.`,
      };
    }

    const nowIso = new Date().toISOString();
    const sqmSold = Math.round(boxes * targetLot.sqmPerBox * 100) / 100;
    const unitPrice =
      params.unitPriceSqm !== undefined && Number(params.unitPriceSqm) > 0
        ? Number(params.unitPriceSqm)
        : undefined;
    const totalValue =
      unitPrice !== undefined ? Math.round(sqmSold * unitPrice * 100) / 100 : undefined;

    const newSale: PromoLotSale = {
      id: `sale_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      saleToken: params.saleToken,
      lotId: targetLot.id,
      lotDescription: targetLot.description,
      modality: params.modality,
      boxesSold: boxes,
      sqmSold,
      unitPriceSqm: unitPrice,
      totalValue,
      customerName: params.customerName?.trim() || '',
      orderNumber: params.orderNumber?.trim() || '',
      notes: params.notes?.trim() || '',
      soldBy: params.soldBy || 'Vanessa Gomes',
      soldAt: nowIso,
    };

    const updatedLots = targetCampaign.lots.map((l) =>
      l.id === targetLot.id
        ? {
            ...l,
            soldBoxes: Math.min(l.initialBoxes, l.soldBoxes + boxes),
            updatedAt: nowIso,
          }
        : l
    );

    const updatedCampaign: PromoCampaign = {
      ...targetCampaign,
      lots: updatedLots,
      lotSales: [newSale, ...targetCampaign.lotSales],
      updatedAt: nowIso,
      updatedBy: params.soldBy || 'Vanessa Gomes',
      version: (targetCampaign.version || 1) + 1,
    };

    const updatedList = parsePromocoesPayload(
      remoteCampaigns.map((c) => (c.id === updatedCampaign.id ? updatedCampaign : c))
    );

    recordSelfSave(PROMOCOES_SUPABASE_KEY, nowIso);

    const { error: upsertErr } = await client.from('fenix_kv_store').upsert(
      {
        key: PROMOCOES_SUPABASE_KEY,
        data: updatedList,
        updated_at: nowIso,
        updated_by: params.soldBy || 'Vanessa Gomes',
      },
      { onConflict: 'key' }
    );

    if (upsertErr) {
      return {
        success: false,
        campaigns: remoteCampaigns,
        error: upsertErr.message || 'Erro ao registrar baixa de estoque no Supabase.',
      };
    }

    writeCachedPromocoes(updatedList);
    return {
      success: true,
      campaigns: updatedList,
      updatedCampaign,
    };
  } catch (err: any) {
    return {
      success: false,
      campaigns: readCachedPromocoes(),
      error: err?.message || 'Erro inesperado ao registrar venda do lote.',
    };
  }
}

/**
 * Estorna uma venda do histórico administrativo, devolvendo as caixas ao lote de origem.
 */
export async function revertLotSaleInSupabase(params: {
  campaignId: string;
  saleId: string;
  revertedBy: string;
}): Promise<{
  success: boolean;
  campaigns: PromoCampaign[];
  updatedCampaign?: PromoCampaign;
  error?: string;
}> {
  const client = getSupabaseClient();
  if (!client) {
    return {
      success: false,
      campaigns: readCachedPromocoes(),
      error: 'Sem conexão com o Supabase para estornar a venda.',
    };
  }

  try {
    const { data: remoteRow, error: fetchErr } = await client
      .from('fenix_kv_store')
      .select('data')
      .eq('key', PROMOCOES_SUPABASE_KEY)
      .maybeSingle();

    if (fetchErr) {
      return {
        success: false,
        campaigns: readCachedPromocoes(),
        error: fetchErr.message || 'Erro ao consultar campanha no Supabase.',
      };
    }

    const remoteCampaigns = remoteRow?.data ? parsePromocoesPayload(remoteRow.data) : [];
    const targetCampaign = remoteCampaigns.find((c) => c.id === params.campaignId);
    if (!targetCampaign) {
      return { success: false, campaigns: remoteCampaigns, error: 'Campanha não encontrada.' };
    }

    const saleToRemove = targetCampaign.lotSales.find((s) => s.id === params.saleId);
    if (!saleToRemove) {
      return { success: false, campaigns: remoteCampaigns, error: 'Registro de venda não encontrado.' };
    }

    const nowIso = new Date().toISOString();
    const remainingSales = targetCampaign.lotSales.filter((s) => s.id !== params.saleId);

    const updatedLots = targetCampaign.lots.map((l) => {
      if (l.id !== saleToRemove.lotId) return l;
      const recalculatedSold = remainingSales
        .filter((s) => s.lotId === l.id)
        .reduce((sum, s) => sum + s.boxesSold, 0);
      const nextSold = Math.max(0, Math.min(l.initialBoxes, Math.min(l.soldBoxes - saleToRemove.boxesSold, recalculatedSold)));
      return {
        ...l,
        soldBoxes: Math.max(0, nextSold),
        updatedAt: nowIso,
      };
    });

    const updatedCampaign: PromoCampaign = {
      ...targetCampaign,
      lots: updatedLots,
      lotSales: remainingSales,
      updatedAt: nowIso,
      updatedBy: params.revertedBy || 'Vanessa Gomes',
      version: (targetCampaign.version || 1) + 1,
    };

    const updatedList = parsePromocoesPayload(
      remoteCampaigns.map((c) => (c.id === updatedCampaign.id ? updatedCampaign : c))
    );

    recordSelfSave(PROMOCOES_SUPABASE_KEY, nowIso);

    const { error: upsertErr } = await client.from('fenix_kv_store').upsert(
      {
        key: PROMOCOES_SUPABASE_KEY,
        data: updatedList,
        updated_at: nowIso,
        updated_by: params.revertedBy || 'Vanessa Gomes',
      },
      { onConflict: 'key' }
    );

    if (upsertErr) {
      return {
        success: false,
        campaigns: remoteCampaigns,
        error: upsertErr.message || 'Erro ao estornar venda no Supabase.',
      };
    }

    writeCachedPromocoes(updatedList);
    return {
      success: true,
      campaigns: updatedList,
      updatedCampaign,
    };
  } catch (err: any) {
    return {
      success: false,
      campaigns: readCachedPromocoes(),
      error: err?.message || 'Erro inesperado ao estornar venda.',
    };
  }
}

/**
 * Atualiza diretamente os dados de estoque de um lote de Piso Vinílico no Controle Administrativo
 * (quantidade inicial, vendida, m² por caixa e descrição), mantendo o estoque compartilhado entre modalidades.
 */
export async function updateLotStockInSupabase(params: {
  campaignId: string;
  lotId: string;
  description: string;
  sqmPerBox: number;
  initialBoxes: number;
  soldBoxes: number;
  lotGroupId?: string;
  updatedBy: string;
}): Promise<{
  success: boolean;
  campaigns: PromoCampaign[];
  updatedCampaign?: PromoCampaign;
  error?: string;
}> {
  const client = getSupabaseClient();
  if (!client) {
    return {
      success: false,
      campaigns: readCachedPromocoes(),
      error: 'Sem conexão com o Supabase para atualizar o lote.',
    };
  }

  const initialBoxes = Math.max(0, Math.floor(Number(params.initialBoxes) || 0));
  const soldBoxes = Math.max(0, Math.floor(Number(params.soldBoxes) || 0));
  const sqmPerBox = Math.max(0, Number(params.sqmPerBox) || 0);
  const description = params.description.trim();

  if (!description) {
    return { success: false, campaigns: readCachedPromocoes(), error: 'Informe a descrição do produto.' };
  }
  if (sqmPerBox <= 0) {
    return { success: false, campaigns: readCachedPromocoes(), error: 'Informe m² / Caixa maior que zero.' };
  }
  if (soldBoxes > initialBoxes) {
    return {
      success: false,
      campaigns: readCachedPromocoes(),
      error: `Quantidade vendida (${soldBoxes}) não pode ultrapassar a quantidade inicial (${initialBoxes}).`,
    };
  }

  try {
    const { data: remoteRow, error: fetchErr } = await client
      .from('fenix_kv_store')
      .select('data')
      .eq('key', PROMOCOES_SUPABASE_KEY)
      .maybeSingle();

    if (fetchErr) {
      return {
        success: false,
        campaigns: readCachedPromocoes(),
        error: fetchErr.message || 'Erro ao consultar lotes no Supabase.',
      };
    }

    const remoteCampaigns = remoteRow?.data ? parsePromocoesPayload(remoteRow.data) : [];
    const targetCampaign = remoteCampaigns.find((c) => c.id === params.campaignId);
    if (!targetCampaign) {
      return { success: false, campaigns: remoteCampaigns, error: 'Campanha não encontrada.' };
    }

    const targetLot = targetCampaign.lots.find((l) => l.id === params.lotId);
    if (!targetLot) {
      return { success: false, campaigns: remoteCampaigns, error: 'Produto não encontrado no lote.' };
    }

    const nowIso = new Date().toISOString();
    const updatedLots = targetCampaign.lots.map((l) =>
      l.id === targetLot.id
        ? {
            ...l,
            description,
            sqmPerBox,
            initialBoxes,
            soldBoxes,
            ...(params.lotGroupId !== undefined ? { lotGroupId: params.lotGroupId || undefined } : {}),
            updatedAt: nowIso,
          }
        : l
    );

    const nextOffers = { ...targetCampaign.offersByModality };
    if (description !== targetLot.description) {
      (['cliente_final', 'construtora', 'revenda'] as PromoModality[]).forEach((mod) => {
        nextOffers[mod] = (nextOffers[mod] || []).map((o) =>
          o.lotId === targetLot.id && o.description === targetLot.description
            ? { ...o, description }
            : o
        );
      });
    }

    const updatedCampaign: PromoCampaign = {
      ...targetCampaign,
      lots: updatedLots,
      offersByModality: nextOffers,
      updatedAt: nowIso,
      updatedBy: params.updatedBy || 'Vanessa Gomes',
      version: (targetCampaign.version || 1) + 1,
    };

    const updatedList = parsePromocoesPayload(
      remoteCampaigns.map((c) => (c.id === updatedCampaign.id ? updatedCampaign : c))
    );

    recordSelfSave(PROMOCOES_SUPABASE_KEY, nowIso);

    const { error: upsertErr } = await client.from('fenix_kv_store').upsert(
      {
        key: PROMOCOES_SUPABASE_KEY,
        data: updatedList,
        updated_at: nowIso,
        updated_by: params.updatedBy || 'Vanessa Gomes',
      },
      { onConflict: 'key' }
    );

    if (upsertErr) {
      return {
        success: false,
        campaigns: remoteCampaigns,
        error: upsertErr.message || 'Erro ao salvar estoque do lote no Supabase.',
      };
    }

    writeCachedPromocoes(updatedList);
    return {
      success: true,
      campaigns: updatedList,
      updatedCampaign,
    };
  } catch (err: any) {
    return {
      success: false,
      campaigns: readCachedPromocoes(),
      error: err?.message || 'Erro inesperado ao atualizar lote.',
    };
  }
}

/**
 * Cadastra um novo lote diretamente no Controle Administrativo da campanha no Supabase.
 */
export async function createLotInSupabase(params: {
  campaignId: string;
  description: string;
  sqmPerBox: number;
  initialBoxes: number;
  soldBoxes?: number;
  lotGroupId?: string;
  createdBy: string;
}): Promise<{
  success: boolean;
  campaigns: PromoCampaign[];
  updatedCampaign?: PromoCampaign;
  error?: string;
}> {
  const client = getSupabaseClient();
  if (!client) {
    return {
      success: false,
      campaigns: readCachedPromocoes(),
      error: 'Sem conexão com o Supabase para cadastrar o produto.',
    };
  }

  const description = params.description.trim();
  const sqmPerBox = Math.max(0, Number(params.sqmPerBox) || 0);
  const initialBoxes = Math.max(0, Math.floor(Number(params.initialBoxes) || 0));
  const soldBoxes = Math.max(0, Math.floor(Number(params.soldBoxes) || 0));

  if (!description) {
    return { success: false, campaigns: readCachedPromocoes(), error: 'Informe o nome do produto.' };
  }
  if (sqmPerBox <= 0) {
    return { success: false, campaigns: readCachedPromocoes(), error: 'Informe m² / Caixa maior que zero.' };
  }
  if (soldBoxes > initialBoxes) {
    return {
      success: false,
      campaigns: readCachedPromocoes(),
      error: `Quantidade vendida (${soldBoxes}) não pode ultrapassar a quantidade inicial (${initialBoxes}).`,
    };
  }

  try {
    const { data: remoteRow, error: fetchErr } = await client
      .from('fenix_kv_store')
      .select('data')
      .eq('key', PROMOCOES_SUPABASE_KEY)
      .maybeSingle();

    if (fetchErr) {
      return {
        success: false,
        campaigns: readCachedPromocoes(),
        error: fetchErr.message || 'Erro ao consultar campanha no Supabase.',
      };
    }

    const remoteCampaigns = remoteRow?.data ? parsePromocoesPayload(remoteRow.data) : [];
    const targetCampaign = remoteCampaigns.find((c) => c.id === params.campaignId);
    if (!targetCampaign) {
      return { success: false, campaigns: remoteCampaigns, error: 'Campanha não encontrada.' };
    }

    const nowIso = new Date().toISOString();
    const newLot: PromoFloorLot = {
      id: `lot_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      lotGroupId: params.lotGroupId || undefined,
      description,
      sqmPerBox,
      initialBoxes,
      soldBoxes,
      active: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const updatedCampaign: PromoCampaign = {
      ...targetCampaign,
      lots: [...targetCampaign.lots, newLot],
      updatedAt: nowIso,
      updatedBy: params.createdBy || 'Vanessa Gomes',
      version: (targetCampaign.version || 1) + 1,
    };

    const updatedList = parsePromocoesPayload(
      remoteCampaigns.map((c) => (c.id === updatedCampaign.id ? updatedCampaign : c))
    );

    recordSelfSave(PROMOCOES_SUPABASE_KEY, nowIso);

    const { error: upsertErr } = await client.from('fenix_kv_store').upsert(
      {
        key: PROMOCOES_SUPABASE_KEY,
        data: updatedList,
        updated_at: nowIso,
        updated_by: params.createdBy || 'Vanessa Gomes',
      },
      { onConflict: 'key' }
    );

    if (upsertErr) {
      return {
        success: false,
        campaigns: remoteCampaigns,
        error: upsertErr.message || 'Erro ao cadastrar lote no Supabase.',
      };
    }

    writeCachedPromocoes(updatedList);
    return {
      success: true,
      campaigns: updatedList,
      updatedCampaign,
    };
  } catch (err: any) {
    return {
      success: false,
      campaigns: readCachedPromocoes(),
      error: err?.message || 'Erro inesperado ao cadastrar lote.',
    };
  }
}

/**
 * Exclui um lote da tabela administrativa preservando integralmente o histórico de vendas (lotSales).
 */
export async function deleteLotInSupabase(params: {
  campaignId: string;
  lotId: string;
  deletedBy: string;
}): Promise<{
  success: boolean;
  campaigns: PromoCampaign[];
  updatedCampaign?: PromoCampaign;
  error?: string;
}> {
  const client = getSupabaseClient();
  if (!client) {
    return {
      success: false,
      campaigns: readCachedPromocoes(),
      error: 'Sem conexão com o Supabase para excluir o lote.',
    };
  }

  try {
    const { data: remoteRow, error: fetchErr } = await client
      .from('fenix_kv_store')
      .select('data')
      .eq('key', PROMOCOES_SUPABASE_KEY)
      .maybeSingle();

    if (fetchErr) {
      return {
        success: false,
        campaigns: readCachedPromocoes(),
        error: fetchErr.message || 'Erro ao consultar campanha no Supabase.',
      };
    }

    const remoteCampaigns = remoteRow?.data ? parsePromocoesPayload(remoteRow.data) : [];
    const targetCampaign = remoteCampaigns.find((c) => c.id === params.campaignId);
    if (!targetCampaign) {
      return { success: false, campaigns: remoteCampaigns, error: 'Campanha não encontrada.' };
    }

    const nowIso = new Date().toISOString();
    const remainingLots = targetCampaign.lots.filter((l) => l.id !== params.lotId);
    const nextOffers = { ...targetCampaign.offersByModality };
    (['cliente_final', 'construtora', 'revenda'] as PromoModality[]).forEach((mod) => {
      nextOffers[mod] = (nextOffers[mod] || []).map((o) =>
        o.lotId === params.lotId ? { ...o, lotId: undefined } : o
      );
    });

    // Preserva targetCampaign.lotSales integralmente para manter o histórico de vendas
    const updatedCampaign: PromoCampaign = {
      ...targetCampaign,
      lots: remainingLots,
      lotSales: [...(targetCampaign.lotSales || [])],
      offersByModality: nextOffers,
      updatedAt: nowIso,
      updatedBy: params.deletedBy || 'Vanessa Gomes',
      version: (targetCampaign.version || 1) + 1,
    };

    const updatedList = parsePromocoesPayload(
      remoteCampaigns.map((c) => (c.id === updatedCampaign.id ? updatedCampaign : c))
    );

    recordSelfSave(PROMOCOES_SUPABASE_KEY, nowIso);

    const { error: upsertErr } = await client.from('fenix_kv_store').upsert(
      {
        key: PROMOCOES_SUPABASE_KEY,
        data: updatedList,
        updated_at: nowIso,
        updated_by: params.deletedBy || 'Vanessa Gomes',
      },
      { onConflict: 'key' }
    );

    if (upsertErr) {
      return {
        success: false,
        campaigns: remoteCampaigns,
        error: upsertErr.message || 'Erro ao excluir lote no Supabase.',
      };
    }

    writeCachedPromocoes(updatedList);
    return {
      success: true,
      campaigns: updatedList,
      updatedCampaign,
    };
  } catch (err: any) {
    return {
      success: false,
      campaigns: readCachedPromocoes(),
      error: err?.message || 'Erro inesperado ao excluir lote.',
    };
  }
}

function normalizeLotText(str: string): string {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export function buildDefaultLotGroupsForCampaign(campaign: PromoCampaign): {
  lotGroups: PromoLotGroup[];
  lots: PromoFloorLot[];
} {
  const nowIso = new Date().toISOString();
  const lotGroups: PromoLotGroup[] = DEFAULT_ADMIN_LOT_GROUPS.map((g) => ({
    id: g.id,
    name: g.name,
    order: g.order,
    createdAt: nowIso,
    updatedAt: nowIso,
  }));

  const existingLots = [...(campaign.lots || [])];
  const matchedSeedNames = new Set<string>();

  const mappedLots: PromoFloorLot[] = existingLots.map((lot) => {
    if (lot.lotGroupId && lotGroups.some((g) => g.id === lot.lotGroupId)) {
      return lot;
    }
    const normDesc = normalizeLotText(lot.description);
    for (const grp of DEFAULT_ADMIN_LOT_GROUPS) {
      for (const prod of grp.products) {
        const normSeed = normalizeLotText(prod.name);
        if (normDesc === normSeed || normDesc.includes(normSeed)) {
          matchedSeedNames.add(prod.seedId);
          return { ...lot, lotGroupId: grp.id };
        }
      }
    }
    return lot;
  });

  for (const grp of DEFAULT_ADMIN_LOT_GROUPS) {
    for (const prod of grp.products) {
      if (matchedSeedNames.has(prod.seedId)) continue;
      const alreadyExists = mappedLots.some(
        (l) =>
          l.id === prod.seedId ||
          normalizeLotText(l.description) === normalizeLotText(prod.name) ||
          normalizeLotText(l.description).includes(normalizeLotText(prod.name))
      );
      if (!alreadyExists) {
        mappedLots.push({
          id: prod.seedId,
          lotGroupId: grp.id,
          description: prod.name,
          sqmPerBox: prod.defaultSqmPerBox,
          initialBoxes: 0,
          soldBoxes: 0,
          active: true,
          createdAt: nowIso,
          updatedAt: nowIso,
        });
      }
    }
  }

  return { lotGroups, lots: mappedLots };
}

/**
 * Inicializa os grupos padrão no Supabase de forma idempotente caso a campanha ainda não tenha lotGroups.
 * Nunca duplica lotes/produtos e preserva integralmente todos os registros existentes.
 */
export async function initializeLotGroupsInSupabase(params: {
  campaignId: string;
  updatedBy: string;
}): Promise<{
  success: boolean;
  campaigns: PromoCampaign[];
  updatedCampaign?: PromoCampaign;
  error?: string;
}> {
  const client = getSupabaseClient();
  if (!client) {
    return {
      success: false,
      campaigns: readCachedPromocoes(),
      error: 'Sem conexão com o Supabase.',
    };
  }

  try {
    const { data: remoteRow, error: fetchErr } = await client
      .from('fenix_kv_store')
      .select('data')
      .eq('key', PROMOCOES_SUPABASE_KEY)
      .maybeSingle();

    if (fetchErr) {
      return {
        success: false,
        campaigns: readCachedPromocoes(),
        error: fetchErr.message || 'Erro ao consultar campanha no Supabase.',
      };
    }

    const remoteCampaigns = remoteRow?.data ? parsePromocoesPayload(remoteRow.data) : [];
    const targetCampaign = remoteCampaigns.find((c) => c.id === params.campaignId);
    if (!targetCampaign) {
      return { success: false, campaigns: remoteCampaigns, error: 'Campanha não encontrada.' };
    }

    // Já inicializada anteriormente (mesmo que vazia): respeita exatamente o estado salvo no Supabase
    if (Array.isArray(targetCampaign.lotGroups)) {
      return {
        success: true,
        campaigns: remoteCampaigns,
        updatedCampaign: targetCampaign,
      };
    }

    const nowIso = new Date().toISOString();
    const { lotGroups, lots } = buildDefaultLotGroupsForCampaign(targetCampaign);
    const updatedCampaign: PromoCampaign = {
      ...targetCampaign,
      lotGroups,
      lots,
      updatedAt: nowIso,
      updatedBy: params.updatedBy || 'Vanessa Gomes',
      version: (targetCampaign.version || 1) + 1,
    };

    const updatedList = parsePromocoesPayload(
      remoteCampaigns.map((c) => (c.id === updatedCampaign.id ? updatedCampaign : c))
    );

    recordSelfSave(PROMOCOES_SUPABASE_KEY, nowIso);

    const { error: upsertErr } = await client.from('fenix_kv_store').upsert(
      {
        key: PROMOCOES_SUPABASE_KEY,
        data: updatedList,
        updated_at: nowIso,
        updated_by: params.updatedBy || 'Vanessa Gomes',
      },
      { onConflict: 'key' }
    );

    if (upsertErr) {
      return {
        success: false,
        campaigns: remoteCampaigns,
        error: upsertErr.message || 'Erro ao inicializar grupos no Supabase.',
      };
    }

    writeCachedPromocoes(updatedList);
    return {
      success: true,
      campaigns: updatedList,
      updatedCampaign,
    };
  } catch (err: any) {
    return {
      success: false,
      campaigns: readCachedPromocoes(),
      error: err?.message || 'Erro inesperado ao inicializar grupos.',
    };
  }
}

export async function createLotGroupInSupabase(params: {
  campaignId: string;
  name: string;
  createdBy: string;
}): Promise<{
  success: boolean;
  campaigns: PromoCampaign[];
  updatedCampaign?: PromoCampaign;
  createdGroup?: PromoLotGroup;
  error?: string;
}> {
  const client = getSupabaseClient();
  if (!client) {
    return {
      success: false,
      campaigns: readCachedPromocoes(),
      error: 'Sem conexão com o Supabase para criar o lote.',
    };
  }

  const name = params.name.trim();
  if (!name) {
    return { success: false, campaigns: readCachedPromocoes(), error: 'Informe o nome do lote.' };
  }

  try {
    const { data: remoteRow, error: fetchErr } = await client
      .from('fenix_kv_store')
      .select('data')
      .eq('key', PROMOCOES_SUPABASE_KEY)
      .maybeSingle();

    if (fetchErr) {
      return {
        success: false,
        campaigns: readCachedPromocoes(),
        error: fetchErr.message || 'Erro ao consultar campanha no Supabase.',
      };
    }

    const remoteCampaigns = remoteRow?.data ? parsePromocoesPayload(remoteRow.data) : [];
    const targetCampaign = remoteCampaigns.find((c) => c.id === params.campaignId);
    if (!targetCampaign) {
      return { success: false, campaigns: remoteCampaigns, error: 'Campanha não encontrada.' };
    }

    const baseOrg = Array.isArray(targetCampaign.lotGroups)
      ? { lotGroups: targetCampaign.lotGroups, lots: targetCampaign.lots }
      : buildDefaultLotGroupsForCampaign(targetCampaign);

    if (baseOrg.lotGroups.some((g) => normalizeLotText(g.name) === normalizeLotText(name))) {
      return {
        success: false,
        campaigns: remoteCampaigns,
        error: `Já existe um lote chamado "${name}".`,
      };
    }

    const nowIso = new Date().toISOString();
    const maxOrder = baseOrg.lotGroups.reduce((m, g) => Math.max(m, g.order), -1);
    const createdGroup: PromoLotGroup = {
      id: `grp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name,
      order: maxOrder + 1,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const updatedCampaign: PromoCampaign = {
      ...targetCampaign,
      lotGroups: [...baseOrg.lotGroups, createdGroup],
      lots: baseOrg.lots,
      updatedAt: nowIso,
      updatedBy: params.createdBy || 'Vanessa Gomes',
      version: (targetCampaign.version || 1) + 1,
    };

    const updatedList = parsePromocoesPayload(
      remoteCampaigns.map((c) => (c.id === updatedCampaign.id ? updatedCampaign : c))
    );

    recordSelfSave(PROMOCOES_SUPABASE_KEY, nowIso);

    const { error: upsertErr } = await client.from('fenix_kv_store').upsert(
      {
        key: PROMOCOES_SUPABASE_KEY,
        data: updatedList,
        updated_at: nowIso,
        updated_by: params.createdBy || 'Vanessa Gomes',
      },
      { onConflict: 'key' }
    );

    if (upsertErr) {
      return {
        success: false,
        campaigns: remoteCampaigns,
        error: upsertErr.message || 'Erro ao criar lote no Supabase.',
      };
    }

    writeCachedPromocoes(updatedList);
    return {
      success: true,
      campaigns: updatedList,
      updatedCampaign,
      createdGroup,
    };
  } catch (err: any) {
    return {
      success: false,
      campaigns: readCachedPromocoes(),
      error: err?.message || 'Erro inesperado ao criar lote.',
    };
  }
}

export async function updateLotGroupInSupabase(params: {
  campaignId: string;
  groupId: string;
  name: string;
  updatedBy: string;
}): Promise<{
  success: boolean;
  campaigns: PromoCampaign[];
  updatedCampaign?: PromoCampaign;
  error?: string;
}> {
  const client = getSupabaseClient();
  if (!client) {
    return {
      success: false,
      campaigns: readCachedPromocoes(),
      error: 'Sem conexão com o Supabase para atualizar o lote.',
    };
  }

  const name = params.name.trim();
  if (!name) {
    return { success: false, campaigns: readCachedPromocoes(), error: 'Informe o nome do lote.' };
  }

  try {
    const { data: remoteRow, error: fetchErr } = await client
      .from('fenix_kv_store')
      .select('data')
      .eq('key', PROMOCOES_SUPABASE_KEY)
      .maybeSingle();

    if (fetchErr) {
      return {
        success: false,
        campaigns: readCachedPromocoes(),
        error: fetchErr.message || 'Erro ao consultar campanha no Supabase.',
      };
    }

    const remoteCampaigns = remoteRow?.data ? parsePromocoesPayload(remoteRow.data) : [];
    const targetCampaign = remoteCampaigns.find((c) => c.id === params.campaignId);
    if (!targetCampaign) {
      return { success: false, campaigns: remoteCampaigns, error: 'Campanha não encontrada.' };
    }

    const currentGroups = Array.isArray(targetCampaign.lotGroups) ? targetCampaign.lotGroups : [];
    if (
      currentGroups.some(
        (g) => g.id !== params.groupId && normalizeLotText(g.name) === normalizeLotText(name)
      )
    ) {
      return {
        success: false,
        campaigns: remoteCampaigns,
        error: `Já existe um lote chamado "${name}".`,
      };
    }

    const nowIso = new Date().toISOString();
    const updatedGroups = currentGroups.map((g) =>
      g.id === params.groupId ? { ...g, name, updatedAt: nowIso } : g
    );

    const updatedCampaign: PromoCampaign = {
      ...targetCampaign,
      lotGroups: updatedGroups,
      updatedAt: nowIso,
      updatedBy: params.updatedBy || 'Vanessa Gomes',
      version: (targetCampaign.version || 1) + 1,
    };

    const updatedList = parsePromocoesPayload(
      remoteCampaigns.map((c) => (c.id === updatedCampaign.id ? updatedCampaign : c))
    );

    recordSelfSave(PROMOCOES_SUPABASE_KEY, nowIso);

    const { error: upsertErr } = await client.from('fenix_kv_store').upsert(
      {
        key: PROMOCOES_SUPABASE_KEY,
        data: updatedList,
        updated_at: nowIso,
        updated_by: params.updatedBy || 'Vanessa Gomes',
      },
      { onConflict: 'key' }
    );

    if (upsertErr) {
      return {
        success: false,
        campaigns: remoteCampaigns,
        error: upsertErr.message || 'Erro ao atualizar lote no Supabase.',
      };
    }

    writeCachedPromocoes(updatedList);
    return {
      success: true,
      campaigns: updatedList,
      updatedCampaign,
    };
  } catch (err: any) {
    return {
      success: false,
      campaigns: readCachedPromocoes(),
      error: err?.message || 'Erro inesperado ao atualizar lote.',
    };
  }
}

export async function deleteLotGroupInSupabase(params: {
  campaignId: string;
  groupId: string;
  deletedBy: string;
}): Promise<{
  success: boolean;
  campaigns: PromoCampaign[];
  updatedCampaign?: PromoCampaign;
  error?: string;
}> {
  const client = getSupabaseClient();
  if (!client) {
    return {
      success: false,
      campaigns: readCachedPromocoes(),
      error: 'Sem conexão com o Supabase para excluir o lote.',
    };
  }

  try {
    const { data: remoteRow, error: fetchErr } = await client
      .from('fenix_kv_store')
      .select('data')
      .eq('key', PROMOCOES_SUPABASE_KEY)
      .maybeSingle();

    if (fetchErr) {
      return {
        success: false,
        campaigns: readCachedPromocoes(),
        error: fetchErr.message || 'Erro ao consultar campanha no Supabase.',
      };
    }

    const remoteCampaigns = remoteRow?.data ? parsePromocoesPayload(remoteRow.data) : [];
    const targetCampaign = remoteCampaigns.find((c) => c.id === params.campaignId);
    if (!targetCampaign) {
      return { success: false, campaigns: remoteCampaigns, error: 'Campanha não encontrada.' };
    }

    const nowIso = new Date().toISOString();
    const removedLotIds = new Set(
      targetCampaign.lots.filter((l) => l.lotGroupId === params.groupId).map((l) => l.id)
    );
    const remainingGroups = (targetCampaign.lotGroups || []).filter((g) => g.id !== params.groupId);
    const remainingLots = targetCampaign.lots.filter((l) => l.lotGroupId !== params.groupId);

    const nextOffers = { ...targetCampaign.offersByModality };
    (['cliente_final', 'construtora', 'revenda'] as PromoModality[]).forEach((mod) => {
      nextOffers[mod] = (nextOffers[mod] || []).map((o) =>
        o.lotId && removedLotIds.has(o.lotId) ? { ...o, lotId: undefined } : o
      );
    });

    // Preserva targetCampaign.lotSales integralmente
    const updatedCampaign: PromoCampaign = {
      ...targetCampaign,
      lotGroups: remainingGroups,
      lots: remainingLots,
      lotSales: [...(targetCampaign.lotSales || [])],
      offersByModality: nextOffers,
      updatedAt: nowIso,
      updatedBy: params.deletedBy || 'Vanessa Gomes',
      version: (targetCampaign.version || 1) + 1,
    };

    const updatedList = parsePromocoesPayload(
      remoteCampaigns.map((c) => (c.id === updatedCampaign.id ? updatedCampaign : c))
    );

    recordSelfSave(PROMOCOES_SUPABASE_KEY, nowIso);

    const { error: upsertErr } = await client.from('fenix_kv_store').upsert(
      {
        key: PROMOCOES_SUPABASE_KEY,
        data: updatedList,
        updated_at: nowIso,
        updated_by: params.deletedBy || 'Vanessa Gomes',
      },
      { onConflict: 'key' }
    );

    if (upsertErr) {
      return {
        success: false,
        campaigns: remoteCampaigns,
        error: upsertErr.message || 'Erro ao excluir lote no Supabase.',
      };
    }

    writeCachedPromocoes(updatedList);
    return {
      success: true,
      campaigns: updatedList,
      updatedCampaign,
    };
  } catch (err: any) {
    return {
      success: false,
      campaigns: readCachedPromocoes(),
      error: err?.message || 'Erro inesperado ao excluir lote.',
    };
  }
}

/**
 * Carrega os produtos já cadastrados no CRM direto do Supabase (sem modificar o cadastro geral ou usar localStorage).
 */
export async function loadCrmProductsForPromocoes(): Promise<CatalogProduct[]> {
  try {
    const { catalog } = await withTimeout(
      fetchCatalogFromSupabase(true),
      4000,
      { catalog: getDynamicProductCatalog(), categories: [], groups: [] }
    );
    return catalog;
  } catch {
    return getDynamicProductCatalog();
  }
}

export function getCrmPriceForModality(prod: CatalogProduct, modality: PromoModality): number {
  if (modality === 'construtora') return getProductTierPrice(prod, 'Construtora');
  if (modality === 'revenda') return getProductTierPrice(prod, 'Revenda');
  return getProductTierPrice(prod, 'Cliente Final');
}
