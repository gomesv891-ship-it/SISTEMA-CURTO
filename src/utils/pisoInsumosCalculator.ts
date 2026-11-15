import {
  CatalogProduct,
  getDynamicProductCatalog,
  getProductTierPrice,
} from '../data/productCatalog';
import { PriceTableTier } from '../types';
import { getStoredRendimentos, RendimentoItem } from './rendimentosService';

import { isRodapeProduct } from './rodapeCalculator';

export type InsumoKind =
  | 'autonivelante'
  | 'primer_36'
  | 'primer_18'
  | 'primer_antiumidade'
  | 'cola_4'
  | 'cola_18'
  | 'globalfix_36'
  | 'globalfix_20';

export interface CalculatedInsumoLine {
  kind: InsumoKind;
  modalLabel: string;
  quantity: number;
  quantityDisplay: string;
  catalogName: string;
  catalogUnit: string;
  catalogPrice: number;
}

export interface PisoInsumosPlan {
  productName: string;
  requestedSqm: number;
  boxYield: number | null;
  boxes: number | null;
  realSqm: number;
  realSqmDisplay: string;
  insumos: CalculatedInsumoLine[];
}

function normalizeStr(val?: string): string {
  return (val || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

export function formatSqmPtBr(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return safe.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function parsePtBrNumeric(val: string | number | null | undefined): number {
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
  if (!val) return 0;
  const clean = String(val).trim();
  if (!clean) return 0;
  if (clean.includes(',')) {
    const num = parseFloat(clean.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(num) ? num : 0;
  }
  const num = parseFloat(clean);
  return Number.isFinite(num) ? num : 0;
}

export function isSquareMeterUnit(unit?: string): boolean {
  const norm = normalizeStr(unit).replace(/\s+/g, '');
  return (
    norm === '' ||
    norm === 'm2' ||
    norm === 'm²' ||
    norm === 'metroquadrado' ||
    norm === 'metrosquadrados'
  );
}

/**
 * Identifica qualquer produto de Piso Vinílico (Colado ou Clicado) para conversão m² <-> caixas.
 */
export function isPisoVinilicoProduct(
  productName?: string,
  categoryName?: string,
  categoryId?: string
): boolean {
  const pNorm = normalizeStr(productName);
  const cNorm = normalizeStr(categoryName);
  const cIdNorm = normalizeStr(categoryId);

  if (!pNorm) return false;

  // Excluir outras categorias / insumos / limpeza / rodapés / mantas / ripados / tetos
  if (
    pNorm.includes('limpa') ||
    pNorm.includes('limpeza') ||
    pNorm.includes('detergente') ||
    pNorm.includes('removedor') ||
    pNorm.includes('cera') ||
    pNorm.includes('sabao') ||
    pNorm.includes('neutro') ||
    pNorm.includes('rodape') ||
    pNorm.includes('manta') ||
    pNorm.includes('cola ') ||
    pNorm.startsWith('cola') ||
    pNorm.includes('adesivo') ||
    pNorm.includes('primer') ||
    pNorm.includes('autonivelante') ||
    pNorm.includes('massa ') ||
    pNorm.includes('ripado') ||
    pNorm.includes('teto') ||
    pNorm.includes('forro') ||
    pNorm.includes('perfil') ||
    pNorm.includes('acabamento') ||
    pNorm.includes('cordao') ||
    pNorm.includes('suporte canto') ||
    pNorm.includes('espatula') ||
    pNorm.includes('rolo ') ||
    pNorm.includes('lixa') ||
    cNorm.includes('limpa') ||
    cNorm.includes('limpeza') ||
    cNorm.includes('rodape') ||
    cNorm.includes('manta') ||
    cNorm.includes('cola') ||
    cNorm.includes('adesivo') ||
    cNorm.includes('primer') ||
    cNorm.includes('autonivelante') ||
    cNorm.includes('massa') ||
    cNorm.includes('ripado') ||
    cNorm.includes('teto') ||
    cNorm.includes('forro') ||
    cNorm.includes('insumo')
  ) {
    return false;
  }

  if (
    cIdNorm === '0368b74c-2647-4e35-aeee-a3a5667561fd' ||
    cIdNorm === 'cat_pisos_vinilicos' ||
    cNorm.includes('piso vinilico') ||
    cNorm.includes('pisos vinilicos')
  ) {
    return true;
  }

  // Se uma categoria real diferente foi informada (ex: Limpeza, Acessórios, Outros), não classificar como Piso Vinílico
  if (cNorm && cNorm !== 'geral') {
    return false;
  }

  if (
    pNorm.includes('piso vinilico') ||
    pNorm.includes('piso flexfloor') ||
    pNorm.includes('piso vinilforte') ||
    pNorm.startsWith('piso ')
  ) {
    return true;
  }

  return false;
}

/**
 * Identifica exclusivamente produtos de Piso Vinílico Colado.
 * NUNCA ativa o modal de insumos para Piso Vinílico Clicado nem para outras categorias.
 */
export function isPisoVinilicoColado(
  productName?: string,
  categoryName?: string,
  categoryId?: string
): boolean {
  if (!isPisoVinilicoProduct(productName, categoryName, categoryId)) {
    return false;
  }
  const pNorm = normalizeStr(productName);
  if (
    pNorm.includes('clicado') ||
    pNorm.includes('clicad') ||
    /\bclick\b/.test(pNorm)
  ) {
    return false;
  }
  return true;
}

/**
 * Identifica exclusivamente produtos de Piso Vinílico Colado da marca Tarkett.
 * Piso Tarkett Clicado e outras marcas retornam false.
 */
export function isTarkettColado(
  productName?: string,
  categoryName?: string,
  categoryId?: string
): boolean {
  if (!isPisoVinilicoColado(productName, categoryName, categoryId)) {
    return false;
  }
  return normalizeStr(productName).includes('tarkett');
}

/**
 * Extrai o rendimento específico por caixa (m²/cx) do produto selecionado.
 * Prioriza cadastro em Rendimentos (m²/caixa) e depois especificação na descrição do produto.
 * Nunca fixa valor padrão arbitrário para todos os produtos.
 */
export function extractPisoBoxYield(
  productName: string,
  rendimentosOverride?: RendimentoItem[]
): number | null {
  const cleanName = (productName || '').trim();
  if (!cleanName) return null;

  // 1. Verificar tabela de Rendimentos cadastrada (Supabase / cache local)
  try {
    const rendimentos = rendimentosOverride ?? getStoredRendimentos();
    const pNorm = normalizeStr(cleanName);
    const matched = rendimentos.find((r) => {
      const rProd = normalizeStr(r.produto);
      const rUnit = normalizeStr(r.unidade);
      const isBoxUnit =
        rUnit.includes('caixa') ||
        rUnit.includes('cx') ||
        rUnit === 'm2/caixa' ||
        rUnit === 'm²/caixa';
      if (!isBoxUnit || !rProd) return false;
      return rProd === pNorm || pNorm.includes(rProd) || rProd.includes(pNorm);
    });
    if (matched) {
      const numMatch = String(matched.rendimento || '').match(/(\d+(?:[.,]\d+)?)/);
      if (numMatch) {
        const parsed = parseFloat(numMatch[1].replace(',', '.'));
        if (Number.isFinite(parsed) && parsed > 0) {
          return parsed;
        }
      }
    }
  } catch {
    // ignore storage fallback errors in non-browser tests
  }

  // 2. Padrão explícito de caixa no nome: [cx 4,72m²], [cx 2,20m²), [5,70m²]
  const bracketMatch = cleanName.match(
    /\[\s*(?:cx|caixa)?\s*(\d+(?:[.,]\d+)?)\s*m[²2]\s*[\]\)]/i
  );
  if (bracketMatch && bracketMatch[1]) {
    const parsed = parseFloat(bracketMatch[1].replace(',', '.'));
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  // 3. Padrão "cx 4,72m²" ou "caixa 4,72 m²"
  const cxMatch = cleanName.match(
    /(?:cx|caixa)\s*:?\s*(\d+(?:[.,]\d+)?)\s*m[²2]/i
  );
  if (cxMatch && cxMatch[1]) {
    const parsed = parseFloat(cxMatch[1].replace(',', '.'));
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  // 4. Padrão "4,72 m²/cx"
  const perBoxMatch = cleanName.match(
    /(\d+(?:[.,]\d+)?)\s*m[²2]\s*\/\s*(?:cx|caixa)/i
  );
  if (perBoxMatch && perBoxMatch[1]) {
    const parsed = parseFloat(perBoxMatch[1].replace(',', '.'));
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  // 5. Fallback genérico para m² no nome do piso
  const genericM2Match = cleanName.match(/(\d+(?:[.,]\d+)?)\s*m[²2]/i);
  if (genericM2Match && genericM2Match[1]) {
    const parsed = parseFloat(genericM2Match[1].replace(',', '.'));
    if (Number.isFinite(parsed) && parsed > 0.3 && parsed < 25) return parsed;
  }

  return null;
}

export function formatBoxesDetail(boxes: number, existingDetail?: string): string {
  const count = Math.max(1, Math.round(boxes));
  const unitWord = count === 1 ? 'CAIXA' : 'CAIXAS';
  const badge = `${count} ${unitWord}`;
  const trimmed = (existingDetail || '').trim();

  if (!trimmed || /^\d+$/.test(trimmed)) {
    return badge;
  }

  const boxTokenRegex = /\d+\s*(?:cx|cxs|caixa|caixas)\b/i;
  if (boxTokenRegex.test(trimmed)) {
    return trimmed.replace(boxTokenRegex, badge);
  }

  return `${badge} - ${trimmed}`;
}

export function parseBoxesFromDetail(detailText?: string): number | null {
  const raw = (detailText || '').trim();
  if (!raw) return null;

  const explicitMatch = raw.match(/(\d+)\s*(?:cx|cxs|caixa|caixas)\b/i);
  if (explicitMatch && explicitMatch[1]) {
    const parsed = parseInt(explicitMatch[1], 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  if (/^\d+$/.test(raw)) {
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  return null;
}

export function convertSqmToPisoBoxes(
  requestedSqm: number,
  boxYield: number,
  existingDetail?: string
): {
  requestedSqm: number;
  boxes: number;
  realSqm: number;
  realSqmDisplay: string;
  detailText: string;
} {
  const safeReq = Math.max(0, Number(requestedSqm) || 0);
  const safeYield = Math.max(0.01, Number(boxYield) || 0);
  const boxes = safeReq > 0 ? Math.max(1, Math.ceil(safeReq / safeYield - 1e-9)) : 0;
  const realSqm = Math.round(boxes * safeYield * 100) / 100;
  return {
    requestedSqm: safeReq,
    boxes,
    realSqm,
    realSqmDisplay: formatSqmPtBr(realSqm),
    detailText: boxes > 0 ? formatBoxesDetail(boxes, existingDetail) : (existingDetail || ''),
  };
}

export function convertBoxesToPisoSqm(
  boxes: number,
  boxYield: number
): {
  boxes: number;
  realSqm: number;
  realSqmDisplay: string;
} {
  const safeBoxes = Math.max(0, Math.round(boxes));
  const safeYield = Math.max(0.01, Number(boxYield) || 0);
  const realSqm = Math.round(safeBoxes * safeYield * 100) / 100;
  return {
    boxes: safeBoxes,
    realSqm,
    realSqmDisplay: formatSqmPtBr(realSqm),
  };
}

export function calculateRealPisoMetragem(
  requestedSqm: number,
  boxYield: number | null
): {
  requestedSqm: number;
  boxYield: number | null;
  boxes: number | null;
  realSqm: number;
} {
  const safeReq = Math.max(0, Number(requestedSqm) || 0);
  if (safeReq <= 0) {
    return { requestedSqm: 0, boxYield, boxes: null, realSqm: 0 };
  }

  if (boxYield !== null && boxYield > 0) {
    const boxes = Math.max(1, Math.ceil(safeReq / boxYield - 1e-9));
    const realSqm = Math.round(boxes * boxYield * 100) / 100;
    return {
      requestedSqm: safeReq,
      boxYield,
      boxes,
      realSqm,
    };
  }

  return {
    requestedSqm: safeReq,
    boxYield: null,
    boxes: null,
    realSqm: Math.round(safeReq * 100) / 100,
  };
}

/**
 * Avalia todas as combinações possíveis de embalagens pequenas + grandes
 * que atingem cobertura >= areaM2 e escolhe a que gera a menor sobra possível.
 */
export function solveMinimumWastePackages(
  areaM2: number,
  smallYield: number,
  bigYield: number
): {
  bigQty: number;
  smallQty: number;
  coverage: number;
  waste: number;
} {
  const area = Math.max(0, Number(areaM2) || 0);
  if (area <= 0) {
    return { bigQty: 0, smallQty: 0, coverage: 0, waste: 0 };
  }

  let bestWaste = Infinity;
  let bestBig = 0;
  let bestSmall = 0;
  let bestCoverage = 0;
  let bestTotalPacks = Infinity;

  const maxBig = Math.ceil(area / bigYield) + 1;
  const maxSmall = Math.ceil(area / smallYield) + 1;

  for (let nBig = 0; nBig <= maxBig; nBig++) {
    for (let nSmall = 0; nSmall <= maxSmall; nSmall++) {
      if (nBig === 0 && nSmall === 0) continue;
      const coverage = Math.round((nBig * bigYield + nSmall * smallYield) * 10000) / 10000;
      if (coverage >= area - 1e-9) {
        const waste = Math.max(0, Math.round((coverage - area) * 10000) / 10000);
        const totalPacks = nBig + nSmall;

        if (waste < bestWaste - 1e-9) {
          bestWaste = waste;
          bestBig = nBig;
          bestSmall = nSmall;
          bestCoverage = coverage;
          bestTotalPacks = totalPacks;
        } else if (Math.abs(waste - bestWaste) <= 1e-9) {
          if (
            totalPacks < bestTotalPacks ||
            (totalPacks === bestTotalPacks && nBig > bestBig)
          ) {
            bestWaste = waste;
            bestBig = nBig;
            bestSmall = nSmall;
            bestCoverage = coverage;
            bestTotalPacks = totalPacks;
          }
        }
      }
    }
  }

  return {
    bigQty: bestBig,
    smallQty: bestSmall,
    coverage: bestCoverage,
    waste: bestWaste === Infinity ? 0 : bestWaste,
  };
}

function findCatalogInsumoProduct(
  kind: InsumoKind,
  priceTable: PriceTableTier,
  catalogOverride?: CatalogProduct[]
): { name: string; unit: string; price: number } {
  const catalog = catalogOverride ?? getDynamicProductCatalog();

  const pickPrice = (
    prod?: CatalogProduct,
    fallbackName: string = '',
    fallbackUnit: string = 'un'
  ) => {
    if (!prod) {
      return { name: fallbackName, unit: fallbackUnit, price: 0 };
    }
    return {
      name: prod.name,
      unit: prod.unit || fallbackUnit,
      price: getProductTierPrice(prod, priceTable),
    };
  };

  if (kind === 'autonivelante') {
    const candidates = catalog.filter((p) => {
      const cat = normalizeStr(p.category);
      const name = normalizeStr(p.name);
      return (
        (cat.includes('autonivelante') || name.includes('autonivelante')) &&
        !name.includes('primer') &&
        !name.includes('massa de preparacao') &&
        !name.includes('prepara pro')
      );
    });
    const preferred =
      candidates.find((p) => normalizeStr(p.name).includes('flexfloor')) ||
      candidates[0];
    return pickPrice(preferred, 'Autonivelante FLEXFLOOR Secagem 12h - 20Kg', 'saco');
  }

  if (kind === 'primer_18') {
    const candidates = catalog.filter((p) => {
      const cat = normalizeStr(p.category);
      const name = normalizeStr(p.name);
      return (
        (cat.includes('primer') || name.includes('primer')) &&
        (name.includes('18l') || name.includes('18 l') || name.includes('(18')) &&
        !name.includes('anti umidade') &&
        !name.includes('glass')
      );
    });
    const preferred =
      candidates.find((p) => normalizeStr(p.name).includes('flexfloor')) ||
      candidates[0];
    return pickPrice(
      preferred,
      'Primer para Autonivelante Flexfloor (18L) Base e Sobreposição',
      'balde'
    );
  }

  if (kind === 'primer_36') {
    const candidates = catalog.filter((p) => {
      const cat = normalizeStr(p.category);
      const name = normalizeStr(p.name);
      return (
        (cat.includes('primer') || name.includes('primer')) &&
        (name.includes('3,6') || name.includes('3.6')) &&
        !name.includes('anti umidade') &&
        !name.includes('glass')
      );
    });
    const preferred =
      candidates.find((p) => normalizeStr(p.name).includes('flexfloor')) ||
      candidates[0];
    return pickPrice(
      preferred,
      'Primer para Autonivelante Flexfloor (3,6L) Base e Sobreposição',
      'Balde'
    );
  }

  if (kind === 'cola_18') {
    const candidates = catalog.filter((p) => {
      const cat = normalizeStr(p.category);
      const name = normalizeStr(p.name);
      return (
        (cat.includes('cola para piso') ||
          (name.includes('cola') && name.includes('piso'))) &&
        (name.includes('18kg') || name.includes('18 kg') || name.includes('(18'))
      );
    });
    const preferred =
      candidates.find((p) => normalizeStr(p.name).includes('super tack')) ||
      candidates.find((p) => normalizeStr(p.name).includes('flexfloor')) ||
      candidates[0];
    return pickPrice(
      preferred,
      'Cola para Piso Vinlílico FlexFloor Super Tack (18KG)',
      'un'
    );
  }

  if (kind === 'primer_antiumidade') {
    const candidates = catalog.filter((p) => {
      const cat = normalizeStr(p.category);
      const name = normalizeStr(p.name);
      return (
        (cat.includes('primer') || name.includes('primer')) &&
        (name.includes('anti umidade') ||
          name.includes('antiumidade') ||
          name.includes('anti-umidade'))
      );
    });
    const preferred =
      candidates.find((p) => normalizeStr(p.name).includes('flexfloor')) ||
      candidates[0];
    return pickPrice(
      preferred,
      'Primer Anti Umidade Flexfloor  4Kg A+B  (3,3Kg + 0,70 Kg)',
      'balde'
    );
  }

  if (kind === 'globalfix_20') {
    const candidates = catalog.filter((p) => {
      const name = normalizeStr(p.name);
      return name.includes('globalfix');
    });
    const preferred =
      candidates.find((p) => {
        const n = normalizeStr(p.name);
        return /\b20\s*kg\b|\(20\b|20kg/.test(n);
      }) ||
      candidates.find((p) => {
        const n = normalizeStr(p.name);
        return /\b23\s*kg\b|\(23\b|23kg/.test(n);
      }) ||
      candidates[0];
    return pickPrice(preferred, 'Cola Globalfix 20Kg', 'balde');
  }

  if (kind === 'globalfix_36') {
    const candidates = catalog.filter((p) => {
      const name = normalizeStr(p.name);
      return name.includes('globalfix');
    });
    const preferred =
      candidates.find((p) => {
        const n = normalizeStr(p.name);
        return n.includes('3,6') || n.includes('3.6');
      }) ||
      candidates.find((p) => {
        const n = normalizeStr(p.name);
        return /\b4\s*kg\b|\(4\b|4kg/.test(n);
      }) ||
      candidates[0];
    return pickPrice(preferred, 'Cola Globalfix 3,6Kg', 'balde');
  }

  // cola_4
  const candidates = catalog.filter((p) => {
    const cat = normalizeStr(p.category);
    const name = normalizeStr(p.name);
    return (
      (cat.includes('cola para piso') ||
        (name.includes('cola') && name.includes('piso'))) &&
      (name.includes('4kg') || name.includes('4 kg') || name.includes('(4'))
    );
  });
  const preferred =
    candidates.find((p) => normalizeStr(p.name).includes('super tack')) ||
    candidates.find((p) => normalizeStr(p.name).includes('flexfloor')) ||
    candidates[0];
  return pickPrice(
    preferred,
    'Cola para Piso Vinlílico FlexFloor Super Tack (4KG)',
    'un'
  );
}

export type QuickBudgetRodapeHeight = '07cm' | '10cm' | '12cm' | '15cm';

export function isStrictPisoVinilicoCategory(
  categoryName?: string,
  categoryId?: string
): boolean {
  const cNorm = normalizeStr(categoryName);
  const cIdNorm = normalizeStr(categoryId);
  return (
    cIdNorm === '0368b74c-2647-4e35-aeee-a3a5667561fd' ||
    cIdNorm === 'cat_pisos_vinilicos' ||
    cNorm.includes('piso vinilico') ||
    cNorm.includes('pisos vinilicos')
  );
}

/**
 * Retorna candidatos reais do catálogo atual para o Orçamento Rápido de Piso,
 * respeitando exclusivamente a categoria Piso Vinílico e excluindo insumos/produtos de limpeza.
 */
export function getQuickBudgetPisoCandidates(
  pisoType: 'colado' | 'clicado',
  catalogOverride?: CatalogProduct[]
): CatalogProduct[] {
  const catalog = catalogOverride ?? getDynamicProductCatalog();
  const filtered = catalog.filter((p) => {
    if (!isStrictPisoVinilicoCategory(p.category, p.categoryId)) return false;
    if (!isPisoVinilicoProduct(p.name, p.category, p.categoryId)) return false;
    const isColado = isPisoVinilicoColado(p.name, p.category, p.categoryId);
    return pisoType === 'colado' ? isColado : !isColado;
  });

  const scoreProduct = (p: CatalogProduct): number => {
    const n = normalizeStr(p.name);
    let score = 0;
    if (pisoType === 'colado') {
      if (n.includes('flexfloor')) score += 100;
      if (/\b2\s*mm\b/.test(n)) score += 50;
      if (n.includes('5,70') || n.includes('5.70')) score += 30;
      if (n.includes('nova linha')) score += 10;
    } else {
      if (n.includes('vexa')) score += 100;
      if (/\b5\s*mm\b/.test(n)) score += 50;
      if (n.includes('2,90') || n.includes('2.90')) score += 30;
    }
    return score;
  };

  return [...filtered].sort((a, b) => scoreProduct(b) - scoreProduct(a));
}

/**
 * Retorna candidatos reais do catálogo atual para o Orçamento Rápido de Rodapé (07 cm, 10 cm, 12 cm ou 15 cm),
 * respeitando exclusivamente produtos pertencentes às categorias de Rodapé.
 */
export function getQuickBudgetRodapeCandidates(
  height: QuickBudgetRodapeHeight,
  catalogOverride?: CatalogProduct[]
): CatalogProduct[] {
  const catalog = catalogOverride ?? getDynamicProductCatalog();
  const heightRegexMap: Record<QuickBudgetRodapeHeight, RegExp> = {
    '07cm': /(?<![0-9])0?7\s*cm\b/i,
    '10cm': /(?<![0-9])10\s*cm\b/i,
    '12cm': /(?<![0-9])12\s*cm\b/i,
    '15cm': /(?<![0-9])15\s*cm\b/i,
  };
  const heightRegex = heightRegexMap[height];

  const filtered = catalog.filter((p) => {
    const cNorm = normalizeStr(p.category);
    const cIdNorm = normalizeStr(p.categoryId);
    const isRealRodapeCategory =
      cIdNorm === '54ff2da7-1c77-458d-834e-77acaf3063f8' ||
      cIdNorm === '5359db09-6718-4c3d-908f-59317607d223' ||
      cIdNorm.includes('rodape') ||
      (cNorm.includes('rodape') && !cNorm.includes('cola'));
    if (!isRealRodapeCategory) return false;
    if (!isRodapeProduct(p.name, p.category, p.categoryId)) return false;
    return heightRegex.test(normalizeStr(p.name));
  });

  const scoreProduct = (p: CatalogProduct): number => {
    const n = normalizeStr(p.name);
    const c = normalizeStr(p.category);
    let score = 0;
    if (c.includes('poliestireno') || n.includes('poliestireno')) score += 100;
    if (n.includes('branco')) score += 40;
    if (n.includes('premium')) score += 20;
    if (n.includes('2,40') || n.includes('2.40')) score += 10;
    if (n.includes('slim')) score += 5;
    return score;
  };

  return [...filtered].sort((a, b) => scoreProduct(b) - scoreProduct(a));
}

/**
 * Calcula a metragem efetiva das caixas (para o orçamento do piso) e calcula todos os insumos
 * EXCLUSIVAMENTE sobre a metragem originalmente solicitada pelo cliente (`requestedSqm`).
 */
export function calculatePisoInsumosForOrcamento(params: {
  productName: string;
  requestedSqm: number;
  effectiveSqm?: number;
  boxes?: number | null;
  priceTable: PriceTableTier;
  includePrimerAntiumidade?: boolean;
  skipCola?: boolean;
  catalogOverride?: CatalogProduct[];
  rendimentosOverride?: RendimentoItem[];
}): PisoInsumosPlan {
  const {
    productName,
    requestedSqm,
    effectiveSqm,
    boxes: boxesOverride,
    priceTable,
    includePrimerAntiumidade = false,
    skipCola = false,
    catalogOverride,
    rendimentosOverride,
  } = params;

  const boxYield = extractPisoBoxYield(productName, rendimentosOverride);
  const calc = calculateRealPisoMetragem(requestedSqm, boxYield);
  const finalRealSqm =
    effectiveSqm !== undefined && effectiveSqm > 0
      ? Math.round(effectiveSqm * 100) / 100
      : calc.realSqm;
  const finalBoxes = boxesOverride !== undefined ? boxesOverride : calc.boxes;
  const realSqmDisplay = formatSqmPtBr(finalRealSqm);

  // REGRA: Os insumos devem ser calculados EXCLUSIVAMENTE sobre a metragem originalmente solicitada!
  const insumoBaseSqm = Math.max(0, Number(requestedSqm) || 0);
  const insumos: CalculatedInsumoLine[] = [];

  if (insumoBaseSqm > 0) {
    // 1. Autonivelante: 0,255 saco por m² solicitado, arredondado para cima
    const autoQty = Math.ceil(insumoBaseSqm * 0.255 - 1e-9);
    if (autoQty > 0) {
      const cat = findCatalogInsumoProduct('autonivelante', priceTable, catalogOverride);
      insumos.push({
        kind: 'autonivelante',
        modalLabel: 'Autonivelante',
        quantity: autoQty,
        quantityDisplay: `${autoQty} ${autoQty === 1 ? 'saco' : 'sacos'}`,
        catalogName: cat.name,
        catalogUnit: cat.unit,
        catalogPrice: cat.price,
      });
    }

    // 2. Primer: 3,6 L (35 m²) e 18 L (175 m²) -> combinação com menor sobra sobre insumoBaseSqm
    const primer = solveMinimumWastePackages(insumoBaseSqm, 35, 175);
    if (primer.bigQty > 0) {
      const cat = findCatalogInsumoProduct('primer_18', priceTable, catalogOverride);
      insumos.push({
        kind: 'primer_18',
        modalLabel: 'Primer 18 L',
        quantity: primer.bigQty,
        quantityDisplay: `${primer.bigQty} ${primer.bigQty === 1 ? 'balde' : 'baldes'}`,
        catalogName: cat.name,
        catalogUnit: cat.unit,
        catalogPrice: cat.price,
      });
    }
    if (primer.smallQty > 0) {
      const cat = findCatalogInsumoProduct('primer_36', priceTable, catalogOverride);
      insumos.push({
        kind: 'primer_36',
        modalLabel: 'Primer 3,6 L',
        quantity: primer.smallQty,
        quantityDisplay: `${primer.smallQty} ${primer.smallQty === 1 ? 'balde' : 'baldes'}`,
        catalogName: cat.name,
        catalogUnit: cat.unit,
        catalogPrice: cat.price,
      });
    }

    // 3. Cola para Piso (apenas para instalação colada):
    //    - Tarkett Colado: Globalfix 3,6 kg (12 m²) e 20 kg (75 m²)
    //    - Demais pisos colados e Manta: 4 kg (13 m²) e 18 kg (60 m²)
    if (!skipCola) {
      if (isTarkettColado(productName)) {
        const globalfix = solveMinimumWastePackages(insumoBaseSqm, 12, 75);
        if (globalfix.bigQty > 0) {
          const cat = findCatalogInsumoProduct('globalfix_20', priceTable, catalogOverride);
          insumos.push({
            kind: 'globalfix_20',
            modalLabel: 'Globalfix 20 kg',
            quantity: globalfix.bigQty,
            quantityDisplay: `${globalfix.bigQty} ${globalfix.bigQty === 1 ? 'balde' : 'baldes'}`,
            catalogName: cat.name,
            catalogUnit: cat.unit,
            catalogPrice: cat.price,
          });
        }
        if (globalfix.smallQty > 0) {
          const cat = findCatalogInsumoProduct('globalfix_36', priceTable, catalogOverride);
          insumos.push({
            kind: 'globalfix_36',
            modalLabel: 'Globalfix 3,6 kg',
            quantity: globalfix.smallQty,
            quantityDisplay: `${globalfix.smallQty} ${globalfix.smallQty === 1 ? 'balde' : 'baldes'}`,
            catalogName: cat.name,
            catalogUnit: cat.unit,
            catalogPrice: cat.price,
          });
        }
      } else {
        const cola = solveMinimumWastePackages(insumoBaseSqm, 13, 60);
        if (cola.bigQty > 0) {
          const cat = findCatalogInsumoProduct('cola_18', priceTable, catalogOverride);
          insumos.push({
            kind: 'cola_18',
            modalLabel: 'Cola para Piso 18 kg',
            quantity: cola.bigQty,
            quantityDisplay: `${cola.bigQty} ${cola.bigQty === 1 ? 'balde' : 'baldes'}`,
            catalogName: cat.name,
            catalogUnit: cat.unit,
            catalogPrice: cat.price,
          });
        }
        if (cola.smallQty > 0) {
          const cat = findCatalogInsumoProduct('cola_4', priceTable, catalogOverride);
          insumos.push({
            kind: 'cola_4',
            modalLabel: 'Cola para Piso 4 kg',
            quantity: cola.smallQty,
            quantityDisplay: `${cola.smallQty} ${cola.smallQty === 1 ? 'balde' : 'baldes'}`,
            catalogName: cat.name,
            catalogUnit: cat.unit,
            catalogPrice: cat.price,
          });
        }
      }
    }

    // 4. Primer Antiumidade (somente quando O ambiente é térreo = Sim): rendimento de 5 m² por unidade sobre insumoBaseSqm
    if (includePrimerAntiumidade) {
      const antiQty = Math.ceil(insumoBaseSqm / 5 - 1e-9);
      if (antiQty > 0) {
        const cat = findCatalogInsumoProduct('primer_antiumidade', priceTable, catalogOverride);
        insumos.push({
          kind: 'primer_antiumidade',
          modalLabel: 'Primer Antiumidade',
          quantity: antiQty,
          quantityDisplay: `${antiQty} ${antiQty === 1 ? 'balde' : 'baldes'}`,
          catalogName: cat.name,
          catalogUnit: cat.unit,
          catalogPrice: cat.price,
        });
      }
    }
  }

  return {
    productName,
    requestedSqm: insumoBaseSqm,
    boxYield,
    boxes: finalBoxes,
    realSqm: finalRealSqm,
    realSqmDisplay,
    insumos,
  };
}
