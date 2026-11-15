import React, { useMemo, useState } from 'react';
import {
  Search,
  X,
  RotateCcw,
  Eye,
  Pencil,
  Trash2,
  Phone,
  MessageCircle,
  User,
  Store,
  Building2,
  Wrench,
  PenTool,
  HardHat,
  CheckCircle2,
  AlertTriangle,
  FileText,
  ExternalLink,
  ArrowUpDown,
  Hash,
  Sparkles,
  Calendar,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import {
  ClientRecord,
  FollowUpItem,
  OfficialFollowUpStatus,
  OrcamentoStatus,
  SavedOrcamento,
} from '../../types';
import {
  calculateOrcamentoTotalSqm,
  deduplicateFollowUpList,
  extractOrcamentoCreationDateParts,
  findMatchingFollowUpIndex,
  generateNextPedidoNumber,
  getDisplayOrcamentoNumber,
  mapOrcamentoStatusToFollowUp,
  normalizeOrcamentoRefId,
  resolveClientPhone,
  resolveOrcamentoResponsible,
} from '../../utils/orcamentoFollowUpSync';
import { isRecordOfResponsible, getSellerIdForUser } from '../../utils/userDataFilter';
import { getUserIdByName } from '../../utils/auth';
import { ResponsibleFilterTabs } from '../ResponsibleFilterTabs';

export type TrackingListStatus = OfficialFollowUpStatus;
export type TrackingStatusFilter = 'Todos' | OfficialFollowUpStatus;
export type TrackingPeriodMode = 'dia' | 'mes' | 'todos';
export type TrackingSortOrder =
  | 'recentes'
  | 'antigos'
  | 'maior_valor'
  | 'menor_valor'
  | 'maior_metragem'
  | 'menor_metragem'
  | 'alfabetica';

export const OFFICIAL_TRACKING_STATUSES: { value: OfficialFollowUpStatus; label: string }[] = [
  { value: 'Orçamento Enviado', label: 'ORÇAMENTO ENVIADO' },
  { value: 'Aguardando Retorno', label: 'AGUARDANDO RETORNO' },
  { value: 'Negociando', label: 'NEGOCIANDO' },
  { value: 'Vendido', label: 'VENDIDO' },
  { value: 'Perdido', label: 'PERDIDO' },
];

export function getOfficialStatusLabel(status: OfficialFollowUpStatus): string {
  const found = OFFICIAL_TRACKING_STATUSES.find((s) => s.value === status);
  return found ? found.label : String(status).toUpperCase();
}

export interface TrackingOrcamentoRow {
  rowKey: string;
  orcamentoId: string;
  numeroOrcamento: string;
  followUpId?: string;
  pedido?: string;
  clientId?: string;
  cliente: string;
  clientType: string;
  telefone: string;
  nomeOrcamento: string;
  sqm: number;
  valor: number;
  status: OfficialFollowUpStatus;
  observacao: string;
  responsavel: string;
  responsavelId?: string | null;
  vendedor?: string;
  vendedorId?: string | null;
  criadoPor?: string;
  criadoPorId?: string | null;
  creatorId?: string | null;
  creationDateStr: string; // YYYY-MM-DD
  creationMonthStr: string; // YYYY-MM
  creationDisplayDate: string; // DD/MM/YYYY
  creationTimestamp: number;
  sourceOrcamento: SavedOrcamento;
  sourceFollowUp?: FollowUpItem;
  hasOverrides: boolean;
}

export function deriveTrackingStatus(
  followUp?: FollowUpItem,
  orc?: Partial<SavedOrcamento>
): OfficialFollowUpStatus {
  const orcMapped = orc?.status ? mapOrcamentoStatusToFollowUp(orc.status) : null;
  if (orcMapped === 'Vendido') return 'Vendido';

  if (followUp?.status) {
    const fupMapped = mapOrcamentoStatusToFollowUp(followUp.status);
    if (fupMapped === 'Orçamento Enviado' && followUp.trackingStatus) {
      if (followUp.trackingStatus === 'Vendido') return 'Vendido';
      if (followUp.trackingStatus === 'Não vendido') return 'Perdido';
    }
    return fupMapped;
  }

  if (followUp?.trackingStatus === 'Vendido') return 'Vendido';
  if (followUp?.trackingStatus === 'Não vendido') return 'Perdido';

  if (orcMapped) return orcMapped;
  return 'Orçamento Enviado';
}

export function formatPhoneDisplay(phone?: string): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 13 && digits.startsWith('55')) {
    return `(${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

export function buildWhatsAppHref(phone?: string, clientName?: string, budgetName?: string): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 8) return null;
  const normalized =
    digits.startsWith('55') && digits.length >= 12 ? digits : `55${digits}`;
  const text = clientName
    ? `Olá ${clientName}! Passando para acompanhar o seu orçamento${budgetName ? ` (${budgetName})` : ''} da Fênix World. Como podemos prosseguir?`
    : 'Olá! Passando para acompanhar o seu orçamento da Fênix World.';
  return `https://wa.me/${normalized}?text=${encodeURIComponent(text)}`;
}

export function formatSqmDisplay(sqm: number): string {
  if (!sqm || isNaN(sqm) || sqm <= 0) return '—';
  return `${sqm.toLocaleString('pt-BR', {
    minimumFractionDigits: sqm % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })} m²`;
}

