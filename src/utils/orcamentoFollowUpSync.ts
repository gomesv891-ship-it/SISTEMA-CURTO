import { FollowUpItem, FollowUpStatus, FollowUpHistoryEntry, SavedOrcamento, ClientRecord } from '../types';
import { saveItemToSupabase, saveWholeCollectionToSupabase, getSupabaseClient } from './supabaseClient';
import { getUserIdByName } from './auth';
import { getSellerIdForUser } from './userDataFilter';

export const FOLLOWUP_STORAGE_KEY = 'fenix_followup_cards_v2';
export const ORCAMENTOS_HISTORY_KEY = 'fenix_orcamentos_history';
export const ORCAMENTOS_SAVED_KEY = 'fenix_saved_orcamentos';
export const CLIENTS_STORAGE_KEY = 'fenix_clients_db';

/**
 * Normaliza e formata datas para DD/MM/YYYY
 */
export function formatToDDMMYYYY(dateInput?: string | number | Date): string {
  if (!dateInput) {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  }

  const str = String(dateInput).trim();
  if (str.includes('/')) {
    return str.split(' ')[0];
  }

  if (str.includes('-')) {
    const onlyDate = str.split('T')[0];
    const parts = onlyDate.split('-');
    if (parts.length === 3) {
      return `${parts[2].padStart(2, '0')}/${parts[1].padStart(2, '0')}/${parts[0]}`;
    }
  }

  const d = new Date(dateInput);
  if (!isNaN(d.getTime())) {
    const dia = String(d.getDate()).padStart(2, '0');
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const ano = d.getFullYear();
    return `${dia}/${mes}/${ano}`;
  }

  return str.split(' ')[0];
}

/**
 * Converte quantidade textual (pt-BR ou EN) em número positivo
 */
export function parseFlexibleNumericValue(raw: unknown): number {
  if (typeof raw === 'number') return isNaN(raw) ? 0 : raw;
  if (raw === null || raw === undefined) return 0;
  const str = String(raw).trim().replace(/[^\d.,-]/g, '');
  if (!str) return 0;
  if (str.includes(',') && str.includes('.')) {
    return parseFloat(str.replace(/\./g, '').replace(',', '.')) || 0;
  }
  if (str.includes(',')) {
    return parseFloat(str.replace(',', '.')) || 0;
  }
  return parseFloat(str) || 0;
}

/**
 * Soma a metragem total (m²) dos itens de um orçamento
 */
