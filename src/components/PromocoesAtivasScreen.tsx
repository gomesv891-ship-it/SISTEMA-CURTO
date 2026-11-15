import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Plus,
  Search,
  Pencil,
  Copy,
  Trash2,
  Check,
  X,
  RefreshCw,
  Loader2,
  AlertTriangle,
  Eye,
  Printer,
  Download,
  Image as ImageIcon,
  Share2,
  Package,
  Calendar,
  ArrowUp,
  ArrowDown,
  FolderPlus,
  SlidersHorizontal,
  LayoutTemplate,
} from 'lucide-react';
import { toPng } from 'html-to-image';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import {
  PROMO_CATEGORIES,
  PROMO_MODALITIES,
  PromoCampaign,
  PromoCampaignStatus,
  PromoCategory,
  PromoFloorLot,
  PromoLotGroup,
  PromoModality,
  PromoOfferItem,
  PromoProgressiveTier,
  PromoSheetModel,
  PromoSheetSettings,
  PromoSubcategory,
  buildDefaultLotGroupsForCampaign,
  canManagePromocoes,
  computeLotMetrics,
  createEmptyConditionsByModality,
  createEmptyOffersByModality,
  createEmptyTierQuantitiesByModality,
  createLotGroupInSupabase,
  createLotInSupabase,
  deleteCampaignFromSupabase,
  deleteLotGroupInSupabase,
  deleteLotInSupabase,
  duplicateCampaignInSupabase,
  fetchPromocoesFromSupabase,
  formatCurrencyBRL,
  formatDateBR,
  formatSqmBR,
  getDefaultSheetSettings,
  getTodayIsoDate,
  initializeLotGroupsInSupabase,
  parseNumberFlexible,
  parsePromocoesPayload,
  saveCampaignToSupabase,
  updateLotGroupInSupabase,
  updateLotStockInSupabase,
} from '../utils/promocoesService';
import { PromocaoFolhaDivulgacao } from './PromocaoFolhaDivulgacao';
import { PromocaoCrmProductPickerModal } from './PromocaoCrmProductPickerModal';

interface PromocoesAtivasScreenProps {
  currentUserName?: string;
}

type MainAreaTab = 'produtos' | 'folha' | 'controle';

const AUDIENCE_ORDER: PromoModality[] = ['revenda', 'construtora', 'cliente_final'];

const ORDERED_MODALITIES = AUDIENCE_ORDER.map(
  (id) => PROMO_MODALITIES.find((m) => m.id === id)!
);

const FIXED_CATEGORIES: { id: PromoCategory; sidebarLabel: string; tableTitle: string }[] = [
  { id: 'piso_vinilico', sidebarLabel: 'Piso Vinílico', tableTitle: 'Piso Vinílico' },
  { id: 'rodapes', sidebarLabel: 'Rodapés', tableTitle: 'Rodapés' },
  { id: 'ripados', sidebarLabel: 'Ripados', tableTitle: 'Ripados' },
  { id: 'teto_vinilico', sidebarLabel: 'Teto Vinílico', tableTitle: 'Teto Vinílico' },
  { id: 'outros', sidebarLabel: 'Outros', tableTitle: 'Outros Produtos' },
];

const SHEET_MODELS: { id: PromoSheetModel; label: string }[] = [
  { id: 'oficial_colorido', label: 'Oficial Fênix (Colorido)' },
  { id: 'pb_economico', label: 'Preto e Branco (Impressão)' },
  { id: 'compacto_a4', label: 'Compacto A4 (Lista Extensa)' },
];

function getStatusLabel(status: PromoCampaignStatus): string {
  if (status === 'ativa') return 'Ativa';
  if (status === 'encerrada') return 'Encerrada';
  return 'Inativa';
}