export function formatCurrencyBRL(val: number): string {
  const num = typeof val === 'number' && !isNaN(val) ? val : 0;
  return `R$ ${num.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function getLocalISODate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function normalizeSearchText(str?: string): string {
  return (str || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function buildTrackingRows(params: {
  followUpItems: FollowUpItem[];
  allOrcamentos: SavedOrcamento[];
  clients: ClientRecord[];
  fallbackUserName?: string;
}): TrackingOrcamentoRow[] {
  const { followUpItems, allOrcamentos, clients, fallbackUserName } = params;

  // 1. Deduplica os orçamentos mantendo sempre o mais recente para o mesmo ID
  const orcMap = new Map<string, SavedOrcamento>();
  allOrcamentos.forEach((o) => {
    if (!o || !o.id) return;
    const key = normalizeOrcamentoRefId(o.id) || String(o.id).trim();
    const existing = orcMap.get(key);
    if (!existing) {
      orcMap.set(key, o);
      return;
    }
    const existingTs = new Date(existing.updatedAt || existing.savedAt || 0).getTime() || 0;
    const incomingTs = new Date(o.updatedAt || o.savedAt || 0).getTime() || 0;
    if (incomingTs >= existingTs) {
      orcMap.set(key, {
        ...existing,
        ...o,
        pedido: o.pedido || existing.pedido,
        followUpId: o.followUpId || existing.followUpId,
      });
    }
  });

  const dedupedFups = deduplicateFollowUpList(followUpItems || []);
  const matchedFupIds = new Set<string>();
  const rows: TrackingOrcamentoRow[] = [];

  // 2. Cada orçamento gerado gera exatamente 1 registro individual
  orcMap.forEach((orc) => {
    const orcId = String(orc.id).trim();
    const idx = findMatchingFollowUpIndex(dedupedFups, orcId);
    const fup = idx >= 0 ? dedupedFups[idx] : undefined;
    if (fup?.id) matchedFupIds.add(fup.id);

    // Se excluído apenas da Lista de Acompanhamento, não renderiza (orçamento original permanece intacto)
    if (fup?.hiddenFromTrackingList) return;

    const clientNameRaw = (orc.clientName || (orc as any).cliente || fup?.cliente || 'Cliente').trim();
    if (clientNameRaw.toLowerCase().includes('roberto silveira')) return;

    const overrides = fup?.trackingOverrides;
    const cliente = overrides?.cliente && fup?.cliente ? fup.cliente : clientNameRaw;

    const resolvedOrcPhone = resolveClientPhone(orc, clients);
    const telefone = overrides?.telefone
      ? fup?.telefone || ''
      : resolvedOrcPhone || fup?.telefone || '';

    const budgetTitleRaw = (
      orc.nomeOrcamento ||
      (orc as any).finalNomeOrcamento ||
      fup?.nomeOrcamento ||
      (orc.items && orc.items[0]?.descricao) ||
      'Orçamento de Materiais'
    ).trim();

    const nomeOrcamento =
      overrides?.nomeOrcamento && fup?.nomeOrcamento ? fup.nomeOrcamento : budgetTitleRaw;

    const calculatedSqm = calculateOrcamentoTotalSqm(
      Array.isArray(orc.items) && orc.items.length > 0 ? orc.items : fup?.produtos
    );
    const sqm =
      overrides?.sqm && fup?.customSqm !== undefined ? Number(fup.customSqm) || 0 : calculatedSqm;

    const rawOrcVal = Number(orc.totalFinal) || Number((orc as any).valor) || 0;
    const valor =
      overrides?.valor && fup?.valor !== undefined
        ? Number(fup.valor) || 0
        : rawOrcVal || Number(fup?.valor) || 0;

    const rawCreation =
      orc.savedAt ||
      (orc as any).createdAt ||
      (orc as any).dataCriacao ||
      orc.dataOrcamento ||
      fup?.createdAt ||
      fup?.dataCriacao ||
      '';
    const dateParts = extractOrcamentoCreationDateParts(rawCreation);

    const responsavel = resolveOrcamentoResponsible(orc, fup?.responsavel || fallbackUserName);
    const sellerId =
      (orc as any).vendedorId ||
      (orc as any).responsavelId ||
      fup?.responsavelId ||
      fup?.vendedorId ||
      getUserIdByName(responsavel) ||
      getSellerIdForUser(responsavel);

    const numeroOrcamento = getDisplayOrcamentoNumber(orc, orcId);

    rows.push({
      rowKey: `orc_${normalizeOrcamentoRefId(orcId) || orcId}`,
      orcamentoId: orcId,
      numeroOrcamento,
      followUpId: fup?.id,
      pedido: (orc as any).pedido || (orc as any).orderNum || fup?.pedido || '',
      clientId: orc.clientId || fup?.clientId,
      cliente,
      clientType: orc.clientType || fup?.clientType || 'Cliente Final',
      telefone,
      nomeOrcamento,
      sqm,
      valor,
      status: deriveTrackingStatus(fup, orc),
      observacao:
        overrides?.observacao && fup?.observacao !== undefined
          ? fup.observacao
          : orc.observacoes || fup?.observacao || '',
      responsavel,
      responsavelId: fup?.responsavelId ?? sellerId,
      vendedor: fup?.vendedor || responsavel,
      vendedorId: fup?.vendedorId ?? sellerId,
      criadoPor: fup?.criadoPor || responsavel,
      criadoPorId: fup?.criadoPorId ?? sellerId,
      creatorId: fup?.creatorId ?? sellerId,
      creationDateStr: dateParts.dateStr,
      creationMonthStr: dateParts.monthStr,
      creationDisplayDate: dateParts.displayDate,
      creationTimestamp: dateParts.timestamp,
      sourceOrcamento: orc,
      sourceFollowUp: fup,
      hasOverrides: Boolean(
        overrides &&
          (overrides.cliente ||
            overrides.telefone ||
            overrides.nomeOrcamento ||
            overrides.sqm ||
            overrides.valor ||
            overrides.observacao)
      ),
    });
  });

  // 3. Follow-ups legados que não possuem registro em saved_orcamentos
  dedupedFups.forEach((fup) => {
    if (!fup || (fup.id && matchedFupIds.has(fup.id))) return;
    if (fup.hiddenFromTrackingList) return;
    const clientName = (fup.cliente || 'Cliente').trim();
    if (clientName.toLowerCase().includes('roberto silveira')) return;

    const overrides = fup.trackingOverrides;
    const sqm =
      overrides?.sqm && fup.customSqm !== undefined
        ? Number(fup.customSqm) || 0
        : calculateOrcamentoTotalSqm(fup.produtos);

    const rawCreation =
      fup.createdAt || fup.dataCriacao || fup.dataEntradaFollowUp || fup.dataAtualizacao || '';
    const dateParts = extractOrcamentoCreationDateParts(rawCreation);

    let phone = fup.telefone || '';
    if (!phone) {
      phone = resolveClientPhone(
        { clientId: fup.clientId, clientName: fup.cliente } as Partial<SavedOrcamento>,
        clients
      );
    }

    const orcId = fup.orcamentoId || fup.id.replace(/^fup_/, '') || `orc_${fup.id}`;
    const fallbackStatus = deriveTrackingStatus(fup);

    const fallbackOrc: SavedOrcamento = {
      id: orcId,
      clientId: fup.clientId || 'cli_geral',
      clientName,
      clientType: fup.clientType || 'Cliente Final',
      clientContact: phone,
      nomeOrcamento: fup.nomeOrcamento || '',
      consultoraName: fup.responsavel || fup.vendedor || fallbackUserName || 'Consultora Fênix',
      dataOrcamento: dateParts.displayDate !== '—' ? dateParts.displayDate : new Date().toLocaleDateString('pt-BR'),
      observacoes: fup.observacao || '',
      items: Array.isArray(fup.produtos) && fup.produtos.length > 0
        ? fup.produtos
        : [
            {
              id: `item_${fup.id}`,
              qtd: sqm > 0 ? String(sqm) : '1',
              descricao: fup.nomeOrcamento || fup.produto || 'Item do Orçamento',
              unidade: sqm > 0 ? 'm²' : 'un',
              precoUnitario: Number(fup.valor) || 0,
              total: Number(fup.valor) || 0,
            },
          ],
      freteValor: Number(fup.frete) || 0,
      freteEndereco: '',
      descontoValor: Number(fup.desconto) || 0,
      totalFinal: Number(fup.valor) || 0,
      status: fallbackStatus as OrcamentoStatus,
      pedido: fup.pedido || '',
      followUpId: fup.id,
      savedAt: fup.createdAt || new Date().toISOString(),
    };

    const numeroOrcamento = getDisplayOrcamentoNumber(fallbackOrc, orcId);

    rows.push({
      rowKey: `fup_${fup.id}`,
      orcamentoId: orcId,
      numeroOrcamento,
      followUpId: fup.id,
      pedido: fup.pedido || '',
      clientId: fup.clientId,
      cliente: clientName,
      clientType: fup.clientType || 'Cliente Final',
      telefone: phone,
      nomeOrcamento: fup.nomeOrcamento || fup.produto || 'Orçamento',
      sqm,
      valor: Number(fup.valor) || 0,
      status: fallbackStatus,
      observacao: fup.observacao || '',
      responsavel: fup.responsavel || fup.vendedor || fallbackUserName || 'Consultora Fênix',
      responsavelId: fup.responsavelId,
      vendedor: fup.vendedor,
      vendedorId: fup.vendedorId,
      criadoPor: fup.criadoPor,
      criadoPorId: fup.criadoPorId,
      creatorId: fup.creatorId,
      creationDateStr: dateParts.dateStr,
      creationMonthStr: dateParts.monthStr,
      creationDisplayDate: dateParts.displayDate,
      creationTimestamp: dateParts.timestamp,
      sourceOrcamento: fallbackOrc,
      sourceFollowUp: fup,
      hasOverrides: Boolean(overrides),
    });
  });

  return rows.sort((a, b) => b.creationTimestamp - a.creationTimestamp);
}

const getClientTypeIconInfo = (type?: string) => {
  switch (type) {
    case 'Revenda':
      return { Icon: Store, bgClass: 'bg-purple-50 text-purple-700 border-purple-100' };
    case 'Construtora':
      return { Icon: Building2, bgClass: 'bg-emerald-50 text-emerald-700 border-emerald-100' };
    case 'Instalador':
      return { Icon: Wrench, bgClass: 'bg-orange-50 text-orange-700 border-orange-100' };
    case 'Arquiteto':
      return { Icon: PenTool, bgClass: 'bg-violet-50 text-violet-700 border-violet-100' };
    case 'Engenheiro':
      return { Icon: HardHat, bgClass: 'bg-sky-50 text-sky-700 border-sky-100' };
    default:
      return { Icon: User, bgClass: 'bg-blue-50 text-[#0052cc] border-blue-100' };
  }
};

const getTrackingStatusSelectClass = (status: OfficialFollowUpStatus): string => {
  switch (status) {
    case 'Vendido':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200 focus:border-emerald-500';
    case 'Perdido':
      return 'bg-rose-50 text-rose-700 border-rose-200 focus:border-rose-500';
    case 'Negociando':
      return 'bg-purple-50 text-purple-700 border-purple-200 focus:border-purple-500';
    case 'Aguardando Retorno':
      return 'bg-amber-50 text-amber-800 border-amber-200 focus:border-amber-500';
    default:
      return 'bg-blue-50 text-[#0052cc] border-blue-200 focus:border-[#0052cc]';
  }
};

interface ListaAcompanhamentoOrcamentosProps {
  followUpItems: FollowUpItem[];
  allOrcamentos: SavedOrcamento[];
  clients: ClientRecord[];
  currentUserName: string;
  isDirector: boolean;
  periodMode?: TrackingPeriodMode;
  onChangePeriodMode?: (mode: TrackingPeriodMode) => void;
  selectedMonth?: string;
  onChangeSelectedMonth?: (month: string) => void;
  selectedDate?: string;
  onChangeSelectedDate?: (date: string) => void;
  onViewOrcamento: (row: TrackingOrcamentoRow) => void;
  onUpdateTrackingStatus: (row: TrackingOrcamentoRow, newStatus: OfficialFollowUpStatus) => Promise<void> | void;
  onSaveTrackingEdit: (
    row: TrackingOrcamentoRow,
    edited: {
      cliente: string;
      telefone: string;
      nomeOrcamento: string;
      sqm: number;
      valor: number;
      status: OfficialFollowUpStatus;
      pedido?: string;
      observacao: string;
      restoreOriginal?: boolean;
    }
  ) => Promise<void> | void;
  onRemoveFromTrackingList: (row: TrackingOrcamentoRow) => Promise<void> | void;
}

export const ListaAcompanhamentoOrcamentos: React.FC<ListaAcompanhamentoOrcamentosProps> = ({
  followUpItems,
  allOrcamentos,
  clients,
  currentUserName,
  isDirector,
  periodMode: controlledPeriodMode,
  onChangePeriodMode,
  selectedMonth: controlledSelectedMonth,
  onChangeSelectedMonth,
  selectedDate: controlledSelectedDate,
  onChangeSelectedDate,
  onViewOrcamento,
  onUpdateTrackingStatus,
  onSaveTrackingEdit,
  onRemoveFromTrackingList,
}) => {
  const todayStr = useMemo(() => getLocalISODate(new Date()), []);
  const currentMonthStr = useMemo(() => todayStr.slice(0, 7), [todayStr]);

  // Filtros combinados
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<TrackingStatusFilter>('Todos');
  const [internalPeriodMode, setInternalPeriodMode] = useState<TrackingPeriodMode>('mes');
  const [internalSelectedDate, setInternalSelectedDate] = useState<string>(todayStr);
  const [internalSelectedMonth, setInternalSelectedMonth] = useState<string>(currentMonthStr);
  const periodMode = controlledPeriodMode ?? internalPeriodMode;
  const selectedDate = controlledSelectedDate ?? internalSelectedDate;
  const selectedMonth = controlledSelectedMonth ?? internalSelectedMonth;

  const setPeriodMode = (nextMode: TrackingPeriodMode) => {
    setInternalPeriodMode(nextMode);
    onChangePeriodMode?.(nextMode);
  };
  const setSelectedDate = (nextDate: string) => {
    setInternalSelectedDate(nextDate);
    onChangeSelectedDate?.(nextDate);
  };
  const setSelectedMonth = (nextMonth: string) => {
    setInternalSelectedMonth(nextMonth);
    onChangeSelectedMonth?.(nextMonth);
  };

  const [sortOrder, setSortOrder] = useState<TrackingSortOrder>('recentes');
  const [responsibleTab, setResponsibleTab] = useState<string>('Todos');

  // Modais de Edição e Exclusão da Lista de Acompanhamento
  const [editingRow, setEditingRow] = useState<TrackingOrcamentoRow | null>(null);
  const [editForm, setEditForm] = useState<{
    cliente: string;
    telefone: string;
    nomeOrcamento: string;
    sqm: string;
    valor: string;
    status: OfficialFollowUpStatus;
    pedido: string;
    observacao: string;
  }>({
    cliente: '',
    telefone: '',
    nomeOrcamento: '',
    sqm: '',
    valor: '',
    status: 'Orçamento Enviado',
    pedido: '',
    observacao: '',
  });
  const [editPedidoError, setEditPedidoError] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const [removingRow, setRemovingRow] = useState<TrackingOrcamentoRow | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);

  // 1. Constrói todas as linhas 1:1 (orçamento -> registro) com dados reais do Supabase
  const allRows = useMemo(
    () =>
      buildTrackingRows({
        followUpItems,
        allOrcamentos,
        clients,
        fallbackUserName: currentUserName,
      }),
    [followUpItems, allOrcamentos, clients, currentUserName]
  );

  // Contagem por responsável (para diretoria)
  const responsibleCounts = useMemo(() => {
    if (!isDirector) return undefined;
    return {
      todos: allRows.length,
      eder: allRows.filter((r) => isRecordOfResponsible(r, 'Éder')).length,
      vanessa: allRows.filter((r) => isRecordOfResponsible(r, 'Vanessa')).length,
      jhessica: allRows.filter((r) => isRecordOfResponsible(r, 'Jhessica')).length,
      demais: allRows.filter((r) => isRecordOfResponsible(r, 'demais')).length,
    };
  }, [allRows, isDirector]);

  // 2. Escopo de usuário / responsável
  const userScopedRows = useMemo(() => {
    if (isDirector) {
      if (responsibleTab === 'Todos') return allRows;
      return allRows.filter((r) => isRecordOfResponsible(r, responsibleTab));
    }
    return allRows.filter((r) => isRecordOfResponsible(r, currentUserName || ''));
  }, [allRows, isDirector, responsibleTab, currentUserName]);

  // Contadores de status sobre a base do usuário (combinando pesquisa por cliente/telefone e período dia/mês)
  const preStatusRows = useMemo(() => {
    const q = normalizeSearchText(searchTerm);
    const qDigits = q.replace(/\D/g, '');

    return userScopedRows.filter((row) => {
      // Período de criação compartilhado (dia ou mês; 'todos' caso selecionado na Visão Geral)
      if (periodMode === 'dia') {
        if (row.creationDateStr !== selectedDate) return false;
      } else if (periodMode === 'mes') {
        if (row.creationMonthStr !== selectedMonth) return false;
      }

      // Busca exclusivamente por nome do cliente ou telefone
      if (!q) return true;

      const inClient = normalizeSearchText(row.cliente).includes(q);
      const inPhone = normalizeSearchText(row.telefone).includes(q);
      const phoneDigits = row.telefone.replace(/\D/g, '');
      const inPhoneDigits = qDigits.length >= 3 && phoneDigits.includes(qDigits);

      return inClient || inPhone || inPhoneDigits;
    });
  }, [
    userScopedRows,
    periodMode,
    selectedDate,
    selectedMonth,
    searchTerm,
  ]);

  const statusCounts = useMemo(() => {
    const counts: Record<TrackingStatusFilter, number> = {
      Todos: preStatusRows.length,
      'Orçamento Enviado': 0,
      'Aguardando Retorno': 0,
      Negociando: 0,
      Vendido: 0,
      Perdido: 0,
    };
    preStatusRows.forEach((r) => {
      if (counts[r.status] !== undefined) {
        counts[r.status] += 1;
      }
    });
    return counts;
  }, [preStatusRows]);

  // 3. Aplica filtro de Status + Ordenação combinados
  const visibleRows = useMemo(() => {
    const filtered =
      statusFilter === 'Todos'
        ? preStatusRows
        : preStatusRows.filter((row) => row.status === statusFilter);

    return [...filtered].sort((a, b) => {
      switch (sortOrder) {
        case 'antigos':
          return a.creationTimestamp - b.creationTimestamp;
        case 'maior_valor':
          return b.valor - a.valor || b.creationTimestamp - a.creationTimestamp;
        case 'menor_valor':
          return a.valor - b.valor || b.creationTimestamp - a.creationTimestamp;
        case 'maior_metragem':
          return b.sqm - a.sqm || b.creationTimestamp - a.creationTimestamp;
        case 'menor_metragem':
          return a.sqm - b.sqm || b.creationTimestamp - a.creationTimestamp;
        case 'alfabetica':
          return a.cliente.localeCompare(b.cliente, 'pt-BR', { sensitivity: 'base' });
        case 'recentes':
        default:
          return b.creationTimestamp - a.creationTimestamp;
      }
    });
  }, [preStatusRows, statusFilter, sortOrder]);

  const hasActiveFilters =
    searchTerm.trim() !== '' ||
    statusFilter !== 'Todos' ||
    periodMode !== 'mes' ||
    selectedMonth !== currentMonthStr ||
    sortOrder !== 'recentes' ||
    (isDirector && responsibleTab !== 'Todos');

  const handleClearFilters = () => {
    setSearchTerm('');
    setStatusFilter('Todos');
    setPeriodMode('mes');
    setSelectedDate(todayStr);
    setSelectedMonth(currentMonthStr);
    setSortOrder('recentes');
    if (isDirector) setResponsibleTab('Todos');
  };

  const handleOpenEditModal = (row: TrackingOrcamentoRow) => {
    setEditingRow(row);
    setEditPedidoError('');
    setEditForm({
      cliente: row.cliente,
      telefone: row.telefone,
      nomeOrcamento: row.nomeOrcamento,
      sqm: row.sqm > 0 ? String(row.sqm).replace('.', ',') : '',
      valor: row.valor > 0 ? row.valor.toFixed(2).replace('.', ',') : '0,00',
      status: row.status,
      pedido: row.pedido ? String(row.pedido).replace(/^#+/, '') : '',
      observacao: row.observacao,
    });
  };

  const handleConfirmEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRow) return;

    const cleanPedido = editForm.pedido.trim().replace(/^#+/, '');
    if (editForm.status === 'Vendido' && !cleanPedido) {
      setEditPedidoError('Informe ou gere o número do pedido para concluir como VENDIDO.');
      return;
    }

    const parsePtNumber = (txt: string): number => {
      const cleaned = txt.trim().replace(/[^\d.,]/g, '');
      if (!cleaned) return 0;
      if (cleaned.includes(',') && cleaned.includes('.')) {
        return parseFloat(cleaned.replace(/\./g, '').replace(',', '.')) || 0;
      }
      if (cleaned.includes(',')) {
        return parseFloat(cleaned.replace(',', '.')) || 0;
      }
      return parseFloat(cleaned) || 0;
    };

    setIsSavingEdit(true);
    try {
      await onSaveTrackingEdit(editingRow, {
        cliente: editForm.cliente.trim() || editingRow.cliente,
        telefone: editForm.telefone.trim(),
        nomeOrcamento: editForm.nomeOrcamento.trim() || editingRow.nomeOrcamento,
        sqm: parsePtNumber(editForm.sqm),
        valor: parsePtNumber(editForm.valor),
        status: editForm.status,
        pedido: cleanPedido || undefined,
        observacao: editForm.observacao.trim(),
      });
      setEditingRow(null);
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleConfirmRestoreOriginal = async () => {
    if (!editingRow) return;
    setIsSavingEdit(true);
    try {
      const origOrc = editingRow.sourceOrcamento;
      const origSqm = calculateOrcamentoTotalSqm(origOrc.items);
      await onSaveTrackingEdit(editingRow, {
        cliente: origOrc.clientName || editingRow.cliente,
        telefone: resolveClientPhone(origOrc, clients) || '',
        nomeOrcamento: origOrc.nomeOrcamento || origOrc.items?.[0]?.descricao || 'Orçamento',
        sqm: origSqm,
        valor: Number(origOrc.totalFinal) || 0,
        status: editingRow.status,
        pedido: editingRow.pedido,
        observacao: origOrc.observacoes || '',
        restoreOriginal: true,
      });
      setEditingRow(null);
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleConfirmRemove = async () => {
    if (!removingRow) return;
    setIsRemoving(true);
    try {
      await onRemoveFromTrackingList(removingRow);
      setRemovingRow(null);
    } finally {
      setIsRemoving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Filtro por Responsável (somente Diretoria) */}
      {isDirector && (
        <ResponsibleFilterTabs
          activeTab={responsibleTab}
          onSelectTab={setResponsibleTab}
          counts={responsibleCounts}
          label="Acompanhamento por Responsável"
        />
      )}

      {/* Barra de Filtros em exatamente duas linhas */}
      <div className="bg-white rounded-[22px] border border-slate-200/90 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.04)] p-3.5 sm:p-4 space-y-2.5">
        {/* Linha 1: Busca (cliente ou telefone) + Seletor de dia + Seletor de mês + Ordenação */}
        <div className="flex flex-wrap xl:flex-nowrap items-center gap-2">
          {/* Busca por nome do cliente ou telefone */}
          <div className="relative flex-1 min-w-[210px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por nome do cliente ou telefone..."
              className="w-full h-9 pl-8.5 pr-8 bg-slate-50/80 hover:bg-slate-50 focus:bg-white border border-slate-200 focus:border-[#0052cc] rounded-xl text-xs text-slate-800 placeholder:text-slate-400 outline-none transition-all"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
                title="Limpar busca"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Seletor de dia com navegação anterior e seguinte */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => {
                const base = selectedDate || todayStr;
                const d = new Date(`${base}T12:00:00`);
                d.setDate(d.getDate() - 1);
                setSelectedDate(getLocalISODate(d));
                setPeriodMode('dia');
              }}
              className="h-9 w-8 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 flex items-center justify-center cursor-pointer transition-colors"
              title="Dia anterior"
              aria-label="Dia anterior"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <input
              type="date"
              value={selectedDate}
              onClick={() => {
                if (periodMode !== 'dia') setPeriodMode('dia');
              }}
              onChange={(e) => {
                const next = e.target.value;
                if (next) {
                  setSelectedDate(next);
                  setPeriodMode('dia');
                }
              }}
              aria-label="Selecionar dia"
              title="Filtrar pelo dia selecionado"
              className={`h-9 px-2.5 rounded-xl border text-xs font-bold outline-none cursor-pointer transition-colors ${
                periodMode === 'dia'
                  ? 'border-[#0052cc] bg-blue-50/70 text-[#0052cc]'
                  : 'border-slate-200 bg-slate-50/80 text-slate-700 hover:bg-slate-50 focus:border-[#0052cc]'
              }`}
            />
            <button
              type="button"
              onClick={() => {
                const base = selectedDate || todayStr;
                const d = new Date(`${base}T12:00:00`);
                d.setDate(d.getDate() + 1);
                setSelectedDate(getLocalISODate(d));
                setPeriodMode('dia');
              }}
              className="h-9 w-8 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 flex items-center justify-center cursor-pointer transition-colors"
              title="Próximo dia"
              aria-label="Próximo dia"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Seletor de mês com navegação anterior e seguinte */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => {
                const [y, m] = (selectedMonth || currentMonthStr).split('-').map(Number);
                const prevM = m === 1 ? 12 : m - 1;
                const prevY = m === 1 ? y - 1 : y;
                setSelectedMonth(`${prevY}-${String(prevM).padStart(2, '0')}`);
                setPeriodMode('mes');
              }}
              className="h-9 w-8 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 flex items-center justify-center cursor-pointer transition-colors"
              title="Mês anterior"
              aria-label="Mês anterior"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <input
              type="month"
              value={selectedMonth}
              onClick={() => {
                if (periodMode !== 'mes') setPeriodMode('mes');
              }}
              onChange={(e) => {
                if (e.target.value) {
                  setSelectedMonth(e.target.value);
                  setPeriodMode('mes');
                }
              }}
              aria-label="Selecionar mês"
              title="Filtrar pelo mês selecionado"
              className={`h-9 px-2.5 rounded-xl border text-xs font-bold outline-none cursor-pointer transition-colors ${
                periodMode === 'mes'
                  ? 'border-[#0052cc] bg-blue-50/70 text-[#0052cc]'
                  : 'border-slate-200 bg-slate-50/80 text-slate-700 hover:bg-slate-50 focus:border-[#0052cc]'
              }`}
            />
            <button
              type="button"
              onClick={() => {
                const [y, m] = (selectedMonth || currentMonthStr).split('-').map(Number);
                const nextM = m === 12 ? 1 : m + 1;
                const nextY = m === 12 ? y + 1 : y;
                setSelectedMonth(`${nextY}-${String(nextM).padStart(2, '0')}`);
                setPeriodMode('mes');
              }}
              className="h-9 w-8 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 flex items-center justify-center cursor-pointer transition-colors"
              title="Próximo mês"
              aria-label="Próximo mês"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Ordenação */}
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="relative w-44 sm:w-48">
              <ArrowUpDown className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <select
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as TrackingSortOrder)}
                aria-label="Ordenar lista"
                className="w-full h-9 pl-7.5 pr-2 bg-slate-50/80 hover:bg-slate-50 focus:bg-white border border-slate-200 focus:border-[#0052cc] rounded-xl text-xs font-semibold text-slate-700 outline-none cursor-pointer"
              >
                <option value="recentes">Mais recentes</option>
                <option value="antigos">Mais antigos</option>
                <option value="maior_valor">Maior valor</option>
                <option value="menor_valor">Menor valor</option>
                <option value="maior_metragem">Maior metragem</option>
                <option value="menor_metragem">Menor metragem</option>
                <option value="alfabetica">Ordem alfabética</option>
              </select>
            </div>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleClearFilters}
                title="Limpar filtros"
                className="h-9 px-2.5 rounded-xl border border-blue-200 bg-blue-50 hover:bg-blue-100 text-[#0052cc] text-xs font-bold inline-flex items-center gap-1 whitespace-nowrap cursor-pointer flex-shrink-0 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Limpar</span>
              </button>
            )}
          </div>
        </div>

        {/* Linha 2: Status (Todos, Orçamento Enviado, Aguardando Retorno, Negociando, Vendido, Perdido) */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 text-[11px]">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setStatusFilter('Todos')}
              className={`px-2 py-1 rounded-lg font-bold transition-colors cursor-pointer ${
                statusFilter === 'Todos'
                  ? 'bg-[#0B2D59] text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200/80'
              }`}
            >
              TODOS ({statusCounts.Todos})
            </button>
            {OFFICIAL_TRACKING_STATUSES.map((st) => {
              const active = statusFilter === st.value;
              return (
                <button
                  key={st.value}
                  type="button"
                  onClick={() => setStatusFilter(active ? 'Todos' : st.value)}
                  className={`px-2 py-1 rounded-lg font-bold border transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#0052cc] text-white border-[#0052cc] shadow-2xs'
                      : `${getTrackingStatusSelectClass(st.value)} opacity-90 hover:opacity-100`
                  }`}
                >
                  {st.label} ({statusCounts[st.value]})
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>
              Exibindo <strong className="text-slate-900 font-bold">{visibleRows.length}</strong>{' '}
              {visibleRows.length === 1 ? 'orçamento' : 'orçamentos'}
            </span>
          </div>
        </div>
      </div>

      {/* Tabela Corporativa Contínua */}
      <div className="bg-white rounded-[24px] sm:rounded-[28px] border border-slate-200/90 shadow-[0_4px_24px_-4px_rgba(0,0,0,0.04)] overflow-hidden">
        {visibleRows.length === 0 ? (
          <div className="py-14 px-6 text-center">
            <div className="w-12 h-12 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3">
              <FileText className="w-6 h-6 stroke-[1.8]" />
            </div>
            <h3 className="text-base font-bold text-[#091122]">
              Nenhum orçamento encontrado na Lista de Acompanhamento
            </h3>
            <p className="text-xs sm:text-sm text-slate-500 mt-1 mb-4 max-w-md mx-auto">
              Todo orçamento gerado no CRM entra automaticamente aqui com status ORÇAMENTO ENVIADO. Ajuste ou limpe os filtros para visualizar os registros.
            </p>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleClearFilters}
                className="inline-flex items-center gap-2 h-9 px-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5 text-[#0052cc]" />
                <span>Limpar filtros</span>
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#0B2D59] text-white text-[11px] font-bold uppercase tracking-wider">
                  <th className="py-3.5 px-4 sm:px-6">Cliente</th>
                  <th className="py-3.5 px-3 sm:px-4 whitespace-nowrap">Contato</th>
                  <th className="py-3.5 px-3 sm:px-4 whitespace-nowrap">m²</th>
                  <th className="py-3.5 px-3 sm:px-4 whitespace-nowrap">Valor</th>
                  <th className="py-3.5 px-3 sm:px-4 whitespace-nowrap">Status</th>
                  <th className="py-3.5 px-4 sm:px-6 text-right whitespace-nowrap">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs sm:text-sm">
                {visibleRows.map((row) => {
                  const { Icon: TypeIcon, bgClass } = getClientTypeIconInfo(row.clientType);
                  const waHref = buildWhatsAppHref(row.telefone, row.cliente, row.nomeOrcamento);
                  const displayPhone = formatPhoneDisplay(row.telefone);

                  return (
                    <tr
                      key={row.rowKey}
                      onClick={() => onViewOrcamento(row)}
                      className="hover:bg-slate-50/80 transition-colors cursor-pointer group"
                    >
                      {/* 1. Cliente (somente nome e data do orçamento) */}
                      <td className="py-3.5 px-4 sm:px-6 min-w-[200px]">
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-8 h-8 rounded-xl border flex items-center justify-center flex-shrink-0 ${bgClass}`}
                            title={row.clientType || 'Cliente'}
                          >
                            <TypeIcon className="w-4 h-4 stroke-[2]" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="font-bold text-[#091122] group-hover:text-[#0052cc] transition-colors truncate">
                              {row.cliente}
                            </div>
                            <div className="text-[11px] text-slate-400 mt-0.5">
                              {row.creationDisplayDate}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* 2. Contato (WhatsApp com link direto para conversa) */}
                      <td
                        className="py-3.5 px-3 sm:px-4 whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {waHref ? (
                          <a
                            href={waHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Abrir conversa no WhatsApp"
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50/80 hover:bg-emerald-100 text-emerald-700 border border-emerald-200/70 text-xs font-semibold transition-colors"
                          >
                            <MessageCircle className="w-3.5 h-3.5 flex-shrink-0" />
                            <span>{displayPhone}</span>
                            <ExternalLink className="w-3 h-3 opacity-60" />
                          </a>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
                            <Phone className="w-3.5 h-3.5" />
                            <span>Sem contato</span>
                          </span>
                        )}
                      </td>

                      {/* 3. m² */}
                      <td className="py-3.5 px-3 sm:px-4 whitespace-nowrap font-semibold text-slate-700 tabular-nums">
                        {formatSqmDisplay(row.sqm)}
                      </td>

                      {/* 4. Valor */}
                      <td className="py-3.5 px-3 sm:px-4 whitespace-nowrap font-bold text-[#091122] tabular-nums">
                        {formatCurrencyBRL(row.valor)}
                      </td>

                      {/* 5. Status (exclusivamente os 5 status oficiais) */}
                      <td
                        className="py-3.5 px-3 sm:px-4 whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <select
                          value={row.status}
                          onChange={(e) =>
                            onUpdateTrackingStatus(row, e.target.value as OfficialFollowUpStatus)
                          }
                          aria-label={`Status de ${row.cliente}`}
                          className={`h-8 px-2.5 pr-6 rounded-lg border text-[11px] font-bold uppercase tracking-wide outline-none cursor-pointer transition-colors ${getTrackingStatusSelectClass(
                            row.status
                          )}`}
                        >
                          {OFFICIAL_TRACKING_STATUSES.map((st) => (
                            <option key={st.value} value={st.value}>
                              {st.label}
                            </option>
                          ))}
                        </select>
                      </td>

                      {/* 6. Ações */}
                      <td
                        className="py-3.5 px-4 sm:px-6 text-right whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="inline-flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => onViewOrcamento(row)}
                            title="Visualizar orçamento"
                            className="w-8 h-8 rounded-lg text-slate-500 hover:text-[#0052cc] hover:bg-blue-50 flex items-center justify-center transition-colors cursor-pointer"
                          >
                            <Eye className="w-4 h-4 stroke-[2]" />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleOpenEditModal(row)}
                            title="Editar informações e status"
                            className="w-8 h-8 rounded-lg text-slate-500 hover:text-[#0052cc] hover:bg-blue-50 flex items-center justify-center transition-colors cursor-pointer"
                          >
                            <Pencil className="w-4 h-4 stroke-[2]" />
                          </button>

                          <button
                            type="button"
                            onClick={() => setRemovingRow(row)}
                            title="Excluir somente da lista de acompanhamento"
                            className="w-8 h-8 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4 stroke-[2]" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL: Editar informações e status na Lista de Acompanhamento */}
      {editingRow && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs"
          onClick={() => !isSavingEdit && setEditingRow(null)}
        >
          <div
            className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 bg-[#0B2D59] text-white flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold">Editar Acompanhamento</h3>
                <p className="text-[11px] text-blue-100 mt-0.5">
                  Status e pedido são sincronizados automaticamente com o CRM e Metas.
                </p>
              </div>
              <button
                type="button"
                disabled={isSavingEdit}
                onClick={() => setEditingRow(null)}
                className="p-1.5 rounded-lg hover:bg-white/15 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmEdit} className="p-5 space-y-3.5">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                  Cliente / Razão Social
                </label>
                <input
                  type="text"
                  required
                  value={editForm.cliente}
                  onChange={(e) => setEditForm((f) => ({ ...f, cliente: e.target.value }))}
                  className="w-full h-9.5 px-3 bg-slate-50 border border-slate-200 focus:bg-white focus:border-[#0052cc] rounded-xl text-xs sm:text-sm text-slate-800 outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                    WhatsApp / Contato
                  </label>
                  <input
                    type="text"
                    value={editForm.telefone}
                    onChange={(e) => setEditForm((f) => ({ ...f, telefone: e.target.value }))}
                    placeholder="(00) 00000-0000"
                    className="w-full h-9.5 px-3 bg-slate-50 border border-slate-200 focus:bg-white focus:border-[#0052cc] rounded-xl text-xs sm:text-sm text-slate-800 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                    Status
                  </label>
                  <select
                    value={editForm.status}
                    onChange={(e) => {
                      const nextStatus = e.target.value as OfficialFollowUpStatus;
                      setEditPedidoError('');
                      setEditForm((f) => ({ ...f, status: nextStatus }));
                    }}
                    className="w-full h-9.5 px-3 bg-slate-50 border border-slate-200 focus:bg-white focus:border-[#0052cc] rounded-xl text-xs font-bold uppercase text-slate-800 outline-none cursor-pointer"
                  >
                    {OFFICIAL_TRACKING_STATUSES.map((st) => (
                      <option key={st.value} value={st.value}>
                        {st.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {editForm.status === 'Vendido' && (
                <div className="p-3.5 bg-emerald-50/70 border border-emerald-200 rounded-xl space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-emerald-900">
                      Número do Pedido <span className="text-rose-500">*</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setEditPedidoError('');
                        setEditForm((f) => ({ ...f, pedido: generateNextPedidoNumber() }));
                      }}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white hover:bg-emerald-100 text-emerald-700 border border-emerald-300 text-[11px] font-bold cursor-pointer"
                    >
                      <Sparkles className="w-3 h-3" />
                      <span>Gerar nº</span>
                    </button>
                  </div>
                  <div className="relative">
                    <Hash className="w-4 h-4 text-emerald-600 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={editForm.pedido}
                      onChange={(e) => {
                        setEditPedidoError('');
                        setEditForm((f) => ({ ...f, pedido: e.target.value.replace(/^#+/, '') }));
                      }}
                      placeholder="Ex: 1052"
                      className="w-full h-9.5 pl-9 pr-3 bg-white border border-emerald-300 focus:border-emerald-600 rounded-xl text-xs sm:text-sm font-bold text-slate-900 outline-none"
                    />
                  </div>
                  {editPedidoError && (
                    <p className="text-[11px] font-bold text-rose-600">{editPedidoError}</p>
                  )}
                </div>
              )}

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                  Referência / Nome do Orçamento
                </label>
                <input
                  type="text"
                  value={editForm.nomeOrcamento}
                  onChange={(e) => setEditForm((f) => ({ ...f, nomeOrcamento: e.target.value }))}
                  className="w-full h-9.5 px-3 bg-slate-50 border border-slate-200 focus:bg-white focus:border-[#0052cc] rounded-xl text-xs sm:text-sm text-slate-800 outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                    Metragem Total (m²)
                  </label>
                  <input
                    type="text"
                    value={editForm.sqm}
                    onChange={(e) => setEditForm((f) => ({ ...f, sqm: e.target.value }))}
                    placeholder="Ex: 42,50"
                    className="w-full h-9.5 px-3 bg-slate-50 border border-slate-200 focus:bg-white focus:border-[#0052cc] rounded-xl text-xs sm:text-sm text-slate-800 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                    Valor Total (R$)
                  </label>
                  <input
                    type="text"
                    value={editForm.valor}
                    onChange={(e) => setEditForm((f) => ({ ...f, valor: e.target.value }))}
                    placeholder="Ex: 5250,00"
                    className="w-full h-9.5 px-3 bg-slate-50 border border-slate-200 focus:bg-white focus:border-[#0052cc] rounded-xl text-xs sm:text-sm text-slate-800 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                  Observação
                </label>
                <textarea
                  rows={2}
                  value={editForm.observacao}
                  onChange={(e) => setEditForm((f) => ({ ...f, observacao: e.target.value }))}
                  placeholder="Anotação rápida do acompanhamento..."
                  className="w-full p-3 bg-slate-50 border border-slate-200 focus:bg-white focus:border-[#0052cc] rounded-xl text-xs text-slate-800 outline-none resize-none"
                />
              </div>

              <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                {editingRow.hasOverrides ? (
                  <button
                    type="button"
                    disabled={isSavingEdit}
                    onClick={handleConfirmRestoreOriginal}
                    className="text-xs font-semibold text-[#0052cc] hover:underline cursor-pointer"
                  >
                    Restaurar dados do orçamento original
                  </button>
                ) : (
                  <span />
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={isSavingEdit}
                    onClick={() => setEditingRow(null)}
                    className="h-9 px-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingEdit}
                    className="inline-flex items-center gap-1.5 h-9 px-4 rounded-xl bg-[#0052cc] hover:bg-[#0041a8] text-white text-xs font-bold shadow-sm cursor-pointer disabled:opacity-60"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>{isSavingEdit ? 'Salvando...' : 'Salvar Alterações'}</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Confirmação para excluir somente da Lista de Acompanhamento */}
      {removingRow && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs"
          onClick={() => !isRemoving && setRemovingRow(null)}
        >
          <div
            className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-[#091122]">
                  Remover da Lista de Acompanhamento?
                </h4>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  O registro de <strong className="text-slate-900">{removingRow.cliente}</strong>{' '}
                  ({removingRow.nomeOrcamento}) será removido apenas da{' '}
                  <strong>Lista de Acompanhamento</strong>. O orçamento original permanecerá intacto no módulo Orçamentos.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                disabled={isRemoving}
                onClick={() => setRemovingRow(null)}
                className="h-9 px-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isRemoving}
                onClick={handleConfirmRemove}
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold cursor-pointer disabled:opacity-60"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isRemoving ? 'Removendo...' : 'Remover da Lista'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
