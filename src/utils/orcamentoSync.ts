import { EspelhoItem } from '../components/EspelhoOrcamento';
import { CatalogProduct, getDynamicProductCatalog } from '../data/productCatalog';
import { PriceTableTier } from '../types';
import {
  CalculatedInsumoLine,
  calculatePisoInsumosForOrcamento,
  convertSqmToPisoBoxes,
  extractPisoBoxYield,
  formatBoxesDetail,
  isPisoVinilicoColado,
  isPisoVinilicoProduct,
  isSquareMeterUnit,
  parsePtBrNumeric,
} from './pisoInsumosCalculator';
import { RendimentoItem } from './rendimentosService';
import {
  calculateRodapeInsumosForOrcamento,
  extractBarLengthFromProductName,
  isRodapeCalafetarCatalogProduct,
  isRodapeColaCatalogProduct,
  parseBarCountFromInput,
  parseRodapeDetails,
  stripRodapeAutoDetail,
} from './rodapeCalculator';

export type PisoInsumoGroup =
  | 'autonivelante'
  | 'primer'
  | 'cola'
  | 'primer_antiumidade';

export type RodapeInsumoGroup = 'colar' | 'calafetar';

export interface PisoInsumoLink {
  hasInsumos: boolean;
  requestedSqm: number;
  lastEffectiveSqm: number;
  skipCola: boolean;
  includePrimerAntiumidade: boolean;
}

export interface RodapeInsumoLink {
  barLengthMeters: number;
  requestedMl?: number;
  lastBarras?: number;
  includeColar: boolean;
  includeCalafetar: boolean;
  calafetarProductId: string;
}

