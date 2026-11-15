import { FollowUpItem, FollowUpStatus, VendaGerencial } from '../types';
import { getSupabaseClient, saveItemToSupabase, deleteItemFromSupabase, saveWholeCollectionToSupabase } from './supabaseClient';
import { calcularCustosVariaveis, calcularLucroEMargem } from './custosVariaveis';
import { findMatchingVendaIndex, deduplicateVendasList, syncSingleMetaSaleToVendas, DELETED_VENDAS_KEY } from './vendasService';
import { getUserIdByName, isUserRevoked } from './auth';
import { getSellerIdForUser } from './userDataFilter';

export const METAS_SALES_STORAGE_KEY = 'fenix_metas_sales_db';
export const VENDAS_GERENCIAL_STORAGE_KEY = 'fenix_vendas_gerencial';
export const FOLLOWUP_STORAGE_KEY_V2 = 'fenix_followup_cards_v2';
export const FOLLOWUP_STORAGE_KEY_LEGACY = 'fenix_followup_db';

/**
 * Converte valores numéricos ou strings em formato BRL ("R$ 10.000,00") para number.
 */
function parseMonetaryValue(raw: string | number | undefined | null): number {
  if (raw === undefined || raw === null || raw === '') return 0;
  if (typeof raw === 'number') return isNaN(raw) ? 0 : raw;
  const str = String(raw).trim();
  if (!str) return 0;
  if (/^-?\d+(\.\d+)?$/.test(str)) {
    const n = parseFloat(str);
    return isNaN(n) ? 0 : n;
  }
  const cleaned = str.replace(/[^\d.,-]/g, '');
  if (!cleaned) return 0;
  if (cleaned.includes('.') && cleaned.includes(',')) {
    const n = parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
    return isNaN(n) ? 0 : n;
  }
  if (cleaned.includes(',')) {
    const n = parseFloat(cleaned.replace(',', '.'));
    return isNaN(n) ? 0 : n;
  }
  if (cleaned.includes('.')) {
    const parts = cleaned.split('.');
    if (parts.length > 1 && parts[parts.length - 1].length === 3) {
      const n = parseFloat(cleaned.replace(/\./g, ''));
      return isNaN(n) ? 0 : n;
    }
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : n;
  }
  const n = parseFloat(cleaned.replace(/\D/g, ''));
  return isNaN(n) ? 0 : n;
}

/**
 * Retorna a data local no formato YYYY-MM-DD (evita deslocamento de fuso horário UTC à noite).
 */
