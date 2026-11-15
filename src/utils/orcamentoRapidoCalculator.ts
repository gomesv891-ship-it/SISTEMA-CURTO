import {
  CatalogProduct,
  getDynamicProductCatalog,
  getProductTierPrice,
} from '../data/productCatalog';
import { PriceTableTier } from '../types';
import { EspelhoItem } from '../components/EspelhoOrcamento';
import {
  calculatePisoInsumosForOrcamento,
  convertSqmToPisoBoxes,
  extractPisoBoxYield,
  formatSqmPtBr,
  getQuickBudgetPisoCandidates,
  getQuickBudgetRodapeCandidates,
  isPisoVinilicoColado,
  QuickBudgetRodapeHeight,
} from './pisoInsumosCalculator';
import {
  calculateRodapeBarras,
  calculateRodapeInsumosForOrcamento,
  extractBarLengthFromProductName,
  formatRodapeDetailText,
} from './rodapeCalculator';

function normalizeStr(val?: string): string {
  return (val || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

export function formatPtBrQuantity(val: number, decimals = 2): string {
  const safe = Number.isFinite(val) ? val : 0;
  if (Number.isInteger(safe)) return String(safe);
  return safe.toLocaleString('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// =========================================================================
// 1. RIPADO
// =========================================================================

export type RipadoCalcMode = 'm2' | 'lxA';
export type RipadoLineKey = 'slim' | 'wide' | 'mdf' | 'poliestireno' | 'outro';

export interface RipadoDimensions {
  barWidthMeters: number;
  barLengthMeters: number;
  lineKey: RipadoLineKey;
}

export function getRipadoLineKey(prod: { name?: string; category?: string }): RipadoLineKey {
  const text = `${normalizeStr(prod.name)} ${normalizeStr(prod.category)}`;
  if (text.includes('slim')) return 'slim';
  if (text.includes('wide')) return 'wide';
  if (text.includes('mdf')) return 'mdf';
  if (text.includes('poliestireno')) return 'poliestireno';
  return 'outro';
}

export function parseRipadoDimensions(prod: { name?: string; category?: string }): RipadoDimensions {
  const name = (prod.name || '').trim();
  const lineKey = getRipadoLineKey(prod);

  // Largura em cm (ex: Larg: 12,2cm | Lar: 10cm)
  let barWidthMeters = 0.12;
  const widthMatch =
    name.match(/larg(?:ura)?\s*:?\s*(\d+(?:[.,]\d+)?)\s*cm/i) ||
    name.match(/lar\s*:?\s*(\d+(?:[.,]\d+)?)\s*cm/i) ||
    name.match(/(\d+(?:[.,]\d+)?)\s*cm/i);
  if (widthMatch && widthMatch[1]) {
    const cm = parseFloat(widthMatch[1].replace(',', '.'));
    if (Number.isFinite(cm) && cm > 0) {
      barWidthMeters = cm / 100;
    }
  }

  // Comprimento/Altura da barra em metros (ex: Alt: 2,85m | Alt: 2,70m)
  let barLengthMeters = lineKey === 'mdf' ? 2.7 : 2.85;
  const heightMatch =
    name.match(/alt(?:ura)?\s*:?\s*(\d+(?:[.,]\d+)?)\s*m\b/i) ||
    name.match(/(?<![a-zA-Z0-9.,])(\d+[.,]\d+)\s*m\b(?!m)/i);
  if (heightMatch && heightMatch[1]) {
    const m = parseFloat(heightMatch[1].replace(',', '.'));
    if (Number.isFinite(m) && m >= 0.5 && m <= 6.0) {
      barLengthMeters = m;
    }
  }

  return { barWidthMeters, barLengthMeters, lineKey };
}

export function getQuickRipadoProducts(catalogOverride?: CatalogProduct[]): CatalogProduct[] {
  const catalog = catalogOverride ?? getDynamicProductCatalog();
  return catalog.filter((p) => {
    const cNorm = normalizeStr(p.category);
    const cIdNorm = normalizeStr(p.categoryId);
    const nNorm = normalizeStr(p.name);

    if (
      nNorm.includes('acabamento') ||
      nNorm.includes('perfil') ||
      nNorm.includes('cola') ||
      nNorm.includes('adesivo') ||
      cNorm.includes('cola') ||
      cNorm.includes('adesivo')
    ) {
      return false;
    }

    return (
      cIdNorm.includes('ripado') ||
      cIdNorm === '6f1a358c-63c6-4422-8066-d71e5938fbf3' ||
      cIdNorm === '839e7b87-10d8-40d4-8f51-9fd294252b42' ||
      cNorm.includes('ripado') ||
      nNorm.includes('ripado')
    );
  });
}

export function getQuickRipadoAcabamentos(
  ripadoProduct: CatalogProduct | null | undefined,
  catalogOverride?: CatalogProduct[]
): CatalogProduct[] {
  const catalog = catalogOverride ?? getDynamicProductCatalog();
  const candidates = catalog.filter((p) => {
    const cNorm = normalizeStr(p.category);
    const cIdNorm = normalizeStr(p.categoryId);
    const nNorm = normalizeStr(p.name);

    if (nNorm.includes('cola') || nNorm.includes('adesivo') || cNorm.includes('cola')) {
      return false;
    }

    const isFinishingName = nNorm.includes('acabamento') || nNorm.includes('perfil');
    const isRipadoScope =
      cNorm.includes('ripado') ||
      nNorm.includes('ripado') ||
      cIdNorm.includes('ripado') ||
      cIdNorm === '6f1a358c-63c6-4422-8066-d71e5938fbf3' ||
      cIdNorm === '839e7b87-10d8-40d4-8f51-9fd294252b42';

    return isFinishingName && isRipadoScope;
  });

  if (!ripadoProduct) return candidates;

  const line = getRipadoLineKey(ripadoProduct);
  if (line === 'slim') {
    const matched = candidates.filter((p) => normalizeStr(p.name).includes('slim'));
    if (matched.length > 0) return matched;
  } else if (line === 'wide') {
    const matched = candidates.filter((p) => normalizeStr(p.name).includes('wide'));
    if (matched.length > 0) return matched;
  } else if (line === 'mdf') {
    const matched = candidates.filter((p) => {
      const text = `${normalizeStr(p.name)} ${normalizeStr(p.category)}`;
      return text.includes('mdf');
    });
    if (matched.length > 0) return matched;
  } else if (line === 'poliestireno') {
    const matched = candidates.filter((p) => {
      const text = `${normalizeStr(p.name)} ${normalizeStr(p.category)}`;
      return text.includes('poliestireno');
    });
    if (matched.length > 0) return matched;
  }

  const sameCat = candidates.filter(
    (p) =>
      (p.categoryId && p.categoryId === ripadoProduct.categoryId) ||
      normalizeStr(p.category) === normalizeStr(ripadoProduct.category)
  );
  return sameCat.length > 0 ? sameCat : candidates;
}

export function getQuickRipadoColaProducts(catalogOverride?: CatalogProduct[]): CatalogProduct[] {
  const catalog = catalogOverride ?? getDynamicProductCatalog();
  return catalog.filter((p) => {
    const cNorm = normalizeStr(p.category);
    const cIdNorm = normalizeStr(p.categoryId);
    const nNorm = normalizeStr(p.name);

    if (
      cIdNorm === 'cat_cola_ripado' ||
      cIdNorm === 'cat_adesivo_ripado' ||
      (cNorm.includes('cola') && cNorm.includes('ripado')) ||
      (cNorm.includes('adesivo') && cNorm.includes('ripado'))
    ) {
      return true;
    }

    if (
      (nNorm.includes('cola') || nNorm.includes('adesivo')) &&
      nNorm.includes('ripado')
    ) {
      return true;
    }

    return false;
  });
}

export function calculateRipadoInternalBars(params: {
  mode: RipadoCalcMode;
  areaM2: number;
  widthMeters: number;
  heightMeters: number;
  ripadoProduct: CatalogProduct;
}): {
  areaSqm: number;
  baseBars: number;
  totalBars: number;
  colaTubos: number;
} {
  const { mode, areaM2, widthMeters, heightMeters, ripadoProduct } = params;
  const dims = parseRipadoDimensions(ripadoProduct);
  const barArea = Math.max(0.01, dims.barWidthMeters * dims.barLengthMeters);

  let areaSqm = 0;
  let baseBars = 0;

  if (mode === 'm2') {
    areaSqm = Math.round(Math.max(0, areaM2) * 100) / 100;
    baseBars = areaSqm > 0 ? Math.ceil(areaSqm / barArea - 1e-9) : 0;
  } else {
    const safeW = Math.max(0, widthMeters);
    const safeH = Math.max(0, heightMeters);
    areaSqm = Math.round(safeW * safeH * 100) / 100;
    if (safeW > 0 && safeH > 0) {
      const cols = Math.ceil(safeW / dims.barWidthMeters - 1e-9);
      const rowsMultiplier =
        safeH > dims.barLengthMeters
          ? Math.ceil(safeH / dims.barLengthMeters - 1e-9)
          : 1;
      baseBars = cols * rowsMultiplier;
    }
  }

  const totalBars = baseBars > 0 ? baseBars + 2 : 0;
  const colaTubos = totalBars > 0 ? Math.ceil(totalBars / 3 - 1e-9) : 0;

  return { areaSqm, baseBars, totalBars, colaTubos };
}

// =========================================================================
// 2. TETO VINÍLICO
// =========================================================================

export const TETO_REGUA_SQM = 1.19;
export const TETO_REGUAS_PER_CAIXA = 10;

export function getQuickTetoProducts(catalogOverride?: CatalogProduct[]): CatalogProduct[] {
  const catalog = catalogOverride ?? getDynamicProductCatalog();
  return catalog.filter((p) => {
    const cNorm = normalizeStr(p.category);
    const nNorm = normalizeStr(p.name);

    const isFinishing =
      nNorm.includes('acabamento') ||
      nNorm.includes('perfil') ||
      nNorm.includes('cantoneira') ||
      nNorm.includes('emenda') ||
      nNorm.includes('terminacao') ||
      nNorm.includes('cola') ||
      nNorm.includes('adesivo');
    if (isFinishing) return false;

    if (cNorm.includes('teto') || cNorm.includes('forro')) return true;
    if (nNorm.includes('teto vinilico') || nNorm.startsWith('teto')) return true;
    return false;
  });
}

export function getQuickTetoAcabamentos(catalogOverride?: CatalogProduct[]): CatalogProduct[] {
  const catalog = catalogOverride ?? getDynamicProductCatalog();
  return catalog.filter((p) => {
    const cNorm = normalizeStr(p.category);
    const nNorm = normalizeStr(p.name);

    if (
      nNorm.includes('ripado') ||
      nNorm.includes('poliestireno') ||
      nNorm.includes('mdf') ||
      nNorm.includes('manta') ||
      nNorm.includes('rodape') ||
      nNorm.includes('canto curvo') ||
      nNorm.includes('cola') ||
      nNorm.includes('adesivo') ||
      cNorm.includes('ripado') ||
      cNorm.includes('manta') ||
      cNorm.includes('rodape')
    ) {
      return false;
    }

    const isTetoScope =
      cNorm.includes('teto') ||
      cNorm.includes('forro') ||
      nNorm.includes('teto') ||
      nNorm.includes('forro');

    const isFinishing =
      nNorm.includes('acabamento') ||
      nNorm.includes('perfil') ||
      nNorm.includes('cantoneira') ||
      nNorm.includes('emenda') ||
      nNorm.includes('terminacao') ||
      cNorm.includes('acabamento');

    return isTetoScope && isFinishing;
  });
}

export function calculateTetoVinilico(requestedSqm: number): {
  totalReguas: number;
  caixas: number;
  reguasAvulsas: number;
  effectiveSqm: number;
  effectiveSqmDisplay: string;
  compositionDetail: string;
} {
  const safeReq = Math.max(0, Number(requestedSqm) || 0);
  if (safeReq <= 0) {
    return {
      totalReguas: 0,
      caixas: 0,
      reguasAvulsas: 0,
      effectiveSqm: 0,
      effectiveSqmDisplay: formatSqmPtBr(0),
      compositionDetail: '',
    };
  }

  const totalReguas = Math.ceil(safeReq / TETO_REGUA_SQM - 1e-9);
  const caixas = Math.floor(totalReguas / TETO_REGUAS_PER_CAIXA);
  const reguasAvulsas = totalReguas % TETO_REGUAS_PER_CAIXA;
  const effectiveSqm = Math.round(totalReguas * TETO_REGUA_SQM * 100) / 100;

  const parts: string[] = [];
  if (caixas > 0) {
    parts.push(`${caixas} ${caixas === 1 ? 'CAIXA' : 'CAIXAS'}`);
  }
  if (reguasAvulsas > 0) {
    parts.push(`${reguasAvulsas} ${reguasAvulsas === 1 ? 'RÉGUA' : 'RÉGUAS'}`);
  }

  return {
    totalReguas,
    caixas,
    reguasAvulsas,
    effectiveSqm,
    effectiveSqmDisplay: formatSqmPtBr(effectiveSqm),
    compositionDetail: parts.join(' + '),
  };
}

// =========================================================================
// 3. MANTA HOSPITALAR
// =========================================================================

export const MANTA_ROLL_SQM = 40;

export function getQuickMantaProducts(catalogOverride?: CatalogProduct[]): CatalogProduct[] {
  const catalog = catalogOverride ?? getDynamicProductCatalog();
  return catalog.filter((p) => {
    const cNorm = normalizeStr(p.category);
    const cIdNorm = normalizeStr(p.categoryId);
    const nNorm = normalizeStr(p.name);

    const isFinishing =
      nNorm.includes('cordao') ||
      nNorm.includes('suporte') ||
      nNorm.includes('canto') ||
      nNorm.includes('arremate') ||
      nNorm.includes('perfil') ||
      nNorm.includes('cola') ||
      nNorm.includes('primer') ||
      nNorm.includes('autonivelante');
    if (isFinishing) return false;

    return (
      cIdNorm === '83c3e2f0-dfa2-4e09-a233-ce0222b78d3b' ||
      cIdNorm === 'cat_manta_hospitalar' ||
      cNorm.includes('manta') ||
      nNorm.includes('manta')
    );
  });
}

export function getQuickMantaSuporteOptions(
  catalogOverride?: CatalogProduct[]
): CatalogProduct[] {
  const catalog = catalogOverride ?? getDynamicProductCatalog();
  return catalog.filter((p) => {
    const nNorm = normalizeStr(p.name);
    return nNorm.includes('suporte') && (nNorm.includes('canto') || nNorm.includes('curvo'));
  });
}

export function findMantaCordaoProduct(
  catalogOverride?: CatalogProduct[]
): CatalogProduct | null {
  const catalog = catalogOverride ?? getDynamicProductCatalog();
  return (
    catalog.find((p) => {
      const nNorm = normalizeStr(p.name);
      return nNorm.includes('cordao') && nNorm.includes('solda');
    }) ||
    catalog.find((p) => normalizeStr(p.name).includes('cordao')) ||
    null
  );
}

export function findMantaPerfilArremateProduct(
  catalogOverride?: CatalogProduct[]
): CatalogProduct | null {
  const catalog = catalogOverride ?? getDynamicProductCatalog();
  return (
    catalog.find((p) => {
      const nNorm = normalizeStr(p.name);
      return nNorm.includes('perfil') && nNorm.includes('arremate');
    }) ||
    catalog.find((p) => normalizeStr(p.name).includes('arremate')) ||
    null
  );
}

export function calculateMantaHospitalar(requestedSqm: number): {
  rolls: number;
  effectiveSqm: number;
  effectiveSqmDisplay: string;
  detail: string;
} {
  const safeReq = Math.max(0, Number(requestedSqm) || 0);
  if (safeReq <= 0) {
    return {
      rolls: 0,
      effectiveSqm: 0,
      effectiveSqmDisplay: formatSqmPtBr(0),
      detail: '',
    };
  }
  const rolls = Math.ceil(safeReq / MANTA_ROLL_SQM - 1e-9);
  const effectiveSqm = rolls * MANTA_ROLL_SQM;
  return {
    rolls,
    effectiveSqm,
    effectiveSqmDisplay: formatSqmPtBr(effectiveSqm),
    detail: `${rolls} ${rolls === 1 ? 'ROLO' : 'ROLOS'}`,
  };
}

export function extractSuporteCantoCurvoPackMeters(productName?: string): number | null {
  const raw = (productName || '').trim();
  if (!raw) return null;

  const pkgKeywordMatch = raw.match(
    /(?:pct|pacote|rolo|bobina|caixa|cx)\s*(?:com|de|:)?\s*(\d+(?:[.,]\d+)?)\s*(?:ml|m)\b/i
  );
  if (pkgKeywordMatch && pkgKeywordMatch[1]) {
    const val = parseFloat(pkgKeywordMatch[1].replace(',', '.'));
    if (Number.isFinite(val) && val > 0) return val;
  }

  const norm = normalizeStr(raw);
  if (/\b2[.,]2\s*cm\b/.test(norm) || /\b22\s*mm\b/.test(norm) || norm.includes('2,2') || norm.includes('2.2')) {
    return 40;
  }
  if (/\b4[.,]5\s*cm\b/.test(norm) || /\b45\s*mm\b/.test(norm) || norm.includes('4,5') || norm.includes('4.5')) {
    return 20;
  }

  return extractMantaAcabamentoPackMeters(raw);
}

export function resolveSuporteCantoCurvoQty(
  ml: number,
  prod: CatalogProduct
): { qty: number; qtyDisplay: string; packs: number; effectiveMl: number } {
  const safeMl = Math.max(0, Number(ml) || 0);
  if (safeMl <= 0) return { qty: 0, qtyDisplay: '0', packs: 0, effectiveMl: 0 };

  const pkgMeters = extractSuporteCantoCurvoPackMeters(prod.name);
  const packs =
    pkgMeters && pkgMeters > 0
      ? Math.ceil(safeMl / pkgMeters - 1e-9)
      : 1;
  const effectiveMl =
    pkgMeters && pkgMeters > 0
      ? Math.round(packs * pkgMeters * 100) / 100
      : Math.round(safeMl * 100) / 100;

  const uNorm = normalizeStr(prod.unit);
  if (uNorm === 'ml' || uNorm === 'm' || uNorm === 'metro' || uNorm === 'metros') {
    return {
      qty: effectiveMl,
      qtyDisplay: formatPtBrQuantity(effectiveMl, 2),
      packs,
      effectiveMl,
    };
  }

  return {
    qty: packs,
    qtyDisplay: String(packs),
    packs,
    effectiveMl,
  };
}

export function extractMantaAcabamentoPackMeters(productName?: string): number | null {
  const raw = (productName || '').trim();
  if (!raw) return null;

  const pkgKeywordMatch = raw.match(
    /(?:pct|pacote|rolo|bobina|caixa|cx)\s*(?:com|de|:)?\s*(\d+(?:[.,]\d+)?)\s*(?:ml|m)\b/i
  );
  if (pkgKeywordMatch && pkgKeywordMatch[1]) {
    const val = parseFloat(pkgKeywordMatch[1].replace(',', '.'));
    if (Number.isFinite(val) && val > 0) return val;
  }

  const bracketMatch = raw.match(
    /[\(\[]\s*(\d+(?:[.,]\d+)?)\s*(?:ml|m)\s*[\)\]]/i
  );
  if (bracketMatch && bracketMatch[1]) {
    const val = parseFloat(bracketMatch[1].replace(',', '.'));
    if (Number.isFinite(val) && val > 0) return val;
  }

  const genericMatch = raw.match(
    /(?<![0-9.,])(\d+(?:[.,]\d+)?)\s*(?:ml|m)(?![a-zA-Z0-9])/i
  );
  if (genericMatch && genericMatch[1]) {
    const val = parseFloat(genericMatch[1].replace(',', '.'));
    if (Number.isFinite(val) && val > 0) return val;
  }

  return null;
}

function resolveMantaAcabamentoByPackAndMlPrice(
  acabMl: number,
  prod: CatalogProduct,
  priceTable: PriceTableTier
): {
  packs: number;
  effectiveMl: number;
  qtyDisplay: string;
  unitPricePerMl: number;
  total: number;
} {
  const safeMl = Math.max(0, Number(acabMl) || 0);
  if (safeMl <= 0) {
    return { packs: 0, effectiveMl: 0, qtyDisplay: '0', unitPricePerMl: 0, total: 0 };
  }
  const pkgMeters = extractMantaAcabamentoPackMeters(prod.name);
  const packs =
    pkgMeters && pkgMeters > 0
      ? Math.ceil(safeMl / pkgMeters - 1e-9)
      : 1;
  const effectiveMl =
    pkgMeters && pkgMeters > 0
      ? Math.round(packs * pkgMeters * 100) / 100
      : Math.round(safeMl * 100) / 100;
  const unitPricePerMl = getProductTierPrice(prod, priceTable);
  return {
    packs,
    effectiveMl,
    qtyDisplay: formatPtBrQuantity(effectiveMl, 2),
    unitPricePerMl,
    total: Math.round(effectiveMl * unitPricePerMl * 100) / 100,
  };
}

export function resolveMantaCordaoFinish(
  acabMl: number,
  prod: CatalogProduct,
  priceTable: PriceTableTier
): {
  packs: number;
  effectiveMl: number;
  qtyDisplay: string;
  unitPricePerMl: number;
  total: number;
} {
  return resolveMantaAcabamentoByPackAndMlPrice(acabMl, prod, priceTable);
}

export function resolveMantaPerfilArremateFinish(
  acabMl: number,
  prod: CatalogProduct,
  priceTable: PriceTableTier
): {
  packs: number;
  effectiveMl: number;
  qtyDisplay: string;
  unitPricePerMl: number;
  total: number;
} {
  return resolveMantaAcabamentoByPackAndMlPrice(acabMl, prod, priceTable);
}

// =========================================================================
// 4. LIMPA PISO 1L & ÁREA TÉRREA (PRIMER ANTIUMIDADE)
// =========================================================================

export function findLimpaPiso1LProduct(
  catalogOverride?: CatalogProduct[]
): CatalogProduct | null {
  const catalog = catalogOverride ?? getDynamicProductCatalog();
  const candidates = catalog.filter((p) => {
    const nNorm = normalizeStr(p.name);
    return nNorm.includes('limpa') && nNorm.includes('piso');
  });
  if (candidates.length === 0) return null;
  return (
    candidates.find((p) => {
      const nNorm = normalizeStr(p.name);
      return (
        /\b1\s*l\b/.test(nNorm) ||
        nNorm.includes('1l') ||
        nNorm.includes('1 litro') ||
        nNorm.includes('1000ml') ||
        nNorm.includes('1000 ml')
      );
    }) || candidates[0]
  );
}

export function findPrimerAntiumidadeProduct(
  catalogOverride?: CatalogProduct[]
): CatalogProduct | null {
  const catalog = catalogOverride ?? getDynamicProductCatalog();
  const candidates = catalog.filter((p) => {
    const cNorm = normalizeStr(p.category);
    const nNorm = normalizeStr(p.name);
    return (
      (cNorm.includes('primer') || nNorm.includes('primer')) &&
      (nNorm.includes('anti umidade') ||
        nNorm.includes('antiumidade') ||
        nNorm.includes('anti-umidade'))
    );
  });
  if (candidates.length === 0) return null;
  return (
    candidates.find((p) => normalizeStr(p.name).includes('flexfloor')) ||
    candidates[0]
  );
}

export function calculateAreaTerreaPrimerQty(areaM2: number): number {
  const safeArea = Math.max(0, Number(areaM2) || 0);
  if (safeArea <= 0) return 0;
  return Math.ceil(safeArea / 5 - 1e-9);
}

// =========================================================================
// 5. CONSTRUTOR DE ITENS DO ORÇAMENTO RÁPIDO
// =========================================================================

export type QuickCategoryKey = 'piso' | 'rodape' | 'ripado' | 'teto' | 'manta';

export interface QuickWizardConfigState {
  piso: {
    pisoType: 'colado' | 'clicado';
    productId: string;
    includeInsumos: boolean;
  };
  rodape: {
    height: QuickBudgetRodapeHeight;
    productId: string;
    includeInsumos: boolean;
    includeColar: boolean;
    includeCalafetar: boolean;
    calafetarProductId: string;
  };
  ripado: {
    productId: string;
    includeInsumos: boolean;
    includeAcabamento: boolean;
    acabamentoProductId: string;
    acabamentoQty: string;
  };
  teto: {
    productId: string;
    includeAcabamento: boolean;
    acabamentoProductId: string;
    acabamentoQty: string;
  };
  manta: {
    productId: string;
    includeInsumos: boolean;
    includeAcabamentos: boolean;
    acabamentoMl: string;
    suporteProductId: string;
  };
}

export interface QuickWizardMeasurements {
  pisoSqm: number;
  rodapeMl: number;
  ripado: {
    mode: RipadoCalcMode;
    areaM2: number;
    widthMeters: number;
    heightMeters: number;
  };
  tetoSqm: number;
  mantaSqm: number;
}

export function getQuickAutoTagsForCategory(cat: QuickCategoryKey): string[] {
  switch (cat) {
    case 'piso':
      return ['quick_piso', 'quick_piso_insumo'];
    case 'rodape':
      return ['quick_rodape', 'quick_rodape_insumo'];
    case 'ripado':
      return ['quick_ripado', 'quick_ripado_insumo', 'quick_ripado_acabamento'];
    case 'teto':
      return ['quick_teto', 'quick_teto_acabamento'];
    case 'manta':
      return ['quick_manta', 'quick_manta_insumo', 'quick_manta_acabamento'];
  }
}

export interface BuildQuickCategoryItemsResult {
  items: EspelhoItem[];
  pisoLink?: {
    itemId: string;
    hasInsumos: boolean;
    requestedSqm: number;
    lastEffectiveSqm: number;
    skipCola: boolean;
  };
  rodapeLink?: {
    itemId: string;
    barLengthMeters: number;
    requestedMl: number;
    lastBarras: number;
    includeColar: boolean;
    includeCalafetar: boolean;
    calafetarProductId: string;
  };
  warnings: string[];
}

export function buildQuickCategoryItems(params: {
  category: QuickCategoryKey;
  measurements: QuickWizardMeasurements;
  config: QuickWizardConfigState;
  priceTable: PriceTableTier;
  catalog: CatalogProduct[];
  parseNumeric: (val: string) => number;
}): BuildQuickCategoryItemsResult {
  const { category, measurements, config, priceTable, catalog, parseNumeric } = params;
  const ts = Date.now();
  const rnd = () => Math.random().toString(36).substring(2, 6);
  const warnings: string[] = [];
  const items: EspelhoItem[] = [];

  if (category === 'piso') {
    const reqSqm = measurements.pisoSqm;
    const candidates = getQuickBudgetPisoCandidates(config.piso.pisoType, catalog);
    const prod =
      candidates.find((p) => p.id === config.piso.productId) || candidates[0];
    if (!prod || reqSqm <= 0) return { items, warnings };

    const boxYield = extractPisoBoxYield(prod.name);
    const conv = boxYield ? convertSqmToPisoBoxes(reqSqm, boxYield) : null;
    const effectiveSqm = conv ? conv.realSqm : Math.round(reqSqm * 100) / 100;
    const unitPrice = getProductTierPrice(prod, priceTable);
    const pisoItemId = `item_${ts}_qp_${rnd()}`;
    const skipCola =
      config.piso.pisoType === 'clicado' ||
      !isPisoVinilicoColado(prod.name, prod.category, prod.categoryId);

    items.push({
      id: pisoItemId,
      qtd: formatSqmPtBr(effectiveSqm),
      descricao: prod.name,
      subtitulo: conv ? conv.detailText : undefined,
      unidade: prod.unit || 'm²',
      precoUnitario: unitPrice,
      total: Math.round(effectiveSqm * unitPrice * 100) / 100,
      autoTag: 'quick_piso',
    });

    if (config.piso.includeInsumos) {
      const plan = calculatePisoInsumosForOrcamento({
        productName: prod.name,
        requestedSqm: reqSqm,
        effectiveSqm,
        boxes: conv?.boxes ?? null,
        priceTable,
        includePrimerAntiumidade: false,
        skipCola,
        catalogOverride: catalog,
      });

      plan.insumos.forEach((ins, idx) => {
        if (ins.quantity <= 0) return;
        items.push({
          id: `item_${ts}_qpi_${idx}_${rnd()}`,
          qtd: String(ins.quantity),
          descricao: ins.catalogName,
          unidade: ins.catalogUnit,
          precoUnitario: ins.catalogPrice,
          total: Math.round(ins.quantity * ins.catalogPrice * 100) / 100,
          autoTag: 'quick_piso_insumo',
        });
      });
    }

    return {
      items,
      pisoLink: {
        itemId: pisoItemId,
        hasInsumos: config.piso.includeInsumos,
        requestedSqm: reqSqm,
        lastEffectiveSqm: effectiveSqm,
        skipCola,
      },
      warnings,
    };
  }

  if (category === 'rodape') {
    const reqMl = measurements.rodapeMl;
    const candidates = getQuickBudgetRodapeCandidates(config.rodape.height, catalog);
    const prod =
      candidates.find((p) => p.id === config.rodape.productId) || candidates[0];
    if (!prod || reqMl <= 0) return { items, warnings };

    const barLen = extractBarLengthFromProductName(prod.name, 2.4);
    const unitPrice = getProductTierPrice(prod, priceTable);
    const calc = calculateRodapeBarras(reqMl, barLen, unitPrice);
    const rodapeItemId = `item_${ts}_qr_${rnd()}`;

    items.push({
      id: rodapeItemId,
      qtd: String(calc.barrasNecessarias),
      descricao: prod.name,
      subtitulo: formatRodapeDetailText({
        requestedMl: reqMl,
        barCount: calc.barrasNecessarias,
        barLengthMeters: barLen,
      }),
      unidade: prod.unit || 'barras',
      precoUnitario: unitPrice,
      total: Math.round(calc.barrasNecessarias * unitPrice * 100) / 100,
      requestedMl: reqMl,
      barLengthMeters: barLen,
      autoTag: 'quick_rodape',
    });

    const includeColar = config.rodape.includeInsumos && config.rodape.includeColar;
    const includeCalafetar =
      config.rodape.includeInsumos && config.rodape.includeCalafetar;
    let resolvedCalafetarId = config.rodape.calafetarProductId;

    if (includeColar || includeCalafetar) {
      const plan = calculateRodapeInsumosForOrcamento({
        rodapeName: prod.name,
        barCount: calc.barrasNecessarias,
        barLengthMeters: barLen,
        requestedMl: reqMl,
        priceTable,
        selectedCalafetarId: config.rodape.calafetarProductId,
        catalogOverride: catalog,
      });

      if (includeColar) {
        plan.colarItems.forEach((colarItem, idx) => {
          if (colarItem.quantity <= 0) return;
          items.push({
            id: `item_${ts}_qrci_${idx}_${rnd()}`,
            qtd: String(colarItem.quantity),
            descricao: colarItem.catalogName,
            unidade: colarItem.unit,
            precoUnitario: colarItem.unitPrice,
            total: Math.round(colarItem.quantity * colarItem.unitPrice * 100) / 100,
            autoTag: 'quick_rodape_insumo',
          });
        });
      }

      if (includeCalafetar) {
        const calOpt =
          plan.calafetarOptions.find(
            (o) => o.productId === config.rodape.calafetarProductId
          ) || plan.calafetarOptions[0];
        if (calOpt && plan.calafetarQuantity > 0) {
          resolvedCalafetarId = calOpt.productId;
          items.push({
            id: `item_${ts}_qrcal_${rnd()}`,
            qtd: String(plan.calafetarQuantity),
            descricao: calOpt.catalogName,
            unidade: calOpt.unit,
            precoUnitario: calOpt.unitPrice,
            total:
              Math.round(plan.calafetarQuantity * calOpt.unitPrice * 100) / 100,
            autoTag: 'quick_rodape_insumo',
          });
        }
      }
    }

    return {
      items,
      rodapeLink: {
        itemId: rodapeItemId,
        barLengthMeters: barLen,
        requestedMl: reqMl,
        lastBarras: calc.barrasNecessarias,
        includeColar,
        includeCalafetar,
        calafetarProductId: resolvedCalafetarId,
      },
      warnings,
    };
  }

  if (category === 'ripado') {
    const candidates = getQuickRipadoProducts(catalog);
    const prod =
      candidates.find((p) => p.id === config.ripado.productId) || candidates[0];
    if (!prod) return { items, warnings };

    const calc = calculateRipadoInternalBars({
      mode: measurements.ripado.mode,
      areaM2: measurements.ripado.areaM2,
      widthMeters: measurements.ripado.widthMeters,
      heightMeters: measurements.ripado.heightMeters,
      ripadoProduct: prod,
    });
    if (calc.totalBars <= 0) return { items, warnings };

    const unitPrice = getProductTierPrice(prod, priceTable);
    items.push({
      id: `item_${ts}_qrip_${rnd()}`,
      qtd: String(calc.totalBars),
      descricao: prod.name,
      unidade: 'barras',
      precoUnitario: unitPrice,
      total: Math.round(calc.totalBars * unitPrice * 100) / 100,
      autoTag: 'quick_ripado',
    });

    if (config.ripado.includeInsumos && calc.colaTubos > 0) {
      const colaProds = getQuickRipadoColaProducts(catalog);
      const colaProd = colaProds[0];
      if (colaProd) {
        const colaPrice = getProductTierPrice(colaProd, priceTable);
        items.push({
          id: `item_${ts}_qripc_${rnd()}`,
          qtd: String(calc.colaTubos),
          descricao: colaProd.name,
          unidade: colaProd.unit || 'tubos',
          precoUnitario: colaPrice,
          total: Math.round(calc.colaTubos * colaPrice * 100) / 100,
          autoTag: 'quick_ripado_insumo',
        });
      } else {
        warnings.push('Cola específica para Ripado não encontrada no catálogo.');
      }
    }

    if (config.ripado.includeAcabamento) {
      const acabOptions = getQuickRipadoAcabamentos(prod, catalog);
      const acabProd =
        acabOptions.find((p) => p.id === config.ripado.acabamentoProductId) ||
        acabOptions[0];
      const acabQty = parseNumeric(config.ripado.acabamentoQty);
      if (acabProd && acabQty > 0) {
        const acabPrice = getProductTierPrice(acabProd, priceTable);
        items.push({
          id: `item_${ts}_qripa_${rnd()}`,
          qtd: formatPtBrQuantity(acabQty, 2),
          descricao: acabProd.name,
          unidade: acabProd.unit || 'barras',
          precoUnitario: acabPrice,
          total: Math.round(acabQty * acabPrice * 100) / 100,
          autoTag: 'quick_ripado_acabamento',
        });
      }
    }

    return { items, warnings };
  }

  if (category === 'teto') {
    const candidates = getQuickTetoProducts(catalog);
    const prod =
      candidates.find((p) => p.id === config.teto.productId) || candidates[0];
    if (!prod || measurements.tetoSqm <= 0) return { items, warnings };

    const calc = calculateTetoVinilico(measurements.tetoSqm);
    const unitPrice = getProductTierPrice(prod, priceTable);

    items.push({
      id: `item_${ts}_qteto_${rnd()}`,
      qtd: calc.effectiveSqmDisplay,
      descricao: prod.name,
      subtitulo: calc.compositionDetail,
      unidade: 'm²',
      precoUnitario: unitPrice,
      total: Math.round(calc.effectiveSqm * unitPrice * 100) / 100,
      autoTag: 'quick_teto',
    });

    if (config.teto.includeAcabamento) {
      const acabOptions = getQuickTetoAcabamentos(catalog);
      const acabProd =
        acabOptions.find((p) => p.id === config.teto.acabamentoProductId) ||
        acabOptions[0];
      const acabQty = parseNumeric(config.teto.acabamentoQty);
      if (acabProd && acabQty > 0) {
        const acabPrice = getProductTierPrice(acabProd, priceTable);
        items.push({
          id: `item_${ts}_qtetoa_${rnd()}`,
          qtd: formatPtBrQuantity(acabQty, 2),
          descricao: acabProd.name,
          unidade: acabProd.unit || 'barras',
          precoUnitario: acabPrice,
          total: Math.round(acabQty * acabPrice * 100) / 100,
          autoTag: 'quick_teto_acabamento',
        });
      }
    }

    return { items, warnings };
  }

  // category === 'manta'
  const candidates = getQuickMantaProducts(catalog);
  const prod =
    candidates.find((p) => p.id === config.manta.productId) || candidates[0];
  if (!prod || measurements.mantaSqm <= 0) return { items, warnings };

  const calc = calculateMantaHospitalar(measurements.mantaSqm);
  const unitPrice = getProductTierPrice(prod, priceTable);

  items.push({
    id: `item_${ts}_qmanta_${rnd()}`,
    qtd: calc.effectiveSqmDisplay,
    descricao: prod.name,
    subtitulo: calc.detail,
    unidade: 'm²',
    precoUnitario: unitPrice,
    total: Math.round(calc.effectiveSqm * unitPrice * 100) / 100,
    autoTag: 'quick_manta',
  });

  if (config.manta.includeInsumos) {
    const plan = calculatePisoInsumosForOrcamento({
      productName: prod.name,
      requestedSqm: measurements.mantaSqm,
      effectiveSqm: calc.effectiveSqm,
      priceTable,
      includePrimerAntiumidade: false,
      skipCola: false,
      catalogOverride: catalog,
    });

    plan.insumos.forEach((ins, idx) => {
      if (ins.quantity <= 0) return;
      items.push({
        id: `item_${ts}_qmi_${idx}_${rnd()}`,
        qtd: String(ins.quantity),
        descricao: ins.catalogName,
        unidade: ins.catalogUnit,
        precoUnitario: ins.catalogPrice,
        total: Math.round(ins.quantity * ins.catalogPrice * 100) / 100,
        autoTag: 'quick_manta_insumo',
      });
    });
  }

  if (config.manta.includeAcabamentos) {
    const acabMl = parseNumeric(config.manta.acabamentoMl);
    if (acabMl > 0) {
      // 1. Suporte Canto Curvo (selecionado entre os cadastrados)
      const suporteOpts = getQuickMantaSuporteOptions(catalog);
      const suporteProd =
        suporteOpts.find((p) => p.id === config.manta.suporteProductId) ||
        suporteOpts[0];
      if (suporteProd) {
        const suporteCalc = resolveSuporteCantoCurvoQty(acabMl, suporteProd);
        const suportePrice = getProductTierPrice(suporteProd, priceTable);
        items.push({
          id: `item_${ts}_qmasup_${rnd()}`,
          qtd: suporteCalc.qtyDisplay,
          descricao: suporteProd.name,
          unidade: suporteProd.unit || 'pct',
          precoUnitario: suportePrice,
          total: Math.round(suporteCalc.qty * suportePrice * 100) / 100,
          autoTag: 'quick_manta_acabamento',
        });
      }

      // 2. Cordão de Solda (embalagem conforme cadastro -> embalagens completas internamente, apresentar e cobrar em ml)
      const cordaoProd = findMantaCordaoProduct(catalog);
      if (cordaoProd) {
        const cordaoCalc = resolveMantaCordaoFinish(acabMl, cordaoProd, priceTable);
        items.push({
          id: `item_${ts}_qmacor_${rnd()}`,
          qtd: cordaoCalc.qtyDisplay,
          descricao: cordaoProd.name,
          unidade: 'ml',
          precoUnitario: cordaoCalc.unitPricePerMl,
          total: cordaoCalc.total,
          autoTag: 'quick_manta_acabamento',
        });
      } else {
        warnings.push('Cordão de Solda não encontrado no catálogo.');
      }

      // 3. Perfil de Arremate (embalagem conforme cadastro -> embalagens completas internamente, apresentar e cobrar em ml)
      const perfilProd = findMantaPerfilArremateProduct(catalog);
      if (perfilProd) {
        const perfilCalc = resolveMantaPerfilArremateFinish(acabMl, perfilProd, priceTable);
        items.push({
          id: `item_${ts}_qmaper_${rnd()}`,
          qtd: perfilCalc.qtyDisplay,
          descricao: perfilProd.name,
          unidade: 'ml',
          precoUnitario: perfilCalc.unitPricePerMl,
          total: perfilCalc.total,
          autoTag: 'quick_manta_acabamento',
        });
      } else {
        warnings.push('Perfil de Arremate não encontrado no catálogo.');
      }
    }
  }

  return { items, warnings };
}