export function calculateOrcamentoTotalSqm(items?: any[]): number {
  if (!Array.isArray(items) || items.length === 0) return 0;
  let total = 0;

  items.forEach((it) => {
    if (!it) return;
    const unidade = String(it.unidade || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    if (
      unidade === 'm2' ||
      unidade === 'm²' ||
      unidade.includes('m2') ||
      unidade.includes('m²') ||
      unidade === 'metro quadrado' ||
      unidade === 'metros quadrados'
    ) {
      const q = parseFlexibleNumericValue(it.qtd);
      if (q > 0) total += q;
      return;
    }

    // Fallback: se unidade for caixa/peça/un e houver detalhe explícito com m² (ex: "12 cx (26,40 m²)")
    const detalhe = String(it.qtdDetalhe || '');
    const m = detalhe.match(/(\d+(?:[.,]\d+)?)\s*m[²2]/i);
    if (m && m[1]) {
      const q = parseFlexibleNumericValue(m[1]);
      if (q > 0) total += q;
    }
  });

  return Math.round(total * 100) / 100;
}

/**
 * Extrai YYYY-MM-DD, YYYY-MM, DD/MM/YYYY e timestamp de uma data de criação de orçamento
 */
export function extractOrcamentoCreationDateParts(dateInput?: string | number | null): {
  dateStr: string;
  monthStr: string;
  displayDate: string;
  timestamp: number;
} {
  if (!dateInput) {
    return { dateStr: '', monthStr: '', displayDate: '—', timestamp: 0 };
  }
  const raw = String(dateInput).trim();
  if (!raw) {
    return { dateStr: '', monthStr: '', displayDate: '—', timestamp: 0 };
  }

  // Timestamp numérico
  if (!isNaN(Number(raw)) && Number(raw) > 1000000000) {
    const d = new Date(Number(raw));
    if (!isNaN(d.getTime())) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return {
        dateStr: `${y}-${m}-${day}`,
        monthStr: `${y}-${m}`,
        displayDate: `${day}/${m}/${y}`,
        timestamp: d.getTime(),
      };
    }
  }

  if (raw.includes('-')) {
    const onlyDate = raw.split('T')[0].split(' ')[0];
    const parts = onlyDate.split('-');
    if (parts.length >= 3 && parts[0].length === 4) {
      const y = parts[0];
      const m = parts[1].padStart(2, '0');
      const d = parts[2].padStart(2, '0');
      const fullTs = new Date(raw).getTime();
      const ts = !isNaN(fullTs) ? fullTs : new Date(`${y}-${m}-${d}T12:00:00`).getTime() || 0;
      return {
        dateStr: `${y}-${m}-${d}`,
        monthStr: `${y}-${m}`,
        displayDate: `${d}/${m}/${y}`,
        timestamp: ts,
      };
    }
  }

  if (raw.includes('/')) {
    const onlyDate = raw.split('T')[0].split(' ')[0];
    const parts = onlyDate.split('/');
    if (parts.length === 3) {
      if (parts[0].length === 4) {
        const y = parts[0];
        const m = parts[1].padStart(2, '0');
        const d = parts[2].padStart(2, '0');
        const ts = new Date(`${y}-${m}-${d}T12:00:00`).getTime() || 0;
        return { dateStr: `${y}-${m}-${d}`, monthStr: `${y}-${m}`, displayDate: `${d}/${m}/${y}`, timestamp: ts };
      } else {
        const d = parts[0].padStart(2, '0');
        const m = parts[1].padStart(2, '0');
        const y = parts[2];
        const ts = new Date(`${y}-${m}-${d}T12:00:00`).getTime() || 0;
        return { dateStr: `${y}-${m}-${d}`, monthStr: `${y}-${m}`, displayDate: `${d}/${m}/${y}`, timestamp: ts };
      }
    }
  }

  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return {
      dateStr: `${y}-${m}-${day}`,
      monthStr: `${y}-${m}`,
      displayDate: `${day}/${m}/${y}`,
      timestamp: parsed.getTime(),
    };
  }

  return { dateStr: '', monthStr: '', displayDate: raw.split(' ')[0], timestamp: 0 };
}

/**
 * Normaliza número de telefone / WhatsApp do cliente
 */
export function resolveClientPhone(
  orcamento: Partial<SavedOrcamento>,
  clientsList?: ClientRecord[]
): string {
  const directPhone = (
    orcamento.clientContact ||
    (orcamento as any).telefone ||
    (orcamento as any).whatsapp ||
    (orcamento as any).clienteWhatsapp ||
    (orcamento as any).clientPhone ||
    ''
  ).trim();

  if (directPhone) return directPhone;

  // Busca na base de clientes locais se tiver clientId ou nome
  if (!clientsList || clientsList.length === 0) {
    try {
      const rawClients = localStorage.getItem(CLIENTS_STORAGE_KEY);
      if (rawClients) {
        clientsList = JSON.parse(rawClients);
      }
    } catch {}
  }

  if (Array.isArray(clientsList) && clientsList.length > 0) {
    const matched = clientsList.find((c) => {
      if (!c) return false;
      if (orcamento.clientId && String(c.id).trim() === String(orcamento.clientId).trim()) {
        return true;
      }
      const cName = (c.name || (c as any).nome || '').trim().toLowerCase();
      const oName = (orcamento.clientName || (orcamento as any).cliente || '').trim().toLowerCase();
      return cName && oName && (cName === oName || cName.includes(oName) || oName.includes(cName));
    });

    if (matched) {
      const phone =
        (matched as any).whatsapp ||
        (matched as any).telefone ||
        (matched as any).phone ||
        (matched as any).celular ||
        (matched as any).contato ||
        '';
      if (phone) return String(phone).trim();
    }
  }

  return '';
}

/**
 * Normaliza o nome do responsável
 */
export function resolveOrcamentoResponsible(
  orcamento: Partial<SavedOrcamento>,
  fallbackUser?: string
): string {
  return (
    orcamento.consultoraName ||
    (orcamento as any).responsavel ||
    (orcamento as any).vendedor ||
    (orcamento as any).registeredBy ||
    (orcamento as any).criadoPor ||
    fallbackUser ||
    'Vanessa Gomes'
  ).trim();
}

