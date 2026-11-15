import { getDynamicProductCatalog, CatalogProduct, getProductTierPrice } from '../data/productCatalog';
import { getSupabaseClient, recordSelfSave, withTimeout } from './supabaseClient';
import { isUserRevoked } from './auth';

export const PROMOCOES_SUPABASE_KEY = 'fenix_promocoes_ativas_db';
const PROMOCOES_CACHE_KEY = 'fenix_promocoes_ativas_cache_v1';

export type PromoModality = 'cliente_final' | 'construtora' | 'revenda';
export type PromoCategory = 'piso_vinilico' | 'rodapes' | 'ripados' | 'teto_vinilico' | 'outros';
export type PromoCampaignStatus = 'ativa' | 'inativa' | 'encerrada';

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

export interface PromoSubcategory {
  id: string;
  category: PromoCategory;
  name: string;
  order: number;
}

export interface PromoFloorLot {
  id: string;
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
  minQty: number;
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
  // Piso Vinílico e Teto Vinílico
  priceSqm?: number;
  // Rodapés e Ripados (preço normal + 3 faixas progressivas editáveis)
  priceNormal?: number;
  tiers?: PromoProgressiveTier[];
  // Outros Produtos
  price?: number;
}

export interface PromoTierQuantities {
  rodapes: [number, number, number];
  ripados: [number, number, number];
}

export type PromoSheetModel = 'oficial_colorido' | 'pb_economico' | 'compacto_a4';

export interface PromoSheetSettings {
  model: PromoSheetModel;
  includedCategories: Record<PromoCategory, boolean>;
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
  subcategories: PromoSubcategory[];
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
    },
    showModalityLabel: false,
    showSubcategories,
    density: 'padrao',
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

function normalizeCampaign(raw: any): PromoCampaign | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim();
  if (!id) return null;

  const status: PromoCampaignStatus =
    raw.status === 'ativa' || raw.status === 'inativa' || raw.status === 'encerrada'
      ? raw.status
      : 'inativa';

  const subcategories: PromoSubcategory[] = Array.isArray(raw.subcategories)
    ? raw.subcategories
        .filter((s: any) => s && typeof s.name === 'string' && s.name.trim())
        .map((s: any, idx: number) => ({
          id: String(s.id || `sub_${idx}`),
          category:
            s.category === 'piso_vinilico' ||
            s.category === 'rodapes' ||
            s.category === 'ripados' ||
            s.category === 'teto_vinilico' ||
            s.category === 'outros'
              ? s.category
              : 'piso_vinilico',
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
        const category: PromoCategory =
          o.category === 'piso_vinilico' ||
          o.category === 'rodapes' ||
          o.category === 'ripados' ||
          o.category === 'teto_vinilico' ||
          o.category === 'outros'
            ? o.category
            : 'outros';
        const tiers: PromoProgressiveTier[] | undefined = Array.isArray(o.tiers)
          ? o.tiers.map((t: any, tIdx: number) => ({
              minQty: Math.max(1, Math.floor(Number(t?.minQty) || [30, 50, 100][tIdx] || 30)),
              label: t?.label ? String(t.label) : undefined,
              price: Math.max(0, Number(t?.price) || 0),
            }))
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
          priceNormal: o.priceNormal !== undefined ? Math.max(0, Number(o.priceNormal) || 0) : undefined,
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

  const sheetSettings: PromoSheetSettings = {
    model: sheetModel,
    includedCategories: {
      piso_vinilico: rawIncluded.piso_vinilico !== false,
      rodapes: rawIncluded.rodapes !== false,
      ripados: rawIncluded.ripados !== false,
      teto_vinilico: rawIncluded.teto_vinilico !== false,
      outros: rawIncluded.outros !== false,
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
    subcategories,
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

  const lotMap = new Map<string, string>();
  const newLots: PromoFloorLot[] = source.lots.map((l, idx) => {
    const newId = `lot_${suffix}_${idx}`;
    lotMap.set(l.id, newId);
    return {
      ...l,
      id: newId,
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

  const cloned: PromoCampaign = {
    ...source,
    id: `camp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: `${source.name} (Cópia)`,
    status: 'inativa',
    subcategories: newSubs,
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
    return { success: false, campaigns: readCachedPromocoes(), error: 'Informe a descrição do lote.' };
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
      return { success: false, campaigns: remoteCampaigns, error: 'Lote não encontrado.' };
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
 * Carrega os produtos já cadastrados no CRM (sem modificar o cadastro geral de produtos).
 */
export async function loadCrmProductsForPromocoes(): Promise<CatalogProduct[]> {
  const client = getSupabaseClient();
  if (client) {
    try {
      const res = await withTimeout(
        client
          .from('fenix_kv_store')
          .select('key, data')
          .in('key', ['fenix_product_items_data', 'fenix_product_categories_data']),
        3500,
        { data: null } as any
      );
      if (Array.isArray(res?.data)) {
        for (const row of res.data) {
          if (row?.key && row?.data) {
            try {
              const str = typeof row.data === 'string' ? row.data : JSON.stringify(row.data);
              localStorage.setItem(row.key, str);
            } catch {
              // ignore
            }
          }
        }
      }
    } catch {
      // ignore fallback to local catalog
    }
  }
  return getDynamicProductCatalog();
}

export function getCrmPriceForModality(prod: CatalogProduct, modality: PromoModality): number {
  if (modality === 'construtora') return getProductTierPrice(prod, 'Construtora');
  if (modality === 'revenda') return getProductTierPrice(prod, 'Revenda');
  return getProductTierPrice(prod, 'Cliente Final');
}
