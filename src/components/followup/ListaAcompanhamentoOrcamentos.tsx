import React, { useMemo, useState } from 'react';
import {
  Search,
  X,
  RotateCcw,
  Calendar,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
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
} from 'lucide-react';
import {
  ClientRecord,
  FollowUpItem,
  OrcamentoStatus,
  SavedOrcamento,
} from '../../types';
import {
  calculateOrcamentoTotalSqm,
  deduplicateFollowUpList,
  extractOrcamentoCreationDateParts,
  findMatchingFollowUpIndex,
  normalizeOrcamentoRefId,
  resolveClientPhone,
  resolveOrcamentoResponsible,
} from '../../utils/orcamentoFollowUpSync';
import { isRecordOfResponsible, getSellerIdForUser } from '../../utils/userDataFilter';
import { getUserIdByName } from '../../utils/auth';
import { ResponsibleFilterTabs } from '../ResponsibleFilterTabs';

export type TrackingListStatus = 'Pendente' | 'Vendido' | 'Não vendido';
export type TrackingStatusFilter = 'Todos' | 'Vendidos' | 'Pendentes' | 'Não vendidos';
export type TrackingPeriodMode = 'dia' | 'mes' | 'todos';

export interface TrackingOrcamentoRow {
  rowKey: string;
  orcamentoId: string;
  followUpId?: string;
  pedido?: string;
  clientId?: string;
  cliente: string;
  clientType: string;
  telefone: string;
  nomeOrcamento: string;
  sqm: number;
  valor: number;
  status: TrackingListStatus;
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
): TrackingListStatus {
  if (
    followUp?.trackingStatus === 'Pendente' ||
    followUp?.trackingStatus === 'Vendido' ||
    followUp?.trackingStatus === 'Não vendido'
  ) {
    return followUp.trackingStatus;
  }

  const raw = String(followUp?.status || orc?.status || '')
    .trim()
    .toLowerCase();

  if (
    raw === 'vendido' ||
    raw === 'fechado' ||
    raw === 'fechados' ||
    raw === 'aprovado' ||
    raw === 'venda' ||
    raw === 'concluido' ||
    raw === 'concluído'
  ) {
    return 'Vendido';
  }

  if (
    raw === 'perdido' ||
    raw === 'perdidos' ||
    raw === 'recusado' ||
    raw === 'cancelado' ||
    raw === 'não vendido' ||
    raw === 'nao vendido'
  ) {
    return 'Não vendido';
  }

  return 'Pendente';
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
      orcMap.set(key, { ...existing, ...o });
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

    rows.push({
      rowKey: `orc_${normalizeOrcamentoRefId(orcId) || orcId}`,
      orcamentoId: orcId,
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

    const fallbackOrc: SavedOrcamento = {
      id: fup.orcamentoId || fup.id.replace(/^fup_/, '') || `orc_${fup.id}`,
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
      status: (fup.status as OrcamentoStatus) || 'Em aberto',
      savedAt: fup.createdAt || new Date().toISOString(),
    };

    rows.push({
      rowKey: `fup_${fup.id}`,
      orcamentoId: fup.orcamentoId || fup.id,
      followUpId: fup.id,
      pedido: fup.pedido || '',
      clientId: fup.clientId,
      cliente: clientName,
      clientType: fup.clientType || 'Cliente Final',
      telefone: phone,
      nomeOrcamento: fup.nomeOrcamento || fup.produto || 'Orçamento',
      sqm,
      valor: Number(fup.valor) || 0,
      status: deriveTrackingStatus(fup),
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

const getTrackingStatusSelectClass = (status: TrackingListStatus): string => {
  switch (status) {
    case 'Vendido':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200 focus:border-emerald-500';
    case 'Não vendido':
      return 'bg-rose-50 text-rose-700 border-rose-200 focus:border-rose-500';
    default:
      return 'bg-amber-50 text-amber-800 border-amber-200 focus:border-[#0052cc]';
  }
};

interface ListaAcompanhamentoOrcamentosProps {
  followUpItems: FollowUpItem[];
  allOrcamentos: SavedOrcamento[];
  clients: ClientRecord[];
  currentUserName: string;
  isDirector: boolean;
  onViewOrcamento: (row: TrackingOrcamentoRow) => void;
  onUpdateTrackingStatus: (row: TrackingOrcamentoRow, newStatus: TrackingListStatus) => Promise<void> | void;
  onSaveTrackingEdit: (
    row: TrackingOrcamentoRow,
    edited: {
      cliente: string;
      telefone: string;
      nomeOrcamento: string;
      sqm: number;
      valor: number;
      status: TrackingListStatus;
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
  onViewOrcamento,
  onUpdateTrackingStatus,
  onSaveTrackingEdit,
  onRemoveFromTrackingList,
}) => {
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const currentMonthStr = useMemo(() => new Date().toISOString().slice(0, 7), []);

  const [searchTerm, setSearchTerm] = useState('');
  const [periodMode, setPeriodMode] = useState<TrackingPeriodMode>('todos');
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthStr);
  const [statusFilter, setStatusFilter] = useState<TrackingStatusFilter>('Todos');
  const [responsibleTab, setResponsibleTab] = useState<string>('Todos');

  // Modais de Edição e Exclusão da Lista de Acompanhamento
  const [editingRow, setEditingRow] = useState<TrackingOrcamentoRow | null>(null);
  const [editForm, setEditForm] = useState<{
    cliente: string;
    telefone: string;
    nomeOrcamento: string;
    sqm: string;
    valor: string;
    status: TrackingListStatus;
    observacao: string;
  }>({
    cliente: '',
    telefone: '',
    nomeOrcamento: '',
    sqm: '',
    valor: '',
    status: 'Pendente',
    observacao: '',
  });
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const [removingRow, setRemovingRow] = useState<TrackingOrcamentoRow | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);

  // 1. Constrói todas as linhas 1:1 (orçamento -> registro)
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

  // 2. Filtro por data de criação do orçamento
  const periodFilteredRows = useMemo(() => {
    if (periodMode === 'todos') return allRows;
    if (periodMode === 'dia') {
      return allRows.filter((r) => r.creationDateStr === selectedDate);
    }
    return allRows.filter((r) => r.creationMonthStr === selectedMonth);
  }, [allRows, periodMode, selectedDate, selectedMonth]);

  // Contagem por responsável (para diretoria)
  const responsibleCounts = useMemo(() => {
    if (!isDirector) return undefined;
    return {
      todos: periodFilteredRows.length,
      eder: periodFilteredRows.filter((r) => isRecordOfResponsible(r, 'Éder')).length,
      vanessa: periodFilteredRows.filter((r) => isRecordOfResponsible(r, 'Vanessa')).length,
      jhessica: periodFilteredRows.filter((r) => isRecordOfResponsible(r, 'Jhessica')).length,
      demais: periodFilteredRows.filter((r) => isRecordOfResponsible(r, 'demais')).length,
    };
  }, [periodFilteredRows, isDirector]);

  // 3. Escopo de usuário / responsável
  const scopedRows = useMemo(() => {
    if (isDirector) {
      if (responsibleTab === 'Todos') return periodFilteredRows;
      return periodFilteredRows.filter((r) => isRecordOfResponsible(r, responsibleTab));
    }
    return periodFilteredRows.filter((r) => isRecordOfResponsible(r, currentUserName || ''));
  }, [periodFilteredRows, isDirector, responsibleTab, currentUserName]);

  // Contadores dos filtros de status
  const statusCounts = useMemo(() => {
    return {
      Todos: scopedRows.length,
      Vendidos: scopedRows.filter((r) => r.status === 'Vendido').length,
      Pendentes: scopedRows.filter((r) => r.status === 'Pendente').length,
      'Não vendidos': scopedRows.filter((r) => r.status === 'Não vendido').length,
    };
  }, [scopedRows]);

  // 4. Filtro de status + pesquisa textual (nome, telefone ou número/título do orçamento)
  const visibleRows = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, '');

    // Quando há pesquisa ativa sem filtros restritivos, busca dentro de scopedRows
    return scopedRows.filter((row) => {
      if (statusFilter === 'Vendidos' && row.status !== 'Vendido') return false;
      if (statusFilter === 'Pendentes' && row.status !== 'Pendente') return false;
      if (statusFilter === 'Não vendidos' && row.status !== 'Não vendido') return false;

      if (!q) return true;

      const inClient = row.cliente.toLowerCase().includes(q);
      const inBudgetName = row.nomeOrcamento.toLowerCase().includes(q);
      const inPedido = (row.pedido || '').toLowerCase().includes(q);
      const inOrcId = row.orcamentoId.toLowerCase().includes(q);
      const inPhone = row.telefone.toLowerCase().includes(q);
      const phoneDigits = row.telefone.replace(/\D/g, '');
      const inPhoneDigits = qDigits.length >= 3 && phoneDigits.includes(qDigits);

      return inClient || inBudgetName || inPedido || inOrcId || inPhone || inPhoneDigits;
    });
  }, [scopedRows, statusFilter, searchTerm]);

  const handleOpenEditModal = (row: TrackingOrcamentoRow) => {
    setEditingRow(row);
    setEditForm({
      cliente: row.cliente,
      telefone: row.telefone,
      nomeOrcamento: row.nomeOrcamento,
      sqm: row.sqm > 0 ? String(row.sqm).replace('.', ',') : '',
      valor: row.valor > 0 ? row.valor.toFixed(2).replace('.', ',') : '0,00',
      status: row.status,
      observacao: row.observacao,
    });
  };

  const handleConfirmEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRow) return;

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

      {/* Barra de Filtros: Pesquisa, Período (Data de Criação) e Status */}
      <div className="bg-white rounded-[24px] border border-slate-200/90 shadow-[0_4px_24px_-4px_rgba(0,0,0,0.04)] p-4 sm:p-5 space-y-4">
        {/* Linha 1: Pesquisa + Filtro de Data de Criação */}
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3.5">
          {/* Pesquisa */}
          <div className="relative w-full xl:max-w-md flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Pesquisar por cliente, WhatsApp ou nº/nome do orçamento..."
              className="w-full h-10 pl-10 pr-9 bg-slate-50/80 hover:bg-slate-50 focus:bg-white border border-slate-200 focus:border-[#0052cc] rounded-xl text-xs sm:text-sm text-slate-800 placeholder:text-slate-400 outline-none transition-all"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
                title="Limpar busca"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Filtro de Data (criação do orçamento) */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-1 p-1 bg-slate-100/90 rounded-xl border border-slate-200/80">
              <button
                type="button"
                onClick={() => setPeriodMode('dia')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  periodMode === 'dia'
                    ? 'bg-white text-[#0052cc] shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Calendar className="w-3.5 h-3.5" />
                <span>Por Dia</span>
              </button>
              <button
                type="button"
                onClick={() => setPeriodMode('mes')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  periodMode === 'mes'
                    ? 'bg-white text-[#0052cc] shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <CalendarDays className="w-3.5 h-3.5" />
                <span>Por Mês</span>
              </button>
              <button
                type="button"
                onClick={() => setPeriodMode('todos')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  periodMode === 'todos'
                    ? 'bg-white text-[#0052cc] shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <span>Todos os Períodos</span>
              </button>
            </div>

            {periodMode === 'dia' && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    const d = new Date(selectedDate + 'T12:00:00');
                    d.setDate(d.getDate() - 1);
                    setSelectedDate(d.toISOString().slice(0, 10));
                  }}
                  className="p-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 cursor-pointer"
                  title="Dia anterior"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="h-9 px-2.5 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-800 focus:border-[#0052cc] outline-none cursor-pointer"
                />
                <button
                  type="button"
                  onClick={() => {
                    const d = new Date(selectedDate + 'T12:00:00');
                    d.setDate(d.getDate() + 1);
                    setSelectedDate(d.toISOString().slice(0, 10));
                  }}
                  className="p-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 cursor-pointer"
                  title="Próximo dia"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedDate(todayStr)}
                  className="px-2.5 py-1.5 rounded-xl border border-blue-200 bg-blue-50 hover:bg-blue-100 text-[#0052cc] text-xs font-bold cursor-pointer"
                >
                  Hoje
                </button>
              </div>
            )}

            {periodMode === 'mes' && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    const [y, m] = selectedMonth.split('-').map(Number);
                    const prevM = m === 1 ? 12 : m - 1;
                    const prevY = m === 1 ? y - 1 : y;
                    setSelectedMonth(`${prevY}-${String(prevM).padStart(2, '0')}`);
                  }}
                  className="p-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 cursor-pointer"
                  title="Mês anterior"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="h-9 px-2.5 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-800 focus:border-[#0052cc] outline-none cursor-pointer"
                />
                <button
                  type="button"
                  onClick={() => {
                    const [y, m] = selectedMonth.split('-').map(Number);
                    const nextM = m === 12 ? 1 : m + 1;
                    const nextY = m === 12 ? y + 1 : y;
                    setSelectedMonth(`${nextY}-${String(nextM).padStart(2, '0')}`);
                  }}
                  className="p-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 cursor-pointer"
                  title="Próximo mês"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedMonth(currentMonthStr)}
                  className="px-2.5 py-1.5 rounded-xl border border-blue-200 bg-blue-50 hover:bg-blue-100 text-[#0052cc] text-xs font-bold cursor-pointer"
                >
                  Mês Atual
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Linha 2: Filtro de Status + Contador */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-slate-100">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 no-scrollbar select-none">
            {(['Todos', 'Pendentes', 'Vendidos', 'Não vendidos'] as TrackingStatusFilter[]).map(
              (tab) => {
                const isActive = statusFilter === tab;
                const count = statusCounts[tab];
                return (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setStatusFilter(tab)}
                    className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs sm:text-sm font-semibold whitespace-nowrap transition-all cursor-pointer ${
                      isActive
                        ? 'bg-[#0052cc] text-white shadow-sm shadow-blue-600/20'
                        : 'bg-white border border-slate-200/90 text-slate-700 hover:bg-slate-50 hover:text-slate-900 shadow-2xs'
                    }`}
                  >
                    <span>{tab}</span>
                    <span
                      className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold ${
                        isActive ? 'bg-[#003d99] text-white' : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              }
            )}
          </div>

          <div className="flex items-center gap-3 text-xs text-slate-500 justify-between sm:justify-end">
            <span>
              Exibindo <strong className="text-slate-900 font-bold">{visibleRows.length}</strong>{' '}
              {visibleRows.length === 1 ? 'orçamento' : 'orçamentos'}
            </span>
            {(searchTerm || statusFilter !== 'Todos' || periodMode !== 'todos') && (
              <button
                type="button"
                onClick={() => {
                  setSearchTerm('');
                  setStatusFilter('Todos');
                  setPeriodMode('todos');
                }}
                className="inline-flex items-center gap-1 font-semibold text-[#0052cc] hover:underline cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Limpar filtros</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Tabela Corporativa Contínua (Padrão Clientes) */}
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
              Todo orçamento gerado no CRM entra automaticamente aqui. Ajuste os filtros de pesquisa, status ou data para visualizar os registros.
            </p>
            {(searchTerm || statusFilter !== 'Todos' || periodMode !== 'todos') && (
              <button
                type="button"
                onClick={() => {
                  setSearchTerm('');
                  setStatusFilter('Todos');
                  setPeriodMode('todos');
                }}
                className="inline-flex items-center gap-2 h-9 px-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5 text-[#0052cc]" />
                <span>Mostrar todos os orçamentos</span>
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
                      {/* 1. Cliente */}
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
                            <div className="text-[11px] text-slate-400 truncate mt-0.5 flex items-center gap-1.5">
                              <span className="truncate">{row.nomeOrcamento}</span>
                              {row.pedido && (
                                <span className="font-semibold text-slate-500 flex-shrink-0">
                                  • #{row.pedido}
                                </span>
                              )}
                              <span className="flex-shrink-0">• {row.creationDisplayDate}</span>
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

                      {/* 5. Status (Pendente | Vendido | Não vendido) */}
                      <td
                        className="py-3.5 px-3 sm:px-4 whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <select
                          value={row.status}
                          onChange={(e) =>
                            onUpdateTrackingStatus(row, e.target.value as TrackingListStatus)
                          }
                          aria-label={`Status de ${row.cliente}`}
                          className={`h-8 px-2.5 pr-6 rounded-lg border text-xs font-bold outline-none cursor-pointer transition-colors ${getTrackingStatusSelectClass(
                            row.status
                          )}`}
                        >
                          <option value="Pendente">Pendente</option>
                          <option value="Vendido">Vendido</option>
                          <option value="Não vendido">Não vendido</option>
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
                  Alterações aqui não modificam nem apagam o orçamento original.
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
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, status: e.target.value as TrackingListStatus }))
                    }
                    className="w-full h-9.5 px-3 bg-slate-50 border border-slate-200 focus:bg-white focus:border-[#0052cc] rounded-xl text-xs sm:text-sm font-bold text-slate-800 outline-none cursor-pointer"
                  >
                    <option value="Pendente">Pendente</option>
                    <option value="Vendido">Vendido</option>
                    <option value="Não vendido">Não vendido</option>
                  </select>
                </div>
              </div>

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