/**
 * Converte status do orçamento para status do follow-up
 */
export function mapOrcamentoStatusToFollowUp(orcStatus?: string): FollowUpStatus {
  if (!orcStatus) return 'Orçamento Enviado';
  const s = String(orcStatus).trim().toLowerCase();
  if (
    s === 'vendido' ||
    s === 'fechado' ||
    s === 'fechados' ||
    s === 'aprovado' ||
    s === 'venda' ||
    s === 'concluido' ||
    s === 'concluído'
  ) {
    return 'Vendido';
  }
  if (s === 'perdido' || s === 'perdidos' || s === 'recusado' || s === 'cancelado') {
    return 'Perdido';
  }
  if (s === 'negociando' || s === 'negociação' || s === 'negociacao' || s === 'em negociação') {
    return 'Negociando';
  }
  if (s === 'aguardando retorno' || s === 'aguardando resposta' || s === 'em contato' || s === 'aguardando') {
    return 'Aguardando Retorno';
  }
  return 'Orçamento Enviado';
}

/**
 * Normaliza um ID de orçamento para comparação 1:1
 */
export function normalizeOrcamentoRefId(rawId?: string | null): string {
  if (!rawId) return '';
  return String(rawId).trim().replace(/^fup_/, '').replace(/^orc_/, '');
}

/**
 * Encontra o índice do Follow-up correspondente a um orçamento (1 orçamento = 1 Follow-up)
 */
export function findMatchingFollowUpIndex(list: FollowUpItem[], orcId: string): number {
  const cleanOrcId = String(orcId || '').trim();
  if (!cleanOrcId) return -1;
  const bareId = normalizeOrcamentoRefId(cleanOrcId);

  return list.findIndex((f) => {
    if (!f) return false;
    const fOrcId = f.orcamentoId ? String(f.orcamentoId).trim() : '';
    const fId = f.id ? String(f.id).trim() : '';
    if (fOrcId && (fOrcId === cleanOrcId || normalizeOrcamentoRefId(fOrcId) === bareId)) {
      return true;
    }
    if (
      fId === `fup_${cleanOrcId}` ||
      fId === cleanOrcId ||
      (bareId && (fId === bareId || fId === `fup_${bareId}` || fId === `orc_${bareId}`))
    ) {
      return true;
    }
    return false;
  });
}

/**
 * Garante correspondência estrita de 1 orçamento para 1 Follow-up na lista
 */
export function deduplicateFollowUpList(list: FollowUpItem[]): FollowUpItem[] {
  const byKey = new Map<string, FollowUpItem>();

  list.forEach((item) => {
    if (!item) return;
    const bareOrc = normalizeOrcamentoRefId(item.orcamentoId || (item.id?.startsWith('fup_') ? item.id : ''));
    const key = bareOrc ? `orc_${bareOrc}` : `id_${item.id}`;
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, item);
      return;
    }

    // Mescla preservando status final (Vendido/Perdido) e histórico mais completo
    const existingIsSold = mapOrcamentoStatusToFollowUp(existing.status) === 'Vendido';
    const itemIsSold = mapOrcamentoStatusToFollowUp(item.status) === 'Vendido';
    const existingTs = new Date(existing.updatedAt || existing.dataAtualizacao || 0).getTime() || 0;
    const itemTs = new Date(item.updatedAt || item.dataAtualizacao || 0).getTime() || 0;

    const mergedHistoryMap = new Map<string, FollowUpHistoryEntry>();
    [...(existing.historico || []), ...(item.historico || [])].forEach((h) => {
      if (h && h.id) mergedHistoryMap.set(h.id, h);
    });
    const mergedHistory = Array.from(mergedHistoryMap.values()).sort(
      (a, b) => (b.timestamp || 0) - (a.timestamp || 0)
    );

    const primary =
      itemIsSold && !existingIsSold
        ? item
        : existingIsSold && !itemIsSold
        ? existing
        : itemTs > existingTs
        ? item
        : existing;
    const secondary = primary === item ? existing : item;

    const existingTrackTs = new Date(existing.trackingUpdatedAt || 0).getTime() || 0;
    const itemTrackTs = new Date(item.trackingUpdatedAt || 0).getTime() || 0;
    const newerTrack = itemTrackTs >= existingTrackTs ? item : existing;
    const olderTrack = newerTrack === item ? existing : item;

    byKey.set(key, {
      ...secondary,
      ...primary,
      id: existing.id || primary.id,
      orcamentoId: primary.orcamentoId || secondary.orcamentoId,
      pedido: primary.pedido || secondary.pedido,
      historico: mergedHistory.length > 0 ? mergedHistory : primary.historico || secondary.historico,
      trackingStatus: newerTrack.trackingStatus ?? olderTrack.trackingStatus,
      customSqm: newerTrack.customSqm !== undefined ? newerTrack.customSqm : olderTrack.customSqm,
      trackingUpdatedAt: newerTrack.trackingUpdatedAt || olderTrack.trackingUpdatedAt,
      trackingOverrides: newerTrack.trackingOverrides || olderTrack.trackingOverrides,
      hiddenFromTrackingList:
        newerTrack.hiddenFromTrackingList !== undefined
          ? newerTrack.hiddenFromTrackingList
          : olderTrack.hiddenFromTrackingList,
    });
  });

  return Array.from(byKey.values());
}

