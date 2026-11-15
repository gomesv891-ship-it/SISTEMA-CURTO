import {
  CatalogProduct,
  getDynamicProductCatalog,
  getProductTierPrice,
} from '../data/productCatalog';
import { PriceTableTier } from '../types';

/**
 * Utilitário de cálculo automático para produtos da categoria Rodapés no CRM Fênix World
 *
 * Regras:
 * 1. Ao informar metros lineares, identifica o comprimento da barra na descrição do produto,
 *    divide a metragem pelo comprimento da barra e arredonda para cima.
 * 2. Calcula insumos sobre a metragem linear efetiva (barras × comprimento da barra):
 *    - Cola para colar: ml ÷ 8 = kg necessários, combinando embalagens cadastradas (ex: 1,5 kg e 5 kg) com menor sobra.
 *    - Cola para calafetar: ml ÷ 6 = quantidade de bisnagas (400 g), arredondado para cima, com seletor dos produtos cadastrados.
 */

function normalizeStr(val?: string): string {
  return (val || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

export function formatMlPtBr(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return safe.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Identifica se um produto pertence à categoria de Rodapés
 */
export function isRodapeProduct(
  productName?: string,
  categoryName?: string,
  categoryId?: string
): boolean {
  const pName = (productName || '').trim().toLowerCase();
  const cName = (categoryName || '').trim().toLowerCase();
  const cId = (categoryId || '').trim().toLowerCase();

  // Excluir colas, adesivos, massas, cantos e perfis que não são barras de rodapé
  if (
    pName.includes('cola') ||
    pName.includes('adesivo') ||
    pName.includes('massa') ||
    pName.includes('suporte canto') ||
    pName.includes('perfil de arremate') ||
    cName.includes('cola')
  ) {
    return false;
  }

  // IDs conhecidos da categoria de rodapé
  if (
    cId === '54ff2da7-1c77-458d-834e-77acaf3063f8' || // RODAPÉS POLIESTIRENO
    cId === '5359db09-6718-4c3d-908f-59317607d223' || // RODAPÉS MDF
    cId.includes('rodape') ||
    cId.includes('rodapes')
  ) {
    return true;
  }

  // Verifica categoria
  if (
    cName.includes('rodapé') ||
    cName.includes('rodape') ||
    cName.includes('rodapés') ||
    cName.includes('rodapes')
  ) {
    return true;
  }

  // Verifica nome do produto
  if (
    pName.includes('rodapé') ||
    pName.includes('rodape') ||
    pName.includes('rodapés') ||
    pName.includes('rodapes')
  ) {
    return true;
  }

  return false;
}

/**
 * Extrai automaticamente o comprimento da barra a partir do nome ou descrição do produto.
 * Exemplos:
 * - "Rodapé POLIESTIRENO Premium BRANCO 07cm (2,40m) SLIM" -> 2.40
 * - "Barras de Rodapé POLIESTIRENO Premium BRANCO 10cm (2,00m)" -> 2.00
 * - "Rodapé MDF Madebene BRANCO 15cm (2,16m)" -> 2.16
 * - "Rodapé MDF Moldufama BRANCO 07cm (1,80m)" -> 1.80
 * Evita falso-positivo com unidades em mm/cm (ex: 3mm, 10cm).
 */
export function extractBarLengthFromProductName(
  productName?: string,
  defaultLength: number = 2.4
): number {
  if (!productName) return defaultLength;

  const str = productName.trim();

  // 1. Padrão explícito entre parênteses como (2,40m), (2.40m), (2,16m), (2m)
  const matchParentheses = str.match(/\(\s*(\d+(?:[.,]\d+)?)\s*m(?:etros?)?\s*\)/i);
  if (matchParentheses && matchParentheses[1]) {
    const val = parseFloat(matchParentheses[1].replace(',', '.'));
    if (!isNaN(val) && val > 0 && val < 10) {
      return val;
    }
  }

  // 2. Padrão fora de parênteses com 'm' ou 'metros', garantindo que não é 'mm' nem 'cm'
  const matchGeneric = str.match(/(?<![a-zA-Z0-9.,])(\d+(?:[.,]\d+)?)\s*(?:m\b|metros?\b)(?!m)/i);
  if (matchGeneric && matchGeneric[1]) {
    const val = parseFloat(matchGeneric[1].replace(',', '.'));
    if (!isNaN(val) && val >= 0.5 && val <= 6.0) {
      return val;
    }
  }

  return defaultLength;
}

export interface RodapeCalculationResult {
  metrosDesejados: number;
  comprimentoBarra: number;
  barrasNecessarias: number;
  metragemTotalFornecida: number;
  sobraMetros: number;
  valorTotal: number;
  textoResumo: string;
}

/**
 * Realiza o cálculo automático de barras de rodapé
 */
export function calculateRodapeBarras(
  metrosLineares: number,
  comprimentoBarra: number = 2.4,
  precoUnitario: number = 0
): RodapeCalculationResult {
  const ml = Math.max(0, Number(metrosLineares) || 0);
  const barLen = Math.max(0.1, Number(comprimentoBarra) || 2.4);
  const unitPrice = Math.max(0, Number(precoUnitario) || 0);

  // Arredonda SEMPRE para cima (com tolerância contra imprecisão de ponto flutuante)
  const barras = ml > 0 ? Math.ceil(ml / barLen - 1e-9) : 0;
  const metragemTotal = Math.round(barras * barLen * 100) / 100;
  const sobra = Math.max(0, Math.round((metragemTotal - ml) * 100) / 100);
  const valorTotal = Math.round(barras * unitPrice * 100) / 100;

  const barLenFormatted = barLen.toFixed(2).replace('.', ',');
  const mlFormatted = ml.toFixed(2).replace('.', ',');
  const totalMlFormatted = metragemTotal.toFixed(2).replace('.', ',');

  const textoResumo =
    ml > 0
      ? `${barras} ${barras === 1 ? 'barra' : 'barras'} de ${barLenFormatted}m (${totalMlFormatted}m para ${mlFormatted}m lineares)`
      : '';

  return {
    metrosDesejados: ml,
    comprimentoBarra: barLen,
    barrasNecessarias: barras,
    metragemTotalFornecida: metragemTotal,
    sobraMetros: sobra,
    valorTotal,
    textoResumo,
  };
}

/**
 * Formata o detalhe do item de rodapé identificando a metragem originalmente solicitada (ML)
 * e a quantidade de barras calculada (além da metragem total comprada em ML).
 * Preserva observações manuais personalizadas existentes quando houver.
 */
export function formatRodapeDetailText(params: {
  requestedMl: number;
  barCount: number;
  barLengthMeters: number;
  existingDetail?: string;
}): string {
  const { requestedMl, barCount, barLengthMeters, existingDetail } = params;
  const count = Math.max(0, Math.round(barCount));
  if (count <= 0) return (existingDetail || '').trim();

  const barLen = Math.max(0.1, Number(barLengthMeters) || 2.4);
  const safeReqMl = Math.max(0, Number(requestedMl) || 0);
  const effectiveMl = Math.round(count * barLen * 100) / 100;
  const barWord = count === 1 ? 'barra' : 'barras';
  const barLenFormatted = barLen.toFixed(2).replace('.', ',');

  const autoBadge =
    safeReqMl > 0
      ? `Solicitado: ${formatMlPtBr(safeReqMl)} ml • ${count} ${barWord} de ${barLenFormatted}m (${formatMlPtBr(effectiveMl)} ml)`
      : `${count} ${barWord} de ${barLenFormatted}m (${formatMlPtBr(effectiveMl)} ml)`;

  const trimmed = (existingDetail || '').trim();
  if (!trimmed) {
    return autoBadge;
  }

  // Remove bloco automático anterior caso já exista, preservando eventual observação manual (ex: cor/modelo)
  const autoBlockRegex =
    /(?:Solicitado:\s*[0-9.,]+\s*ml?\s*[•\-—]\s*)?\d+\s*barras?\s+de\s+[0-9.,]+\s*m\s*\([^)]*\)/i;
  if (autoBlockRegex.test(trimmed)) {
    const updated = trimmed.replace(autoBlockRegex, autoBadge).trim();
    return updated;
  }

  return `${autoBadge} — ${trimmed}`;
}

/**
 * Remove o bloco automático complementar de rodapé (metragem solicitada, barras, metragem efetiva)
 * para exibição limpa na tabela de Itens do Orçamento, preservando eventual observação manual.
 */
export function stripRodapeAutoDetail(subtitle?: string): string | undefined {
  if (!subtitle) return undefined;
  const autoBlockRegex =
    /(?:Solicitado:\s*[0-9.,]+\s*ml?\s*[•\-—]\s*)?\d+\s*barras?\s+de\s+[0-9.,]+\s*m\s*(?:\([^)]*\))?/gi;
  const cleaned = subtitle
    .replace(autoBlockRegex, '')
    .replace(/\s*[•\-—]+\s*$/g, '')
    .replace(/^\s*[•\-—]+\s*/g, '')
    .trim();
  return cleaned || undefined;
}

/**
 * Tenta extrair metros lineares e comprimento de barra de um subtítulo previamente gerado
 */
export function parseRodapeDetails(
  subtitle?: string
): { metrosDesejados?: number; comprimentoBarra?: number } | null {
  if (!subtitle) return null;
  const matchMeters =
    subtitle.match(/Solicitado:\s*([0-9.,]+)\s*ml?/i) ||
    subtitle.match(/para\s+([0-9.,]+)\s*m/i) ||
    subtitle.match(/([0-9.,]+)\s*m\s*lineares/i);
  const matchBar = subtitle.match(/de\s+([0-9.,]+)\s*m/i);

  const parseNum = (raw: string) => {
    const clean = raw.trim();
    if (clean.includes(',')) {
      return parseFloat(clean.replace(/\./g, '').replace(',', '.'));
    }
    return parseFloat(clean);
  };

  const metrosDesejados = matchMeters ? parseNum(matchMeters[1]) : undefined;
  const comprimentoBarra = matchBar ? parseNum(matchBar[1]) : undefined;

  if (
    (metrosDesejados !== undefined && Number.isFinite(metrosDesejados) && metrosDesejados > 0) ||
    (comprimentoBarra !== undefined && Number.isFinite(comprimentoBarra) && comprimentoBarra > 0)
  ) {
    return {
      metrosDesejados:
        metrosDesejados !== undefined && Number.isFinite(metrosDesejados)
          ? metrosDesejados
          : undefined,
      comprimentoBarra:
        comprimentoBarra !== undefined && Number.isFinite(comprimentoBarra)
          ? comprimentoBarra
          : undefined,
    };
  }
  return null;
}

/**
 * Extrai quantidade explícita de barras se o usuário informar algo como "10 barras" ou "10 bar"
 */
export function parseBarCountFromInput(inputVal?: string): number | null {
  const raw = (inputVal || '').trim();
  if (!raw) return null;
  const match = raw.match(/^(\d+)\s*(?:bar|barra|barras|br)\b/i);
  if (match && match[1]) {
    const parsed = parseInt(match[1], 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

/**
 * Converte valor digitado no campo Quantidade (metros lineares) em barras necessárias,
 * arredondando sempre para cima.
 * Exemplo: 20 ml ÷ 2,40m = 8,33 -> 9 barras (21,60 ml comprados)
 */
export function convertMetrosToBarras(
  inputVal: string | number,
  productName?: string,
  customBarLen?: number
): {
  barras: number;
  barLen: number;
  metros: number;
  effectiveMl: number;
  detailText: string;
} | null {
  if (inputVal === '' || inputVal === null || inputVal === undefined) return null;
  const str = String(inputVal).trim();
  if (!str) return null;
  const normalizedNumStr = str.includes(',')
    ? str.replace(/\./g, '').replace(',', '.')
    : str;
  const metros = parseFloat(normalizedNumStr);
  if (isNaN(metros) || metros <= 0) return null;

  const barLen = Math.max(
    0.1,
    customBarLen || extractBarLengthFromProductName(productName, 2.4)
  );

  const barras = Math.ceil(metros / barLen - 1e-9);
  const effectiveMl = Math.round(barras * barLen * 100) / 100;
  const detailText = formatRodapeDetailText({
    requestedMl: metros,
    barCount: barras,
    barLengthMeters: barLen,
  });
  return { barras, barLen, metros, effectiveMl, detailText };
}

// =========================================================================
// CÁLCULO DE INSUMOS DO RODAPÉ (COLA PARA COLAR & COLA PARA CALAFETAR)
// =========================================================================

export interface RodapeColaColarPackage {
  productId: string;
  catalogName: string;
  unit: string;
  weightKg: number;
  unitPrice: number;
}

export interface RodapeColaColarAllocation extends RodapeColaColarPackage {
  quantity: number;
  quantityDisplay: string;
}

export interface RodapeCalafetarOption {
  productId: string;
  catalogName: string;
  unit: string;
  unitPrice: number;
}

export interface RodapeInsumosPlan {
  rodapeName: string;
  barCount: number;
  barLengthMeters: number;
  effectiveMl: number;
  effectiveMlDisplay: string;
  insumoMl: number;
  insumoMlDisplay: string;
  requiredKgColar: number;
  requiredKgColarDisplay: string;
  colarQuantitySummary: string;
  colarItems: RodapeColaColarAllocation[];
  calafetarQuantity: number;
  calafetarQuantityDisplay: string;
  calafetarOptions: RodapeCalafetarOption[];
  selectedCalafetarId: string;
}

export function isRodapeColaCatalogProduct(prod: {
  name?: string;
  category?: string;
  categoryId?: string;
}): boolean {
  const cId = (prod.categoryId || '').trim().toLowerCase();
  const cNorm = normalizeStr(prod.category);
  const nNorm = normalizeStr(prod.name);

  if (nNorm.includes('piso')) return false;

  if (
    cId === '17e0cbc7-9c53-4284-ae38-a33e9d64cc18' ||
    cId === 'cat_cola_rodape'
  ) {
    return true;
  }

  if (cNorm.includes('cola') && cNorm.includes('rodape')) {
    return true;
  }

  if (nNorm.includes('cola') && nNorm.includes('rodape')) {
    return true;
  }

  return false;
}

export function isRodapeCalafetarCatalogProduct(prod: {
  name?: string;
  unit?: string;
}): boolean {
  const uNorm = normalizeStr(prod.unit);
  const nNorm = normalizeStr(prod.name);

  if (
    uNorm.includes('bisnaga') ||
    uNorm.includes('tubo') ||
    uNorm.includes('cartao') ||
    uNorm.includes('sache')
  ) {
    return true;
  }

  if (
    nNorm.includes('bisnaga') ||
    nNorm.includes('calafetar') ||
    /\b(?:0[.,])?400\s*g\b/i.test(nNorm) ||
    /\b0[.,]4\s*kg\b/i.test(nNorm)
  ) {
    return true;
  }

  return false;
}

export function extractRodapeColaWeightKg(productName?: string): number | null {
  const clean = (productName || '').trim();
  if (!clean) return null;
  const match = clean.match(/(\d+(?:[.,]\d+)?)\s*kg\b/i);
  if (match && match[1]) {
    const val = parseFloat(match[1].replace(',', '.'));
    if (Number.isFinite(val) && val > 0.45) {
      return val;
    }
  }
  return null;
}

function formatContainerUnitWord(unit: string, qty: number): string {
  const clean = (unit || 'un').trim();
  const norm = normalizeStr(clean);
  if (norm === 'balde' || norm === 'baldes') {
    return qty === 1 ? 'balde' : 'baldes';
  }
  if (norm === 'bisnaga' || norm === 'bisnagas') {
    return qty === 1 ? 'bisnaga' : 'bisnagas';
  }
  if (norm === 'unidade' || norm === 'unidades') {
    return qty === 1 ? 'unidade' : 'unidades';
  }
  return clean;
}

/**
 * Busca diretamente no cadastro atual do CRM as opções reais de:
 * - Cola para colar (embalagens em kg cadastradas, ex: 1,5 kg e 5 kg)
 * - Cola para calafetar (bisnagas / 400 g cadastradas)
 * Sem listas fixas de marcas ou produtos.
 */
export function getRodapeColaCatalogOptions(
  priceTable: PriceTableTier,
  rodapeName?: string,
  catalogOverride?: CatalogProduct[]
): {
  colarPackages: RodapeColaColarPackage[];
  calafetarOptions: RodapeCalafetarOption[];
} {
  const catalog = catalogOverride ?? getDynamicProductCatalog();
  const allRodapeColas = catalog.filter((p) => isRodapeColaCatalogProduct(p));

  const rodapeNorm = normalizeStr(rodapeName);

  const calafetarOptions: RodapeCalafetarOption[] = allRodapeColas
    .filter((p) => isRodapeCalafetarCatalogProduct(p))
    .map((p) => ({
      productId: p.id,
      catalogName: p.name,
      unit: p.unit || 'bisnaga',
      unitPrice: getProductTierPrice(p, priceTable),
    }));

  // Agrupar embalagens de cola para colar por peso em kg
  const byWeight = new Map<number, RodapeColaColarPackage[]>();
  for (const p of allRodapeColas) {
    if (isRodapeCalafetarCatalogProduct(p)) continue;
    const weight = extractRodapeColaWeightKg(p.name);
    if (!weight) continue;
    const list = byWeight.get(weight) || [];
    list.push({
      productId: p.id,
      catalogName: p.name,
      unit: p.unit || 'balde',
      weightKg: weight,
      unitPrice: getProductTierPrice(p, priceTable),
    });
    byWeight.set(weight, list);
  }

  const colarPackages: RodapeColaColarPackage[] = [];
  const rodapeTokens = rodapeNorm
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !['rodape', 'poliestireno', 'branco', 'preto', 'cinza', 'frisado', 'liso', 'barras', 'barra', 'premium', 'sobrepor', 'somente'].includes(t));

  for (const [, candidates] of Array.from(byWeight.entries()).sort((a, b) => a[0] - b[0])) {
    const matched =
      candidates.find((c) => {
        const cNorm = normalizeStr(c.catalogName);
        return rodapeTokens.some((tok) => cNorm.includes(tok));
      }) || candidates[0];
    if (matched) {
      colarPackages.push(matched);
    }
  }

  return { colarPackages, calafetarOptions };
}

/**
 * Escolhe a combinação de embalagens cadastradas de Cola para colar (ex: 1,5 kg e 5 kg)
 * que atende `requiredKg` com a menor sobra possível.
 * Em caso de empate na sobra, prefere menor quantidade de embalagens e depois embalagens maiores.
 */
export function solveMinimumWasteKgPackages(
  requiredKg: number,
  packages: RodapeColaColarPackage[]
): RodapeColaColarAllocation[] {
  const target = Math.max(0, Number(requiredKg) || 0);
  if (target <= 0 || packages.length === 0) return [];

  // Ordenar por peso decrescente para desempate limpo
  const sorted = [...packages].sort((a, b) => b.weightKg - a.weightKg);

  let bestWaste = Infinity;
  let bestCount = Infinity;
  let bestCombo: number[] = new Array(sorted.length).fill(0);

  const search = (
    idx: number,
    currentKg: number,
    currentTotalPacks: number,
    counts: number[]
  ) => {
    if (currentKg >= target - 1e-9) {
      const waste = Math.max(0, Math.round((currentKg - target) * 10000) / 10000);
      if (waste < bestWaste - 1e-9) {
        bestWaste = waste;
        bestCount = currentTotalPacks;
        bestCombo = [...counts];
      } else if (Math.abs(waste - bestWaste) <= 1e-9) {
        if (currentTotalPacks < bestCount) {
          bestCount = currentTotalPacks;
          bestCombo = [...counts];
        } else if (currentTotalPacks === bestCount) {
          // Prefere maior quantidade nas embalagens maiores (índices menores)
          for (let i = 0; i < counts.length; i++) {
            if (counts[i] !== bestCombo[i]) {
              if (counts[i] > bestCombo[i]) {
                bestCombo = [...counts];
              }
              break;
            }
          }
        }
      }
      return;
    }

    if (idx >= sorted.length) return;

    const pkg = sorted[idx];
    const remaining = Math.max(0, target - currentKg);
    const maxQty = Math.ceil(remaining / pkg.weightKg) + 1;

    // Se for o último pacote disponível, só precisa testar exatamente o mínimo que fecha target
    if (idx === sorted.length - 1) {
      const needed = Math.ceil(remaining / pkg.weightKg - 1e-9);
      counts[idx] = needed;
      search(
        idx + 1,
        currentKg + needed * pkg.weightKg,
        currentTotalPacks + needed,
        counts
      );
      counts[idx] = 0;
      return;
    }

    for (let q = maxQty; q >= 0; q--) {
      counts[idx] = q;
      search(
        idx + 1,
        currentKg + q * pkg.weightKg,
        currentTotalPacks + q,
        counts
      );
    }
    counts[idx] = 0;
  };

  search(0, 0, 0, new Array(sorted.length).fill(0));

  const allocations: RodapeColaColarAllocation[] = [];
  sorted.forEach((pkg, idx) => {
    const qty = bestCombo[idx] || 0;
    if (qty > 0) {
      allocations.push({
        ...pkg,
        quantity: qty,
        quantityDisplay: `${qty} ${formatContainerUnitWord(pkg.unit, qty)}`,
      });
    }
  });

  return allocations;
}

export function formatKgPtBr(kg: number): string {
  const safe = Math.round(Math.max(0, Number(kg) || 0) * 100) / 100;
  return safe.toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

/**
 * Calcula todos os insumos para um Rodapé.
 * Quando `requestedMl` é informado (ex.: 80 ml no Orçamento Rápido), os insumos consideram a
 * metragem linear solicitada (80 ÷ 8 = 10 kg -> 2 baldes de 5 kg), preservando as barras convertidas para o orçamento.
 */
export function calculateRodapeInsumosForOrcamento(params: {
  rodapeName: string;
  barCount: number;
  barLengthMeters?: number;
  requestedMl?: number;
  priceTable: PriceTableTier;
  selectedCalafetarId?: string;
  catalogOverride?: CatalogProduct[];
}): RodapeInsumosPlan {
  const {
    rodapeName,
    barCount,
    barLengthMeters: barLengthOverride,
    requestedMl,
    priceTable,
    selectedCalafetarId,
    catalogOverride,
  } = params;

  const safeBars = Math.max(0, Number(barCount) || 0);
  const barLengthMeters = Math.max(
    0.1,
    barLengthOverride ?? extractBarLengthFromProductName(rodapeName, 2.4)
  );
  const effectiveMl = Math.round(safeBars * barLengthMeters * 100) / 100;
  const effectiveMlDisplay = formatMlPtBr(effectiveMl);

  const insumoMl =
    requestedMl !== undefined && requestedMl > 0
      ? Math.round(requestedMl * 100) / 100
      : effectiveMl;
  const insumoMlDisplay = formatMlPtBr(insumoMl);

  const { colarPackages, calafetarOptions } = getRodapeColaCatalogOptions(
    priceTable,
    rodapeName,
    catalogOverride
  );

  // Cola para colar: ml ÷ 8 = kg necessários -> combinação de embalagens cadastradas com menor sobra
  const requiredKgColar = insumoMl > 0 ? Math.round((insumoMl / 8) * 10000) / 10000 : 0;
  const requiredKgColarDisplay = `${formatKgPtBr(requiredKgColar)} kg`;
  const colarItems = solveMinimumWasteKgPackages(requiredKgColar, colarPackages);
  const colarQuantitySummary = colarItems
    .map(
      (item) =>
        `${item.quantity} ${item.quantity === 1 ? 'balde' : 'baldes'} de ${formatKgPtBr(item.weightKg)} kg`
    )
    .join(' + ');

  // Cola para calafetar: ml ÷ 6 = quantidade de bisnagas (400 g), sempre arredondando para cima
  const calafetarQuantity = insumoMl > 0 ? Math.ceil(insumoMl / 6 - 1e-9) : 0;
  const resolvedCalafetar =
    calafetarOptions.find((opt) => opt.productId === selectedCalafetarId) ||
    calafetarOptions[0];
  const calafetarUnitWord = resolvedCalafetar
    ? formatContainerUnitWord(resolvedCalafetar.unit, calafetarQuantity)
    : calafetarQuantity === 1
    ? 'bisnaga'
    : 'bisnagas';

  return {
    rodapeName,
    barCount: safeBars,
    barLengthMeters,
    effectiveMl,
    effectiveMlDisplay,
    insumoMl,
    insumoMlDisplay,
    requiredKgColar,
    requiredKgColarDisplay,
    colarQuantitySummary,
    colarItems,
    calafetarQuantity,
    calafetarQuantityDisplay: `${calafetarQuantity} ${calafetarUnitWord}`,
    calafetarOptions,
    selectedCalafetarId: resolvedCalafetar?.productId || '',
  };
}