function getLocalDateISO(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Verifica se o nome informado é genérico/sistema ou pertence a usuário revogado.
 */
function isGenericOrRevokedSeller(name?: string | null): boolean {
  if (!name) return true;
  const norm = name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (
    !norm ||
    norm === 'sistema' ||
    norm === 'usuario fenix' ||
    norm === 'consultora fenix' ||
    norm === 'crm fenix' ||
    norm === 'geral' ||
    norm === 'todos'
  ) {
    return true;
  }
  return isUserRevoked(name);
}

/**
 * Normaliza número do pedido removendo caracteres especiais
 */
export function extractCleanPedido(raw?: string | number): string {
  if (!raw) return '';
  return String(raw).trim().replace(/^#+/, '');
}

/**
 * Localiza o orçamento de origem salvo em fenix_orcamentos_history / fenix_saved_orcamentos
 */
function findOriginOrcamento(budget: FollowUpItem): any | null {
  try {
    const originOrcId = (budget.orcamentoId || budget.id.replace(/^fup_/, '')).trim();
    const bareOrcId = originOrcId.replace(/^orc_/, '');

    const sources = [
      localStorage.getItem('fenix_orcamentos_history'),
      localStorage.getItem('fenix_saved_orcamentos'),
    ];

    for (const raw of sources) {
      if (!raw) continue;
      const list = JSON.parse(raw);
      if (!Array.isArray(list)) continue;
      const found = list.find((o: any) => {
        if (!o || !o.id) return false;
        const oId = String(o.id).trim();
        return (
          oId === originOrcId ||
          oId === budget.id ||
          oId.replace(/^orc_/, '') === bareOrcId
        );
      });
      if (found) return found;
    }
  } catch {}
  return null;
}

/**
 * Remove IDs relacionados à venda reconfirmada da lista de vendas excluídas para nunca ocultar em Metas.
 */
function clearDeletedIdsForConfirmedSale(idsToRestore: string[], user: string): void {
  try {
    const rawDel = localStorage.getItem(DELETED_VENDAS_KEY);
    if (!rawDel) return;
    const parsedDel = JSON.parse(rawDel);
    if (!Array.isArray(parsedDel) || parsedDel.length === 0) return;

    const restoreSet = new Set(idsToRestore.filter(Boolean).map((x) => String(x).trim()));
    if (restoreSet.size === 0) return;

    const filteredDel = parsedDel.filter((d: any) => !restoreSet.has(String(d).trim()));
    if (filteredDel.length === parsedDel.length) return;

    localStorage.setItem(DELETED_VENDAS_KEY, JSON.stringify(filteredDel));
    if (filteredDel.length > 0) {
      saveWholeCollectionToSupabase(DELETED_VENDAS_KEY, filteredDel, user).catch(() => {});
    } else {
      const client = getSupabaseClient();
      if (client) {
        client
          .from('fenix_kv_store')
          .upsert(
            {
              key: DELETED_VENDAS_KEY,
              data: [],
              updated_at: new Date().toISOString(),
              updated_by: user,
            },
            { onConflict: 'key' }
          )
          .then(() => {}, () => {});
      }
    }
  } catch {}
}

/**
 * 1. FOLLOW-UP + META + VENDAS
 * Sincroniza a transição de status do Follow-up com a META da consultora responsável vinculada ao orçamento.
 * - Se VENDIDO: Adiciona ou atualiza na META usando o valor e a responsável vinculados ao orçamento.
 * - Mantém vínculo explícito entre orçamento (orcamentoId), Follow-up (followUpId) e venda (pedido).
 * - Impede duplicações usando ID do orçamento, ID do Follow-up e número do pedido.
 */
export function syncFollowUpStatusWithMetasAndVendas(
  budget: FollowUpItem,
  newStatus: FollowUpStatus,
  currentUserName: string,
  extraData?: {
    pedido?: string;
    formasPagamento?: any[];
    formaPagamento?: string;
    parcelas?: string;
    wasPreviouslySold?: boolean;
  }
): void {
  if (typeof window === 'undefined' || !budget || !budget.id) return;

  const cleanPedido = extractCleanPedido(extraData?.pedido || budget.pedido);
  const originOrc = findOriginOrcamento(budget);
  const originOrcId = String(
    originOrc?.id || budget.orcamentoId || budget.id.replace(/^fup_/, '')
  ).trim();
  const bareOrcId = originOrcId.replace(/^orc_/, '');
  const followUpId = String(budget.id).trim();
  const saleId = `v_orc_${originOrcId || followUpId}`;
  const now = new Date();
  const dateStr = getLocalDateISO(now);
  const nowIso = now.toISOString();

  // Responsável vinculado ao orçamento de origem (ignora genéricos e contas revogadas)
  const sellerCandidates = [
    originOrc?.consultoraName,
    originOrc?.responsavel,
    originOrc?.vendedor,
    originOrc?.registeredBy,
    originOrc?.criadoPor,
    budget.responsavel,
    budget.vendedor,
    (budget as any).consultoraName,
    (budget as any).vendedorNome,
    budget.criadoPor,
    currentUserName,
    'Vanessa Gomes',
  ];
  const responsibleUser = (
    sellerCandidates.find((c) => typeof c === 'string' && !isGenericOrRevokedSeller(c)) ||
    (!isGenericOrRevokedSeller(currentUserName) ? currentUserName : 'Vanessa Gomes')
  ).trim();

  const resolvedSellerId =
    getUserIdByName(responsibleUser) ||
    getSellerIdForUser(responsibleUser) ||
    originOrc?.vendedorId ||
    originOrc?.responsavelId ||
    budget.vendedorId ||
    budget.responsavelId ||
    null;

  // Valor vinculado ao orçamento de origem
  const originValor =
    parseMonetaryValue(originOrc?.totalFinal) ||
    parseMonetaryValue(originOrc?.valor) ||
    parseMonetaryValue(originOrc?.totalGeral);
  const budgetValor = parseMonetaryValue(budget.valor);
  const saleValue = originValor > 0 ? originValor : budgetValor;

  const clientName = (originOrc?.clientName || budget.cliente || 'Cliente').trim();
  const clientPhone =
    originOrc?.clientContact ||
    budget.telefone ||
    (budget as any).clienteWhatsapp ||
    (budget as any).clientPhone ||
    (budget as any).whatsapp ||
    '';
  const clientType = originOrc?.clientType || budget.clientType || 'Cliente Final';

  // Resgata frete, desconto e produtos vinculados ao orçamento original
  let freteVal =
    originOrc?.freteAtivo && originOrc?.freteValor
      ? parseMonetaryValue(originOrc.freteValor)
      : parseMonetaryValue(budget.frete);
  let descontoVal =
    originOrc?.descontoValor !== undefined
      ? parseMonetaryValue(originOrc.descontoValor)
      : parseMonetaryValue(budget.desconto);
  let orcProdutos: any[] | undefined = budget.produtos;
  if ((!orcProdutos || orcProdutos.length === 0) && Array.isArray(originOrc?.items)) {
    orcProdutos = originOrc.items.map((it: any) => ({
      id: it.id || `p_${Math.random()}`,
      nome: it.descricao || 'Produto',
      detalhe: it.subtitulo,
      unidade: it.unidade || 'un',
      quantidade: parseFloat(it.qtd) || 1,
      valorUnitario: parseMonetaryValue(it.precoUnitario),
      subtotal: parseMonetaryValue(it.total),
    }));
  }

  // ----------------------------------------------------
  // CASO 1: MARCADO COMO VENDIDO -> ADICIONAR / ATUALIZAR
  // ----------------------------------------------------
  if (newStatus === 'Vendido') {
    // Garante que uma reconfirmação no Follow-up não fique oculta por exclusões anteriores
    clearDeletedIdsForConfirmedSale(
      [
        saleId,
        `v_orc_${followUpId}`,
        `v_orc_${bareOrcId}`,
        `v_orc_orc_${bareOrcId}`,
        `v_orc_fup_${originOrcId}`,
        followUpId,
        originOrcId,
        bareOrcId,
        `orc_${bareOrcId}`,
        `fup_${bareOrcId}`,
        cleanPedido,
        cleanPedido ? `ped_${cleanPedido}` : '',
      ],
      responsibleUser
    );

    // 1.1 Atualizar META DA CONSULTORA RESPONSÁVEL
    try {
      const rawMetas = localStorage.getItem(METAS_SALES_STORAGE_KEY);
      let metasSales: any[] = rawMetas ? JSON.parse(rawMetas) : [];
      if (!Array.isArray(metasSales)) metasSales = [];

      const clientNameNorm = clientName.toLowerCase().trim();

      const isMatchingMetaSale = (s: any): boolean => {
        if (!s) return false;
        const sId = String(s.id || '').trim();
        const sFupId = s.followUpId ? String(s.followUpId).trim() : '';
        const sOrcId = s.orcamentoId ? String(s.orcamentoId).trim() : '';
        const sBareOrc = sOrcId.replace(/^orc_/, '');

        if (
          sId === saleId ||
          sId === `v_orc_${followUpId}` ||
          sId === `v_orc_${originOrcId}` ||
          sId === `v_orc_fup_${originOrcId}` ||
          (bareOrcId && (sId === `v_orc_${bareOrcId}` || sId === `v_orc_orc_${bareOrcId}`))
        ) {
          return true;
        }
        if (
          sFupId &&
          (sFupId === followUpId ||
            sFupId === `fup_${originOrcId}` ||
            (bareOrcId && sFupId === `fup_${bareOrcId}`))
        ) {
          return true;
        }
        if (
          sOrcId &&
          (sOrcId === originOrcId ||
            sOrcId === followUpId ||
            sOrcId === `fup_${originOrcId}` ||
            (bareOrcId && sBareOrc === bareOrcId))
        ) {
          return true;
        }
        const sPed = extractCleanPedido(s.pedido);
        const sCli = (s.cliente || '').trim().toLowerCase();
        const bothHaveDifferentOrcs = Boolean(bareOrcId && sBareOrc && bareOrcId !== sBareOrc);
        if (
          !bothHaveDifferentOrcs &&
          cleanPedido &&
          sPed &&
          cleanPedido === sPed &&
          (!clientNameNorm || !sCli || clientNameNorm === sCli)
        ) {
          return true;
        }
        return false;
      };

      const existingIndices: number[] = [];
      metasSales.forEach((s, idx) => {
        if (isMatchingMetaSale(s)) existingIndices.push(idx);
      });

      const primaryExisting = existingIndices.length > 0 ? metasSales[existingIndices[0]] : null;
      const resolvedData =
        extraData?.wasPreviouslySold && primaryExisting?.data ? primaryExisting.data : dateStr;

      const metaSaleRecord = {
        id: primaryExisting?.id || saleId,
        orcamentoId: originOrcId,
        followUpId: followUpId,
        pedido: cleanPedido,
        valor: saleValue,
        frete: freteVal > 0 ? freteVal : undefined,
        desconto: descontoVal > 0 ? descontoVal : undefined,
        produtos: orcProdutos,
        cliente: clientName,
        clienteId: originOrc?.clientId || budget.clientId,
        whatsapp: clientPhone,
        tipoCliente: clientType,
        ...(extraData?.formaPagamento || primaryExisting?.formaPagamento
          ? { formaPagamento: extraData?.formaPagamento || primaryExisting?.formaPagamento }
          : {}),
        ...(extraData?.formasPagamento?.length || primaryExisting?.formasPagamento?.length
          ? { formasPagamento: extraData?.formasPagamento || primaryExisting?.formasPagamento }
          : {}),
        ...(extraData?.parcelas || primaryExisting?.parcelas
          ? { parcelas: extraData?.parcelas || primaryExisting?.parcelas }
          : {}),
        data: resolvedData,
        updatedAt: nowIso,
        responsavel: responsibleUser,
        vendedor: responsibleUser,
        consultoraName: responsibleUser,
        vendedorId: resolvedSellerId,
        responsavelId: resolvedSellerId,
        criadoPor: responsibleUser,
        registeredBy: responsibleUser,
        origem: 'followup',
      };

      // Atualiza in-place o registro existente e remove eventuais duplicatas antigas da mesma venda
      const withoutDuplicates = metasSales.filter((s) => !isMatchingMetaSale(s));
      const updatedMetas = [metaSaleRecord, ...withoutDuplicates];

      localStorage.setItem(METAS_SALES_STORAGE_KEY, JSON.stringify(updatedMetas));
      // Salva de forma atômica no Supabase garantindo deduplicação
      saveItemToSupabase(METAS_SALES_STORAGE_KEY, metaSaleRecord, 'id', responsibleUser).catch(() => {});
      syncSingleMetaSaleToVendas(metaSaleRecord, responsibleUser).catch(() => {});
      window.dispatchEvent(new Event('fenix_metas_updated'));
    } catch (err) {
      console.error('Erro ao sincronizar venda na Meta:', err);
    }

    // 1.2 Atualizar registro gerencial (mantido internamente em sync sem impactar layout)
    try {
      const rawVendas = localStorage.getItem(VENDAS_GERENCIAL_STORAGE_KEY);
      let gerencialSales: VendaGerencial[] = rawVendas ? JSON.parse(rawVendas) : [];
      if (!Array.isArray(gerencialSales)) gerencialSales = [];

      const custoProdutos = Number((saleValue * 0.6).toFixed(2));
      const { totalGeral: custosAdic } = calcularCustosVariaveis(saleValue);
      const { lucro, margem } = calcularLucroEMargem(saleValue, custoProdutos, custosAdic);

      const vendaGerencialRecord: VendaGerencial = {
        id: `vnd-fup-${originOrcId || followUpId}`,
        numeroPedido: cleanPedido || String(originOrcId || followUpId).replace(/\D/g, '').slice(-4),
        data: dateStr,
        cliente: clientName,
        clienteId: originOrc?.clientId || budget.clientId,
        tipoCliente: clientType,
        vendedor: responsibleUser,
        valorVenda: saleValue,
        frete: freteVal > 0 ? freteVal : undefined,
        desconto: descontoVal > 0 ? descontoVal : undefined,
        custoProdutos,
        custosAdicionais: custosAdic,
        lucro,
        margem,
        statusPedido: 'Concluída',
        observacoes: `Venda confirmada no Follow-up Comercial por ${responsibleUser}.`,
        itensResumo: budget.produto || budget.nomeOrcamento || 'Piso Vinílico e Acessórios Fênix',
        metaId: saleId,
        followUpId: followUpId,
        orcamentoId: originOrcId,
        createdAt: now.toISOString(),
        criadoPor: responsibleUser,
      };

      const existingIndex = findMatchingVendaIndex(gerencialSales, {
        id: vendaGerencialRecord.id,
        followUpId: followUpId,
        orcamentoId: originOrcId,
        pedido: cleanPedido,
        numeroPedido: cleanPedido,
        cliente: clientName,
        data: dateStr,
        responsavel: responsibleUser,
        vendedor: responsibleUser,
        valor: saleValue,
        valorVenda: saleValue,
        metaId: saleId,
      });

      let updatedVendas: VendaGerencial[];
      if (existingIndex >= 0) {
        updatedVendas = [...gerencialSales];
        updatedVendas[existingIndex] = {
          ...updatedVendas[existingIndex],
          ...vendaGerencialRecord,
          id: gerencialSales[existingIndex].id || vendaGerencialRecord.id,
          metaId: gerencialSales[existingIndex].metaId || saleId,
          followUpId: followUpId,
          orcamentoId: originOrcId,
        };
      } else {
        updatedVendas = [vendaGerencialRecord, ...gerencialSales];
      }
      updatedVendas = deduplicateVendasList(updatedVendas);

      localStorage.setItem(VENDAS_GERENCIAL_STORAGE_KEY, JSON.stringify(updatedVendas));
      saveWholeCollectionToSupabase(VENDAS_GERENCIAL_STORAGE_KEY, updatedVendas, currentUserName).catch(() => {});
      window.dispatchEvent(new Event('fenix_vendas_gerencial_updated'));
      window.dispatchEvent(new Event('fenix_vendas_updated'));
    } catch (err) {
      console.error('Erro ao sincronizar Vendas Gerencial:', err);
    }
  } else {
    // REGRA: Nunca apagar, substituir ou zerar vendas já existentes em Metas.
    // Todas as vendas anteriores são preservadas integralmente.

    // 2.2 Remover das VENDAS DO DIRETOR ÉDER se mudou de Vendido para outro status
    try {
      const rawVendas = localStorage.getItem(VENDAS_GERENCIAL_STORAGE_KEY);
      if (rawVendas) {
        const gerencialSales: VendaGerencial[] = JSON.parse(rawVendas);
        if (Array.isArray(gerencialSales)) {
          const removedVenda = gerencialSales.find(
            (v) =>
              v.orcamentoId === budget.id ||
              (v as any).followUpId === budget.id ||
              v.metaId === saleId ||
              v.id === `vnd-fup-${budget.id}` ||
              (cleanPedido && v.numeroPedido === cleanPedido && v.cliente?.trim().toLowerCase() === clientName.toLowerCase())
          );
          const filtered = gerencialSales.filter(
            (v) =>
              v.orcamentoId !== budget.id &&
              (v as any).followUpId !== budget.id &&
              v.metaId !== saleId &&
              v.id !== `vnd-fup-${budget.id}` &&
              !(cleanPedido && v.numeroPedido === cleanPedido && v.cliente?.trim().toLowerCase() === clientName.toLowerCase())
          );
          if (filtered.length !== gerencialSales.length) {
            localStorage.setItem(VENDAS_GERENCIAL_STORAGE_KEY, JSON.stringify(filtered));
            if (removedVenda?.id) {
              deleteItemFromSupabase(VENDAS_GERENCIAL_STORAGE_KEY, removedVenda.id, 'id', currentUserName).catch(() => {});
            }
            window.dispatchEvent(new Event('fenix_vendas_updated'));
          }
        }
      }
    } catch (err) {
      console.error('Erro ao remover das Vendas do Diretor:', err);
    }
  }

  // Se VENDIDO ou PERDIDO, limpa alertas periódicos
  if (newStatus === 'Vendido' || newStatus === 'Perdido') {
    try {
      localStorage.removeItem(`fenix_fup_alerted_2dias_${budget.id}`);
    } catch {}
  }
}

/**
 * 1.3 Se uma venda for excluída da META:
 * - Follow-up correspondente vira PERDIDO automaticamente.
 * - Também é removido das Vendas do Diretor Éder.
 */
export function onMetaSaleDeleted(
  deletedSale: {
    id: string;
    orcamentoId?: string;
    followUpId?: string;
    pedido?: string;
    cliente?: string;
  },
  currentUserName: string = 'Vanessa Gomes'
): { followUpUpdated: boolean; vendasUpdated: boolean } {
  if (typeof window === 'undefined' || !deletedSale) {
    return { followUpUpdated: false, vendasUpdated: false };
  }

  let followUpUpdated = false;
  let vendasUpdated = false;

  const targetId = deletedSale.orcamentoId || deletedSale.followUpId || deletedSale.id;
  const targetPedido = extractCleanPedido(deletedSale.pedido);
  const targetClient = (deletedSale.cliente || '').trim().toLowerCase();

  // 1. ATUALIZAR FOLLOW-UP PARA 'PERDIDO'
  const updateFollowUpToPerdido = (key: string): boolean => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return false;
      const list: FollowUpItem[] = JSON.parse(raw);
      if (!Array.isArray(list) || list.length === 0) return false;

      let changed = false;
      const now = new Date();
      const dia = String(now.getDate()).padStart(2, '0');
      const mes = String(now.getMonth() + 1).padStart(2, '0');
      const ano = now.getFullYear();
      const hora = String(now.getHours()).padStart(2, '0');
      const min = String(now.getMinutes()).padStart(2, '0');

      const updatedList = list.map((item) => {
        const itemCleanPed = extractCleanPedido(item.pedido);
        const itemClient = (item.cliente || '').trim().toLowerCase();

        const isMatch =
          item.id === targetId ||
          item.id === deletedSale.orcamentoId ||
          item.id === deletedSale.followUpId ||
          (targetPedido && itemCleanPed && itemCleanPed === targetPedido && (!targetClient || itemClient === targetClient));

        if (isMatch) {
          changed = true;
          // Adiciona histórico de alteração para Perdido
          const newEntry = {
            id: `h_del_${Date.now()}`,
            data: `${dia}/${mes}/${ano}`,
            hora: `${hora}:${min}`,
            statusAnterior: item.status,
            novoStatus: 'Perdido' as FollowUpStatus,
            observacao: `Venda #${item.pedido || targetPedido} excluída da Meta por ${currentUserName}. Status do Follow-up alterado automaticamente para Perdido.`,
            usuario: currentUserName,
            timestamp: now.getTime(),
          };

          return {
            ...item,
            status: 'Perdido' as FollowUpStatus,
            lembretesAtivos: false,
            dataAtualizacao: now.toISOString(),
            historico: [newEntry, ...(item.historico || [])],
          };
        }
        return item;
      });

      if (changed) {
        localStorage.setItem(key, JSON.stringify(updatedList));
        const targetPerdidoItem = updatedList.find(it => it.id === targetId || (targetPedido && extractCleanPedido(it.pedido) === targetPedido));
        if (targetPerdidoItem) {
          saveItemToSupabase(key, targetPerdidoItem, 'id', currentUserName).catch(() => {});
        }
        return true;
      }
    } catch (err) {
      console.warn(`Erro ao atualizar Follow-up para Perdido [${key}]:`, err);
    }
    return false;
  };

  const fupV2 = updateFollowUpToPerdido(FOLLOWUP_STORAGE_KEY_V2);
  const fupLeg = updateFollowUpToPerdido(FOLLOWUP_STORAGE_KEY_LEGACY);
  if (fupV2 || fupLeg) {
    followUpUpdated = true;
    window.dispatchEvent(new Event('fenix_followup_updated'));
  }

  // 2. REMOVER DAS VENDAS DO DIRETOR ÉDER
  try {
    const rawVendas = localStorage.getItem(VENDAS_GERENCIAL_STORAGE_KEY);
    if (rawVendas) {
      const gerencialSales: VendaGerencial[] = JSON.parse(rawVendas);
      if (Array.isArray(gerencialSales)) {
        const filtered = gerencialSales.filter((v) => {
          const vCleanPed = extractCleanPedido(v.numeroPedido);
          const vClient = (v.cliente || '').trim().toLowerCase();

          const isMatch =
            v.metaId === deletedSale.id ||
            v.id === `vnd-meta-${deletedSale.id}` ||
            v.id === `vnd-fup-${targetId}` ||
            v.orcamentoId === targetId ||
            (targetPedido && vCleanPed && vCleanPed === targetPedido && (!targetClient || vClient === targetClient));

          return !isMatch;
        });

        if (filtered.length !== gerencialSales.length) {
          localStorage.setItem(VENDAS_GERENCIAL_STORAGE_KEY, JSON.stringify(filtered));
          const removedItem = gerencialSales.find(v => {
            const vCleanPed = extractCleanPedido(v.numeroPedido);
            const vClient = (v.cliente || '').trim().toLowerCase();
            return (
              v.metaId === deletedSale.id ||
              v.id === `vnd-meta-${deletedSale.id}` ||
              v.id === `vnd-fup-${targetId}` ||
              v.orcamentoId === targetId ||
              (targetPedido && vCleanPed && vCleanPed === targetPedido && (!targetClient || vClient === targetClient))
            );
          });
          if (removedItem?.id) {
            deleteItemFromSupabase(VENDAS_GERENCIAL_STORAGE_KEY, removedItem.id, 'id', currentUserName).catch(() => {});
          }
          vendasUpdated = true;
          window.dispatchEvent(new Event('fenix_vendas_updated'));
        }
      }
    }
  } catch (err) {
    console.error('Erro ao remover das Vendas do Diretor:', err);
  }

  return { followUpUpdated, vendasUpdated };
}