/**
 * Sincroniza um único orçamento para o Follow-up, criando novo card ou atualizando o existente
 * SEM perder históricos de interação e mantendo correspondência estrita de 1 orçamento para 1 Follow-up.
 */
export async function syncSingleOrcamentoToFollowUp(
  orcamento: SavedOrcamento,
  options?: {
    currentUser?: string;
    isEdit?: boolean;
    forceSaveSupabase?: boolean;
    skipSupabaseSave?: boolean;
  }
): Promise<FollowUpItem> {
  if (!orcamento || !orcamento.id) {
    throw new Error('Orçamento inválido para sincronização no Follow-up.');
  }

  const now = new Date();
  const dia = String(now.getDate()).padStart(2, '0');
  const mes = String(now.getMonth() + 1).padStart(2, '0');
  const ano = now.getFullYear();
  const hora = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const todayFormatted = `${dia}/${mes}/${ano}`;
  const timeFormatted = `${hora}:${min}`;

  const orcId = String(orcamento.id).trim();
  let followUpList: FollowUpItem[] = [];

  try {
    const rawFollowUp = localStorage.getItem(FOLLOWUP_STORAGE_KEY);
    if (rawFollowUp) {
      const parsed = JSON.parse(rawFollowUp);
      if (Array.isArray(parsed)) followUpList = parsed;
    }
  } catch {}

  // Consulta o Supabase para garantir sincronia entre computador e celular sem criar duplicidades
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { data: remoteRow, error } = await supabase
        .from('fenix_kv_store')
        .select('data')
        .eq('key', FOLLOWUP_STORAGE_KEY)
        .maybeSingle();

      if (!error && remoteRow && remoteRow.data !== undefined) {
        let remoteData = remoteRow.data;
        if (typeof remoteData === 'string') {
          try {
            remoteData = JSON.parse(remoteData);
          } catch {}
        }
        if (Array.isArray(remoteData) && remoteData.length > 0) {
          followUpList = deduplicateFollowUpList([...remoteData, ...followUpList]);
        }
      }
    } catch (err) {
      console.warn('Aviso ao consultar Follow-up remoto antes do sync 1:1:', err);
    }
  }

  // Prepara dados canônicos
  const clientName = (orcamento.clientName || (orcamento as any).cliente || 'Cliente').trim();
  const clientPhone = resolveClientPhone(orcamento);
  const clientType = orcamento.clientType || 'Cliente Final';
  const responsibleName = resolveOrcamentoResponsible(orcamento, options?.currentUser);
  const sellerId =
    (orcamento as any).vendedorId ||
    (orcamento as any).responsavelId ||
    getUserIdByName(responsibleName) ||
    getSellerIdForUser(responsibleName);

  const budgetTitle = (
    orcamento.nomeOrcamento ||
    (orcamento as any).finalNomeOrcamento ||
    (orcamento.items && orcamento.items[0]?.descricao) ||
    'Orçamento de Materiais'
  ).trim();

  const produtosSummary =
    Array.isArray(orcamento.items) && orcamento.items.length > 0
      ? orcamento.items.map((it) => `${it.descricao}${it.qtd ? ` (${it.qtd} ${it.unidade || 'm²'})` : ''}`).join(', ')
      : budgetTitle || 'Pisos e Revestimentos Fênix';

  const totalValue = Number(orcamento.totalFinal) || Number((orcamento as any).valor) || 0;
  const creationDateISO =
    orcamento.savedAt ||
    (orcamento as any).createdAt ||
    (orcamento as any).dataCriacao ||
    (orcamento as any).dataOrcamento ||
    now.toISOString();
  const creationDateFormatted = formatToDDMMYYYY(creationDateISO);

  // Procura card correspondente 1:1
  const existingIdx = findMatchingFollowUpIndex(followUpList, orcId);

  let finalCard: FollowUpItem;

  if (existingIdx >= 0) {
    const existing = followUpList[existingIdx];
    const prevValue = Number(existing.valor) || 0;
    const valueChanged = Math.abs(prevValue - totalValue) > 0.01;
    const titleChanged = Boolean(budgetTitle && existing.nomeOrcamento !== budgetTitle);
    const clientChanged = Boolean(clientName && existing.cliente !== clientName);

    // Atualiza status se o orçamento foi vendido ou perdido, mantendo o status do follow-up se já em negociação
    let resolvedStatus: FollowUpStatus = existing.status;
    const orcStatusMapped = mapOrcamentoStatusToFollowUp(orcamento.status);
    if (orcStatusMapped === 'Vendido' || orcStatusMapped === 'Perdido') {
      resolvedStatus = orcStatusMapped;
    }

    // Registra entrada de histórico de alteração se houve edição relevante
    const historyEntries = [...(existing.historico || [])];
    if (options?.isEdit || valueChanged || titleChanged || clientChanged) {
      const editEntry: FollowUpHistoryEntry = {
        id: `h_upd_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
        data: todayFormatted,
        hora: timeFormatted,
        statusAnterior: existing.status,
        novoStatus: resolvedStatus,
        observacao: `Orçamento atualizado no CRM (Valor: R$ ${totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}). Informações sincronizadas com o Follow-up.`,
        usuario: options?.currentUser || responsibleName,
        timestamp: now.getTime(),
      };
      historyEntries.unshift(editEntry);
    }

    finalCard = {
      ...existing,
      id: existing.id || `fup_${orcId}`,
      orcamentoId: orcId,
      pedido: (orcamento as any).pedido || existing.pedido || '',
      clientId: orcamento.clientId || existing.clientId,
      cliente: existing.trackingOverrides?.cliente ? existing.cliente : clientName || existing.cliente,
      clientType: clientType || existing.clientType,
      telefone: existing.trackingOverrides?.telefone ? existing.telefone : clientPhone || existing.telefone,
      nomeOrcamento: existing.trackingOverrides?.nomeOrcamento ? existing.nomeOrcamento : budgetTitle,
      produto: budgetTitle || produtosSummary,
      valor: existing.trackingOverrides?.valor ? existing.valor : totalValue,
      dataAtualizacao: now.toISOString(),
      updatedAt: now.toISOString(),
      status: resolvedStatus,
      vendedor: responsibleName,
      responsavel: responsibleName,
      vendedorId: sellerId || existing.vendedorId,
      responsavelId: sellerId || existing.responsavelId,
      criadoPor: existing.criadoPor || responsibleName,
      produtos: orcamento.items || existing.produtos,
      frete: orcamento.freteAtivo ? orcamento.freteValor || 0 : 0,
      desconto: orcamento.descontoValor ?? existing.desconto,
      lembretesAtivos:
        resolvedStatus === 'Vendido' || resolvedStatus === 'Perdido'
          ? false
          : existing.lembretesAtivos ?? true,
      historico: historyEntries,
    };

    followUpList[existingIdx] = finalCard;
  } else {
    // Cria novo card no Follow-up (1:1 com o orçamento de origem)
    const initialStatus = mapOrcamentoStatusToFollowUp(orcamento.status);
    const initialHistory: FollowUpHistoryEntry = {
      id: `h_init_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
      data: todayFormatted,
      hora: timeFormatted,
      novoStatus: initialStatus,
      observacao: 'Orçamento gerado e salvo no CRM. Integrado automaticamente na esteira de Follow-up.',
      usuario: options?.currentUser || responsibleName,
      timestamp: now.getTime(),
    };

    finalCard = {
      id: `fup_${orcId}`,
      orcamentoId: orcId,
      pedido: (orcamento as any).pedido || (orcamento as any).orderNum || '',
      clientId: orcamento.clientId,
      cliente: clientName,
      clientType,
      nomeOrcamento: budgetTitle,
      produto: budgetTitle || produtosSummary,
      telefone: clientPhone,
      valor: totalValue,
      dataCriacao: creationDateFormatted,
      dataEntradaFollowUp: creationDateISO,
      dataAtualizacao: now.toISOString(),
      status: initialStatus,
      observacao:
        orcamento.observacoes ||
        'Orçamento oficial gerado no CRM. Aguardando retorno do cliente.',
      vendedor: responsibleName,
      vendedorId: sellerId,
      criadoPor: responsibleName,
      criadoPorId: sellerId,
      creatorId: sellerId,
      responsavel: responsibleName,
      responsavelId: sellerId,
      createdAt: creationDateISO,
      updatedAt: now.toISOString(),
      lembretesAtivos: initialStatus !== 'Vendido' && initialStatus !== 'Perdido',
      frete: orcamento.freteAtivo ? orcamento.freteValor : 0,
      desconto: orcamento.descontoValor,
      produtos: orcamento.items,
      historico: [initialHistory],
    };

    followUpList.unshift(finalCard);
  }

  // Deduplicação estrita 1:1
  const dedupedList = deduplicateFollowUpList(followUpList);

  // Salva no localStorage e emite evento
  try {
    localStorage.setItem(FOLLOWUP_STORAGE_KEY, JSON.stringify(dedupedList));
  } catch {}
  window.dispatchEvent(new Event('fenix_followup_updated'));

  // Salva de forma persistente no Supabase
  if (!options?.skipSupabaseSave) {
    try {
      await saveItemToSupabase(FOLLOWUP_STORAGE_KEY, finalCard, 'id', options?.currentUser || responsibleName);
    } catch (err) {
      console.warn('Sync Supabase Follow-up erro:', err);
    }
  }

  return finalCard;
}