function normalizeStr(val?: string): string {
  return (val || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

export function getPisoInsumoGroupFromKind(
  kind: CalculatedInsumoLine['kind']
): PisoInsumoGroup {
  if (kind === 'autonivelante') return 'autonivelante';
  if (kind === 'primer_18' || kind === 'primer_36') return 'primer';
  if (kind === 'primer_antiumidade') return 'primer_antiumidade';
  return 'cola';
}

export function classifyPisoInsumoGroup(
  productName?: string,
  catalogOverride?: CatalogProduct[]
): PisoInsumoGroup | null {
  const norm = normalizeStr(productName);
  if (!norm) return null;

  if (
    norm.includes('limpa') ||
    norm.includes('limpeza') ||
    norm.includes('detergente') ||
    norm.includes('removedor') ||
    norm.includes('cera') ||
    norm.includes('rodape')
  ) {
    return null;
  }

  let catNorm = '';
  try {
    const catalog = catalogOverride ?? getDynamicProductCatalog();
    const matched = catalog.find((p) => normalizeStr(p.name) === norm);
    if (matched) {
      catNorm = normalizeStr(matched.category);
    }
  } catch {
    // ignore in isolated environments without browser storage
  }

  if (
    norm.includes('primer') &&
    (norm.includes('anti umidade') ||
      norm.includes('antiumidade') ||
      norm.includes('anti-umidade'))
  ) {
    return 'primer_antiumidade';
  }

  if (
    (catNorm.includes('autonivelante') || norm.includes('autonivelante') || norm.includes('auto nivelante')) &&
    !norm.includes('primer') &&
    !norm.includes('massa de preparacao') &&
    !norm.includes('prepara pro')
  ) {
    return 'autonivelante';
  }

  if (
    (catNorm.includes('primer') || norm.includes('primer')) &&
    !norm.includes('glass') &&
    !norm.includes('anti umidade') &&
    !norm.includes('antiumidade') &&
    !norm.includes('anti-umidade')
  ) {
    return 'primer';
  }

  if (
    (catNorm.includes('cola para piso') ||
      (norm.includes('cola') && norm.includes('piso'))) &&
    !norm.includes('rodape')
  ) {
    return 'cola';
  }

  return null;
}

export function classifyRodapeInsumoGroup(
  productName?: string,
  unit?: string,
  catalogOverride?: CatalogProduct[]
): RodapeInsumoGroup | null {
  const norm = normalizeStr(productName);
  if (!norm || norm.includes('piso')) return null;

  let matchedProd: CatalogProduct | undefined;
  try {
    const catalog = catalogOverride ?? getDynamicProductCatalog();
    matchedProd = catalog.find((p) => normalizeStr(p.name) === norm);
  } catch {
    // ignore in isolated environments
  }

  const isRodapeCola =
    isRodapeColaCatalogProduct({
      name: productName,
      category: matchedProd?.category,
      categoryId: matchedProd?.categoryId,
    }) || norm.includes('calafetar');

  if (!isRodapeCola) {
    return null;
  }

  return isRodapeCalafetarCatalogProduct({ name: productName, unit })
    ? 'calafetar'
    : 'colar';
}

export function applyPisoTableQuantityChange(params: {
  item: EspelhoItem;
  rawQtdVal: string;
  existingLink?: PisoInsumoLink;
  rendimentosOverride?: RendimentoItem[];
}): {
  updatedItem: EspelhoItem;
  requestedSqm: number;
  effectiveSqm: number;
  boxes: number | null;
} {
  const { item, rawQtdVal, existingLink, rendimentosOverride } = params;
  const parsedNum = parsePtBrNumeric(rawQtdVal);
  const boxYield = isSquareMeterUnit(item.unidade)
    ? extractPisoBoxYield(item.descricao, rendimentosOverride)
    : null;

  if (!rawQtdVal.trim() || parsedNum <= 0) {
    return {
      updatedItem: {
        ...item,
        qtd: rawQtdVal,
        total: 0,
      },
      requestedSqm: 0,
      effectiveSqm: 0,
      boxes: boxYield ? 0 : null,
    };
  }

  if (boxYield && boxYield > 0) {
    const matchesPreviousEffective =
      existingLink &&
      existingLink.lastEffectiveSqm > 0 &&
      Math.abs(parsedNum - existingLink.lastEffectiveSqm) <= 0.005;

    const requestedSqm = matchesPreviousEffective
      ? existingLink.requestedSqm
      : parsedNum;

    const conv = convertSqmToPisoBoxes(requestedSqm, boxYield, item.subtitulo);
    const total = Math.round(conv.realSqm * item.precoUnitario * 100) / 100;

    return {
      updatedItem: {
        ...item,
        qtd: conv.realSqmDisplay,
        subtitulo: conv.detailText || item.subtitulo,
        total,
      },
      requestedSqm,
      effectiveSqm: conv.realSqm,
      boxes: conv.boxes,
    };
  }

  const effectiveSqm = Math.round(parsedNum * 100) / 100;
  const total = Math.round(effectiveSqm * item.precoUnitario * 100) / 100;
  return {
    updatedItem: {
      ...item,
      qtd: rawQtdVal,
      total,
    },
    requestedSqm: parsedNum,
    effectiveSqm,
    boxes: null,
  };
}

export function applyRodapeTableQuantityChange(params: {
  item: EspelhoItem;
  rawQtdVal: string;
  existingLink?: RodapeInsumoLink;
  barLengthMeters?: number;
  forceTreatAsMl?: boolean;
  inputMode?: 'barras' | 'ml';
}): {
  updatedItem: EspelhoItem;
  bars: number;
  requestedMl: number;
  barLen: number;
  effectiveMl: number;
} {
  const {
    item,
    rawQtdVal,
    existingLink,
    barLengthMeters,
    forceTreatAsMl = false,
    inputMode = forceTreatAsMl ? 'ml' : 'barras',
  } = params;
  const barLen = Math.max(
    0.1,
    barLengthMeters ??
      item.barLengthMeters ??
      existingLink?.barLengthMeters ??
      extractBarLengthFromProductName(item.descricao, 2.4)
  );

  const explicitBars = parseBarCountFromInput(rawQtdVal);
  if (explicitBars && explicitBars > 0) {
    const bars = explicitBars;
    const effectiveMl = Math.round(bars * barLen * 100) / 100;
    const requestedMl = effectiveMl;
    const total = Math.round(bars * item.precoUnitario * 100) / 100;
    const nextSubtitulo = stripRodapeAutoDetail(item.subtitulo);
    return {
      updatedItem: {
        ...item,
        qtd: String(bars),
        unidade: item.unidade || 'barras',
        subtitulo: nextSubtitulo,
        requestedMl,
        barLengthMeters: barLen,
        total,
      },
      bars,
      requestedMl,
      barLen,
      effectiveMl,
    };
  }

  const parsedNum = parsePtBrNumeric(rawQtdVal);
  if (!rawQtdVal.trim() || parsedNum <= 0) {
    return {
      updatedItem: {
        ...item,
        qtd: rawQtdVal,
        total: 0,
      },
      bars: 0,
      requestedMl: 0,
      barLen,
      effectiveMl: 0,
    };
  }

  if (inputMode === 'barras') {
    const bars = Math.max(1, Math.round(parsedNum));
    const effectiveMl = Math.round(bars * barLen * 100) / 100;
    const preservedExistingReqMl =
      existingLink?.lastBarras !== undefined &&
      bars === existingLink.lastBarras &&
      (item.requestedMl ?? existingLink.requestedMl)
        ? (item.requestedMl ?? existingLink.requestedMl!)
        : effectiveMl;
    const total = Math.round(bars * item.precoUnitario * 100) / 100;
    const nextSubtitulo = stripRodapeAutoDetail(item.subtitulo);
    return {
      updatedItem: {
        ...item,
        qtd: String(bars),
        unidade: item.unidade || 'barras',
        subtitulo: nextSubtitulo,
        requestedMl: preservedExistingReqMl,
        barLengthMeters: barLen,
        total,
      },
      bars,
      requestedMl: preservedExistingReqMl,
      barLen,
      effectiveMl,
    };
  }

  // Modo ML: valor digitado representa metros lineares (ML) -> converte em barras arredondando para cima
  const requestedMl = parsedNum;
  const bars = Math.max(1, Math.ceil(requestedMl / barLen - 1e-9));
  const effectiveMl = Math.round(bars * barLen * 100) / 100;
  const total = Math.round(bars * item.precoUnitario * 100) / 100;
  const nextSubtitulo = stripRodapeAutoDetail(item.subtitulo);

  return {
    updatedItem: {
      ...item,
      qtd: String(bars),
      unidade: item.unidade || 'barras',
      subtitulo: nextSubtitulo,
      requestedMl,
      barLengthMeters: barLen,
      total,
    },
    bars,
    requestedMl,
    barLen,
    effectiveMl,
  };
}

export function ensurePisoLinkForExistingBudget(params: {
  itemsList: EspelhoItem[];
  pisoItem: EspelhoItem;
  pisoLinks: Map<string, PisoInsumoLink>;
  removedGroups: Set<PisoInsumoGroup>;
  catalogOverride?: CatalogProduct[];
  rendimentosOverride?: RendimentoItem[];
}): void {
  const {
    itemsList,
    pisoItem,
    pisoLinks,
    removedGroups,
    catalogOverride,
    rendimentosOverride,
  } = params;

  if (pisoLinks.has(pisoItem.id)) return;
  if (!isPisoVinilicoProduct(pisoItem.descricao)) return;

  const presentGroups = new Set<PisoInsumoGroup>();
  for (const it of itemsList) {
    const grp = classifyPisoInsumoGroup(it.descricao, catalogOverride);
    if (grp) presentGroups.add(grp);
  }

  if (presentGroups.size === 0) return;

  // Para orçamentos reabertos sem metadado em memória, preserva grupos ausentes como excluídos
  // para não recriar insumos que o usuário tenha removido antes de salvar.
  const standardGroups: PisoInsumoGroup[] = ['autonivelante', 'primer', 'cola'];
  for (const g of standardGroups) {
    if (!presentGroups.has(g)) {
      removedGroups.add(g);
    }
  }

  const parsedQty = Math.max(0, parsePtBrNumeric(pisoItem.qtd));
  const boxYield = extractPisoBoxYield(pisoItem.descricao, rendimentosOverride);
  const boxesFromDetail =
    boxYield && boxYield > 0 ? Math.max(1, Math.round(parsedQty / boxYield)) : null;

  pisoLinks.set(pisoItem.id, {
    hasInsumos: true,
    requestedSqm: parsedQty,
    lastEffectiveSqm:
      boxesFromDetail && boxYield
        ? Math.round(boxesFromDetail * boxYield * 100) / 100
        : parsedQty,
    skipCola: !isPisoVinilicoColado(pisoItem.descricao),
    includePrimerAntiumidade: presentGroups.has('primer_antiumidade'),
  });
}

export function ensureRodapeLinkForExistingBudgetList(params: {
  itemsList: EspelhoItem[];
  rodapeItem: EspelhoItem;
  rodapeLinks: Map<string, RodapeInsumoLink>;
  priceTable: PriceTableTier;
  catalogOverride?: CatalogProduct[];
}): void {
  const { itemsList, rodapeItem, rodapeLinks, priceTable, catalogOverride } = params;
  if (rodapeLinks.has(rodapeItem.id)) return;

  const existingColar = itemsList.some(
    (it) => classifyRodapeInsumoGroup(it.descricao, it.unidade, catalogOverride) === 'colar'
  );
  const existingCalafetarItem = itemsList.find(
    (it) =>
      classifyRodapeInsumoGroup(it.descricao, it.unidade, catalogOverride) === 'calafetar'
  );
  if (!existingColar && !existingCalafetarItem) return;

  const liveOptions = calculateRodapeInsumosForOrcamento({
    rodapeName: rodapeItem.descricao,
    barCount: Math.max(1, parsePtBrNumeric(rodapeItem.qtd)),
    priceTable,
    catalogOverride,
  });
  const matchedCal = existingCalafetarItem
    ? liveOptions.calafetarOptions.find(
        (o) =>
          normalizeStr(o.catalogName) === normalizeStr(existingCalafetarItem.descricao)
      )
    : undefined;

  const parsedSub = parseRodapeDetails(rodapeItem.subtitulo);
  const savedBars = Math.max(0, parsePtBrNumeric(rodapeItem.qtd));
  const barLen =
    rodapeItem.barLengthMeters ||
    extractBarLengthFromProductName(rodapeItem.descricao, 2.4);

  rodapeLinks.set(rodapeItem.id, {
    barLengthMeters: barLen,
    requestedMl:
      (rodapeItem.requestedMl && rodapeItem.requestedMl > 0
        ? rodapeItem.requestedMl
        : undefined) ??
      (parsedSub?.metrosDesejados && parsedSub.metrosDesejados > 0
        ? parsedSub.metrosDesejados
        : undefined),
    lastBarras: savedBars > 0 ? savedBars : undefined,
    includeColar: existingColar,
    includeCalafetar: Boolean(existingCalafetarItem),
    calafetarProductId:
      matchedCal?.productId || liveOptions.calafetarOptions[0]?.productId || '',
  });
}

export function syncPisoInsumosInItemsList(params: {
  currentItems: EspelhoItem[];
  pisoLinks: Map<string, PisoInsumoLink>;
  lockedGroups: Set<PisoInsumoGroup>;
  removedGroups: Set<PisoInsumoGroup>;
  priceTable: PriceTableTier;
  catalogOverride?: CatalogProduct[];
  rendimentosOverride?: RendimentoItem[];
}): EspelhoItem[] {
  const {
    currentItems,
    pisoLinks,
    lockedGroups,
    removedGroups,
    priceTable,
    catalogOverride,
    rendimentosOverride,
  } = params;

  const activeLinkedItems: Array<{ item: EspelhoItem; link: PisoInsumoLink }> = [];
  for (const item of currentItems) {
    const link = pisoLinks.get(item.id);
    if (link && link.hasInsumos) {
      activeLinkedItems.push({ item, link });
    }
  }

  if (activeLinkedItems.length === 0) {
    return currentItems;
  }

  let totalRequestedSqmAll = 0;
  let totalRequestedSqmCola = 0;
  let totalRequestedSqmAntiumidade = 0;
  let referencePisoName = activeLinkedItems[0].item.descricao;

  for (const { item, link } of activeLinkedItems) {
    const req = Math.max(0, link.requestedSqm);
    totalRequestedSqmAll = Math.round((totalRequestedSqmAll + req) * 1000) / 1000;
    if (!link.skipCola && req > 0) {
      totalRequestedSqmCola = Math.round((totalRequestedSqmCola + req) * 1000) / 1000;
    }
    if (link.includePrimerAntiumidade && req > 0) {
      totalRequestedSqmAntiumidade =
        Math.round((totalRequestedSqmAntiumidade + req) * 1000) / 1000;
    }
  }

  // Se o usuário apagou o campo temporariamente (0) antes de digitar o novo valor,
  // zera os insumos não-travados sem destruir os vínculos.
  if (totalRequestedSqmAll <= 0) {
    return currentItems.map((it) => {
      const grp = classifyPisoInsumoGroup(it.descricao, catalogOverride);
      if (!grp || lockedGroups.has(grp) || removedGroups.has(grp)) {
        return it;
      }
      return {
        ...it,
        qtd: '0',
        total: 0,
      };
    });
  }

  const basePlan = calculatePisoInsumosForOrcamento({
    productName: referencePisoName,
    requestedSqm: totalRequestedSqmAll,
    priceTable,
    includePrimerAntiumidade: false,
    skipCola: true,
    catalogOverride,
    rendimentosOverride,
  });

  const desiredLines: CalculatedInsumoLine[] = [...basePlan.insumos];

  if (totalRequestedSqmCola > 0) {
    const colaPlan = calculatePisoInsumosForOrcamento({
      productName: referencePisoName,
      requestedSqm: totalRequestedSqmCola,
      priceTable,
      includePrimerAntiumidade: false,
      skipCola: false,
      catalogOverride,
      rendimentosOverride,
    });
    for (const line of colaPlan.insumos) {
      if (line.kind === 'cola_18' || line.kind === 'cola_4') {
        desiredLines.push(line);
      }
    }
  }

  if (totalRequestedSqmAntiumidade > 0) {
    const antiPlan = calculatePisoInsumosForOrcamento({
      productName: referencePisoName,
      requestedSqm: totalRequestedSqmAntiumidade,
      priceTable,
      includePrimerAntiumidade: true,
      skipCola: true,
      catalogOverride,
      rendimentosOverride,
    });
    for (const line of antiPlan.insumos) {
      if (line.kind === 'primer_antiumidade') {
        desiredLines.push(line);
      }
    }
  }

  const desiredByName = new Map<
    string,
    { line: CalculatedInsumoLine; group: PisoInsumoGroup }
  >();
  const activeManagedGroups = new Set<PisoInsumoGroup>();

  for (const line of desiredLines) {
    const group = getPisoInsumoGroupFromKind(line.kind);
    if (lockedGroups.has(group) || removedGroups.has(group)) continue;
    activeManagedGroups.add(group);
    const key = normalizeStr(line.catalogName);
    const prev = desiredByName.get(key);
    if (prev) {
      desiredByName.set(key, {
        group,
        line: {
          ...prev.line,
          quantity: prev.line.quantity + line.quantity,
        },
      });
    } else {
      desiredByName.set(key, { line, group });
    }
  }

  // Se havia cola antes mas todos os pisos restantes são Clicado, ainda gerencia 'cola' se não travado
  if (totalRequestedSqmCola === 0 && !lockedGroups.has('cola') && !removedGroups.has('cola')) {
    activeManagedGroups.add('cola');
  }
  if (
    totalRequestedSqmAntiumidade === 0 &&
    !lockedGroups.has('primer_antiumidade') &&
    !removedGroups.has('primer_antiumidade')
  ) {
    activeManagedGroups.add('primer_antiumidade');
  }

  const next = [...currentItems];
  const seenNames = new Set<string>();
  const firstIndexByGroup = new Map<PisoInsumoGroup, number>();

  for (let i = next.length - 1; i >= 0; i--) {
    const it = next[i];
    const grp = classifyPisoInsumoGroup(it.descricao, catalogOverride);
    if (!grp) continue;

    // Respeitar edições/exclusões manuais
    if (lockedGroups.has(grp) || removedGroups.has(grp)) {
      continue;
    }

    if (!activeManagedGroups.has(grp)) {
      continue;
    }

    const normName = normalizeStr(it.descricao);
    const target = desiredByName.get(normName);

    if (target && !seenNames.has(normName)) {
      seenNames.add(normName);
      const resolvedPrice =
        it.precoUnitario > 0 ? it.precoUnitario : target.line.catalogPrice;
      next[i] = {
        ...it,
        qtd: String(target.line.quantity),
        precoUnitario: resolvedPrice,
        total: Math.round(target.line.quantity * resolvedPrice * 100) / 100,
      };
      firstIndexByGroup.set(grp, i);
    } else {
      // Remove pacote antigo que mudou (ex: Cola 4KG -> Cola 18KG, Primer 3,6L -> 18L) ou duplicata
      firstIndexByGroup.set(grp, i);
      next.splice(i, 1);
    }
  }

  const ts = Date.now();
  let idxCounter = 0;

  for (const [normKey, { line, group }] of desiredByName.entries()) {
    if (seenNames.has(normKey)) continue;
    seenNames.add(normKey);
    const newInsumo: EspelhoItem = {
      id: `item_${ts}_pins_${idxCounter++}_${Math.random().toString(36).substring(2, 6)}`,
      qtd: String(line.quantity),
      descricao: line.catalogName,
      unidade: line.catalogUnit,
      precoUnitario: line.catalogPrice,
      total: Math.round(line.quantity * line.catalogPrice * 100) / 100,
    };

    const insertPos = firstIndexByGroup.get(group);
    if (insertPos !== undefined && insertPos >= 0 && insertPos <= next.length) {
      next.splice(insertPos, 0, newInsumo);
    } else {
      next.push(newInsumo);
    }
  }

  return next;
}

export function syncRodapeInsumosInItemsList(params: {
  currentItems: EspelhoItem[];
  rodapeLinks: Map<string, RodapeInsumoLink>;
  lockedGroups: Set<RodapeInsumoGroup>;
  removedGroups: Set<RodapeInsumoGroup>;
  priceTable: PriceTableTier;
  referenceRodapeName?: string;
  catalogOverride?: CatalogProduct[];
}): EspelhoItem[] {
  const {
    currentItems,
    rodapeLinks,
    lockedGroups,
    removedGroups,
    priceTable,
    referenceRodapeName,
    catalogOverride,
  } = params;

  if (rodapeLinks.size === 0) return currentItems;

  let totalMlColar = 0;
  let hasAnyColarLink = false;
  let hasAnyCalafetarLink = false;
  const calafetarMlByProductId = new Map<string, number>();
  let firstLinkedRodapeName = referenceRodapeName || '';

  for (const item of currentItems) {
    const link = rodapeLinks.get(item.id);
    if (!link) continue;
    if (!firstLinkedRodapeName) firstLinkedRodapeName = item.descricao;
    const bars = Math.max(0, parsePtBrNumeric(item.qtd));
    const effMl = Math.round(bars * link.barLengthMeters * 100) / 100;
    const baseMl =
      link.requestedMl && link.requestedMl > 0 ? link.requestedMl : effMl;
    if (link.includeColar) {
      hasAnyColarLink = true;
      if (baseMl > 0) {
        totalMlColar = Math.round((totalMlColar + baseMl) * 100) / 100;
      }
    }
    if (link.includeCalafetar && link.calafetarProductId) {
      hasAnyCalafetarLink = true;
      if (baseMl > 0) {
        calafetarMlByProductId.set(
          link.calafetarProductId,
          Math.round(
            ((calafetarMlByProductId.get(link.calafetarProductId) || 0) + baseMl) *
              100
          ) / 100
        );
      }
    }
  }

  const colarPlan = calculateRodapeInsumosForOrcamento({
    rodapeName: firstLinkedRodapeName || 'Rodapé',
    barCount: totalMlColar,
    barLengthMeters: 1,
    priceTable,
    catalogOverride,
  });

  const desiredColarByName = new Map<
    string,
    {
      catalogName: string;
      unit: string;
      quantity: number;
      unitPrice: number;
    }
  >();
  if (!lockedGroups.has('colar') && !removedGroups.has('colar')) {
    for (const c of colarPlan.colarItems) {
      if (c.quantity > 0) {
        desiredColarByName.set(normalizeStr(c.catalogName), {
          catalogName: c.catalogName,
          unit: c.unit,
          quantity: c.quantity,
          unitPrice: c.unitPrice,
        });
      }
    }
  }

  const desiredCalafetarByName = new Map<
    string,
    {
      catalogName: string;
      unit: string;
      quantity: number;
      unitPrice: number;
    }
  >();
  if (!lockedGroups.has('calafetar') && !removedGroups.has('calafetar')) {
    for (const [calId, calMl] of calafetarMlByProductId.entries()) {
      const calPlan = calculateRodapeInsumosForOrcamento({
        rodapeName: firstLinkedRodapeName || 'Rodapé',
        barCount: calMl,
        barLengthMeters: 1,
        priceTable,
        selectedCalafetarId: calId,
        catalogOverride,
      });
      const opt =
        calPlan.calafetarOptions.find((o) => o.productId === calId) ||
        calPlan.calafetarOptions[0];
      if (opt && calPlan.calafetarQuantity > 0) {
        const key = normalizeStr(opt.catalogName);
        const prevEntry = desiredCalafetarByName.get(key);
        const totalQty = (prevEntry?.quantity || 0) + calPlan.calafetarQuantity;
        desiredCalafetarByName.set(key, {
          catalogName: opt.catalogName,
          unit: opt.unit,
          quantity: totalQty,
          unitPrice: opt.unitPrice,
        });
      }
    }
  }

  const next = [...currentItems];
  const seenColarNames = new Set<string>();
  const seenCalafetarNames = new Set<string>();
  let firstColarPos: number | undefined;
  let firstCalafetarPos: number | undefined;

  for (let i = next.length - 1; i >= 0; i--) {
    const it = next[i];
    const normName = normalizeStr(it.descricao);
    const grp = classifyRodapeInsumoGroup(it.descricao, it.unidade, catalogOverride);
    if (!grp) continue;

    if (grp === 'calafetar') {
      if (lockedGroups.has('calafetar') || removedGroups.has('calafetar')) {
        continue;
      }
      if (hasAnyCalafetarLink && calafetarMlByProductId.size === 0) {
        // Barras temporariamente zeradas durante digitação
        next[i] = { ...it, qtd: '0', total: 0 };
        continue;
      }
      const target = desiredCalafetarByName.get(normName);
      if (target && !seenCalafetarNames.has(normName)) {
        seenCalafetarNames.add(normName);
        const resolvedPrice =
          it.precoUnitario > 0 ? it.precoUnitario : target.unitPrice;
        next[i] = {
          ...it,
          qtd: String(target.quantity),
          precoUnitario: resolvedPrice,
          total: Math.round(target.quantity * resolvedPrice * 100) / 100,
        };
        firstCalafetarPos = i;
      } else {
        firstCalafetarPos = i;
        next.splice(i, 1);
      }
    } else {
      if (lockedGroups.has('colar') || removedGroups.has('colar')) {
        continue;
      }
      if (hasAnyColarLink && totalMlColar === 0) {
        // Barras temporariamente zeradas durante digitação
        next[i] = { ...it, qtd: '0', total: 0 };
        continue;
      }
      const target = desiredColarByName.get(normName);
      if (target && !seenColarNames.has(normName)) {
        seenColarNames.add(normName);
        const resolvedPrice =
          it.precoUnitario > 0 ? it.precoUnitario : target.unitPrice;
        next[i] = {
          ...it,
          qtd: String(target.quantity),
          precoUnitario: resolvedPrice,
          total: Math.round(target.quantity * resolvedPrice * 100) / 100,
        };
        firstColarPos = i;
      } else {
        firstColarPos = i;
        next.splice(i, 1);
      }
    }
  }

  const ts = Date.now();
  let idxCounter = 0;

  for (const [key, target] of desiredColarByName.entries()) {
    if (seenColarNames.has(key)) continue;
    seenColarNames.add(key);
    const newItem: EspelhoItem = {
      id: `item_${ts}_rcolar_${idxCounter++}_${Math.random().toString(36).substring(2, 6)}`,
      qtd: String(target.quantity),
      descricao: target.catalogName,
      unidade: target.unit,
      precoUnitario: target.unitPrice,
      total: Math.round(target.quantity * target.unitPrice * 100) / 100,
    };
    if (firstColarPos !== undefined && firstColarPos >= 0 && firstColarPos <= next.length) {
      next.splice(firstColarPos, 0, newItem);
    } else {
      next.push(newItem);
    }
  }

  for (const [key, target] of desiredCalafetarByName.entries()) {
    if (seenCalafetarNames.has(key)) continue;
    seenCalafetarNames.add(key);
    const newItem: EspelhoItem = {
      id: `item_${ts}_rcal_${idxCounter++}_${Math.random().toString(36).substring(2, 6)}`,
      qtd: String(target.quantity),
      descricao: target.catalogName,
      unidade: target.unit,
      precoUnitario: target.unitPrice,
      total: Math.round(target.quantity * target.unitPrice * 100) / 100,
    };
    if (
      firstCalafetarPos !== undefined &&
      firstCalafetarPos >= 0 &&
      firstCalafetarPos <= next.length
    ) {
      next.splice(firstCalafetarPos, 0, newItem);
    } else {
      next.push(newItem);
    }
  }

  return next;
}