export const PromocoesAtivasScreen: React.FC<PromocoesAtivasScreenProps> = ({
  currentUserName = 'Vanessa Gomes',
}) => {
  const hasAdminAccess = canManagePromocoes(currentUserName);

  const [campaigns, setCampaigns] = useState<PromoCampaign[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<MainAreaTab>('produtos');

  // Aba 1: Produtos e Ofertas
  const [activeModality, setActiveModality] = useState<PromoModality>('revenda');
  const [activeCategory, setActiveCategory] = useState<PromoCategory>('piso_vinilico');
  const [productSearch, setProductSearch] = useState('');
  const [conditionDraft, setConditionDraft] = useState('');

  // Aba 2: Folha de Divulgação
  const [sheetModality, setSheetModality] = useState<PromoModality>('revenda');
  const [isShareMenuOpen, setIsShareMenuOpen] = useState(false);
  const [isSheetPreviewModalOpen, setIsSheetPreviewModalOpen] = useState(false);
  const [isLayoutModalOpen, setIsLayoutModalOpen] = useState(false);

  // Estados gerais de rede
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Modal Criar / Editar Campanha
  const [isCampaignModalOpen, setIsCampaignModalOpen] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<PromoCampaign | null>(null);
  const [campFormName, setCampFormName] = useState('');
  const [campFormBadgeTop, setCampFormBadgeTop] = useState('');
  const [campFormBadgeBottom, setCampFormBadgeBottom] = useState('');
  const [campFormStatus, setCampFormStatus] = useState<PromoCampaignStatus>('ativa');
  const [campFormStart, setCampFormStart] = useState(getTodayIsoDate());
  const [campFormEnd, setCampFormEnd] = useState(getTodayIsoDate());
  const [campFormValidityText, setCampFormValidityText] = useState('');
  const [campFormPaymentText, setCampFormPaymentText] = useState('');
  const [campFormError, setCampFormError] = useState<string | null>(null);
  const [campaignToDelete, setCampaignToDelete] = useState<PromoCampaign | null>(null);

  // Modal Editar Layout da Folha
  const [layoutBadgeTop, setLayoutBadgeTop] = useState('');
  const [layoutBadgeBottom, setLayoutBadgeBottom] = useState('');
  const [layoutValidityText, setLayoutValidityText] = useState('');
  const [layoutPaymentText, setLayoutPaymentText] = useState('');
  const [layoutModel, setLayoutModel] = useState<PromoSheetModel>('oficial_colorido');
  const [layoutShowModality, setLayoutShowModality] = useState(false);
  const [layoutShowSubcategories, setLayoutShowSubcategories] = useState(false);
  const [layoutDensity, setLayoutDensity] = useState<'padrao' | 'compacto'>('padrao');
  const [layoutConditionCF, setLayoutConditionCF] = useState('');
  const [layoutConditionConst, setLayoutConditionConst] = useState('');
  const [layoutConditionRev, setLayoutConditionRev] = useState('');

  // Modal Gerenciar Subcategorias (Piso Vinílico)
  const [isSubcategoryModalOpen, setIsSubcategoryModalOpen] = useState(false);
  const [newSubName, setNewSubName] = useState('');
  const [editingSubId, setEditingSubId] = useState<string | null>(null);
  const [editingSubName, setEditingSubName] = useState('');

  // Modal Cadastrar / Editar Oferta (por categoria)
  const [isOfferModalOpen, setIsOfferModalOpen] = useState(false);
  const [editingOffer, setEditingOffer] = useState<PromoOfferItem | null>(null);
  const [offerCategory, setOfferCategory] = useState<PromoCategory>('piso_vinilico');
  const [offerSubcategoryId, setOfferSubcategoryId] = useState('');
  const [offerCrmProductId, setOfferCrmProductId] = useState<string | undefined>(undefined);
  const [offerDescription, setOfferDescription] = useState('');
  const [offerSpecs, setOfferSpecs] = useState('');
  const [offerActive, setOfferActive] = useState(true);
  // Piso Vinílico
  const [offerLotMode, setOfferLotMode] = useState<'new' | 'existing'>('new');
  const [offerExistingLotId, setOfferExistingLotId] = useState('');
  const [offerLotPattern, setOfferLotPattern] = useState('');
  const [offerLotThickness, setOfferLotThickness] = useState('');
  const [offerLotSqmPerBox, setOfferLotSqmPerBox] = useState('');
  const [offerLotInitialBoxes, setOfferLotInitialBoxes] = useState('');
  const [offerPriceSqm, setOfferPriceSqm] = useState('');
  // Rodapés / Ripados
  const [offerPriceNormal, setOfferPriceNormal] = useState('');
  const [offerTier1Qty, setOfferTier1Qty] = useState('30');
  const [offerTier1Price, setOfferTier1Price] = useState('');
  const [offerTier2Qty, setOfferTier2Qty] = useState('50');
  const [offerTier2Price, setOfferTier2Price] = useState('');
  const [offerTier3Qty, setOfferTier3Qty] = useState('100');
  const [offerTier3Price, setOfferTier3Price] = useState('');
  // Outros Produtos
  const [offerSimplePrice, setOfferSimplePrice] = useState('');
  const [offerFormError, setOfferFormError] = useState<string | null>(null);

  // Picker de Produtos do CRM
  const [isCrmPickerOpen, setIsCrmPickerOpen] = useState(false);

  // Modal Editar Quantidades das Faixas Progressivas (Rodapés / Ripados)
  const [tierHeaderEditCat, setTierHeaderEditCat] = useState<'rodapes' | 'ripados' | null>(null);
  const [tierHeaderQ1, setTierHeaderQ1] = useState('30');
  const [tierHeaderQ2, setTierHeaderQ2] = useState('50');
  const [tierHeaderQ3, setTierHeaderQ3] = useState('100');

  // Modal Copiar Oferta para Outros Públicos
  const [offerToReplicate, setOfferToReplicate] = useState<PromoOfferItem | null>(null);
  const [replicateTargets, setReplicateTargets] = useState<Record<PromoModality, boolean>>({
    cliente_final: false,
    construtora: false,
    revenda: false,
  });

  // Aba 3: Controle Administrativo organizado por Grupos de Lotes
  const [adminLotSearch, setAdminLotSearch] = useState('');
  const [isCreatingGroupInline, setIsCreatingGroupInline] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState('');
  const [groupToDelete, setGroupToDelete] = useState<{
    group: PromoLotGroup;
    productCount: number;
  } | null>(null);

  const [adminEditingLotId, setAdminEditingLotId] = useState<string | null>(null);
  const [adminCreatingGroupId, setAdminCreatingGroupId] = useState<string | null>(null);
  const [adminLotGroupId, setAdminLotGroupId] = useState<string>('');
  const [adminLotDesc, setAdminLotDesc] = useState('');
  const [adminLotSqmPerBox, setAdminLotSqmPerBox] = useState('');
  const [adminLotInitialBoxes, setAdminLotInitialBoxes] = useState('');
  const [adminLotSoldBoxes, setAdminLotSoldBoxes] = useState('');
  const [adminLotError, setAdminLotError] = useState<string | null>(null);
  const [adminLotToDelete, setAdminLotToDelete] = useState<PromoFloorLot | null>(null);
  const initializedGroupCampaignsRef = useRef<Set<string>>(new Set());

  const showToast = useCallback((text: string, type: 'success' | 'error' = 'success') => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const loadCampaigns = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    setErrorBanner(null);

    const res = await fetchPromocoesFromSupabase();
    setCampaigns(res.campaigns);
    if (!res.success && res.error) {
      setErrorBanner(res.error);
    }

    setSelectedCampaignId((prev) => {
      if (prev && res.campaigns.some((c) => c.id === prev)) return prev;
      const activeOne = res.campaigns.find((c) => c.status === 'ativa');
      return activeOne?.id || res.campaigns[0]?.id || '';
    });

    if (!silent) setIsLoading(false);
  }, []);

  useEffect(() => {
    loadCampaigns(false);

    const handleRealtime = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      if (detail?.data !== undefined) {
        const parsed = parsePromocoesPayload(detail.data);
        setCampaigns(parsed);
      } else {
        loadCampaigns(true);
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        loadCampaigns(true);
      }
    };

    const handlePromocoesUpdated = () => {
      loadCampaigns(true);
    };

    window.addEventListener('fenix_promocoes_realtime_updated', handleRealtime);
    window.addEventListener('fenix_promocoes_updated', handlePromocoesUpdated);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener('fenix_promocoes_realtime_updated', handleRealtime);
      window.removeEventListener('fenix_promocoes_updated', handlePromocoesUpdated);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [loadCampaigns]);

  const selectedCampaign = useMemo(
    () => campaigns.find((c) => c.id === selectedCampaignId) || campaigns[0] || null,
    [campaigns, selectedCampaignId]
  );

  useEffect(() => {
    if (selectedCampaign) {
      setConditionDraft(selectedCampaign.conditionsByModality?.[activeModality] || '');
    } else {
      setConditionDraft('');
    }
  }, [selectedCampaign, activeModality]);

  // Inicialização idempotente dos grupos padrão de lotes no Supabase quando a campanha ainda não possui lotGroups
  useEffect(() => {
    if (activeTab !== 'controle' || !selectedCampaign) return;
    if (Array.isArray(selectedCampaign.lotGroups)) return;
    if (initializedGroupCampaignsRef.current.has(selectedCampaign.id)) return;

    initializedGroupCampaignsRef.current.add(selectedCampaign.id);
    initializeLotGroupsInSupabase({
      campaignId: selectedCampaign.id,
      updatedBy: currentUserName,
    }).then((res) => {
      if (res.success) {
        setCampaigns(res.campaigns);
      }
    });
  }, [activeTab, selectedCampaign, currentUserName]);

  const adminOrgData = useMemo(() => {
    if (!selectedCampaign) {
      return { groups: [] as PromoLotGroup[], lots: [] as PromoFloorLot[] };
    }
    if (Array.isArray(selectedCampaign.lotGroups)) {
      return {
        groups: [...selectedCampaign.lotGroups].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
        lots: selectedCampaign.lots || [],
      };
    }
    const fallback = buildDefaultLotGroupsForCampaign(selectedCampaign);
    return {
      groups: [...fallback.lotGroups].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
      lots: fallback.lots,
    };
  }, [selectedCampaign]);

  const adminGroupedView = useMemo(() => {
    const normalizeText = (s: string) =>
      (s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();

    const query = normalizeText(adminLotSearch);
    const groupIds = new Set(adminOrgData.groups.map((g) => g.id));

    const sortLotsAsc = (list: PromoFloorLot[]) =>
      [...list].sort((a, b) => {
        const diff = (Number(a.sqmPerBox) || 0) - (Number(b.sqmPerBox) || 0);
        if (diff !== 0) return diff;
        return (a.description || '').localeCompare(b.description || '', 'pt-BR', {
          sensitivity: 'base',
        });
      });

    const sections: {
      group: PromoLotGroup;
      isSyntheticUngrouped: boolean;
      lots: PromoFloorLot[];
      allLotsCount: number;
      matchedByGroupName: boolean;
    }[] = adminOrgData.groups.map((grp) => {
      const groupLots = sortLotsAsc(adminOrgData.lots.filter((l) => l.lotGroupId === grp.id));
      return {
        group: grp,
        isSyntheticUngrouped: false,
        lots: groupLots,
        allLotsCount: groupLots.length,
        matchedByGroupName: false,
      };
    });

    const ungroupedLots = sortLotsAsc(
      adminOrgData.lots.filter((l) => !l.lotGroupId || !groupIds.has(l.lotGroupId))
    );
    if (ungroupedLots.length > 0) {
      sections.push({
        group: {
          id: '__ungrouped__',
          name: 'OUTROS PRODUTOS / SEM LOTE',
          order: 99999,
        },
        isSyntheticUngrouped: true,
        lots: ungroupedLots,
        allLotsCount: ungroupedLots.length,
        matchedByGroupName: false,
      });
    }

    if (!query) {
      return {
        sections,
        isFiltering: false,
        totalMatches: adminOrgData.lots.length,
      };
    }

    const filteredSections = sections
      .map((sec) => {
        const groupMatches = normalizeText(sec.group.name).includes(query);
        if (groupMatches) {
          return {
            ...sec,
            matchedByGroupName: true,
          };
        }
        const matchingLots = sec.lots.filter(
          (l) =>
            normalizeText(l.description).includes(query) ||
            normalizeText(l.pattern || '').includes(query) ||
            normalizeText(l.thickness || '').includes(query)
        );
        if (matchingLots.length === 0) return null;
        return {
          ...sec,
          lots: matchingLots,
          matchedByGroupName: false,
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);

    const totalMatches = filteredSections.reduce((sum, s) => sum + s.lots.length, 0);
    return {
      sections: filteredSections,
      isFiltering: true,
      totalMatches,
    };
  }, [adminOrgData, adminLotSearch]);

  const activeModalityOffers = useMemo(() => {
    if (!selectedCampaign) return [];
    return [...(selectedCampaign.offersByModality?.[activeModality] || [])].sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0)
    );
  }, [selectedCampaign, activeModality]);

  const activeCategoryOffers = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    return activeModalityOffers.filter((o) => {
      if (o.category !== activeCategory) return false;
      if (!q) return true;
      return (
        o.description.toLowerCase().includes(q) ||
        (o.specs || '').toLowerCase().includes(q)
      );
    });
  }, [activeModalityOffers, activeCategory, productSearch]);

  const sheetSettings = useMemo<PromoSheetSettings>(() => {
    if (!selectedCampaign) return getDefaultSheetSettings(true);
    return (
      selectedCampaign.sheetSettings ||
      getDefaultSheetSettings(
        selectedCampaign.showSubcategoriesOnSheet !== undefined
          ? Boolean(selectedCampaign.showSubcategoriesOnSheet)
          : true
      )
    );
  }, [selectedCampaign]);

  // Helper para persistir campanha no Supabase
  const persistCampaign = useCallback(
    async (nextCampaign: PromoCampaign, successMessage?: string) => {
      setIsSaving(true);
      const res = await saveCampaignToSupabase(nextCampaign, currentUserName);
      setIsSaving(false);

      if (!res.success) {
        showToast(res.error || 'Falha ao salvar no Supabase.', 'error');
        return false;
      }

      setCampaigns(res.campaigns);
      if (res.savedCampaign) {
        setSelectedCampaignId(res.savedCampaign.id);
      }
      if (successMessage) {
        showToast(successMessage, 'success');
      }
      return true;
    },
    [currentUserName, showToast]
  );

  // =========================================================================
  // 1. GERENCIAMENTO DE CAMPANHAS
  // =========================================================================
  const openNewCampaignModal = () => {
    const today = getTodayIsoDate();
    setEditingCampaign(null);
    setCampFormName('');
    setCampFormBadgeTop('');
    setCampFormBadgeBottom('');
    setCampFormStatus('ativa');
    setCampFormStart(today);
    setCampFormEnd(today);
    setCampFormValidityText('');
    setCampFormPaymentText('');
    setCampFormError(null);
    setIsCampaignModalOpen(true);
  };

  const openEditCampaignModal = (camp: PromoCampaign) => {
    setEditingCampaign(camp);
    setCampFormName(camp.name);
    setCampFormBadgeTop(camp.badgeTopText || '');
    setCampFormBadgeBottom(camp.badgeBottomText || '');
    setCampFormStatus(camp.status);
    setCampFormStart(camp.startDate || getTodayIsoDate());
    setCampFormEnd(camp.endDate || getTodayIsoDate());
    setCampFormValidityText(camp.validityText || '');
    setCampFormPaymentText(camp.paymentConditionText || '');
    setCampFormError(null);
    setIsCampaignModalOpen(true);
  };

  const handleSaveCampaignModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!campFormName.trim()) {
      setCampFormError('Informe o nome da campanha.');
      return;
    }
    if (!campFormStart || !campFormEnd) {
      setCampFormError('Defina as datas de início e término da campanha.');
      return;
    }
    if (campFormEnd < campFormStart) {
      setCampFormError('A data de término não pode ser anterior à data de início.');
      return;
    }

    const nowIso = new Date().toISOString();
    const payload: PromoCampaign = editingCampaign
      ? {
          ...editingCampaign,
          name: campFormName.trim(),
          badgeTopText: campFormBadgeTop.trim() || undefined,
          badgeBottomText: campFormBadgeBottom.trim() || undefined,
          status: campFormStatus,
          startDate: campFormStart,
          endDate: campFormEnd,
          validityText: campFormValidityText.trim() || undefined,
          paymentConditionText: campFormPaymentText.trim() || undefined,
        }
      : {
          id: `camp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          name: campFormName.trim(),
          badgeTopText: campFormBadgeTop.trim() || undefined,
          badgeBottomText: campFormBadgeBottom.trim() || undefined,
          status: campFormStatus,
          startDate: campFormStart,
          endDate: campFormEnd,
          validityText: campFormValidityText.trim() || undefined,
          paymentConditionText: campFormPaymentText.trim() || undefined,
          showSubcategoriesOnSheet: true,
          sheetSettings: getDefaultSheetSettings(true),
          conditionsByModality: createEmptyConditionsByModality(),
          tierQuantitiesByModality: createEmptyTierQuantitiesByModality(),
          subcategories: [],
          lots: [],
          lotSales: [],
          offersByModality: createEmptyOffersByModality(),
          createdBy: currentUserName,
          createdAt: nowIso,
          updatedAt: nowIso,
          updatedBy: currentUserName,
          version: 1,
        };

    const ok = await persistCampaign(
      payload,
      editingCampaign ? 'Campanha atualizada no Supabase!' : 'Nova campanha criada com sucesso!'
    );
    if (ok) {
      setIsCampaignModalOpen(false);
    }
  };

  const handleDuplicateCampaign = async (camp: PromoCampaign) => {
    setIsSaving(true);
    const res = await duplicateCampaignInSupabase(camp.id, currentUserName);
    setIsSaving(false);
    if (!res.success) {
      showToast(res.error || 'Erro ao duplicar campanha.', 'error');
      return;
    }
    setCampaigns(res.campaigns);
    if (res.duplicatedCampaign) {
      setSelectedCampaignId(res.duplicatedCampaign.id);
    }
    setIsCampaignModalOpen(false);
    showToast('Campanha duplicada com sucesso!');
  };

  const handleEndCampaign = async (camp: PromoCampaign) => {
    const ok = await persistCampaign({ ...camp, status: 'encerrada' }, 'Campanha encerrada.');
    if (ok) setIsCampaignModalOpen(false);
  };

  const handleConfirmDeleteCampaign = async () => {
    if (!campaignToDelete) return;
    setIsSaving(true);
    const res = await deleteCampaignFromSupabase(campaignToDelete.id, currentUserName);
    setIsSaving(false);
    if (!res.success) {
      showToast(res.error || 'Erro ao excluir campanha.', 'error');
      return;
    }
    setCampaigns(res.campaigns);
    if (selectedCampaignId === campaignToDelete.id) {
      setSelectedCampaignId(res.campaigns[0]?.id || '');
    }
    setCampaignToDelete(null);
    setIsCampaignModalOpen(false);
    showToast('Campanha excluída.');
  };

  // =========================================================================
  // 2. PRODUTOS E OFERTAS
  // =========================================================================
  const handleAddSubcategory = async () => {
    if (!selectedCampaign || !newSubName.trim()) return;
    const newSub: PromoSubcategory = {
      id: `sub_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      category: 'piso_vinilico',
      name: newSubName.trim(),
      order: selectedCampaign.subcategories.length,
    };
    const nextSheetSettings: PromoSheetSettings = {
      ...(selectedCampaign.sheetSettings || getDefaultSheetSettings(true)),
      showSubcategories: true,
    };
    const ok = await persistCampaign(
      {
        ...selectedCampaign,
        subcategories: [...selectedCampaign.subcategories, newSub],
        showSubcategoriesOnSheet: true,
        sheetSettings: nextSheetSettings,
      },
      'Subcategoria adicionada.'
    );
    if (ok) setNewSubName('');
  };

  const handleSaveEditSubcategory = async (subId: string) => {
    if (!selectedCampaign || !editingSubName.trim()) return;
    const ok = await persistCampaign(
      {
        ...selectedCampaign,
        subcategories: selectedCampaign.subcategories.map((s) =>
          s.id === subId ? { ...s, name: editingSubName.trim() } : s
        ),
      },
      'Subcategoria atualizada.'
    );
    if (ok) {
      setEditingSubId(null);
      setEditingSubName('');
    }
  };

  const handleDeleteSubcategory = async (subId: string) => {
    if (!selectedCampaign) return;
    const cleanOffers = { ...selectedCampaign.offersByModality };
    (['cliente_final', 'construtora', 'revenda'] as PromoModality[]).forEach((mod) => {
      cleanOffers[mod] = (cleanOffers[mod] || []).map((o) =>
        o.subcategoryId === subId ? { ...o, subcategoryId: undefined } : o
      );
    });

    await persistCampaign(
      {
        ...selectedCampaign,
        subcategories: selectedCampaign.subcategories.filter((s) => s.id !== subId),
        lots: selectedCampaign.lots.map((l) =>
          l.subcategoryId === subId ? { ...l, subcategoryId: undefined } : l
        ),
        offersByModality: cleanOffers,
      },
      'Subcategoria removida.'
    );
  };

  const openNewOfferModal = (category: PromoCategory) => {
    if (!selectedCampaign) return;
    const tq = selectedCampaign.tierQuantitiesByModality?.[activeModality] || {
      rodapes: [30, 50, 100],
      ripados: [30, 50, 100],
    };
    const qArr = category === 'ripados' ? tq.ripados : tq.rodapes;

    setEditingOffer(null);
    setOfferCategory(category);
    setOfferSubcategoryId('');
    setOfferCrmProductId(undefined);
    setOfferDescription('');
    setOfferSpecs('');
    setOfferActive(true);
    setOfferLotMode('new');
    setOfferExistingLotId(selectedCampaign.lots[0]?.id || '');
    setOfferLotPattern('');
    setOfferLotThickness('');
    setOfferLotSqmPerBox('');
    setOfferLotInitialBoxes('');
    setOfferPriceSqm('');
    setOfferPriceNormal('');
    setOfferTier1Qty(String(qArr[0]));
    setOfferTier1Price('');
    setOfferTier2Qty(String(qArr[1]));
    setOfferTier2Price('');
    setOfferTier3Qty(String(qArr[2]));
    setOfferTier3Price('');
    setOfferSimplePrice('');
    setOfferFormError(null);
    setIsOfferModalOpen(true);
  };

  const openEditOfferModal = (offer: PromoOfferItem) => {
    if (!selectedCampaign) return;
    const tq = selectedCampaign.tierQuantitiesByModality?.[activeModality] || {
      rodapes: [30, 50, 100],
      ripados: [30, 50, 100],
    };
    const qArr = offer.category === 'ripados' ? tq.ripados : tq.rodapes;
    const linkedLot = offer.lotId
      ? selectedCampaign.lots.find((l) => l.id === offer.lotId)
      : undefined;

    setEditingOffer(offer);
    setOfferCategory(offer.category);
    setOfferSubcategoryId(offer.subcategoryId || linkedLot?.subcategoryId || '');
    setOfferCrmProductId(offer.crmProductId);
    setOfferDescription(offer.description);
    setOfferSpecs(offer.specs || '');
    setOfferActive(offer.active !== false);

    if (offer.category === 'piso_vinilico') {
      setOfferLotMode('existing');
      setOfferExistingLotId(linkedLot?.id || '');
      setOfferLotPattern(linkedLot?.pattern || '');
      setOfferLotThickness(linkedLot?.thickness || '');
      setOfferLotSqmPerBox(linkedLot ? String(linkedLot.sqmPerBox) : '');
      setOfferLotInitialBoxes(linkedLot ? String(linkedLot.initialBoxes) : '');
      setOfferPriceSqm(offer.priceSqm !== undefined ? String(offer.priceSqm) : '');
    } else if (offer.category === 'rodapes' || offer.category === 'ripados') {
      setOfferPriceNormal(offer.priceNormal !== undefined ? String(offer.priceNormal) : '');
      setOfferTier1Qty(String(offer.tiers?.[0]?.minQty || qArr[0]));
      setOfferTier1Price(offer.tiers?.[0] ? String(offer.tiers[0].price) : '');
      setOfferTier2Qty(String(offer.tiers?.[1]?.minQty || qArr[1]));
      setOfferTier2Price(offer.tiers?.[1] ? String(offer.tiers[1].price) : '');
      setOfferTier3Qty(String(offer.tiers?.[2]?.minQty || qArr[2]));
      setOfferTier3Price(offer.tiers?.[2] ? String(offer.tiers[2].price) : '');
    } else if (offer.category === 'teto_vinilico') {
      setOfferPriceSqm(offer.priceSqm !== undefined ? String(offer.priceSqm) : '');
    } else {
      setOfferSimplePrice(offer.price !== undefined ? String(offer.price) : '');
    }

    setOfferFormError(null);
    setIsOfferModalOpen(true);
  };

  const handleSelectFromCrm = (payload: {
    crmProduct: any;
    detectedCategory: PromoCategory;
    suggestedPrice: number;
    extractedSqmPerBox: number;
  }) => {
    setIsCrmPickerOpen(false);
    if (!selectedCampaign) return;

    const cat = activeCategory;
    const tq = selectedCampaign.tierQuantitiesByModality?.[activeModality] || {
      rodapes: [30, 50, 100],
      ripados: [30, 50, 100],
    };
    const qArr = cat === 'ripados' ? tq.ripados : tq.rodapes;

    setEditingOffer(null);
    setOfferCategory(cat);
    setOfferSubcategoryId('');
    setOfferCrmProductId(payload.crmProduct.id);
    setOfferDescription(payload.crmProduct.name);
    setOfferSpecs('');
    setOfferActive(true);
    setOfferLotMode('new');
    setOfferExistingLotId(selectedCampaign.lots[0]?.id || '');
    setOfferLotPattern(payload.crmProduct.name);
    setOfferLotThickness('');
    setOfferLotSqmPerBox(payload.extractedSqmPerBox > 0 ? String(payload.extractedSqmPerBox) : '');
    setOfferLotInitialBoxes('');
    setOfferPriceSqm(payload.suggestedPrice > 0 ? payload.suggestedPrice.toFixed(2) : '');
    setOfferPriceNormal(payload.suggestedPrice > 0 ? payload.suggestedPrice.toFixed(2) : '');
    setOfferTier1Qty(String(qArr[0]));
    setOfferTier1Price('');
    setOfferTier2Qty(String(qArr[1]));
    setOfferTier2Price('');
    setOfferTier3Qty(String(qArr[2]));
    setOfferTier3Price('');
    setOfferSimplePrice(payload.suggestedPrice > 0 ? payload.suggestedPrice.toFixed(2) : '');
    setOfferFormError(null);
    setIsOfferModalOpen(true);
  };

  const handleSaveOfferModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCampaign) return;

    const desc = offerDescription.trim();
    if (!desc) {
      setOfferFormError('Informe a descrição do produto.');
      return;
    }

    const nowIso = new Date().toISOString();
    let updatedLots = [...selectedCampaign.lots];
    let linkedLotId: string | undefined = undefined;

    if (offerCategory === 'piso_vinilico') {
      const priceSqm = parseNumberFlexible(offerPriceSqm);
      if (priceSqm <= 0) {
        setOfferFormError('Informe um preço promocional (R$/m²) válido maior que zero.');
        return;
      }

      if (offerLotMode === 'existing' && offerExistingLotId) {
        const existingLot = updatedLots.find((l) => l.id === offerExistingLotId);
        if (!existingLot) {
          setOfferFormError('Selecione um lote válido.');
          return;
        }
        linkedLotId = existingLot.id;
        if (editingOffer && editingOffer.lotId === existingLot.id) {
          const sqm = parseNumberFlexible(offerLotSqmPerBox);
          const initB = Math.floor(parseNumberFlexible(offerLotInitialBoxes));
          if (sqm <= 0) {
            setOfferFormError('Informe a metragem por caixa (m²) válida.');
            return;
          }
          if (initB < existingLot.soldBoxes) {
            setOfferFormError(
              `A quantidade inicial (${initB}) não pode ser menor que o total já vendido (${existingLot.soldBoxes} cx).`
            );
            return;
          }
          updatedLots = updatedLots.map((l) =>
            l.id === existingLot.id
              ? {
                  ...l,
                  description: desc,
                  pattern: offerLotPattern.trim(),
                  thickness: offerLotThickness.trim(),
                  subcategoryId: offerSubcategoryId || undefined,
                  sqmPerBox: sqm,
                  initialBoxes: initB,
                  updatedAt: nowIso,
                }
              : l
          );
        }
      } else {
        const sqm = parseNumberFlexible(offerLotSqmPerBox);
        const initB = Math.floor(parseNumberFlexible(offerLotInitialBoxes));
        if (sqm <= 0) {
          setOfferFormError('Informe a metragem por caixa (m²) maior que zero.');
          return;
        }
        if (initB <= 0) {
          setOfferFormError('Informe a quantidade inicial de caixas maior que zero.');
          return;
        }
        const newLot: PromoFloorLot = {
          id: `lot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          crmProductId: offerCrmProductId,
          description: desc,
          pattern: offerLotPattern.trim(),
          thickness: offerLotThickness.trim(),
          subcategoryId: offerSubcategoryId || undefined,
          sqmPerBox: sqm,
          initialBoxes: initB,
          soldBoxes: 0,
          active: true,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        updatedLots = [...updatedLots, newLot];
        linkedLotId = newLot.id;
      }
    }

    const currentList = selectedCampaign.offersByModality?.[activeModality] || [];
    let newOffer: PromoOfferItem;

    if (offerCategory === 'piso_vinilico') {
      newOffer = {
        id: editingOffer?.id || `off_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        category: 'piso_vinilico',
        subcategoryId: offerSubcategoryId || undefined,
        crmProductId: offerCrmProductId,
        lotId: linkedLotId,
        description: desc,
        active: offerActive,
        order: editingOffer?.order ?? currentList.length,
        priceSqm: parseNumberFlexible(offerPriceSqm),
      };
    } else if (offerCategory === 'rodapes' || offerCategory === 'ripados') {
      const normal = parseNumberFlexible(offerPriceNormal);
      if (normal <= 0) {
        setOfferFormError('Informe o preço normal válido.');
        return;
      }
      const q1 = Math.max(1, Math.floor(parseNumberFlexible(offerTier1Qty) || 30));
      const q2 = Math.max(1, Math.floor(parseNumberFlexible(offerTier2Qty) || 50));
      const q3 = Math.max(1, Math.floor(parseNumberFlexible(offerTier3Qty) || 100));
      const p1 = parseNumberFlexible(offerTier1Price) || normal;
      const p2 = parseNumberFlexible(offerTier2Price) || p1;
      const p3 = parseNumberFlexible(offerTier3Price) || p2;

      const tiers: PromoProgressiveTier[] = [
        { minQty: q1, price: p1 },
        { minQty: q2, price: p2 },
        { minQty: q3, price: p3 },
      ];

      newOffer = {
        id: editingOffer?.id || `off_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        category: offerCategory,
        subcategoryId: offerSubcategoryId || undefined,
        crmProductId: offerCrmProductId,
        description: desc,
        specs: offerCategory === 'ripados' ? offerSpecs.trim() || undefined : undefined,
        active: offerActive,
        order: editingOffer?.order ?? currentList.length,
        priceNormal: normal,
        tiers,
      };
    } else if (offerCategory === 'teto_vinilico') {
      const priceSqm = parseNumberFlexible(offerPriceSqm);
      if (priceSqm <= 0) {
        setOfferFormError('Informe um preço promocional (R$/m²) válido maior que zero.');
        return;
      }
      newOffer = {
        id: editingOffer?.id || `off_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        category: 'teto_vinilico',
        subcategoryId: offerSubcategoryId || undefined,
        crmProductId: offerCrmProductId,
        description: desc,
        active: offerActive,
        order: editingOffer?.order ?? currentList.length,
        priceSqm,
      };
    } else {
      const priceVal = parseNumberFlexible(offerSimplePrice);
      if (priceVal <= 0) {
        setOfferFormError('Informe o preço promocional válido.');
        return;
      }
      newOffer = {
        id: editingOffer?.id || `off_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        category: 'outros',
        subcategoryId: offerSubcategoryId || undefined,
        crmProductId: offerCrmProductId,
        description: desc,
        active: offerActive,
        order: editingOffer?.order ?? currentList.length,
        price: priceVal,
      };
    }

    const updatedOffersList = editingOffer
      ? currentList.map((o) => (o.id === newOffer.id ? newOffer : o))
      : [...currentList, newOffer];

    let nextTQs = { ...selectedCampaign.tierQuantitiesByModality };
    if ((offerCategory === 'rodapes' || offerCategory === 'ripados') && newOffer.tiers) {
      const qTuple: [number, number, number] = [
        newOffer.tiers[0].minQty,
        newOffer.tiers[1].minQty,
        newOffer.tiers[2].minQty,
      ];
      nextTQs = {
        ...nextTQs,
        [activeModality]: {
          ...nextTQs[activeModality],
          [offerCategory]: qTuple,
        },
      };
    }

    const baseSheet = selectedCampaign.sheetSettings || getDefaultSheetSettings(true);
    const shouldAutoShowSub =
      offerCategory === 'piso_vinilico' &&
      Boolean(offerSubcategoryId) &&
      baseSheet.subcategoriesToggledByUser !== true;

    const ok = await persistCampaign(
      {
        ...selectedCampaign,
        lots: updatedLots,
        tierQuantitiesByModality: nextTQs,
        showSubcategoriesOnSheet: shouldAutoShowSub
          ? true
          : selectedCampaign.showSubcategoriesOnSheet,
        sheetSettings: shouldAutoShowSub
          ? { ...baseSheet, showSubcategories: true }
          : selectedCampaign.sheetSettings,
        offersByModality: {
          ...selectedCampaign.offersByModality,
          [activeModality]: updatedOffersList,
        },
      },
      editingOffer ? 'Produto atualizado!' : 'Produto adicionado à campanha!'
    );

    if (ok) {
      setIsOfferModalOpen(false);
    }
  };

  const handleToggleOfferActive = async (offer: PromoOfferItem) => {
    if (!selectedCampaign) return;
    const list = selectedCampaign.offersByModality?.[activeModality] || [];
    await persistCampaign({
      ...selectedCampaign,
      offersByModality: {
        ...selectedCampaign.offersByModality,
        [activeModality]: list.map((o) =>
          o.id === offer.id ? { ...o, active: o.active === false } : o
        ),
      },
    });
  };

  const handleMoveOffer = async (offer: PromoOfferItem, direction: 'up' | 'down') => {
    if (!selectedCampaign) return;
    const fullList = [...(selectedCampaign.offersByModality?.[activeModality] || [])].sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0)
    );
    const catItems = fullList.filter((o) => o.category === offer.category);
    const idx = catItems.findIndex((o) => o.id === offer.id);
    if (idx < 0) return;
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= catItems.length) return;

    const swapped = [...catItems];
    const temp = swapped[idx];
    swapped[idx] = swapped[targetIdx];
    swapped[targetIdx] = temp;

    const orderMap = new Map<string, number>();
    swapped.forEach((item, i) => orderMap.set(item.id, i));

    const updatedFull = fullList.map((o) =>
      orderMap.has(o.id) ? { ...o, order: orderMap.get(o.id)! } : o
    );

    await persistCampaign({
      ...selectedCampaign,
      offersByModality: {
        ...selectedCampaign.offersByModality,
        [activeModality]: updatedFull,
      },
    });
  };

  const handleDeleteOffer = async (offer: PromoOfferItem) => {
    if (!selectedCampaign) return;
    const list = selectedCampaign.offersByModality?.[activeModality] || [];
    await persistCampaign(
      {
        ...selectedCampaign,
        offersByModality: {
          ...selectedCampaign.offersByModality,
          [activeModality]: list.filter((o) => o.id !== offer.id),
        },
      },
      'Produto removido deste público.'
    );
  };

  const handleSaveTierQuantities = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCampaign || !tierHeaderEditCat) return;
    const q1 = Math.max(1, Math.floor(parseNumberFlexible(tierHeaderQ1) || 30));
    const q2 = Math.max(1, Math.floor(parseNumberFlexible(tierHeaderQ2) || 50));
    const q3 = Math.max(1, Math.floor(parseNumberFlexible(tierHeaderQ3) || 100));
    const nextTuple: [number, number, number] = [q1, q2, q3];

    const updatedOffers = (selectedCampaign.offersByModality?.[activeModality] || []).map((o) => {
      if (o.category !== tierHeaderEditCat) return o;
      const oldTiers = o.tiers || [];
      return {
        ...o,
        tiers: [
          { minQty: q1, price: oldTiers[0]?.price ?? o.priceNormal ?? 0 },
          { minQty: q2, price: oldTiers[1]?.price ?? o.priceNormal ?? 0 },
          { minQty: q3, price: oldTiers[2]?.price ?? o.priceNormal ?? 0 },
        ],
      };
    });

    const ok = await persistCampaign(
      {
        ...selectedCampaign,
        tierQuantitiesByModality: {
          ...selectedCampaign.tierQuantitiesByModality,
          [activeModality]: {
            ...selectedCampaign.tierQuantitiesByModality[activeModality],
            [tierHeaderEditCat]: nextTuple,
          },
        },
        offersByModality: {
          ...selectedCampaign.offersByModality,
          [activeModality]: updatedOffers,
        },
      },
      'Faixas progressivas atualizadas.'
    );
    if (ok) setTierHeaderEditCat(null);
  };

  const handleOpenReplicateOffer = (offer: PromoOfferItem) => {
    setOfferToReplicate(offer);
    setReplicateTargets({
      cliente_final: activeModality !== 'cliente_final',
      construtora: activeModality !== 'construtora',
      revenda: activeModality !== 'revenda',
    });
  };

  const handleConfirmReplicateOffer = async () => {
    if (!selectedCampaign || !offerToReplicate) return;
    const nextOffersByMod = { ...selectedCampaign.offersByModality };

    (['revenda', 'construtora', 'cliente_final'] as PromoModality[]).forEach((mod) => {
      if (mod === activeModality || !replicateTargets[mod]) return;
      const list = [...(nextOffersByMod[mod] || [])];
      const cloned: PromoOfferItem = {
        ...offerToReplicate,
        id: `off_${mod}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        order: list.length,
        tiers: offerToReplicate.tiers
          ? offerToReplicate.tiers.map((t) => ({ ...t }))
          : undefined,
      };
      nextOffersByMod[mod] = [...list, cloned];
    });

    const ok = await persistCampaign(
      { ...selectedCampaign, offersByModality: nextOffersByMod },
      'Produto copiado para os públicos selecionados! Ajuste os preços de cada tabela.'
    );
    if (ok) setOfferToReplicate(null);
  };

  const handleSaveConditionDraft = async () => {
    if (!selectedCampaign) return;
    await persistCampaign(
      {
        ...selectedCampaign,
        conditionsByModality: {
          ...selectedCampaign.conditionsByModality,
          [activeModality]: conditionDraft.trim(),
        },
      },
      'Condições comerciais salvas.'
    );
  };

  // =========================================================================
  // 3. FOLHA DE DIVULGAÇÃO (Configurações, Layout, PDF, Impressão, Compartilhar)
  // =========================================================================
  const updateCampaignSheetSettings = async (patch: Partial<PromoSheetSettings>) => {
    if (!selectedCampaign) return;
    const nextSettings: PromoSheetSettings = {
      ...sheetSettings,
      ...patch,
      includedCategories: {
        ...sheetSettings.includedCategories,
        ...(patch.includedCategories || {}),
      },
    };
    // Atualização otimista imediata + persistência Supabase
    setCampaigns((prev) =>
      prev.map((c) =>
        c.id === selectedCampaign.id
          ? { ...c, sheetSettings: nextSettings, showSubcategoriesOnSheet: nextSettings.showSubcategories }
          : c
      )
    );
    await persistCampaign({
      ...selectedCampaign,
      sheetSettings: nextSettings,
      showSubcategoriesOnSheet: nextSettings.showSubcategories,
    });
  };

  const openLayoutModal = () => {
    if (!selectedCampaign) return;
    setLayoutBadgeTop(selectedCampaign.badgeTopText || '');
    setLayoutBadgeBottom(selectedCampaign.badgeBottomText || '');
    setLayoutValidityText(selectedCampaign.validityText || '');
    setLayoutPaymentText(selectedCampaign.paymentConditionText || '');
    setLayoutModel(sheetSettings.model);
    setLayoutShowModality(sheetSettings.showModalityLabel);
    setLayoutShowSubcategories(sheetSettings.showSubcategories);
    setLayoutDensity(sheetSettings.density);
    setLayoutConditionRev(selectedCampaign.conditionsByModality?.revenda || '');
    setLayoutConditionConst(selectedCampaign.conditionsByModality?.construtora || '');
    setLayoutConditionCF(selectedCampaign.conditionsByModality?.cliente_final || '');
    setIsLayoutModalOpen(true);
  };

  const handleSaveLayoutModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCampaign) return;
    const nextSettings: PromoSheetSettings = {
      ...sheetSettings,
      model: layoutModel,
      showModalityLabel: layoutShowModality,
      showSubcategories: layoutShowSubcategories,
      subcategoriesToggledByUser: true,
      density: layoutModel === 'compacto_a4' ? 'compacto' : layoutDensity,
    };

    const ok = await persistCampaign(
      {
        ...selectedCampaign,
        badgeTopText: layoutBadgeTop.trim() || undefined,
        badgeBottomText: layoutBadgeBottom.trim() || undefined,
        validityText: layoutValidityText.trim() || undefined,
        paymentConditionText: layoutPaymentText.trim() || undefined,
        showSubcategoriesOnSheet: nextSettings.showSubcategories,
        sheetSettings: nextSettings,
        conditionsByModality: {
          revenda: layoutConditionRev.trim(),
          construtora: layoutConditionConst.trim(),
          cliente_final: layoutConditionCF.trim(),
        },
      },
      'Layout da folha atualizado!'
    );
    if (ok) setIsLayoutModalOpen(false);
  };

  const getSheetFileName = (ext: 'pdf' | 'png') => {
    const campSlug = (selectedCampaign?.name || 'promocao')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-');
    return `fenix-world-${campSlug}-${sheetModality}.${ext}`;
  };

  const captureSheetDataUrl = async (): Promise<{
    dataUrl: string;
    width: number;
    height: number;
  }> => {
    const element = document.getElementById('promocao-folha-a4');
    if (!element) {
      throw new Error('Folha de divulgação não encontrada na tela.');
    }
    const width = element.offsetWidth || 794;
    const height = element.scrollHeight || element.offsetHeight || 1123;

    try {
      const dataUrl = await toPng(element, {
        quality: 0.98,
        pixelRatio: 2,
        backgroundColor: '#ffffff',
        cacheBust: false,
        width,
        height,
        style: {
          margin: '0',
          transform: 'none',
        },
      });
      return { dataUrl, width, height };
    } catch {
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        logging: false,
        width,
        height,
      });
      return {
        dataUrl: canvas.toDataURL('image/png'),
        width: canvas.width / 2,
        height: canvas.height / 2,
      };
    }
  };

  const handlePrintSheetA4 = () => {
    const styleId = 'fenix-promo-print-a4-portrait';
    let styleTag = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!styleTag) {
      styleTag = document.createElement('style');
      styleTag.id = styleId;
      styleTag.textContent = `
        @media print {
          @page { size: A4 portrait; margin: 4mm; }
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          body.printing-promocao-a4 * { visibility: hidden !important; }
          body.printing-promocao-a4 #promocao-folha-a4,
          body.printing-promocao-a4 #promocao-folha-a4 * {
            visibility: visible !important;
          }
          body.printing-promocao-a4 #promocao-folha-a4 {
            position: fixed !important;
            left: 0 !important;
            top: 0 !important;
            z-index: 99999 !important;
            width: 100% !important;
            min-width: 100% !important;
            max-width: 100% !important;
            min-height: 288mm !important;
            margin: 0 !important;
            border: none !important;
            box-shadow: none !important;
          }
        }
      `;
      document.head.appendChild(styleTag);
    }

    const cleanup = () => {
      document.body.classList.remove('printing-promocao-a4');
      window.removeEventListener('afterprint', cleanup);
    };

    document.body.classList.add('printing-promocao-a4');
    window.addEventListener('afterprint', cleanup);
    setTimeout(() => {
      window.print();
      setTimeout(cleanup, 1200);
    }, 80);
  };

  const handleDownloadSheetPdf = async () => {
    if (!selectedCampaign) return;
    try {
      setIsExporting(true);
      showToast('Gerando PDF A4...');
      const { dataUrl, width, height } = await captureSheetDataUrl();

      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      });

      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 3;
      const availW = pageW - margin * 2;
      const availH = pageH - margin * 2;

      const imgMmW = width * 0.264583;
      const imgMmH = height * 0.264583;
      const scale = Math.min(availW / imgMmW, availH / imgMmH);
      const renderW = imgMmW * scale;
      const renderH = imgMmH * scale;
      const x = (pageW - renderW) / 2;
      const y = (pageH - renderH) / 2;

      pdf.addImage(dataUrl, 'PNG', x, y, renderW, renderH, undefined, 'FAST');
      pdf.save(getSheetFileName('pdf'));
      showToast('PDF baixado com sucesso!');
    } catch (err) {
      console.error('Erro ao baixar PDF da promoção:', err);
      showToast('Não foi possível gerar o PDF. Tente Imprimir.', 'error');
    } finally {
      setIsExporting(false);
    }
  };

  const handleDownloadSheetImage = async () => {
    if (!selectedCampaign) return;
    try {
      setIsExporting(true);
      setIsShareMenuOpen(false);
      showToast('Gerando imagem PNG...');
      const { dataUrl } = await captureSheetDataUrl();
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = getSheetFileName('png');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast('Imagem PNG baixada!');
    } catch (err) {
      console.error('Erro ao baixar imagem:', err);
      showToast('Erro ao gerar imagem.', 'error');
    } finally {
      setIsExporting(false);
    }
  };

  const handleShareWhatsApp = async () => {
    if (!selectedCampaign) return;
    const modMeta = PROMO_MODALITIES.find((m) => m.id === sheetModality) || PROMO_MODALITIES[0];

    try {
      setIsExporting(true);
      setIsShareMenuOpen(false);
      const { dataUrl } = await captureSheetDataUrl();
      const blob = await (await fetch(dataUrl)).blob();

      if (blob && navigator.clipboard && typeof ClipboardItem !== 'undefined') {
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          showToast('Imagem copiada! Cole no WhatsApp (Ctrl+V).');
        } catch {
          // ignore
        }
      }

      const file = new File([blob], getSheetFileName('png'), { type: 'image/png' });
      const summaryText =
        `*FÊNIX WORLD — ${selectedCampaign.name.toUpperCase()}*\n` +
        `Tabela: *${modMeta.label}*\n` +
        `Validade: ${formatDateBR(selectedCampaign.startDate)} a ${formatDateBR(selectedCampaign.endDate)} (ou enquanto durarem os estoques).`;

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            title: `Fênix World - ${selectedCampaign.name} (${modMeta.label})`,
            text: summaryText,
            files: [file],
          });
          setIsExporting(false);
          return;
        } catch {
          // fallback wa.me
        }
      }

      const encoded = encodeURIComponent(summaryText);
      const a = document.createElement('a');
      a.href = `https://wa.me/?text=${encoded}`;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      console.error('Erro ao compartilhar:', err);
      showToast('Erro ao preparar compartilhamento.', 'error');
    } finally {
      setIsExporting(false);
    }
  };

  // =========================================================================
  // 4. CONTROLE ADMINISTRATIVO POR GRUPOS DE LOTES (Supabase)
  // =========================================================================
  const cancelGroupForms = () => {
    setIsCreatingGroupInline(false);
    setNewGroupName('');
    setEditingGroupId(null);
    setEditingGroupName('');
  };

  const openCreateLotGroupForm = () => {
    setEditingGroupId(null);
    setEditingGroupName('');
    setAdminLotError(null);
    setIsCreatingGroupInline(true);
    setNewGroupName('');
  };

  const handleCreateLotGroup = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedCampaign) return;
    const name = newGroupName.trim();
    if (!name) {
      setAdminLotError('Informe o nome do novo lote.');
      return;
    }

    setIsSaving(true);
    const res = await createLotGroupInSupabase({
      campaignId: selectedCampaign.id,
      name,
      createdBy: currentUserName,
    });
    setIsSaving(false);

    if (!res.success) {
      setAdminLotError(res.error || 'Erro ao criar lote no Supabase.');
      return;
    }

    setCampaigns(res.campaigns);
    setIsCreatingGroupInline(false);
    setNewGroupName('');
    setAdminLotError(null);
    showToast(`Lote "${name}" criado com sucesso!`);
  };

  const openEditLotGroup = (group: PromoLotGroup) => {
    setIsCreatingGroupInline(false);
    setAdminLotError(null);
    setEditingGroupId(group.id);
    setEditingGroupName(group.name);
  };

  const handleSaveEditLotGroup = async (groupId: string) => {
    if (!selectedCampaign) return;
    const name = editingGroupName.trim();
    if (!name) {
      setAdminLotError('Informe o nome do lote.');
      return;
    }

    setIsSaving(true);
    const res = await updateLotGroupInSupabase({
      campaignId: selectedCampaign.id,
      groupId,
      name,
      updatedBy: currentUserName,
    });
    setIsSaving(false);

    if (!res.success) {
      setAdminLotError(res.error || 'Erro ao renomear lote no Supabase.');
      return;
    }

    setCampaigns(res.campaigns);
    setEditingGroupId(null);
    setEditingGroupName('');
    setAdminLotError(null);
    showToast('Nome do lote atualizado!');
  };

  const handleConfirmDeleteLotGroup = async () => {
    if (!selectedCampaign || !groupToDelete) return;
    setIsSaving(true);
    const res = await deleteLotGroupInSupabase({
      campaignId: selectedCampaign.id,
      groupId: groupToDelete.group.id,
      deletedBy: currentUserName,
    });
    setIsSaving(false);

    if (!res.success) {
      showToast(res.error || 'Erro ao excluir lote.', 'error');
      return;
    }

    setCampaigns(res.campaigns);
    if (adminCreatingGroupId === groupToDelete.group.id) {
      setAdminCreatingGroupId(null);
    }
    if (editingGroupId === groupToDelete.group.id) {
      setEditingGroupId(null);
    }
    setGroupToDelete(null);
    showToast('Lote excluído. Histórico de vendas preservado.');
  };

  const openInlineNewLot = (groupId: string) => {
    setAdminEditingLotId(null);
    setAdminCreatingGroupId(groupId);
    setAdminLotGroupId(groupId);
    setAdminLotDesc('');
    setAdminLotSqmPerBox('2,50');
    setAdminLotInitialBoxes('0');
    setAdminLotSoldBoxes('0');
    setAdminLotError(null);
  };

  const openInlineEditLot = (lot: PromoFloorLot) => {
    setAdminCreatingGroupId(null);
    setAdminEditingLotId(lot.id);
    setAdminLotGroupId(lot.lotGroupId || '');
    setAdminLotDesc(lot.description);
    setAdminLotSqmPerBox(String(lot.sqmPerBox).replace('.', ','));
    setAdminLotInitialBoxes(String(lot.initialBoxes));
    setAdminLotSoldBoxes(String(lot.soldBoxes));
    setAdminLotError(null);
  };

  const cancelInlineLotForm = () => {
    setAdminCreatingGroupId(null);
    setAdminEditingLotId(null);
    setAdminLotGroupId('');
    setAdminLotError(null);
  };

  const handleSaveInlineNewLot = async () => {
    if (!selectedCampaign || !adminCreatingGroupId) return;
    const desc = adminLotDesc.trim();
    const sqm = parseNumberFlexible(adminLotSqmPerBox);
    const initialBoxes = Math.max(0, Math.floor(parseNumberFlexible(adminLotInitialBoxes)));
    const soldBoxes = Math.max(0, Math.floor(parseNumberFlexible(adminLotSoldBoxes)));

    if (!desc) {
      setAdminLotError('Informe o nome do produto.');
      return;
    }
    if (sqm <= 0) {
      setAdminLotError('Informe m² / Caixa maior que zero.');
      return;
    }
    if (soldBoxes > initialBoxes) {
      setAdminLotError(
        `A quantidade vendida (${soldBoxes}) não pode ultrapassar a quantidade inicial (${initialBoxes}).`
      );
      return;
    }

    setIsSaving(true);
    const res = await createLotInSupabase({
      campaignId: selectedCampaign.id,
      lotGroupId: adminCreatingGroupId === '__ungrouped__' ? undefined : adminCreatingGroupId,
      description: desc,
      sqmPerBox: sqm,
      initialBoxes,
      soldBoxes,
      createdBy: currentUserName,
    });
    setIsSaving(false);

    if (!res.success) {
      setAdminLotError(res.error || 'Erro ao cadastrar produto no Supabase.');
      return;
    }

    setCampaigns(res.campaigns);
    setAdminCreatingGroupId(null);
    setAdminLotGroupId('');
    setAdminLotError(null);
    showToast('Produto cadastrado no lote!');
  };

  const handleSaveInlineEditLot = async (lotId: string) => {
    if (!selectedCampaign) return;
    const desc = adminLotDesc.trim();
    const sqm = parseNumberFlexible(adminLotSqmPerBox);
    const initialBoxes = Math.max(0, Math.floor(parseNumberFlexible(adminLotInitialBoxes)));
    const soldBoxes = Math.max(0, Math.floor(parseNumberFlexible(adminLotSoldBoxes)));

    if (!desc) {
      setAdminLotError('Informe o nome do produto.');
      return;
    }
    if (sqm <= 0) {
      setAdminLotError('Informe m² / Caixa maior que zero.');
      return;
    }
    if (soldBoxes > initialBoxes) {
      setAdminLotError(
        `A quantidade vendida (${soldBoxes}) não pode ultrapassar a quantidade inicial (${initialBoxes}).`
      );
      return;
    }

    setIsSaving(true);
    const res = await updateLotStockInSupabase({
      campaignId: selectedCampaign.id,
      lotId,
      lotGroupId: adminLotGroupId || undefined,
      description: desc,
      sqmPerBox: sqm,
      initialBoxes,
      soldBoxes,
      updatedBy: currentUserName,
    });
    setIsSaving(false);

    if (!res.success) {
      setAdminLotError(res.error || 'Erro ao atualizar produto no Supabase.');
      return;
    }

    setCampaigns(res.campaigns);
    setAdminEditingLotId(null);
    setAdminLotGroupId('');
    setAdminLotError(null);
    showToast('Produto atualizado com sucesso!');
  };

  const handleConfirmDeleteLot = async () => {
    if (!selectedCampaign || !adminLotToDelete) return;
    setIsSaving(true);
    const res = await deleteLotInSupabase({
      campaignId: selectedCampaign.id,
      lotId: adminLotToDelete.id,
      deletedBy: currentUserName,
    });
    setIsSaving(false);

    if (!res.success) {
      showToast(res.error || 'Erro ao excluir produto.', 'error');
      return;
    }

    setCampaigns(res.campaigns);
    if (adminEditingLotId === adminLotToDelete.id) {
      setAdminEditingLotId(null);
    }
    setAdminLotToDelete(null);
    showToast('Produto excluído. Histórico de vendas preservado.');
  };

  // Acesso restrito
  if (!hasAdminAccess) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
          <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-[#0B2046]">Acesso restrito</h2>
          <p className="text-sm text-slate-500 mt-1">
            Este módulo é destinado às usuárias autorizadas.
          </p>
        </div>
      </div>
    );
  }

  const activeModalityLabel =
    PROMO_MODALITIES.find((m) => m.id === activeModality)?.shortLabel || 'Revenda';
  const activeCategoryMeta =
    FIXED_CATEGORIES.find((c) => c.id === activeCategory) || FIXED_CATEGORIES[0];

  const tqActive =
    activeCategory === 'rodapes'
      ? selectedCampaign?.tierQuantitiesByModality?.[activeModality]?.rodapes || [30, 50, 100]
      : activeCategory === 'ripados'
      ? selectedCampaign?.tierQuantitiesByModality?.[activeModality]?.ripados || [30, 50, 100]
      : null;

  return (
    <div className="w-full max-w-[1760px] mx-auto px-3 sm:px-6 lg:px-8 pt-5 pb-12 space-y-5">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed bottom-5 right-5 z-50 px-4 py-3 rounded-xl shadow-lg border text-xs sm:text-sm font-semibold flex items-center gap-2 ${
            toast.type === 'error'
              ? 'bg-rose-600 text-white border-rose-700'
              : 'bg-[#0B2046] text-white border-slate-700'
          }`}
        >
          {toast.type === 'error' ? (
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          ) : (
            <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          )}
          <span>{toast.text}</span>
        </div>
      )}

      {/* =================================================================== */}
      {/* TOPO: GERENCIAMENTO DE CAMPANHAS                                    */}
      {/* =================================================================== */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-1 min-w-0">
            <label
              htmlFor="promo-campaign-selector"
              className="text-xs sm:text-sm font-extrabold text-[#0B2046] whitespace-nowrap"
            >
              Selecione a Campanha:
            </label>
            <div className="flex-1 max-w-md min-w-0">
              <select
                id="promo-campaign-selector"
                value={selectedCampaign?.id || ''}
                onChange={(e) => setSelectedCampaignId(e.target.value)}
                disabled={isLoading || campaigns.length === 0}
                className="w-full h-10 px-3.5 rounded-xl border border-slate-200 bg-slate-50 text-sm font-bold text-[#0B2046] outline-none focus:border-[#0052cc] cursor-pointer disabled:opacity-60"
              >
                {campaigns.length === 0 ? (
                  <option value="">Nenhuma campanha cadastrada</option>
                ) : (
                  campaigns.map((camp) => (
                    <option key={camp.id} value={camp.id}>
                      {camp.name} — {getStatusLabel(camp.status)} ({formatDateBR(camp.startDate)} a{' '}
                      {formatDateBR(camp.endDate)})
                    </option>
                  ))
                )}
              </select>
            </div>

            {selectedCampaign && (
              <div className="flex items-center gap-2 text-xs text-slate-500 whitespace-nowrap">
                <span
                  className={`font-bold ${
                    selectedCampaign.status === 'ativa'
                      ? 'text-emerald-700'
                      : selectedCampaign.status === 'encerrada'
                      ? 'text-slate-600'
                      : 'text-amber-700'
                  }`}
                >
                  {getStatusLabel(selectedCampaign.status)}
                </span>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">
                  {formatDateBR(selectedCampaign.startDate)} a{' '}
                  {formatDateBR(selectedCampaign.endDate)}
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => loadCampaigns(false)}
              disabled={isLoading || isSaving}
              title="Sincronizar com Supabase"
              className="h-10 px-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Atualizar</span>
            </button>

            <button
              type="button"
              onClick={openNewCampaignModal}
              className="h-10 px-4 rounded-xl bg-[#0052cc] hover:bg-blue-700 text-white text-xs sm:text-sm font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
              <span>Nova Campanha</span>
            </button>

            {selectedCampaign && (
              <button
                type="button"
                onClick={() => openEditCampaignModal(selectedCampaign)}
                className="h-10 px-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-[#0B2046] text-xs sm:text-sm font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <Pencil className="w-3.5 h-3.5" />
                <span>Editar Campanha</span>
              </button>
            )}
          </div>
        </div>

        {/* TRÊS ABAS HORIZONTAIS (SEM CARDS) */}
        <div className="border-b border-slate-200 flex items-center gap-6 overflow-x-auto pt-1">
          <button
            type="button"
            onClick={() => setActiveTab('produtos')}
            className={`pb-3 text-sm font-bold whitespace-nowrap cursor-pointer border-b-2 transition-colors ${
              activeTab === 'produtos'
                ? 'border-[#0052cc] text-[#0B2046]'
                : 'border-transparent text-slate-500 hover:text-[#0B2046]'
            }`}
          >
            Produtos e Ofertas
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('folha')}
            className={`pb-3 text-sm font-bold whitespace-nowrap cursor-pointer border-b-2 transition-colors ${
              activeTab === 'folha'
                ? 'border-[#0052cc] text-[#0B2046]'
                : 'border-transparent text-slate-500 hover:text-[#0B2046]'
            }`}
          >
            Folha de Divulgação
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('controle')}
            className={`pb-3 text-sm font-bold whitespace-nowrap cursor-pointer border-b-2 transition-colors ${
              activeTab === 'controle'
                ? 'border-[#0052cc] text-[#0B2046]'
                : 'border-transparent text-slate-500 hover:text-[#0B2046]'
            }`}
          >
            Controle Administrativo
          </button>
        </div>
      </div>

      {errorBanner && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs sm:text-sm text-amber-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>{errorBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => loadCampaigns(false)}
            className="text-xs font-bold underline cursor-pointer"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-sm text-slate-500 flex items-center justify-center gap-2">
          <Loader2 className="w-5 h-5 animate-spin text-[#0052cc]" />
          <span>Carregando campanhas promocionais...</span>
        </div>
      ) : !selectedCampaign ? (
        <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-12 text-center space-y-3">
          <Package className="w-10 h-10 text-slate-300 mx-auto" />
          <h3 className="text-base font-bold text-[#0B2046]">
            Nenhuma campanha cadastrada no sistema
          </h3>
          <p className="text-xs sm:text-sm text-slate-500 max-w-md mx-auto">
            Clique em <strong>Nova Campanha</strong> para criar sua primeira campanha promocional
            com tabelas para Revenda, Construtora e Cliente Final.
          </p>
          <button
            type="button"
            onClick={openNewCampaignModal}
            className="px-4 py-2.5 rounded-xl bg-[#0052cc] hover:bg-blue-700 text-white text-xs sm:text-sm font-bold inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Nova Campanha</span>
          </button>
        </div>
      ) : (
        <>
          {/* =============================================================== */}
          {/* ABA 1: PRODUTOS E OFERTAS                                        */}
          {/* =============================================================== */}
          {activeTab === 'produtos' && (
            <div className="space-y-4">
              {/* Seleção do Público */}
              <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    Público da Tabela Promocional
                  </span>
                  <p className="text-xs text-slate-500">
                    Preços e condições são independentes por público, sem misturar valores.
                  </p>
                </div>

                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl overflow-x-auto">
                  {ORDERED_MODALITIES.map((mod) => {
                    const count = selectedCampaign.offersByModality?.[mod.id]?.length || 0;
                    const isCurrent = activeModality === mod.id;
                    return (
                      <button
                        key={mod.id}
                        type="button"
                        onClick={() => setActiveModality(mod.id)}
                        className={`px-4 py-2 rounded-lg text-xs sm:text-sm font-bold whitespace-nowrap cursor-pointer transition-colors ${
                          isCurrent
                            ? 'bg-[#0052cc] text-white shadow-2xs'
                            : 'text-slate-600 hover:text-[#0B2046]'
                        }`}
                      >
                        {mod.shortLabel} ({count})
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Layout em 2 colunas: Coluna lateral de Categorias + Área principal da categoria */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
                {/* Coluna Lateral: As 5 Categorias Oficiais */}
                <aside className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-3 space-y-1">
                  <div className="px-3 py-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                    Categorias
                  </div>
                  <div className="grid grid-cols-2 lg:grid-cols-1 gap-1">
                    {FIXED_CATEGORIES.map((cat) => {
                      const catCount = activeModalityOffers.filter(
                        (o) => o.category === cat.id
                      ).length;
                      const isCatActive = activeCategory === cat.id;
                      return (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => setActiveCategory(cat.id)}
                          className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold cursor-pointer transition-colors ${
                            isCatActive
                              ? 'bg-[#0B2046] text-white'
                              : 'text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          <span>{cat.sidebarLabel}</span>
                          <span
                            className={`text-xs tabular-nums ${
                              isCatActive ? 'text-blue-200' : 'text-slate-400'
                            }`}
                          >
                            {catCount}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </aside>

                {/* Área Principal: Tabela da Categoria Selecionada */}
                <div className="lg:col-span-10 space-y-4 min-w-0">
                  <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                    {/* Cabeçalho da Categoria Selecionada */}
                    <div className="px-4 sm:px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <h2 className="text-base sm:text-lg font-extrabold text-[#0B2046]">
                          {activeCategoryMeta.tableTitle}
                        </h2>
                        <p className="text-xs text-slate-500">
                          Público: <strong className="text-[#0052cc]">{activeModalityLabel}</strong>{' '}
                          <span aria-hidden="true">·</span> {activeCategoryOffers.length}{' '}
                          {activeCategoryOffers.length === 1 ? 'produto' : 'produtos'}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {activeCategory === 'piso_vinilico' && (
                          <button
                            type="button"
                            onClick={() => setIsSubcategoryModalOpen(true)}
                            className="px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                          >
                            <FolderPlus className="w-3.5 h-3.5" />
                            <span>Subcategorias</span>
                          </button>
                        )}

                        {(activeCategory === 'rodapes' || activeCategory === 'ripados') &&
                          tqActive && (
                            <button
                              type="button"
                              onClick={() => {
                                setTierHeaderEditCat(activeCategory);
                                setTierHeaderQ1(String(tqActive[0]));
                                setTierHeaderQ2(String(tqActive[1]));
                                setTierHeaderQ3(String(tqActive[2]));
                              }}
                              className="px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                            >
                              <SlidersHorizontal className="w-3.5 h-3.5" />
                              <span>
                                Faixas (+{tqActive[0]}/+{tqActive[1]}/+{tqActive[2]})
                              </span>
                            </button>
                          )}

                        <button
                          type="button"
                          onClick={() => setIsCrmPickerOpen(true)}
                          className="px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-[#0B2046] text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                        >
                          <Search className="w-3.5 h-3.5" />
                          <span>Selecionar do CRM</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => openNewOfferModal(activeCategory)}
                          className="px-3.5 py-2 rounded-xl bg-[#0052cc] hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Adicionar Produto</span>
                        </button>
                      </div>
                    </div>

                    {/* Busca rápida dentro da categoria */}
                    <div className="px-4 sm:px-5 py-2.5 bg-slate-50/70 border-b border-slate-200">
                      <div className="relative max-w-sm">
                        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          value={productSearch}
                          onChange={(e) => setProductSearch(e.target.value)}
                          placeholder={`Filtrar em ${activeCategoryMeta.tableTitle}...`}
                          className="w-full h-9 pl-8 pr-3 rounded-lg border border-slate-200 bg-white text-xs text-slate-800 outline-none focus:border-[#0052cc]"
                        />
                      </div>
                    </div>

                    {/* Tabela da Categoria */}
                    {activeCategoryOffers.length === 0 ? (
                      <div className="p-10 text-center space-y-2">
                        <p className="text-sm font-semibold text-slate-600">
                          Nenhum produto cadastrado em {activeCategoryMeta.tableTitle} para{' '}
                          {activeModalityLabel}.
                        </p>
                        <p className="text-xs text-slate-400">
                          Use <strong>Adicionar Produto</strong> ou{' '}
                          <strong>Selecionar do CRM</strong> acima.
                        </p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse tabular-nums">
                          <thead>
                            <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                              <th
                                className={`py-2.5 px-4 ${
                                  activeCategory === 'teto_vinilico' || activeCategory === 'outros'
                                    ? 'w-full min-w-[280px]'
                                    : ''
                                }`}
                              >
                                Descrição
                              </th>

                              {activeCategory === 'piso_vinilico' && (
                                <>
                                  <th className="py-2.5 px-3 text-center whitespace-nowrap">
                                    Caixas
                                  </th>
                                  <th className="py-2.5 px-3 text-center whitespace-nowrap">
                                    Total (m²)
                                  </th>
                                  <th className="py-2.5 px-3 text-center whitespace-nowrap">
                                    Preço (m²)
                                  </th>
                                </>
                              )}

                              {(activeCategory === 'rodapes' || activeCategory === 'ripados') &&
                                tqActive && (
                                  <>
                                    <th className="py-2.5 px-3 text-center whitespace-nowrap">
                                      Preço
                                    </th>
                                    <th className="py-2.5 px-3 text-center whitespace-nowrap">
                                      +{tqActive[0]} barras
                                    </th>
                                    <th className="py-2.5 px-3 text-center whitespace-nowrap">
                                      +{tqActive[1]} barras
                                    </th>
                                    <th className="py-2.5 px-3 text-center whitespace-nowrap">
                                      +{tqActive[2]} barras
                                    </th>
                                  </>
                                )}

                              {activeCategory === 'teto_vinilico' && (
                                <th className="py-2.5 px-4 text-center whitespace-nowrap">
                                  Preço (m²)
                                </th>
                              )}

                              {activeCategory === 'outros' && (
                                <th className="py-2.5 px-4 text-center whitespace-nowrap">
                                  Preço
                                </th>
                              )}

                              <th className="py-2.5 px-3 text-center whitespace-nowrap">Status</th>
                              <th className="py-2.5 px-4 text-right whitespace-nowrap">Ações</th>
                            </tr>
                          </thead>

                          <tbody className="divide-y divide-slate-100 text-xs sm:text-sm">
                            {activeCategoryOffers.map((offer, idx) => {
                              const lot =
                                activeCategory === 'piso_vinilico' && offer.lotId
                                  ? selectedCampaign.lots.find((l) => l.id === offer.lotId)
                                  : undefined;
                              const lotMetrics = lot ? computeLotMetrics(lot) : null;
                              const subName =
                                (offer.subcategoryId || lot?.subcategoryId) &&
                                selectedCampaign.subcategories.find(
                                  (s) => s.id === (offer.subcategoryId || lot?.subcategoryId)
                                )?.name;

                              return (
                                <tr
                                  key={offer.id}
                                  className={`hover:bg-slate-50/70 ${
                                    offer.active === false ? 'opacity-55' : ''
                                  }`}
                                >
                                  <td className="py-2.5 px-4">
                                    <div className="font-bold text-[#0B2046]">
                                      {offer.description}
                                    </div>
                                    {(subName || offer.specs) && (
                                      <div className="text-[11px] text-slate-500">
                                        {[subName, offer.specs].filter(Boolean).join(' · ')}
                                      </div>
                                    )}
                                  </td>

                                  {activeCategory === 'piso_vinilico' && (
                                    <>
                                      <td className="py-2.5 px-3 text-center font-bold text-[#0B2046]">
                                        {lotMetrics ? lotMetrics.availableBoxes : '—'}
                                      </td>
                                      <td className="py-2.5 px-3 text-center font-semibold text-slate-700 whitespace-nowrap">
                                        {lotMetrics ? formatSqmBR(lotMetrics.availableSqm) : '—'}
                                      </td>
                                      <td className="py-2.5 px-3 text-center font-extrabold text-[#0052cc] whitespace-nowrap">
                                        {formatCurrencyBRL(offer.priceSqm)}
                                      </td>
                                    </>
                                  )}

                                  {(activeCategory === 'rodapes' || activeCategory === 'ripados') && (
                                    <>
                                      <td className="py-2.5 px-3 text-center font-extrabold text-[#0B2046] whitespace-nowrap">
                                        {formatCurrencyBRL(offer.priceNormal)}
                                      </td>
                                      {[0, 1, 2].map((tIdx) => (
                                        <td
                                          key={tIdx}
                                          className="py-2.5 px-3 text-center font-bold text-[#0052cc] whitespace-nowrap"
                                        >
                                          {formatCurrencyBRL(
                                            offer.tiers?.[tIdx]?.price ?? offer.priceNormal
                                          )}
                                        </td>
                                      ))}
                                    </>
                                  )}

                                  {activeCategory === 'teto_vinilico' && (
                                    <td className="py-2.5 px-4 text-center font-extrabold text-[#0052cc] whitespace-nowrap">
                                      {formatCurrencyBRL(offer.priceSqm)}
                                    </td>
                                  )}

                                  {activeCategory === 'outros' && (
                                    <td className="py-2.5 px-4 text-center font-extrabold text-[#0052cc] whitespace-nowrap">
                                      {formatCurrencyBRL(offer.price)}
                                    </td>
                                  )}

                                  <td className="py-2.5 px-3 text-center whitespace-nowrap">
                                    <button
                                      type="button"
                                      onClick={() => handleToggleOfferActive(offer)}
                                      title="Clique para ativar ou desativar"
                                      className={`text-xs font-bold cursor-pointer ${
                                        offer.active === false
                                          ? 'text-slate-400'
                                          : lotMetrics && lotMetrics.availableBoxes === 0
                                          ? 'text-rose-600'
                                          : 'text-emerald-700'
                                      }`}
                                    >
                                      {offer.active === false
                                        ? 'Inativo'
                                        : lotMetrics && lotMetrics.availableBoxes === 0
                                        ? 'Esgotado'
                                        : 'Ativo'}
                                    </button>
                                  </td>

                                  <td className="py-2.5 px-4 text-right whitespace-nowrap">
                                    <div className="inline-flex items-center gap-1">
                                      <button
                                        type="button"
                                        disabled={idx === 0}
                                        onClick={() => handleMoveOffer(offer, 'up')}
                                        title="Subir posição"
                                        className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30 cursor-pointer"
                                      >
                                        <ArrowUp className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        disabled={idx === activeCategoryOffers.length - 1}
                                        onClick={() => handleMoveOffer(offer, 'down')}
                                        title="Descer posição"
                                        className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30 cursor-pointer"
                                      >
                                        <ArrowDown className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleOpenReplicateOffer(offer)}
                                        title="Copiar para outros públicos"
                                        className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:text-[#0052cc] hover:bg-slate-50 cursor-pointer"
                                      >
                                        <Copy className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => openEditOfferModal(offer)}
                                        title="Editar produto"
                                        className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:text-[#0052cc] hover:bg-slate-50 cursor-pointer"
                                      >
                                        <Pencil className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteOffer(offer)}
                                        title="Excluir produto"
                                        className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
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

                  {/* Condições Comerciais do Público Selecionado */}
                  <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-col sm:flex-row items-stretch sm:items-end gap-3">
                    <div className="flex-1">
                      <label className="block text-xs font-bold text-[#0B2046] mb-1">
                        Texto após a Validade — {activeModalityLabel} (Opcional)
                      </label>
                      <textarea
                        rows={2}
                        value={conditionDraft}
                        onChange={(e) => setConditionDraft(e.target.value)}
                        placeholder="Digite exatamente o texto que deseja exibir na folha após a validade (opcional)..."
                        className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-xs sm:text-sm text-slate-800 outline-none focus:border-[#0052cc] resize-y"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleSaveConditionDraft}
                      disabled={isSaving}
                      className="h-10 px-4 rounded-xl bg-[#0B2046] hover:bg-slate-800 text-white text-xs font-bold whitespace-nowrap cursor-pointer disabled:opacity-50"
                    >
                      Salvar Condição
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* =============================================================== */}
          {/* ABA 2: FOLHA DE DIVULGAÇÃO                                      */}
          {/* =============================================================== */}
          {activeTab === 'folha' && (
            <div className="space-y-4">
              {/* Painel de Configurações e Ações */}
              <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-4">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-end">
                  {/* Público */}
                  <div className="lg:col-span-4">
                    <label className="block text-xs font-bold text-[#0B2046] mb-1.5">
                      Público
                    </label>
                    <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl overflow-x-auto">
                      {ORDERED_MODALITIES.map((mod) => {
                        const isCurrent = sheetModality === mod.id;
                        return (
                          <button
                            key={mod.id}
                            type="button"
                            onClick={() => setSheetModality(mod.id)}
                            className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold whitespace-nowrap cursor-pointer transition-colors ${
                              isCurrent
                                ? 'bg-[#0B2046] text-white'
                                : 'text-slate-600 hover:text-[#0B2046]'
                            }`}
                          >
                            {mod.shortLabel}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Modelo da Folha */}
                  <div className="lg:col-span-3">
                    <label
                      htmlFor="sheet-model-select"
                      className="block text-xs font-bold text-[#0B2046] mb-1.5"
                    >
                      Modelo da Folha
                    </label>
                    <select
                      id="sheet-model-select"
                      value={sheetSettings.model}
                      onChange={(e) =>
                        updateCampaignSheetSettings({
                          model: e.target.value as PromoSheetModel,
                          density:
                            e.target.value === 'compacto_a4' ? 'compacto' : 'padrao',
                        })
                      }
                      className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-white text-xs sm:text-sm font-bold text-[#0B2046] outline-none focus:border-[#0052cc] cursor-pointer"
                    >
                      {SHEET_MODELS.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Categorias que deseja incluir */}
                  <div className="lg:col-span-5">
                    <span className="block text-xs font-bold text-[#0B2046] mb-1.5">
                      Categorias na Folha
                    </span>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 min-h-10 py-1.5 px-3 rounded-xl border border-slate-200 bg-slate-50/70">
                      {FIXED_CATEGORIES.map((cat) => {
                        const checked = sheetSettings.includedCategories[cat.id] !== false;
                        return (
                          <label
                            key={cat.id}
                            className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 cursor-pointer select-none"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) =>
                                updateCampaignSheetSettings({
                                  includedCategories: {
                                    ...sheetSettings.includedCategories,
                                    [cat.id]: e.target.checked,
                                  },
                                })
                              }
                              className="w-3.5 h-3.5 rounded border-slate-300 text-[#0052cc]"
                            />
                            <span>{cat.sidebarLabel}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Ações */}
                <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={openLayoutModal}
                      className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-[#0B2046] text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      <LayoutTemplate className="w-3.5 h-3.5" />
                      <span>Editar Layout</span>
                    </button>

                    {selectedCampaign.subcategories.some((s) => s.category === 'piso_vinilico') && (
                      <label className="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-slate-50/80 text-xs font-semibold text-[#0B2046] cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={sheetSettings.showSubcategories}
                          onChange={(e) =>
                            updateCampaignSheetSettings({
                              showSubcategories: e.target.checked,
                              subcategoriesToggledByUser: true,
                            })
                          }
                          className="w-3.5 h-3.5 rounded border-slate-300 text-[#0052cc]"
                        />
                        <span>Exibir subcategorias</span>
                      </label>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setIsSheetPreviewModalOpen(true)}
                      className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-[#0B2046] text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Visualizar Folha</span>
                    </button>

                    <button
                      type="button"
                      disabled={isExporting}
                      onClick={handleDownloadSheetPdf}
                      className="px-3.5 py-2 rounded-xl bg-[#0B2046] hover:bg-slate-800 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Baixar PDF</span>
                    </button>

                    <button
                      type="button"
                      onClick={handlePrintSheetA4}
                      className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-[#0B2046] text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      <span>Imprimir</span>
                    </button>

                    <div className="relative">
                      <button
                        type="button"
                        disabled={isExporting}
                        onClick={() => setIsShareMenuOpen((v) => !v)}
                        className="px-3.5 py-2 rounded-xl bg-[#0052cc] hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        <Share2 className="w-3.5 h-3.5" />
                        <span>Compartilhar</span>
                      </button>

                      {isShareMenuOpen && (
                        <div className="absolute right-0 mt-2 w-52 bg-white rounded-xl border border-slate-200 shadow-xl py-1.5 z-30">
                          <button
                            type="button"
                            onClick={handleShareWhatsApp}
                            className="w-full px-3.5 py-2 text-left text-xs font-bold text-[#0B2046] hover:bg-slate-50 flex items-center gap-2 cursor-pointer"
                          >
                            <Share2 className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Enviar pelo WhatsApp</span>
                          </button>
                          <button
                            type="button"
                            onClick={handleDownloadSheetImage}
                            className="w-full px-3.5 py-2 text-left text-xs font-bold text-[#0B2046] hover:bg-slate-50 flex items-center gap-2 cursor-pointer"
                          >
                            <ImageIcon className="w-3.5 h-3.5 text-[#0052cc]" />
                            <span>Baixar Imagem (PNG)</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Preview A4 Oficial */}
              <div className="bg-slate-100/80 rounded-2xl border border-slate-200 p-3 sm:p-6 overflow-x-auto">
                <div className="flex justify-center min-w-max">
                  <PromocaoFolhaDivulgacao
                    id="promocao-folha-a4"
                    campaign={selectedCampaign}
                    modality={sheetModality}
                    includedCategories={sheetSettings.includedCategories}
                    sheetModel={sheetSettings.model}
                    showModalityLabel={sheetSettings.showModalityLabel}
                    showSubcategories={sheetSettings.showSubcategories}
                    density={sheetSettings.density}
                  />
                </div>
              </div>
            </div>
          )}

          {/* =============================================================== */}
          {/* ABA 3: CONTROLE ADMINISTRATIVO POR GRUPOS DE LOTES              */}
          {/* =============================================================== */}
          {activeTab === 'controle' && (
            <div className="space-y-4">
              {/* Cabeçalho + Seletor de Campanha + Barra de Busca + Botão Novo Lote */}
              <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:px-6 sm:py-4 space-y-3.5">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base sm:text-lg font-extrabold text-[#0B2046]">
                      Controle Administrativo
                    </h2>
                    <p className="text-xs text-slate-500">
                      Gerencie grupos de lotes e produtos ordenados automaticamente do menor para o maior m² por caixa. Saldos atualizados em tempo real.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <label
                      htmlFor="admin-campaign-selector"
                      className="text-xs font-bold text-slate-500 whitespace-nowrap"
                    >
                      Campanha:
                    </label>
                    <select
                      id="admin-campaign-selector"
                      value={selectedCampaign.id}
                      onChange={(e) => {
                        setSelectedCampaignId(e.target.value);
                        cancelInlineLotForm();
                        cancelGroupForms();
                        setAdminLotSearch('');
                      }}
                      className="h-9 px-3 rounded-xl border border-slate-200 bg-slate-50 text-xs sm:text-sm font-bold text-[#0B2046] outline-none focus:border-[#0052cc] cursor-pointer max-w-xs"
                    >
                      {campaigns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>

                    <button
                      type="button"
                      onClick={openCreateLotGroupForm}
                      className="h-9 px-3.5 rounded-xl bg-[#0052cc] hover:bg-blue-700 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <FolderPlus className="w-4 h-4" />
                      <span>Novo Lote</span>
                    </button>
                  </div>
                </div>

                {/* Barra de Busca (Produto ou Lote) */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 pt-1">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={adminLotSearch}
                      onChange={(e) => setAdminLotSearch(e.target.value)}
                      placeholder="Buscar por nome do produto ou do lote..."
                      className="w-full h-10 pl-10 pr-9 rounded-xl border border-slate-200 bg-slate-50/70 focus:bg-white text-xs sm:text-sm font-medium text-[#0B2046] placeholder:text-slate-400 outline-none focus:border-[#0052cc]"
                    />
                    {adminLotSearch && (
                      <button
                        type="button"
                        onClick={() => setAdminLotSearch('')}
                        title="Limpar busca"
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full hover:bg-slate-200 flex items-center justify-center text-slate-500 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {adminGroupedView.isFiltering && (
                    <div className="flex items-center gap-2 text-xs text-slate-600 whitespace-nowrap">
                      <span>
                        <strong className="text-[#0B2046]">{adminGroupedView.totalMatches}</strong>{' '}
                        {adminGroupedView.totalMatches === 1 ? 'produto encontrado' : 'produtos encontrados'}
                      </span>
                      <button
                        type="button"
                        onClick={() => setAdminLotSearch('')}
                        className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-[#0052cc] cursor-pointer"
                      >
                        Limpar busca
                      </button>
                    </div>
                  )}
                </div>

                {/* Formulário inline para criar Novo Grupo de Lote */}
                {isCreatingGroupInline && (
                  <form
                    onSubmit={handleCreateLotGroup}
                    className="p-3.5 rounded-xl bg-blue-50/70 border border-blue-200 flex flex-col sm:flex-row sm:items-center gap-2.5"
                  >
                    <div className="flex-1">
                      <label className="block text-[11px] font-bold text-[#0B2046] uppercase tracking-wider mb-1">
                        Nome do Novo Grupo de Lote
                      </label>
                      <input
                        type="text"
                        value={newGroupName}
                        onChange={(e) => {
                          setNewGroupName(e.target.value);
                          setAdminLotError(null);
                        }}
                        placeholder="Ex: TARKETT AMBIENTA"
                        className="w-full h-9 px-3 rounded-lg border border-blue-300 bg-white text-xs sm:text-sm font-bold text-[#0B2046] outline-none focus:border-[#0052cc]"
                        autoFocus
                      />
                    </div>
                    <div className="flex items-center gap-2 sm:self-end">
                      <button
                        type="submit"
                        disabled={isSaving}
                        className="h-9 px-4 rounded-lg bg-[#0052cc] hover:bg-blue-700 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Criar Lote</span>
                      </button>
                      <button
                        type="button"
                        onClick={cancelGroupForms}
                        className="h-9 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 text-xs font-bold cursor-pointer"
                      >
                        Cancelar
                      </button>
                    </div>
                  </form>
                )}

                {adminLotError && (
                  <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-700 flex items-center justify-between gap-2">
                    <span>{adminLotError}</span>
                    <button
                      type="button"
                      onClick={() => setAdminLotError(null)}
                      className="text-rose-500 hover:text-rose-700 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              {/* Lista de Grupos de Lotes (Todos abertos por padrão, um abaixo do outro) */}
              {adminGroupedView.sections.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center space-y-3">
                  {adminGroupedView.isFiltering ? (
                    <>
                      <p className="text-sm font-bold text-[#0B2046]">
                        Nenhum produto ou lote encontrado para &ldquo;{adminLotSearch}&rdquo;.
                      </p>
                      <p className="text-xs text-slate-500">
                        Tente outro termo ou limpe a busca para visualizar todos os lotes.
                      </p>
                      <button
                        type="button"
                        onClick={() => setAdminLotSearch('')}
                        className="px-4 py-2 rounded-xl bg-[#0052cc] hover:bg-blue-700 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                        <span>Limpar busca</span>
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="text-xs sm:text-sm text-slate-500">
                        Nenhum lote cadastrado nesta campanha.
                      </p>
                      <button
                        type="button"
                        onClick={openCreateLotGroupForm}
                        className="px-4 py-2 rounded-xl bg-[#0052cc] hover:bg-blue-700 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <FolderPlus className="w-4 h-4" />
                        <span>Criar Primeiro Lote</span>
                      </button>
                    </>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  {adminGroupedView.sections.map((section) => {
                    const { group, isSyntheticUngrouped, lots } = section;
                    const isEditingThisGroup = editingGroupId === group.id;
                    const isAddingProductHere = adminCreatingGroupId === group.id;

                    const groupTotals = lots.reduce(
                      (acc, lot) => {
                        const m = computeLotMetrics(lot);
                        return {
                          availableBoxes: acc.availableBoxes + m.availableBoxes,
                          availableSqm: Math.round((acc.availableSqm + m.availableSqm) * 100) / 100,
                        };
                      },
                      { availableBoxes: 0, availableSqm: 0 }
                    );

                    return (
                      <div
                        key={group.id}
                        className="bg-white rounded-2xl border border-slate-200 overflow-hidden"
                      >
                        {/* Cabeçalho do Grupo de Lote (sempre aberto) */}
                        <div className="px-4 sm:px-6 py-3.5 bg-slate-50/90 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                          <div className="flex flex-wrap items-center gap-2.5 min-w-0">
                            {isEditingThisGroup ? (
                              <div className="flex flex-wrap items-center gap-2">
                                <input
                                  type="text"
                                  value={editingGroupName}
                                  onChange={(e) => {
                                    setEditingGroupName(e.target.value);
                                    setAdminLotError(null);
                                  }}
                                  className="h-8 px-3 rounded-lg border border-blue-300 bg-white text-xs sm:text-sm font-extrabold text-[#0B2046] outline-none focus:border-[#0052cc]"
                                  autoFocus
                                />
                                <button
                                  type="button"
                                  disabled={isSaving}
                                  onClick={() => handleSaveEditLotGroup(group.id)}
                                  className="h-8 px-2.5 rounded-lg bg-[#0052cc] hover:bg-blue-700 text-white text-xs font-bold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                  <span>Salvar</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingGroupId(null);
                                    setEditingGroupName('');
                                  }}
                                  className="h-8 px-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 text-xs font-bold cursor-pointer"
                                >
                                  Cancelar
                                </button>
                              </div>
                            ) : (
                              <>
                                <h3 className="text-sm sm:text-base font-extrabold text-[#0B2046] tracking-wide uppercase">
                                  {group.name}
                                </h3>
                                <span className="px-2 py-0.5 rounded-md bg-blue-50 border border-blue-100 text-[11px] font-bold text-[#0052cc] whitespace-nowrap">
                                  {lots.length} {lots.length === 1 ? 'produto' : 'produtos'}
                                </span>
                                <span className="text-xs font-semibold text-slate-600 whitespace-nowrap tabular-nums">
                                  Saldo do lote: <strong className="text-[#0B2046]">{groupTotals.availableBoxes} cx</strong>{' '}
                                  ({formatSqmBR(groupTotals.availableSqm)})
                                </span>
                              </>
                            )}
                          </div>

                          {!isSyntheticUngrouped && (
                            <div className="flex flex-wrap items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => openInlineNewLot(group.id)}
                                className="px-3 py-1.5 rounded-lg bg-[#0052cc] hover:bg-blue-700 text-white text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
                              >
                                <Plus className="w-3.5 h-3.5" />
                                <span>Adicionar Produto</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => openEditLotGroup(group)}
                                title="Editar nome do lote"
                                className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-[#0B2046] text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                                <span>Editar Lote</span>
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setGroupToDelete({
                                    group,
                                    productCount: section.allLotsCount,
                                  })
                                }
                                title="Excluir lote"
                                className="px-2.5 py-1.5 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>Excluir Lote</span>
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Tabela de Produtos deste Lote (ordenada por m²/caixa crescente) */}
                        {lots.length === 0 && !isAddingProductHere ? (
                          <div className="px-4 sm:px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
                            <span>Nenhum produto cadastrado neste lote.</span>
                            {!isSyntheticUngrouped && (
                              <button
                                type="button"
                                onClick={() => openInlineNewLot(group.id)}
                                className="px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-100 text-[#0052cc] text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
                              >
                                <Plus className="w-3.5 h-3.5" />
                                <span>Adicionar Primeiro Produto</span>
                              </button>
                            )}
                          </div>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse tabular-nums">
                              <thead>
                                <tr className="border-b border-slate-200 bg-white text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                                  <th className="py-2.5 px-4">Produto</th>
                                  <th className="py-2.5 px-3 text-center whitespace-nowrap">m² / Caixa</th>
                                  <th className="py-2.5 px-3 text-center whitespace-nowrap">
                                    Inicial (Caixas)
                                  </th>
                                  <th className="py-2.5 px-3 text-center whitespace-nowrap">
                                    Vendido (Caixas)
                                  </th>
                                  <th className="py-2.5 px-3 text-center whitespace-nowrap">
                                    Saldo (Caixas)
                                  </th>
                                  <th className="py-2.5 px-3 text-center whitespace-nowrap">Saldo (m²)</th>
                                  <th className="py-2.5 px-4 text-right whitespace-nowrap">Ações</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100 text-xs sm:text-sm">
                                {isAddingProductHere && (() => {
                                  const sqmVal = parseNumberFlexible(adminLotSqmPerBox);
                                  const initVal = Math.max(
                                    0,
                                    Math.floor(parseNumberFlexible(adminLotInitialBoxes))
                                  );
                                  const soldVal = Math.max(
                                    0,
                                    Math.floor(parseNumberFlexible(adminLotSoldBoxes))
                                  );
                                  const saldoCx = Math.max(0, initVal - soldVal);
                                  const saldoSqm = Math.round(saldoCx * sqmVal * 100) / 100;
                                  return (
                                    <tr className="bg-blue-50/60">
                                      <td className="py-2.5 px-4">
                                        <input
                                          type="text"
                                          value={adminLotDesc}
                                          onChange={(e) => {
                                            setAdminLotDesc(e.target.value);
                                            setAdminLotError(null);
                                          }}
                                          placeholder={`Novo produto em ${group.name}`}
                                          className="w-full h-9 px-3 rounded-lg border border-blue-300 bg-white text-xs sm:text-sm font-bold text-[#0B2046] outline-none focus:border-[#0052cc]"
                                          autoFocus
                                        />
                                      </td>
                                      <td className="py-2.5 px-3 text-center">
                                        <input
                                          type="text"
                                          value={adminLotSqmPerBox}
                                          onChange={(e) => {
                                            setAdminLotSqmPerBox(e.target.value);
                                            setAdminLotError(null);
                                          }}
                                          placeholder="2,50"
                                          className="w-24 mx-auto h-9 px-2.5 rounded-lg border border-blue-300 bg-white text-center text-xs sm:text-sm font-bold text-slate-800 outline-none focus:border-[#0052cc]"
                                        />
                                      </td>
                                      <td className="py-2.5 px-3 text-center">
                                        <input
                                          type="number"
                                          min={0}
                                          value={adminLotInitialBoxes}
                                          onChange={(e) => {
                                            setAdminLotInitialBoxes(e.target.value);
                                            setAdminLotError(null);
                                          }}
                                          className="w-24 mx-auto h-9 px-2.5 rounded-lg border border-blue-300 bg-white text-center text-xs sm:text-sm font-bold text-slate-800 outline-none focus:border-[#0052cc]"
                                        />
                                      </td>
                                      <td className="py-2.5 px-3 text-center">
                                        <input
                                          type="number"
                                          min={0}
                                          value={adminLotSoldBoxes}
                                          onChange={(e) => {
                                            setAdminLotSoldBoxes(e.target.value);
                                            setAdminLotError(null);
                                          }}
                                          className="w-24 mx-auto h-9 px-2.5 rounded-lg border border-blue-300 bg-white text-center text-xs sm:text-sm font-bold text-slate-800 outline-none focus:border-[#0052cc]"
                                        />
                                      </td>
                                      <td className="py-2.5 px-3 text-center font-extrabold text-[#0B2046]">
                                        {saldoCx}
                                      </td>
                                      <td className="py-2.5 px-3 text-center font-bold text-[#0052cc] whitespace-nowrap">
                                        {formatSqmBR(saldoSqm)}
                                      </td>
                                      <td className="py-2.5 px-4 text-right whitespace-nowrap">
                                        <div className="inline-flex items-center gap-1.5">
                                          <button
                                            type="button"
                                            disabled={isSaving}
                                            onClick={handleSaveInlineNewLot}
                                            className="px-3 py-1.5 rounded-lg bg-[#0052cc] hover:bg-blue-700 text-white text-xs font-bold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                                          >
                                            <Check className="w-3.5 h-3.5" />
                                            <span>Salvar</span>
                                          </button>
                                          <button
                                            type="button"
                                            onClick={cancelInlineLotForm}
                                            className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 text-xs font-bold cursor-pointer"
                                          >
                                            Cancelar
                                          </button>
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })()}

                                {lots.map((lot) => {
                                  const isInlineEditing = adminEditingLotId === lot.id;
                                  if (isInlineEditing) {
                                    const sqmVal = parseNumberFlexible(adminLotSqmPerBox);
                                    const initVal = Math.max(
                                      0,
                                      Math.floor(parseNumberFlexible(adminLotInitialBoxes))
                                    );
                                    const soldVal = Math.max(
                                      0,
                                      Math.floor(parseNumberFlexible(adminLotSoldBoxes))
                                    );
                                    const saldoCx = Math.max(0, initVal - soldVal);
                                    const saldoSqm = Math.round(saldoCx * sqmVal * 100) / 100;

                                    return (
                                      <tr key={lot.id} className="bg-amber-50/50">
                                        <td className="py-2.5 px-4 space-y-1.5">
                                          <input
                                            type="text"
                                            value={adminLotDesc}
                                            onChange={(e) => {
                                              setAdminLotDesc(e.target.value);
                                              setAdminLotError(null);
                                            }}
                                            className="w-full h-9 px-3 rounded-lg border border-blue-300 bg-white text-xs sm:text-sm font-bold text-[#0B2046] outline-none focus:border-[#0052cc]"
                                            autoFocus
                                          />
                                          {adminOrgData.groups.length > 0 && (
                                            <div className="flex items-center gap-1.5">
                                              <span className="text-[11px] font-bold text-slate-500">
                                                Lote:
                                              </span>
                                              <select
                                                value={adminLotGroupId}
                                                onChange={(e) => setAdminLotGroupId(e.target.value)}
                                                className="h-7 px-2 rounded-md border border-slate-200 bg-white text-[11px] font-bold text-[#0B2046] outline-none focus:border-[#0052cc] cursor-pointer"
                                              >
                                                <option value="">Sem lote definido</option>
                                                {adminOrgData.groups.map((g) => (
                                                  <option key={g.id} value={g.id}>
                                                    {g.name}
                                                  </option>
                                                ))}
                                              </select>
                                            </div>
                                          )}
                                        </td>
                                        <td className="py-2.5 px-3 text-center">
                                          <input
                                            type="text"
                                            value={adminLotSqmPerBox}
                                            onChange={(e) => {
                                              setAdminLotSqmPerBox(e.target.value);
                                              setAdminLotError(null);
                                            }}
                                            className="w-24 mx-auto h-9 px-2.5 rounded-lg border border-blue-300 bg-white text-center text-xs sm:text-sm font-bold text-slate-800 outline-none focus:border-[#0052cc]"
                                          />
                                        </td>
                                        <td className="py-2.5 px-3 text-center">
                                          <input
                                            type="number"
                                            min={0}
                                            value={adminLotInitialBoxes}
                                            onChange={(e) => {
                                              setAdminLotInitialBoxes(e.target.value);
                                              setAdminLotError(null);
                                            }}
                                            className="w-24 mx-auto h-9 px-2.5 rounded-lg border border-blue-300 bg-white text-center text-xs sm:text-sm font-bold text-slate-800 outline-none focus:border-[#0052cc]"
                                          />
                                        </td>
                                        <td className="py-2.5 px-3 text-center">
                                          <input
                                            type="number"
                                            min={0}
                                            value={adminLotSoldBoxes}
                                            onChange={(e) => {
                                              setAdminLotSoldBoxes(e.target.value);
                                              setAdminLotError(null);
                                            }}
                                            className="w-24 mx-auto h-9 px-2.5 rounded-lg border border-blue-300 bg-white text-center text-xs sm:text-sm font-bold text-slate-800 outline-none focus:border-[#0052cc]"
                                          />
                                        </td>
                                        <td className="py-2.5 px-3 text-center font-extrabold text-[#0B2046]">
                                          {saldoCx}
                                        </td>
                                        <td className="py-2.5 px-3 text-center font-bold text-[#0052cc] whitespace-nowrap">
                                          {formatSqmBR(saldoSqm)}
                                        </td>
                                        <td className="py-2.5 px-4 text-right whitespace-nowrap">
                                          <div className="inline-flex items-center gap-1.5">
                                            <button
                                              type="button"
                                              disabled={isSaving}
                                              onClick={() => handleSaveInlineEditLot(lot.id)}
                                              className="px-3 py-1.5 rounded-lg bg-[#0052cc] hover:bg-blue-700 text-white text-xs font-bold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                                            >
                                              <Check className="w-3.5 h-3.5" />
                                              <span>Salvar</span>
                                            </button>
                                            <button
                                              type="button"
                                              onClick={cancelInlineLotForm}
                                              className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 text-xs font-bold cursor-pointer"
                                            >
                                              Cancelar
                                            </button>
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  }

                                  const metrics = computeLotMetrics(lot);
                                  return (
                                    <tr key={lot.id} className="hover:bg-slate-50/70">
                                      <td className="py-3 px-4 font-bold text-[#0B2046]">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <span>{lot.description}</span>
                                          {adminGroupedView.isFiltering && (
                                            <span className="px-2 py-0.5 rounded bg-slate-100 text-[10px] font-bold text-slate-600 uppercase tracking-wide">
                                              Lote: {group.name}
                                            </span>
                                          )}
                                        </div>
                                      </td>
                                      <td className="py-3 px-3 text-center font-medium text-slate-700">
                                        {lot.sqmPerBox.toLocaleString('pt-BR', {
                                          minimumFractionDigits: 2,
                                          maximumFractionDigits: 2,
                                        })}
                                      </td>
                                      <td className="py-3 px-3 text-center font-semibold text-slate-700">
                                        {metrics.initialBoxes}
                                      </td>
                                      <td className="py-3 px-3 text-center font-semibold text-slate-700">
                                        {metrics.soldBoxes}
                                      </td>
                                      <td className="py-3 px-3 text-center font-extrabold text-[#0B2046]">
                                        {metrics.availableBoxes}
                                      </td>
                                      <td className="py-3 px-3 text-center font-bold text-[#0052cc] whitespace-nowrap">
                                        {formatSqmBR(metrics.availableSqm)}
                                      </td>
                                      <td className="py-3 px-4 text-right whitespace-nowrap">
                                        <div className="inline-flex items-center gap-1.5">
                                          <button
                                            type="button"
                                            onClick={() => openInlineEditLot(lot)}
                                            className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-[#0B2046] text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                                          >
                                            <Pencil className="w-3.5 h-3.5" />
                                            <span>Editar</span>
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setAdminLotToDelete(lot)}
                                            className="px-2.5 py-1.5 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
                                            title="Excluir produto"
                                          >
                                            <Trash2 className="w-3.5 h-3.5" />
                                            <span>Excluir</span>
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
                    );
                  })}
                </div>
              )}

              {/* Histórico de Vendas Preservado */}
              {selectedCampaign.lotSales && selectedCampaign.lotSales.length > 0 && (
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                  <div className="px-4 sm:px-6 py-3.5 border-b border-slate-200 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-extrabold text-[#0B2046]">
                      Histórico de Vendas de Lotes ({selectedCampaign.lotSales.length})
                    </h3>
                    <span className="text-[11px] font-semibold text-slate-500">
                      Registros preservados mesmo após alterações ou exclusões de lotes
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse tabular-nums text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                          <th className="py-2.5 px-4">Data</th>
                          <th className="py-2.5 px-3">Produto / Lote</th>
                          <th className="py-2.5 px-3">Público</th>
                          <th className="py-2.5 px-3 text-center">Caixas</th>
                          <th className="py-2.5 px-3 text-center">m²</th>
                          <th className="py-2.5 px-4">Cliente / Responsável</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {selectedCampaign.lotSales.map((sale) => (
                          <tr key={sale.id} className="hover:bg-slate-50/70">
                            <td className="py-2.5 px-4 text-slate-600 whitespace-nowrap">
                              {formatDateBR(sale.soldAt)}
                            </td>
                            <td className="py-2.5 px-3 font-bold text-[#0B2046]">
                              {sale.lotDescription}
                            </td>
                            <td className="py-2.5 px-3 text-slate-600">
                              {PROMO_MODALITIES.find((m) => m.id === sale.modality)?.shortLabel ||
                                sale.modality}
                            </td>
                            <td className="py-2.5 px-3 text-center font-bold text-slate-800">
                              {sale.boxesSold}
                            </td>
                            <td className="py-2.5 px-3 text-center font-semibold text-[#0052cc]">
                              {formatSqmBR(sale.sqmSold)}
                            </td>
                            <td className="py-2.5 px-4 text-slate-600">
                              {sale.customerName ? `${sale.customerName} · ` : ''}
                              {sale.soldBy}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* =================================================================== */}
      {/* MODAL: CRIAR / EDITAR CAMPANHA                                      */}
      {/* =================================================================== */}
      {isCampaignModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5"
          onClick={() => setIsCampaignModalOpen(false)}
        >
          <div
            className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-xl max-h-[92vh] overflow-y-auto p-5 sm:p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-lg font-extrabold text-[#0B2046]">
                {editingCampaign ? 'Editar Campanha' : 'Nova Campanha'}
              </h3>
              <button
                type="button"
                onClick={() => setIsCampaignModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveCampaignModal} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                <div className="sm:col-span-8">
                  <label className="block text-xs font-bold text-[#0B2046] mb-1">
                    Nome da Campanha *
                  </label>
                  <input
                    type="text"
                    value={campFormName}
                    onChange={(e) => setCampFormName(e.target.value)}
                    placeholder="Ex: Novembro Black, Feirão de Piso Vinílico..."
                    className="w-full h-10 px-3.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-900 outline-none focus:border-[#0052cc]"
                  />
                </div>

                <div className="sm:col-span-4">
                  <label className="block text-xs font-bold text-[#0B2046] mb-1">Status</label>
                  <select
                    value={campFormStatus}
                    onChange={(e) => setCampFormStatus(e.target.value as PromoCampaignStatus)}
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm font-bold text-slate-800 bg-white outline-none focus:border-[#0052cc]"
                  >
                    <option value="ativa">Ativa</option>
                    <option value="inativa">Inativa</option>
                    <option value="encerrada">Encerrada</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-[#0B2046] mb-1">
                    Data de Início *
                  </label>
                  <input
                    type="date"
                    value={campFormStart}
                    onChange={(e) => setCampFormStart(e.target.value)}
                    className="w-full h-10 px-3.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-800 outline-none focus:border-[#0052cc]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#0B2046] mb-1">
                    Data de Término *
                  </label>
                  <input
                    type="date"
                    value={campFormEnd}
                    onChange={(e) => setCampFormEnd(e.target.value)}
                    className="w-full h-10 px-3.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-800 outline-none focus:border-[#0052cc]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-[#0B2046] mb-1">
                    Texto Superior do Selo (opcional)
                  </label>
                  <input
                    type="text"
                    value={campFormBadgeTop}
                    onChange={(e) => setCampFormBadgeTop(e.target.value)}
                    placeholder="Ex: NOVEMBRO"
                    className="w-full h-10 px-3.5 rounded-xl border border-slate-200 text-sm text-slate-800 outline-none focus:border-[#0052cc]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#0B2046] mb-1">
                    Texto Inferior do Selo (opcional)
                  </label>
                  <input
                    type="text"
                    value={campFormBadgeBottom}
                    onChange={(e) => setCampFormBadgeBottom(e.target.value)}
                    placeholder="Ex: BLACK"
                    className="w-full h-10 px-3.5 rounded-xl border border-slate-200 text-sm text-slate-800 outline-none focus:border-[#0052cc]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-[#0B2046] mb-1">
                    Texto de Validade no Rodapé (opcional)
                  </label>
                  <input
                    type="text"
                    value={campFormValidityText}
                    onChange={(e) => setCampFormValidityText(e.target.value)}
                    placeholder="Ex: CONDIÇÃO VÁLIDA ATÉ 30/11/2026"
                    className="w-full h-10 px-3.5 rounded-xl border border-slate-200 text-xs sm:text-sm text-slate-800 outline-none focus:border-[#0052cc]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#0B2046] mb-1">
                    Condição de Pagamento no Rodapé (opcional)
                  </label>
                  <input
                    type="text"
                    value={campFormPaymentText}
                    onChange={(e) => setCampFormPaymentText(e.target.value)}
                    placeholder="Ex: PAGAMENTO VIA PIX"
                    className="w-full h-10 px-3.5 rounded-xl border border-slate-200 text-xs sm:text-sm text-slate-800 outline-none focus:border-[#0052cc]"
                  />
                </div>
              </div>

              {campFormError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-700">
                  {campFormError}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-100">
                {editingCampaign ? (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleDuplicateCampaign(editingCampaign)}
                      className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                    >
                      Duplicar
                    </button>
                    {editingCampaign.status !== 'encerrada' && (
                      <button
                        type="button"
                        onClick={() => handleEndCampaign(editingCampaign)}
                        className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                      >
                        Encerrar
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setCampaignToDelete(editingCampaign)}
                      className="px-3 py-2 rounded-xl border border-rose-200 text-xs font-bold text-rose-600 hover:bg-rose-50 cursor-pointer"
                    >
                      Excluir
                    </button>
                  </div>
                ) : (
                  <span />
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsCampaignModalOpen(false)}
                    className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="px-5 py-2 rounded-xl bg-[#0052cc] hover:bg-blue-700 text-white text-xs sm:text-sm font-bold cursor-pointer disabled:opacity-50"
                  >
                    {isSaving ? 'Salvando...' : 'Salvar Campanha'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: CONFIRMAR EXCLUSÃO DE CAMPANHA */}
      {campaignToDelete && (
        <div
          className="fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setCampaignToDelete(null)}
        >
          <div
            className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-extrabold text-[#0B2046]">Excluir Campanha</h3>
            <p className="text-sm text-slate-600">
              Tem certeza que deseja excluir a campanha <strong>{campaignToDelete.name}</strong>?
              Todos os produtos e lotes desta campanha serão removidos.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setCampaignToDelete(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isSaving}
                onClick={handleConfirmDeleteCampaign}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold cursor-pointer"
              >
                Confirmar Exclusão
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MODAL: EDITAR LAYOUT DA FOLHA DE DIVULGAÇÃO                         */}
      {/* =================================================================== */}
      {isLayoutModalOpen && selectedCampaign && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5"
          onClick={() => setIsLayoutModalOpen(false)}
        >
          <div
            className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-xl max-h-[92vh] overflow-y-auto p-5 sm:p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-lg font-extrabold text-[#0B2046]">
                Editar Layout da Folha A4
              </h3>
              <button
                type="button"
                onClick={() => setIsLayoutModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveLayoutModal} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-[#0B2046] mb-1">
                    Modelo da Folha
                  </label>
                  <select
                    value={layoutModel}
                    onChange={(e) => setLayoutModel(e.target.value as PromoSheetModel)}
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm font-semibold bg-white outline-none focus:border-[#0052cc]"
                  >
                    {SHEET_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#0B2046] mb-1">
                    Espaçamento das Tabelas
                  </label>
                  <select
                    value={layoutModel === 'compacto_a4' ? 'compacto' : layoutDensity}
                    disabled={layoutModel === 'compacto_a4'}
                    onChange={(e) => setLayoutDensity(e.target.value as 'padrao' | 'compacto')}
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm font-semibold bg-white outline-none focus:border-[#0052cc] disabled:opacity-60"
                  >
                    <option value="padrao">Padrão Oficial A4</option>
                    <option value="compacto">Compacto (caber mais itens)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-[#0B2046] mb-1">
                    Selo — Linha Superior
                  </label>
                  <input
                    type="text"
                    value={layoutBadgeTop}
                    onChange={(e) => setLayoutBadgeTop(e.target.value)}
                    placeholder="Ex: NOVEMBRO"
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm outline-none focus:border-[#0052cc]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#0B2046] mb-1">
                    Selo — Linha Inferior
                  </label>
                  <input
                    type="text"
                    value={layoutBadgeBottom}
                    onChange={(e) => setLayoutBadgeBottom(e.target.value)}
                    placeholder="Ex: BLACK"
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm outline-none focus:border-[#0052cc]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-[#0B2046] mb-1">
                    Texto de Validade no Rodapé
                  </label>
                  <input
                    type="text"
                    value={layoutValidityText}
                    onChange={(e) => setLayoutValidityText(e.target.value)}
                    placeholder="Ex: CONDIÇÃO VÁLIDA ATÉ 30/11/2026"
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm outline-none focus:border-[#0052cc]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#0B2046] mb-1">
                    Condição de Pagamento no Rodapé (Opcional)
                  </label>
                  <input
                    type="text"
                    value={layoutPaymentText}
                    onChange={(e) => setLayoutPaymentText(e.target.value)}
                    placeholder="Ex: PAGAMENTO VIA PIX (deixe vazio para ocultar)"
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm outline-none focus:border-[#0052cc]"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={layoutShowModality}
                    onChange={(e) => setLayoutShowModality(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-[#0052cc]"
                  />
                  <span>Exibir identificação do público (Revenda / Construtora / Cliente Final) na folha</span>
                </label>

                <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={layoutShowSubcategories}
                    onChange={(e) => setLayoutShowSubcategories(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-[#0052cc]"
                  />
                  <span>Exibir separadores de subcategorias na tabela de Piso Vinílico</span>
                </label>
              </div>

              <div className="space-y-2.5 pt-2 border-t border-slate-100">
                <div className="text-xs font-extrabold text-[#0B2046] uppercase">
                  Condições Comerciais após a Validade (Opcional)
                </div>
                <p className="text-[11px] text-slate-500">
                  O texto digitado aparece exatamente como escrito abaixo da barra de validade.
                </p>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">
                    Revenda
                  </label>
                  <textarea
                    rows={2}
                    value={layoutConditionRev}
                    onChange={(e) => setLayoutConditionRev(e.target.value)}
                    placeholder="Digite o texto para a folha de Revenda (opcional)..."
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs outline-none focus:border-[#0052cc] resize-y"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">
                    Construtora
                  </label>
                  <textarea
                    rows={2}
                    value={layoutConditionConst}
                    onChange={(e) => setLayoutConditionConst(e.target.value)}
                    placeholder="Digite o texto para a folha de Construtora (opcional)..."
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs outline-none focus:border-[#0052cc] resize-y"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">
                    Cliente Final
                  </label>
                  <textarea
                    rows={2}
                    value={layoutConditionCF}
                    onChange={(e) => setLayoutConditionCF(e.target.value)}
                    placeholder="Digite o texto para a folha de Cliente Final (opcional)..."
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs outline-none focus:border-[#0052cc] resize-y"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsLayoutModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-5 py-2 rounded-xl bg-[#0052cc] hover:bg-blue-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                >
                  {isSaving ? 'Salvando...' : 'Salvar Layout'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MODAL: SUBCATEGORIAS INTERNAS DE PISO VINÍLICO (OPCIONAIS)          */}
      {/* =================================================================== */}
      {isSubcategoryModalOpen && selectedCampaign && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setIsSubcategoryModalOpen(false)}
        >
          <div
            className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-lg p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-base font-extrabold text-[#0B2046]">
                  Subcategorias Internas (Piso Vinílico)
                </h3>
                <p className="text-xs text-slate-500">
                  Ex: Piso Colado 2 mm, Piso Clicado 5 mm (opcionais)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsSubcategoryModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={newSubName}
                onChange={(e) => setNewSubName(e.target.value)}
                placeholder="Nome da subcategoria..."
                className="flex-1 h-10 px-3 rounded-xl border border-slate-200 text-sm outline-none focus:border-[#0052cc]"
              />
              <button
                type="button"
                onClick={handleAddSubcategory}
                className="px-4 h-10 rounded-xl bg-[#0052cc] hover:bg-blue-700 text-white text-xs font-bold cursor-pointer"
              >
                Adicionar
              </button>
            </div>

            <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-2xl">
              {selectedCampaign.subcategories.filter((s) => s.category === 'piso_vinilico')
                .length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400">
                  Nenhuma subcategoria cadastrada.
                </div>
              ) : (
                selectedCampaign.subcategories
                  .filter((s) => s.category === 'piso_vinilico')
                  .map((sub) => (
                    <div key={sub.id} className="p-3 flex items-center justify-between gap-2">
                      {editingSubId === sub.id ? (
                        <div className="flex-1 flex items-center gap-2">
                          <input
                            type="text"
                            value={editingSubName}
                            onChange={(e) => setEditingSubName(e.target.value)}
                            className="flex-1 h-8 px-2.5 rounded-lg border border-slate-300 text-xs font-semibold"
                          />
                          <button
                            type="button"
                            onClick={() => handleSaveEditSubcategory(sub.id)}
                            className="px-2.5 h-8 rounded-lg bg-emerald-600 text-white text-xs font-bold cursor-pointer"
                          >
                            Salvar
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingSubId(null)}
                            className="px-2 h-8 rounded-lg text-slate-500 text-xs cursor-pointer"
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <>
                          <span className="text-xs font-bold text-[#0B2046]">{sub.name}</span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingSubId(sub.id);
                                setEditingSubName(sub.name);
                              }}
                              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteSubcategory(sub.id)}
                              className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MODAL: CADASTRAR / EDITAR PRODUTO NA CAMPANHA                       */}
      {/* =================================================================== */}
      {isOfferModalOpen && selectedCampaign && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5"
          onClick={() => setIsOfferModalOpen(false)}
        >
          <div
            className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-xl max-h-[92vh] overflow-y-auto p-5 sm:p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-base sm:text-lg font-extrabold text-[#0B2046]">
                  {editingOffer ? 'Editar Produto' : 'Adicionar Produto'}
                </h3>
                <p className="text-xs text-slate-500">
                  Categoria:{' '}
                  <strong>{PROMO_CATEGORIES.find((c) => c.id === offerCategory)?.label}</strong> ·
                  Público: <strong className="text-[#0052cc]">{activeModalityLabel}</strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsOfferModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveOfferModal} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-[#0B2046] mb-1">
                  Descrição do Produto *
                </label>
                <input
                  type="text"
                  value={offerDescription}
                  onChange={(e) => setOfferDescription(e.target.value)}
                  placeholder={
                    offerCategory === 'piso_vinilico'
                      ? 'Ex: Lobato – 2 mm'
                      : offerCategory === 'rodapes'
                      ? 'Ex: Rodapé Branco – 7 cm'
                      : offerCategory === 'ripados'
                      ? 'Ex: Ripado PVC (0,16 x 2,90 m)'
                      : offerCategory === 'teto_vinilico'
                      ? 'Ex: Teto Vinílico Amadeirado – 8 mm'
                      : 'Ex: Cola de Contato – Balde 5 kg'
                  }
                  className="w-full h-10 px-3.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-900 outline-none focus:border-[#0052cc]"
                />
              </div>

              {offerCategory === 'piso_vinilico' &&
                selectedCampaign.subcategories.some((s) => s.category === 'piso_vinilico') && (
                  <div>
                    <label className="block text-xs font-bold text-[#0B2046] mb-1">
                      Subcategoria (Opcional)
                    </label>
                    <select
                      value={offerSubcategoryId}
                      onChange={(e) => setOfferSubcategoryId(e.target.value)}
                      className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm text-slate-800 bg-white outline-none focus:border-[#0052cc]"
                    >
                      <option value="">Sem subcategoria</option>
                      {selectedCampaign.subcategories
                        .filter((s) => s.category === 'piso_vinilico')
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                    </select>
                  </div>
                )}

              {offerCategory === 'piso_vinilico' && (
                <div className="space-y-3 p-4 rounded-2xl bg-slate-50 border border-slate-200">
                  {selectedCampaign.lots.length > 0 && !editingOffer && (
                    <div className="flex items-center gap-2 text-xs font-bold">
                      <button
                        type="button"
                        onClick={() => setOfferLotMode('new')}
                        className={`px-3 py-1.5 rounded-lg cursor-pointer ${
                          offerLotMode === 'new'
                            ? 'bg-[#0052cc] text-white'
                            : 'bg-white border border-slate-200 text-slate-600'
                        }`}
                      >
                        Novo Lote Compartilhado
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setOfferLotMode('existing');
                          const firstLot = selectedCampaign.lots[0];
                          if (firstLot && !offerExistingLotId) {
                            setOfferExistingLotId(firstLot.id);
                          }
                        }}
                        className={`px-3 py-1.5 rounded-lg cursor-pointer ${
                          offerLotMode === 'existing'
                            ? 'bg-[#0052cc] text-white'
                            : 'bg-white border border-slate-200 text-slate-600'
                        }`}
                      >
                        Usar Lote Já Cadastrado
                      </button>
                    </div>
                  )}

                  {offerLotMode === 'existing' && !editingOffer ? (
                    <div>
                      <label className="block text-xs font-bold text-[#0B2046] mb-1">
                        Selecionar Lote *
                      </label>
                      <select
                        value={offerExistingLotId}
                        onChange={(e) => {
                          const lot = selectedCampaign.lots.find((l) => l.id === e.target.value);
                          setOfferExistingLotId(e.target.value);
                          if (lot && !offerDescription.trim()) {
                            setOfferDescription(lot.description);
                          }
                        }}
                        className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm font-semibold bg-white outline-none"
                      >
                        {selectedCampaign.lots.map((l) => {
                          const m = computeLotMetrics(l);
                          return (
                            <option key={l.id} value={l.id}>
                              {l.description} — {m.availableBoxes} cx ({formatSqmBR(m.availableSqm)})
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-bold text-[#0B2046] mb-1">
                            Metragem por Caixa (m²) *
                          </label>
                          <input
                            type="text"
                            value={offerLotSqmPerBox}
                            onChange={(e) => setOfferLotSqmPerBox(e.target.value)}
                            placeholder="Ex: 4,72"
                            className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-white text-sm font-bold outline-none tabular-nums"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-[#0B2046] mb-1">
                            Quantidade de Caixas *
                          </label>
                          <input
                            type="number"
                            min={1}
                            value={offerLotInitialBoxes}
                            onChange={(e) => setOfferLotInitialBoxes(e.target.value)}
                            placeholder="Ex: 6"
                            className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-white text-sm font-bold outline-none tabular-nums"
                          />
                        </div>
                      </div>

                      {parseNumberFlexible(offerLotSqmPerBox) > 0 &&
                        parseNumberFlexible(offerLotInitialBoxes) > 0 && (
                          <div className="text-xs font-semibold text-[#0052cc] tabular-nums">
                            Total calculado:{' '}
                            {formatSqmBR(
                              parseNumberFlexible(offerLotSqmPerBox) *
                                Math.floor(parseNumberFlexible(offerLotInitialBoxes))
                            )}
                          </div>
                        )}
                    </>
                  )}

                  <div>
                    <label className="block text-xs font-bold text-[#0B2046] mb-1">
                      Preço (m²) para {activeModalityLabel} (R$) *
                    </label>
                    <input
                      type="text"
                      value={offerPriceSqm}
                      onChange={(e) => setOfferPriceSqm(e.target.value)}
                      placeholder="Ex: 39,90"
                      className="w-full h-10 px-3.5 rounded-xl border border-slate-200 bg-white text-sm font-extrabold text-[#0052cc] outline-none tabular-nums"
                    />
                  </div>
                </div>
              )}

              {(offerCategory === 'rodapes' || offerCategory === 'ripados') && (
                <div className="space-y-3 p-4 rounded-2xl bg-slate-50 border border-slate-200">
                  {offerCategory === 'ripados' && (
                    <div>
                      <label className="block text-xs font-bold text-[#0B2046] mb-1">
                        Dimensões / Especificação (Opcional)
                      </label>
                      <input
                        type="text"
                        value={offerSpecs}
                        onChange={(e) => setOfferSpecs(e.target.value)}
                        placeholder="Ex: 0,16 x 2,90 m"
                        className="w-full h-9 px-3 rounded-xl border border-slate-200 bg-white text-sm outline-none"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-bold text-[#0B2046] mb-1">
                      Preço ({activeModalityLabel}) (R$) *
                    </label>
                    <input
                      type="text"
                      value={offerPriceNormal}
                      onChange={(e) => setOfferPriceNormal(e.target.value)}
                      placeholder="Ex: 15,90"
                      className="w-full h-10 px-3.5 rounded-xl border border-slate-200 bg-white text-sm font-extrabold text-[#0B2046] outline-none tabular-nums"
                    />
                  </div>

                  <div className="text-xs font-bold text-[#0B2046] pt-1">
                    Descontos Progressivos por Quantidade de Barras
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    {[
                      {
                        label: 'Faixa 1',
                        qty: offerTier1Qty,
                        setQty: setOfferTier1Qty,
                        price: offerTier1Price,
                        setPrice: setOfferTier1Price,
                      },
                      {
                        label: 'Faixa 2',
                        qty: offerTier2Qty,
                        setQty: setOfferTier2Qty,
                        price: offerTier2Price,
                        setPrice: setOfferTier2Price,
                      },
                      {
                        label: 'Faixa 3',
                        qty: offerTier3Qty,
                        setQty: setOfferTier3Qty,
                        price: offerTier3Price,
                        setPrice: setOfferTier3Price,
                      },
                    ].map((tier, i) => (
                      <div
                        key={i}
                        className="p-2.5 rounded-xl bg-white border border-slate-200 space-y-2"
                      >
                        <div className="text-[11px] font-bold text-slate-500 uppercase">
                          {tier.label}
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-400">
                            + Barras
                          </label>
                          <input
                            type="number"
                            min={1}
                            value={tier.qty}
                            onChange={(e) => tier.setQty(e.target.value)}
                            className="w-full h-8 px-2 rounded-lg border border-slate-200 text-xs font-bold tabular-nums"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-400">
                            Preço (R$)
                          </label>
                          <input
                            type="text"
                            value={tier.price}
                            onChange={(e) => tier.setPrice(e.target.value)}
                            placeholder="0,00"
                            className="w-full h-8 px-2 rounded-lg border border-slate-200 text-xs font-extrabold text-[#0052cc] tabular-nums"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {offerCategory === 'teto_vinilico' && (
                <div>
                  <label className="block text-xs font-bold text-[#0B2046] mb-1">
                    Preço (m²) para {activeModalityLabel} (R$) *
                  </label>
                  <input
                    type="text"
                    value={offerPriceSqm}
                    onChange={(e) => setOfferPriceSqm(e.target.value)}
                    placeholder="Ex: 89,90"
                    className="w-full h-10 px-3.5 rounded-xl border border-slate-200 text-sm font-extrabold text-[#0052cc] outline-none tabular-nums"
                  />
                </div>
              )}

              {offerCategory === 'outros' && (
                <div>
                  <label className="block text-xs font-bold text-[#0B2046] mb-1">
                    Preço ({activeModalityLabel}) (R$) *
                  </label>
                  <input
                    type="text"
                    value={offerSimplePrice}
                    onChange={(e) => setOfferSimplePrice(e.target.value)}
                    placeholder="Ex: 189,90"
                    className="w-full h-10 px-3.5 rounded-xl border border-slate-200 text-sm font-extrabold text-[#0052cc] outline-none tabular-nums"
                  />
                </div>
              )}

              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={offerActive}
                  onChange={(e) => setOfferActive(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-[#0052cc]"
                />
                <span>Oferta ativa</span>
              </label>

              {offerFormError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-700">
                  {offerFormError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsOfferModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-5 py-2 rounded-xl bg-[#0052cc] hover:bg-blue-700 text-white text-xs sm:text-sm font-bold cursor-pointer disabled:opacity-50"
                >
                  {isSaving ? 'Salvando...' : 'Salvar Produto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: CONFIGURAR FAIXAS PROGRESSIVAS */}
      {tierHeaderEditCat && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setTierHeaderEditCat(null)}
        >
          <div
            className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-extrabold text-[#0B2046]">
              Configurar Faixas ({tierHeaderEditCat === 'rodapes' ? 'Rodapés' : 'Ripados'})
            </h3>
            <form onSubmit={handleSaveTierQuantities} className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Faixa 1 (+)</label>
                  <input
                    type="number"
                    min={1}
                    value={tierHeaderQ1}
                    onChange={(e) => setTierHeaderQ1(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm font-bold tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Faixa 2 (+)</label>
                  <input
                    type="number"
                    min={1}
                    value={tierHeaderQ2}
                    onChange={(e) => setTierHeaderQ2(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm font-bold tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Faixa 3 (+)</label>
                  <input
                    type="number"
                    min={1}
                    value={tierHeaderQ3}
                    onChange={(e) => setTierHeaderQ3(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm font-bold tabular-nums"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setTierHeaderEditCat(null)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-[#0052cc] text-white text-xs font-bold cursor-pointer"
                >
                  Aplicar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: COPIAR ITEM PARA OUTROS PÚBLICOS */}
      {offerToReplicate && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setOfferToReplicate(null)}
        >
          <div
            className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-extrabold text-[#0B2046]">
              Copiar Produto para Outros Públicos
            </h3>
            <p className="text-xs text-slate-500">
              Produto: <strong>{offerToReplicate.description}</strong>. Os preços podem ser
              editados separadamente em cada público.
            </p>
            <div className="space-y-2">
              {ORDERED_MODALITIES.filter((m) => m.id !== activeModality).map((m) => (
                <label
                  key={m.id}
                  className="flex items-center gap-2.5 p-3 rounded-xl border border-slate-200 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={replicateTargets[m.id]}
                    onChange={(e) =>
                      setReplicateTargets((prev) => ({ ...prev, [m.id]: e.target.checked }))
                    }
                    className="w-4 h-4 rounded border-slate-300 text-[#0052cc]"
                  />
                  <span className="text-xs font-bold text-[#0B2046]">{m.shortLabel}</span>
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOfferToReplicate(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmReplicateOffer}
                className="px-4 py-2 rounded-xl bg-[#0052cc] text-white text-xs font-bold cursor-pointer"
              >
                Copiar Produto
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MODAL: CONFIRMAÇÃO DE EXCLUSÃO DE PRODUTO (PRESERVANDO HISTÓRICO)   */}
      {/* =================================================================== */}
      {adminLotToDelete && selectedCampaign && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setAdminLotToDelete(null)}
        >
          <div
            className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-extrabold text-[#0B2046]">Excluir produto?</h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Tem certeza que deseja excluir o produto{' '}
                  <strong className="text-[#0B2046]">{adminLotToDelete.description}</strong> deste
                  lote?
                </p>
                <p className="text-xs text-slate-500">
                  Os históricos de vendas vinculados a este produto serão preservados integralmente.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setAdminLotToDelete(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isSaving}
                onClick={handleConfirmDeleteLot}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isSaving ? 'Excluindo...' : 'Confirmar Exclusão'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MODAL: CONFIRMAÇÃO DE EXCLUSÃO DE GRUPO DE LOTE (PRESERVA HISTÓRICO)*/}
      {/* =================================================================== */}
      {groupToDelete && selectedCampaign && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setGroupToDelete(null)}
        >
          <div
            className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-extrabold text-[#0B2046]">Excluir lote?</h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Tem certeza que deseja excluir o lote{' '}
                  <strong className="text-[#0B2046]">{groupToDelete.group.name}</strong>
                  {groupToDelete.productCount > 0
                    ? ` e os ${groupToDelete.productCount} ${
                        groupToDelete.productCount === 1 ? 'produto vinculado' : 'produtos vinculados'
                      } a ele`
                    : ''}
                  ?
                </p>
                <p className="text-xs text-slate-500">
                  Os históricos de vendas registrados anteriormente serão preservados integralmente.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setGroupToDelete(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isSaving}
                onClick={handleConfirmDeleteLotGroup}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isSaving ? 'Excluindo...' : 'Confirmar Exclusão'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MODAL: VISUALIZAÇÃO FULLSCREEN DA FOLHA A4                          */}
      {/* =================================================================== */}
      {isSheetPreviewModalOpen && selectedCampaign && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/75 backdrop-blur-xs flex flex-col p-3 sm:p-6 overflow-y-auto"
          onClick={() => setIsSheetPreviewModalOpen(false)}
        >
          <div
            className="max-w-[840px] w-full mx-auto space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-white rounded-2xl px-4 py-3 flex flex-wrap items-center justify-between gap-2 shadow-lg">
              <div className="text-xs sm:text-sm font-extrabold text-[#0B2046] flex items-center gap-2">
                <Calendar className="w-4 h-4 text-[#0052cc]" />
                <span>
                  Folha A4 — {selectedCampaign.name} (
                  {PROMO_MODALITIES.find((m) => m.id === sheetModality)?.shortLabel})
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePrintSheetA4}
                  className="px-3 py-1.5 rounded-lg bg-[#0B2046] text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Imprimir</span>
                </button>
                <button
                  type="button"
                  onClick={handleDownloadSheetPdf}
                  className="px-3 py-1.5 rounded-lg bg-[#0052cc] text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Baixar PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsSheetPreviewModalOpen(false)}
                  className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="overflow-x-auto flex justify-center pb-6">
              <PromocaoFolhaDivulgacao
                id="promocao-folha-a4-preview"
                campaign={selectedCampaign}
                modality={sheetModality}
                includedCategories={sheetSettings.includedCategories}
                sheetModel={sheetSettings.model}
                showModalityLabel={sheetSettings.showModalityLabel}
                showSubcategories={sheetSettings.showSubcategories}
                density={sheetSettings.density}
              />
            </div>
          </div>
        </div>
      )}

      {/* MODAL SELECIONADOR DE PRODUTOS DO CRM */}
      <PromocaoCrmProductPickerModal
        isOpen={isCrmPickerOpen}
        onClose={() => setIsCrmPickerOpen(false)}
        modality={activeModality}
        defaultCategory={activeCategory}
        onSelectCrmProduct={handleSelectFromCrm}
      />
    </div>
  );
};