/**
 * Varre todos os orçamentos antigos/existentes em fenix_orcamentos_history e fenix_saved_orcamentos
 * e garante que todos estejam integrados e atualizados na aba Follow-up (1:1 sem duplicidade).
 */
export async function syncAllSavedOrcamentosToFollowUp(options?: {
  currentUser?: string;
}): Promise<{ syncedCount: number; totalCount: number }> {
  const currentUserName = options?.currentUser || 'Sistema';

  // 1. Carrega todos os orçamentos locais
  let allOrcamentos: SavedOrcamento[] = [];
  const orcsMap = new Map<string, SavedOrcamento>();

  const mergeOrcIntoMap = (o: any) => {
    if (!o || !o.id) return;
    const key = String(o.id);
    const existing = orcsMap.get(key);
    if (!existing) {
      orcsMap.set(key, o);
      return;
    }
    const existingTs = new Date(existing.updatedAt || existing.savedAt || 0).getTime() || 0;
    const incomingTs = new Date(o.updatedAt || o.savedAt || 0).getTime() || 0;
    if (incomingTs >= existingTs) {
      orcsMap.set(key, { ...existing, ...o });
    }
  };

  try {
    const rawHist = localStorage.getItem(ORCAMENTOS_HISTORY_KEY);
    if (rawHist) {
      const parsed = JSON.parse(rawHist);
      if (Array.isArray(parsed)) parsed.forEach(mergeOrcIntoMap);
    }
  } catch {}

  try {
    const rawSaved = localStorage.getItem(ORCAMENTOS_SAVED_KEY);
    if (rawSaved) {
      const parsed = JSON.parse(rawSaved);
      if (Array.isArray(parsed)) parsed.forEach(mergeOrcIntoMap);
    }
  } catch {}

  // Carrega lista local de follow-up
  let currentFollowUpList: FollowUpItem[] = [];
  try {
    const rawFup = localStorage.getItem(FOLLOWUP_STORAGE_KEY);
    if (rawFup) {
      const parsed = JSON.parse(rawFup);
      if (Array.isArray(parsed)) currentFollowUpList = parsed;
    }
  } catch {}

  // 2. Consulta também o Supabase para orçamentos e follow-ups remotos
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { data: rows, error } = await supabase
        .from('fenix_kv_store')
        .select('key, data')
        .in('key', [ORCAMENTOS_HISTORY_KEY, ORCAMENTOS_SAVED_KEY, FOLLOWUP_STORAGE_KEY]);

      if (!error && Array.isArray(rows)) {
        rows.forEach((r) => {
          let list = r.data;
          if (typeof list === 'string') {
            try {
              list = JSON.parse(list);
            } catch {}
          }
          if (!Array.isArray(list)) return;

          if (r.key === FOLLOWUP_STORAGE_KEY) {
            currentFollowUpList = deduplicateFollowUpList([...list, ...currentFollowUpList]);
          } else {
            list.forEach(mergeOrcIntoMap);
          }
        });
      }
    } catch (err) {
      console.warn('Erro ao carregar dados remotos para sync Follow-up:', err);
    }
  }

  allOrcamentos = Array.from(orcsMap.values());
  if (allOrcamentos.length === 0) {
    return { syncedCount: 0, totalCount: 0 };
  }

  // Carrega clientes para resolução de telefone
  let clientsList: ClientRecord[] = [];
  try {
    const rawClients = localStorage.getItem(CLIENTS_STORAGE_KEY);
    if (rawClients) {
      const parsed = JSON.parse(rawClients);
      if (Array.isArray(parsed)) clientsList = parsed;
    }
  } catch {}

  let createdOrUpdatedCount = 0;
  const updatedFollowUpList = deduplicateFollowUpList([...currentFollowUpList]);

  allOrcamentos.forEach((orc) => {
    const orcId = String(orc.id).trim();
    const existingIndex = findMatchingFollowUpIndex(updatedFollowUpList, orcId);

    const clientName = (orc.clientName || (orc as any).cliente || 'Cliente').trim();
    const clientPhone = resolveClientPhone(orc, clientsList);
    const clientType = orc.clientType || 'Cliente Final';
    const responsibleName = resolveOrcamentoResponsible(orc, currentUserName);
    const sellerId =
      (orc as any).vendedorId ||
      (orc as any).responsavelId ||
      getUserIdByName(responsibleName) ||
      getSellerIdForUser(responsibleName);

    const budgetTitle = (
      orc.nomeOrcamento ||
      (orc as any).finalNomeOrcamento ||
      (orc.items && orc.items[0]?.descricao) ||
      'Orçamento de Materiais'
    ).trim();

    const produtosSummary =
      Array.isArray(orc.items) && orc.items.length > 0
        ? orc.items.map((it) => `${it.descricao}${it.qtd ? ` (${it.qtd} ${it.unidade || 'm²'})` : ''}`).join(', ')
        : budgetTitle || 'Pisos e Revestimentos Fênix';

    const totalValue = Number(orc.totalFinal) || Number((orc as any).valor) || 0;
    const creationDateISO =
      orc.savedAt ||
      (orc as any).createdAt ||
      (orc as any).dataCriacao ||
      (orc as any).dataOrcamento ||
      new Date().toISOString();
    const creationDateFormatted = formatToDDMMYYYY(creationDateISO);

    if (existingIndex >= 0) {
      const existing = updatedFollowUpList[existingIndex];
      const orcStatusMapped = mapOrcamentoStatusToFollowUp(orc.status);
      const nextStatus: FollowUpStatus =
        orcStatusMapped === 'Vendido' || orcStatusMapped === 'Perdido'
          ? orcStatusMapped
          : existing.status;

      const orcUpdatedTs = new Date(orc.updatedAt || orc.savedAt || 0).getTime() || 0;
      const fupUpdatedTs = new Date(existing.updatedAt || existing.dataAtualizacao || 0).getTime() || 0;
      const orcIsNewer = orcUpdatedTs > fupUpdatedTs + 1000;

      const nextPhone = clientPhone || existing.telefone || '';
      const nextValor =
        orcIsNewer || !existing.valor ? (totalValue || existing.valor || 0) : existing.valor;
      const nextNome =
        orcIsNewer || !existing.nomeOrcamento ? budgetTitle : existing.nomeOrcamento;
      const nextCliente =
        orcIsNewer || !existing.cliente ? clientName : existing.cliente;
      const nextResp =
        orcIsNewer || (!existing.responsavel && !existing.vendedor)
          ? responsibleName
          : existing.responsavel || existing.vendedor || responsibleName;

      const needsUpdate =
        existing.orcamentoId !== orcId ||
        existing.status !== nextStatus ||
        existing.telefone !== nextPhone ||
        Math.abs((Number(existing.valor) || 0) - nextValor) > 0.01 ||
        existing.nomeOrcamento !== nextNome ||
        existing.cliente !== nextCliente ||
        existing.responsavel !== nextResp;

      if (needsUpdate) {
        updatedFollowUpList[existingIndex] = {
          ...existing,
          orcamentoId: orcId,
          status: nextStatus,
          clientId: orc.clientId || existing.clientId,
          cliente: existing.trackingOverrides?.cliente ? existing.cliente : nextCliente,
          clientType: clientType || existing.clientType,
          telefone: existing.trackingOverrides?.telefone ? existing.telefone : nextPhone,
          nomeOrcamento: existing.trackingOverrides?.nomeOrcamento ? existing.nomeOrcamento : nextNome,
          produto: nextNome || existing.produto || produtosSummary,
          valor: existing.trackingOverrides?.valor ? existing.valor : nextValor,
          responsavel: nextResp,
          vendedor: nextResp,
          vendedorId: sellerId || existing.vendedorId,
          responsavelId: sellerId || existing.responsavelId,
          produtos: orc.items || existing.produtos,
          frete: orc.freteAtivo ? orc.freteValor || 0 : existing.frete,
          desconto: orc.descontoValor ?? existing.desconto,
          lembretesAtivos:
            nextStatus === 'Vendido' || nextStatus === 'Perdido'
              ? false
              : existing.lembretesAtivos,
          hiddenFromTrackingList: existing.hiddenFromTrackingList,
          trackingStatus: existing.trackingStatus,
          customSqm: existing.customSqm,
          trackingUpdatedAt: existing.trackingUpdatedAt,
          trackingOverrides: existing.trackingOverrides,
        };
        createdOrUpdatedCount += 1;
      }
    } else {
      // Cria o card que estava faltando (1:1)
      const initialStatus = mapOrcamentoStatusToFollowUp(orc.status);
      const newCard: FollowUpItem = {
        id: `fup_${orcId}`,
        orcamentoId: orcId,
        pedido: (orc as any).pedido || (orc as any).orderNum || '',
        clientId: orc.clientId,
        cliente: clientName,
        clientType,
        nomeOrcamento: budgetTitle,
        produto: budgetTitle || produtosSummary,
        telefone: clientPhone,
        valor: totalValue,
        dataCriacao: creationDateFormatted,
        dataEntradaFollowUp: creationDateISO,
        dataAtualizacao: new Date().toISOString(),
        status: initialStatus,
        observacao:
          orc.observacoes ||
          'Orçamento importado automaticamente para o Follow-up comercial.',
        vendedor: responsibleName,
        vendedorId: sellerId,
        criadoPor: responsibleName,
        criadoPorId: sellerId,
        creatorId: sellerId,
        responsavel: responsibleName,
        responsavelId: sellerId,
        createdAt: creationDateISO,
        updatedAt: new Date().toISOString(),
        lembretesAtivos: initialStatus !== 'Vendido' && initialStatus !== 'Perdido',
        frete: orc.freteAtivo ? orc.freteValor : 0,
        desconto: orc.descontoValor,
        produtos: orc.items,
        historico: [
          {
            id: `h_sync_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
            data: formatToDDMMYYYY(new Date()),
            hora: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
            novoStatus: initialStatus,
            observacao: 'Orçamento cadastrado e integrado na esteira de Follow-up.',
            usuario: responsibleName,
            timestamp: Date.now(),
          },
        ],
      };
      updatedFollowUpList.unshift(newCard);
      createdOrUpdatedCount += 1;
    }
  });

  // Deduplicação final estrita 1:1
  const finalDeduped = deduplicateFollowUpList(updatedFollowUpList);

  if (createdOrUpdatedCount > 0 || finalDeduped.length !== currentFollowUpList.length) {
    try {
      localStorage.setItem(FOLLOWUP_STORAGE_KEY, JSON.stringify(finalDeduped));
    } catch {}
    window.dispatchEvent(new Event('fenix_followup_updated'));

    // Persiste no Supabase
    saveWholeCollectionToSupabase(FOLLOWUP_STORAGE_KEY, finalDeduped, currentUserName).catch(() => {});
  }

  return { syncedCount: createdOrUpdatedCount, totalCount: allOrcamentos.length };
}
