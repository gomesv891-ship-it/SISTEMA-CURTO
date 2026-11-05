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
 * Sincroniza um único orçamento para o Follow-up, criando novo card ou atualizando o existente
 * SEM perder históricos de interação e sem duplicar registros.
 */
export async function syncSingleOrcamentoToFollowUp(
  orcamento: SavedOrcamento,
  options?: {
    currentUser?: string;
    isEdit?: boolean;
    forceSaveSupabase?: boolean;
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
  const rawFollowUp = localStorage.getItem(FOLLOWUP_STORAGE_KEY);
  let followUpList: FollowUpItem[] = [];
  if (rawFollowUp) {
    try {
      const parsed = JSON.parse(rawFollowUp);
      if (Array.isArray(parsed)) followUpList = parsed;
    } catch {}
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

  // Procura card correspondente (evitando duplicações)
  const existingIdx = followUpList.findIndex(
    (f) =>
      f &&
      (f.orcamentoId === orcId ||
        f.id === `fup_${orcId}` ||
        f.id === orcId ||
        f.id === orcId.replace('orc_', ''))
  );

  let finalCard: FollowUpItem;

  if (existingIdx >= 0) {
    const existing = followUpList[existingIdx];
    const prevValue = Number(existing.valor) || 0;
    const valueChanged = Math.abs(prevValue - totalValue) > 0.01;

    // Atualiza status se o orçamento foi vendido ou perdido, mantendo o status do follow-up se já em negociação
    let resolvedStatus: FollowUpStatus = existing.status;
    const orcStatusMapped = mapOrcamentoStatusToFollowUp(orcamento.status);
    if (orcStatusMapped === 'Vendido' || orcStatusMapped === 'Perdido') {
      resolvedStatus = orcStatusMapped;
    }

    // Registra entrada de histórico de alteração se houve edição relevante
    const historyEntries = [...(existing.historico || [])];
    if (options?.isEdit || valueChanged) {
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
      orcamentoId: orcId,
      clientId: orcamento.clientId || existing.clientId,
      cliente: clientName || existing.cliente,
      clientType: clientType || existing.clientType,
      telefone: clientPhone || existing.telefone,
      nomeOrcamento: budgetTitle,
      produto: budgetTitle || produtosSummary,
      valor: totalValue,
      dataAtualizacao: now.toISOString(),
      updatedAt: now.toISOString(),
      status: resolvedStatus,
      vendedor: responsibleName,
      responsavel: responsibleName,
      vendedorId: sellerId || existing.vendedorId,
      responsavelId: sellerId || existing.responsavelId,
      criadoPor: existing.criadoPor || responsibleName,
      produtos: orcamento.items || existing.produtos,
      frete: orcamento.freteValor || existing.frete,
      desconto: orcamento.descontoValor || existing.desconto,
      historico: historyEntries,
    };

    followUpList[existingIdx] = finalCard;
  } else {
    // Cria novo card no Follow-up
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
      pedido:
        (orcamento as any).orderNum ||
        orcId.replace('orc_', '').slice(-4) ||
        String(Math.floor(1000 + Math.random() * 9000)),
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
      frete: orcamento.freteValor,
      desconto: orcamento.descontoValor,
      produtos: orcamento.items,
      historico: [initialHistory],
    };

    followUpList.unshift(finalCard);
  }

  // Deduplicação estrita: remove qualquer outro card com o mesmo orcamentoId
  const dedupedMap = new Map<string, FollowUpItem>();
  followUpList.forEach((item) => {
    if (!item) return;
    const key = item.orcamentoId ? `orc_${item.orcamentoId}` : item.id;
    if (!dedupedMap.has(key)) {
      dedupedMap.set(key, item);
    }
  });
  const dedupedList = Array.from(dedupedMap.values());

  // Salva no localStorage e emite evento
  try {
    localStorage.setItem(FOLLOWUP_STORAGE_KEY, JSON.stringify(dedupedList));
  } catch {}
  window.dispatchEvent(new Event('fenix_followup_updated'));

  // Salva de forma persistente no Supabase
  try {
    await saveItemToSupabase(FOLLOWUP_STORAGE_KEY, finalCard, 'id', options?.currentUser || responsibleName);
  } catch (err) {
    console.warn('Sync Supabase Follow-up erro:', err);
  }

  return finalCard;
}

/**
 * Varre todos os orçamentos antigos/existentes em fenix_orcamentos_history e fenix_saved_orcamentos
 * e garante que todos estejam integrados e atualizados na aba Follow-up.
 */
export async function syncAllSavedOrcamentosToFollowUp(options?: {
  currentUser?: string;
}): Promise<{ syncedCount: number; totalCount: number }> {
  const currentUserName = options?.currentUser || 'Sistema';

  // 1. Carrega todos os orçamentos locais
  let allOrcamentos: SavedOrcamento[] = [];
  const orcsMap = new Map<string, SavedOrcamento>();

  try {
    const rawHist = localStorage.getItem(ORCAMENTOS_HISTORY_KEY);
    if (rawHist) {
      const parsed = JSON.parse(rawHist);
      if (Array.isArray(parsed)) {
        parsed.forEach((o) => {
          if (o && o.id) orcsMap.set(String(o.id), o);
        });
      }
    }
  } catch {}

  try {
    const rawSaved = localStorage.getItem(ORCAMENTOS_SAVED_KEY);
    if (rawSaved) {
      const parsed = JSON.parse(rawSaved);
      if (Array.isArray(parsed)) {
        parsed.forEach((o) => {
          if (o && o.id && !orcsMap.has(String(o.id))) {
            orcsMap.set(String(o.id), o);
          }
        });
      }
    }
  } catch {}

  // 2. Consulta também o Supabase para orçamentos remotos
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { data: rows, error } = await supabase
        .from('fenix_kv_store')
        .select('key, data')
        .in('key', [ORCAMENTOS_HISTORY_KEY, ORCAMENTOS_SAVED_KEY]);

      if (!error && Array.isArray(rows)) {
        rows.forEach((r) => {
          let list = r.data;
          if (typeof list === 'string') {
            try {
              list = JSON.parse(list);
            } catch {}
          }
          if (Array.isArray(list)) {
            list.forEach((o: any) => {
              if (o && o.id && !orcsMap.has(String(o.id))) {
                orcsMap.set(String(o.id), o);
              }
            });
          }
        });
      }
    } catch (err) {
      console.warn('Erro ao carregar orçamentos remotos para sync:', err);
    }
  }

  allOrcamentos = Array.from(orcsMap.values());
  if (allOrcamentos.length === 0) {
    return { syncedCount: 0, totalCount: 0 };
  }

  // 3. Carrega lista atual de follow-up
  let currentFollowUpList: FollowUpItem[] = [];
  try {
    const rawFup = localStorage.getItem(FOLLOWUP_STORAGE_KEY);
    if (rawFup) {
      const parsed = JSON.parse(rawFup);
      if (Array.isArray(parsed)) currentFollowUpList = parsed;
    }
  } catch {}

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
  const updatedFollowUpList = [...currentFollowUpList];

  allOrcamentos.forEach((orc) => {
    const orcId = String(orc.id).trim();
    const existingIndex = updatedFollowUpList.findIndex(
      (f) =>
        f &&
        (f.orcamentoId === orcId ||
          f.id === `fup_${orcId}` ||
          f.id === orcId ||
          f.id === orcId.replace('orc_', ''))
    );

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
      let needsUpdate = false;

      // Se valor ou telefone ou título estiverem vazios no follow-up mas presentes no orçamento
      const newPhone = existing.telefone || clientPhone;
      const newValor = existing.valor || totalValue;
      const newNome = existing.nomeOrcamento || budgetTitle;
      const newResp = existing.responsavel || existing.vendedor || responsibleName;

      if (
        existing.telefone !== newPhone ||
        existing.valor !== newValor ||
        existing.nomeOrcamento !== newNome ||
        (!existing.responsavel && newResp)
      ) {
        needsUpdate = true;
      }

      if (needsUpdate) {
        updatedFollowUpList[existingIndex] = {
          ...existing,
          orcamentoId: orcId,
          cliente: clientName || existing.cliente,
          clientType: clientType || existing.clientType,
          telefone: newPhone,
          nomeOrcamento: newNome,
          produto: existing.produto || budgetTitle || produtosSummary,
          valor: newValor,
          responsavel: newResp,
          vendedor: newResp,
          vendedorId: existing.vendedorId || sellerId,
          responsavelId: existing.responsavelId || sellerId,
        };
        createdOrUpdatedCount += 1;
      }
    } else {
      // Cria o card que estava faltando
      const initialStatus = mapOrcamentoStatusToFollowUp(orc.status);
      const newCard: FollowUpItem = {
        id: `fup_${orcId}`,
        orcamentoId: orcId,
        pedido:
          (orc as any).orderNum ||
          orcId.replace('orc_', '').slice(-4) ||
          String(Math.floor(1000 + Math.random() * 9000)),
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
        frete: orc.freteValor,
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

  // Deduplicação final por orcamentoId
  const finalMap = new Map<string, FollowUpItem>();
  updatedFollowUpList.forEach((item) => {
    if (!item) return;
    const key = item.orcamentoId ? `orc_${item.orcamentoId}` : item.id;
    if (!finalMap.has(key)) {
      finalMap.set(key, item);
    }
  });
  const finalDeduped = Array.from(finalMap.values());

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
