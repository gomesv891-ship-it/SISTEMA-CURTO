import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  Bold,
  Check,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  Eraser,
  FileDown,
  FilePlus2,
  Folder,
  FolderInput,
  FolderPlus,
  Highlighter,
  Italic,
  List,
  ListOrdered,
  Loader2,
  Lock,
  NotebookPen,
  Pencil,
  Plus,
  Printer,
  Redo2,
  RefreshCw,
  Save,
  Search,
  Share2,
  SlidersHorizontal,
  Trash2,
  Underline,
  Undo2,
  Users,
  X,
} from 'lucide-react';
import { toPng } from 'html-to-image';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import {
  ANOTACOES_HEADER_PRESETS,
  ANOTACOES_SUPABASE_KEY,
  AnotacaoBlock,
  AnotacaoCategory,
  AnotacaoItem,
  AnotacaoSheetConfig,
  AnotacaoUserKey,
  DEFAULT_SHEET_CONFIG,
  createDefaultCategories,
  createNewAnotacaoDraft,
  deleteAnotacaoInDb,
  fetchAnotacoesDbFromSupabase,
  formatAnotacaoDatePtBr,
  generateUid,
  getAnotacaoUserDisplayName,
  getAnotacaoUserFirstName,
  getNoteChecklistStats,
  getNotePreviewText,
  getOtherAnotacaoUserKey,
  getVisibleNotesForUser,
  normalizeAnotacaoUserKey,
  parseAnotacoesDatabase,
  saveAnotacaoInDb,
  saveUserCategoriesInDb,
  saveUserSheetConfigInDb,
} from '../utils/anotacoesService';
import {
  AnotacaoFolhaDocument,
  HEADER_ICON_OPTIONS,
  HEADER_STYLE_OPTIONS,
  renderHeaderIcon,
} from './AnotacaoFolhaDocument';
import { AnotacaoRichEditor, AnotacaoRichEditorHandle } from './AnotacaoRichEditor';

interface AnotacoesScreenProps {
  currentUserName: string;
}

type HistorySnapshot = {
  title: string;
  blocks: AnotacaoBlock[];
};

const HIGHLIGHT_COLORS = [
  { id: 'yellow', label: 'Amarelo', value: '#FEF08A', border: '#EAB308' },
  { id: 'blue', label: 'Azul Claro', value: '#BAE6FD', border: '#38BDF8' },
  { id: 'green', label: 'Verde Menta', value: '#BBF7D0', border: '#4ADE80' },
  { id: 'pink', label: 'Rosa Suave', value: '#FBCFE8', border: '#F472B6' },
  { id: 'orange', label: 'Pêssego', value: '#FED7AA', border: '#FB923C' },
  { id: 'purple', label: 'Lavanda', value: '#E9D5FF', border: '#C084FC' },
];

const SHARED_SECTION_ID = '__shared_with_me__';

function cloneBlocks(blocks: AnotacaoBlock[]): AnotacaoBlock[] {
  return blocks.map((b) =>
    b.kind === 'checklist'
      ? {
          ...b,
          items: b.items.map((it) => ({ ...it })),
        }
      : { ...b }
  );
}

function cloneNote(note: AnotacaoItem): AnotacaoItem {
  return {
    ...note,
    sharedWith: [...(note.sharedWith || [])],
    blocks: cloneBlocks(note.blocks || []),
  };
}

export const AnotacoesScreen: React.FC<AnotacoesScreenProps> = ({ currentUserName }) => {
  const currentUserKey: AnotacaoUserKey = useMemo(
    () => normalizeAnotacaoUserKey(currentUserName),
    [currentUserName]
  );
  const otherUserKey: AnotacaoUserKey = useMemo(
    () => getOtherAnotacaoUserKey(currentUserKey),
    [currentUserKey]
  );
  const otherFirstName = getAnotacaoUserFirstName(otherUserKey);

  // Estado oficial vindo do Supabase
  const [notes, setNotes] = useState<AnotacaoItem[]>([]);
  const [categoriesByUser, setCategoriesByUser] = useState<
    Record<AnotacaoUserKey, AnotacaoCategory[]>
  >({
    vanessa: createDefaultCategories(),
    jhessica: createDefaultCategories(),
  });
  const [sheetConfigByUser, setSheetConfigByUser] = useState<
    Record<AnotacaoUserKey, AnotacaoSheetConfig>
  >({
    vanessa: { ...DEFAULT_SHEET_CONFIG },
    jhessica: { ...DEFAULT_SHEET_CONFIG },
  });

  // Navegação & seleção
  const [selectedFolderId, setSelectedFolderId] = useState<string>('cat_negociacoes');
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [draftNote, setDraftNote] = useState<AnotacaoItem | null>(null);
  const [isNewDraft, setIsNewDraft] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  // Status & Feedback
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<{
    text: string;
    type: 'success' | 'error';
  } | null>(null);

  // Modais e popovers
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [renamingCategory, setRenamingCategory] = useState<AnotacaoCategory | null>(null);
  const [renameCategoryValue, setRenameCategoryValue] = useState('');
  const [deleteCategoryTarget, setDeleteCategoryTarget] = useState<AnotacaoCategory | null>(null);
  const [deleteNoteTarget, setDeleteNoteTarget] = useState<AnotacaoItem | null>(null);
  const [pendingNavAction, setPendingNavAction] = useState<{
    title: string;
    run: () => void;
  } | null>(null);

  const [isPersonalizeOpen, setIsPersonalizeOpen] = useState(false);
  const [personalizeDraft, setPersonalizeDraft] = useState<AnotacaoSheetConfig>({
    ...DEFAULT_SHEET_CONFIG,
  });
  const [isSavingPersonalize, setIsSavingPersonalize] = useState(false);

  const [isHighlightMenuOpen, setIsHighlightMenuOpen] = useState(false);
  const [isPrintMenuOpen, setIsPrintMenuOpen] = useState(false);
  const [printMode, setPrintMode] = useState<'print-filled' | 'print-blank'>('print-filled');
  const [printMeasureKey, setPrintMeasureKey] = useState(0);
  const [pdfRenderMode, setPdfRenderMode] = useState<'print-filled' | 'print-blank' | null>(null);

  const [activeFormats, setActiveFormats] = useState({
    bold: false,
    italic: false,
    underline: false,
    unorderedList: false,
    orderedList: false,
  });

  // Undo / Redo por nota
  const historyPastRef = useRef<HistorySnapshot[]>([]);
  const historyFutureRef = useRef<HistorySnapshot[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const lastHistoryPushAtRef = useRef<number>(0);

  // Refs para editor e menus
  const editorRef = useRef<AnotacaoRichEditorHandle | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftNoteRef = useRef<AnotacaoItem | null>(null);
  const hasUnsavedRef = useRef(false);
  const isEditingRef = useRef(false);
  const highlightMenuRef = useRef<HTMLDivElement | null>(null);
  const printMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    draftNoteRef.current = draftNote;
  }, [draftNote]);

  useEffect(() => {
    hasUnsavedRef.current = hasUnsavedChanges;
  }, [hasUnsavedChanges]);

  useEffect(() => {
    isEditingRef.current = isEditing;
  }, [isEditing]);

  const showToast = useCallback((text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ text, type });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMessage(null), 3200);
  }, []);

  // Fecha menus suspensos ao clicar fora
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (highlightMenuRef.current && !highlightMenuRef.current.contains(target)) {
        setIsHighlightMenuOpen(false);
      }
      if (printMenuRef.current && !printMenuRef.current.contains(target)) {
        setIsPrintMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const userCategories = useMemo(
    () => categoriesByUser[currentUserKey] || createDefaultCategories(),
    [categoriesByUser, currentUserKey]
  );

  const userSheetConfig = useMemo(
    () => sheetConfigByUser[currentUserKey] || DEFAULT_SHEET_CONFIG,
    [sheetConfigByUser, currentUserKey]
  );

  const { owned: ownedNotes, sharedWithMe: sharedWithMeNotes } = useMemo(
    () => getVisibleNotesForUser(notes, currentUserKey),
    [notes, currentUserKey]
  );

  const visibleNotesTotal = useMemo(
    () => [...ownedNotes, ...sharedWithMeNotes],
    [ownedNotes, sharedWithMeNotes]
  );

  // Mantém folder selecionado válido
  useEffect(() => {
    if (selectedFolderId === SHARED_SECTION_ID) return;
    if (!userCategories.some((c) => c.id === selectedFolderId)) {
      setSelectedFolderId(userCategories[0]?.id || 'cat_negociacoes');
    }
  }, [userCategories, selectedFolderId]);

  const resetHistory = useCallback(() => {
    historyPastRef.current = [];
    historyFutureRef.current = [];
    setCanUndo(false);
    setCanRedo(false);
  }, []);

  const pushHistorySnapshot = useCallback((snapshot: HistorySnapshot, force = false) => {
    const now = Date.now();
    if (!force && now - lastHistoryPushAtRef.current < 550) {
      return;
    }
    const prevTop = historyPastRef.current[historyPastRef.current.length - 1];
    const serializedNew = JSON.stringify(snapshot);
    if (prevTop && JSON.stringify(prevTop) === serializedNew) return;

    historyPastRef.current = [
      ...historyPastRef.current.slice(-39),
      { title: snapshot.title, blocks: cloneBlocks(snapshot.blocks) },
    ];
    historyFutureRef.current = [];
    lastHistoryPushAtRef.current = now;
    setCanUndo(historyPastRef.current.length > 0);
    setCanRedo(false);
  }, []);

  // Carregamento inicial exclusivamente do Supabase
  const loadDatabase = useCallback(
    async (silent = false) => {
      if (!silent) setIsLoading(true);
      setErrorBanner(null);

      const res = await fetchAnotacoesDbFromSupabase();
      if (!res.success) {
        setErrorBanner(res.error || 'Não foi possível carregar as anotações do Supabase.');
        setIsLoading(false);
        return;
      }

      const db = res.db;
      setNotes(db.notes);
      setCategoriesByUser(db.categoriesByUser);
      setSheetConfigByUser(db.sheetConfigByUser);
      setIsLoading(false);

      const { owned, sharedWithMe } = getVisibleNotesForUser(db.notes, currentUserKey);
      const allVisible = [...owned, ...sharedWithMe];

      setSelectedNoteId((prevId) => {
        if (prevId && allVisible.some((n) => n.id === prevId)) return prevId;
        const cats = db.categoriesByUser[currentUserKey] || [];
        const firstOwned = owned.find((n) => n.categoryId === cats[0]?.id) || owned[0];
        if (firstOwned) {
          setSelectedFolderId(firstOwned.categoryId);
          return firstOwned.id;
        }
        if (sharedWithMe[0]) {
          setSelectedFolderId(SHARED_SECTION_ID);
          return sharedWithMe[0].id;
        }
        return null;
      });
    },
    [currentUserKey]
  );

  useEffect(() => {
    loadDatabase(false);
  }, [loadDatabase]);

  // Realtime sync via Supabase (fenix_anotacoes_realtime_updated) e retorno de foco
  useEffect(() => {
    const handleRealtimePayload = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      if (!detail || detail.key !== ANOTACOES_SUPABASE_KEY) return;
      const incomingDb = parseAnotacoesDatabase(detail.data);
      setNotes(incomingDb.notes);
      setCategoriesByUser(incomingDb.categoriesByUser);
      setSheetConfigByUser(incomingDb.sheetConfigByUser);

      const { owned, sharedWithMe } = getVisibleNotesForUser(incomingDb.notes, currentUserKey);
      const visibleAll = [...owned, ...sharedWithMe];

      setDraftNote((prevDraft) => {
        if (!prevDraft) return null;
        if (hasUnsavedRef.current) return prevDraft;
        const match = visibleAll.find((n) => n.id === prevDraft.id);
        return match ? cloneNote(match) : null;
      });

      setSelectedNoteId((prevId) => {
        if (!prevId) return null;
        if (hasUnsavedRef.current) return prevId;
        if (visibleAll.some((n) => n.id === prevId)) return prevId;
        return visibleAll[0]?.id || null;
      });
    };

    const handleWindowFocus = () => {
      if (document.visibilityState === 'visible' && !isEditingRef.current && !hasUnsavedRef.current) {
        loadDatabase(true);
      }
    };

    window.addEventListener('fenix_anotacoes_realtime_updated', handleRealtimePayload);
    window.addEventListener('focus', handleWindowFocus);
    document.addEventListener('visibilitychange', handleWindowFocus);
    return () => {
      window.removeEventListener('fenix_anotacoes_realtime_updated', handleRealtimePayload);
      window.removeEventListener('focus', handleWindowFocus);
      document.removeEventListener('visibilitychange', handleWindowFocus);
    };
  }, [currentUserKey, loadDatabase]);

  // Sincroniza draftNote quando usuário muda a nota selecionada
  useEffect(() => {
    if (isNewDraft) return;
    if (!selectedNoteId) {
      setDraftNote(null);
      setHasUnsavedChanges(false);
      return;
    }
    const found = visibleNotesTotal.find((n) => n.id === selectedNoteId);
    if (found && !hasUnsavedChanges) {
      setDraftNote(cloneNote(found));
    } else if (!found && !hasUnsavedChanges) {
      setDraftNote(null);
    }
  }, [selectedNoteId, visibleNotesTotal, isNewDraft, hasUnsavedChanges]);

  // Executa salvamento manual oficial no Supabase
  const persistNoteNow = useCallback(
    async (noteToSave: AnotacaoItem, silentToast = false): Promise<boolean> => {
      setIsSaving(true);
      setErrorBanner(null);

      const res = await saveAnotacaoInDb(
        noteToSave,
        currentUserName || getAnotacaoUserDisplayName(currentUserKey)
      );

      setIsSaving(false);

      if (!res.success || !res.savedNote) {
        const msg = res.error || 'Erro ao salvar anotação no Supabase.';
        setErrorBanner(msg);
        showToast(msg, 'error');
        return false;
      }

      setNotes(res.db.notes);
      setCategoriesByUser(res.db.categoriesByUser);
      setSheetConfigByUser(res.db.sheetConfigByUser);
      setIsNewDraft(false);
      setHasUnsavedChanges(false);
      hasUnsavedRef.current = false;

      // Atualiza metadados do draft atual sem sobrescrever edições ocorridas durante o await
      setDraftNote((curr) => {
        if (!curr || curr.id !== res.savedNote!.id) return curr;
        return {
          ...curr,
          updatedAt: res.savedNote!.updatedAt,
          updatedBy: res.savedNote!.updatedBy,
          sharedWith: res.savedNote!.sharedWith,
          categoryId: res.savedNote!.categoryId,
        };
      });

      const now = new Date();
      setLastSavedAt(
        `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
      );
      if (!silentToast) {
        showToast('Anotação salva no Supabase!');
      }
      return true;
    },
    [currentUserKey, currentUserName, showToast]
  );

  // Alerta o navegador se houver alterações não salvas antes de fechar/recarregar
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  // Lista filtrada pela pasta selecionada + pesquisa
  const folderFilteredNotes = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();

    // Se houver busca digitada, pesquisa em TODAS as anotações visíveis do usuário (próprias + compartilhadas)
    // Caso contrário, exibe apenas a pasta ou seção selecionada.
    const sourceList = q
      ? visibleNotesTotal
      : selectedFolderId === SHARED_SECTION_ID
      ? sharedWithMeNotes
      : ownedNotes.filter((n) => n.categoryId === selectedFolderId);

    if (!q) return sourceList;

    return sourceList.filter((n) => {
      const inTitle = (n.title || '').toLowerCase().includes(q);
      const inDate = formatAnotacaoDatePtBr(n.date).includes(q) || (n.date || '').includes(q);
      const inBody = getNotePreviewText(n).toLowerCase().includes(q);
      const catName =
        (categoriesByUser[n.ownerKey] || [])
          .find((c) => c.id === n.categoryId)
          ?.name.toLowerCase() || '';
      return inTitle || inDate || inBody || catName.includes(q);
    });
  }, [
    searchTerm,
    visibleNotesTotal,
    selectedFolderId,
    sharedWithMeNotes,
    ownedNotes,
    categoriesByUser,
  ]);

  const runWithUnsavedGuard = (title: string, action: () => void) => {
    if (hasUnsavedRef.current && draftNoteRef.current) {
      setPendingNavAction({ title, run: action });
      return;
    }
    action();
  };

  const applySelectFolder = (folderId: string) => {
    setSelectedFolderId(folderId);
    setSearchTerm('');

    const targetNotes =
      folderId === SHARED_SECTION_ID
        ? sharedWithMeNotes
        : ownedNotes.filter((n) => n.categoryId === folderId);

    setIsNewDraft(false);
    setIsEditing(false);
    setHasUnsavedChanges(false);
    hasUnsavedRef.current = false;
    resetHistory();

    if (targetNotes[0]) {
      setSelectedNoteId(targetNotes[0].id);
      setDraftNote(cloneNote(targetNotes[0]));
    } else {
      setSelectedNoteId(null);
      setDraftNote(null);
    }
  };

  const handleSelectFolder = (folderId: string) => {
    if (folderId === selectedFolderId && !isNewDraft) return;
    runWithUnsavedGuard('Você possui alterações não salvas antes de trocar de pasta.', () =>
      applySelectFolder(folderId)
    );
  };

  const applySelectNote = (note: AnotacaoItem) => {
    setIsNewDraft(false);
    setHasUnsavedChanges(false);
    hasUnsavedRef.current = false;
    setIsEditing(false);
    resetHistory();
    setSelectedNoteId(note.id);
    setDraftNote(cloneNote(note));
    setIsMobileSidebarOpen(false);
  };

  const handleSelectNote = (note: AnotacaoItem) => {
    if (draftNote?.id === note.id) {
      setIsMobileSidebarOpen(false);
      return;
    }
    runWithUnsavedGuard('Você possui alterações não salvas nesta anotação.', () =>
      applySelectNote(note)
    );
  };

  const applyStartNewNote = () => {
    const targetCatId =
      selectedFolderId !== SHARED_SECTION_ID &&
      userCategories.some((c) => c.id === selectedFolderId)
        ? selectedFolderId
        : userCategories[0]?.id || 'cat_outras';

    setSelectedFolderId(targetCatId);
    const blank = createNewAnotacaoDraft(
      currentUserName || getAnotacaoUserDisplayName(currentUserKey),
      currentUserKey,
      targetCatId
    );
    resetHistory();
    setDraftNote(blank);
    setSelectedNoteId(blank.id);
    setIsNewDraft(true);
    setIsEditing(true);
    setHasUnsavedChanges(true);
    hasUnsavedRef.current = true;
    setIsMobileSidebarOpen(false);

    setTimeout(() => {
      editorRef.current?.focusEditor();
    }, 60);
  };

  const handleStartNewNote = () => {
    runWithUnsavedGuard('Você possui alterações não salvas antes de criar uma nova anotação.', () =>
      applyStartNewNote()
    );
  };

  const handleUpdateDraftTitle = (newTitle: string) => {
    if (!draftNote) return;
    pushHistorySnapshot({ title: draftNote.title, blocks: draftNote.blocks });
    const next = { ...draftNote, title: newTitle };
    setDraftNote(next);
    draftNoteRef.current = next;
    setHasUnsavedChanges(true);
    hasUnsavedRef.current = true;
  };

  const handleUpdateDraftDate = (newDate: string) => {
    if (!draftNote) return;
    const next = { ...draftNote, date: newDate };
    setDraftNote(next);
    draftNoteRef.current = next;
    setHasUnsavedChanges(true);
    hasUnsavedRef.current = true;
  };

  const handleUpdateDraftBlocks = useCallback(
    (nextBlocks: AnotacaoBlock[], flushImmediate = false) => {
      setDraftNote((prev) => {
        if (!prev) return prev;
        pushHistorySnapshot({ title: prev.title, blocks: prev.blocks }, flushImmediate);
        const updated = { ...prev, blocks: nextBlocks };
        draftNoteRef.current = updated;
        setHasUnsavedChanges(true);
        hasUnsavedRef.current = true;
        return updated;
      });
    },
    [pushHistorySnapshot]
  );

  const handleUndo = () => {
    if (!draftNote || historyPastRef.current.length === 0) return;
    const past = [...historyPastRef.current];
    const previous = past.pop()!;
    historyPastRef.current = past;
    historyFutureRef.current = [
      ...historyFutureRef.current.slice(-39),
      { title: draftNote.title, blocks: cloneBlocks(draftNote.blocks) },
    ];
    setCanUndo(past.length > 0);
    setCanRedo(true);

    const restored: AnotacaoItem = {
      ...draftNote,
      title: previous.title,
      blocks: cloneBlocks(previous.blocks),
    };
    setDraftNote(restored);
    draftNoteRef.current = restored;
    setHasUnsavedChanges(true);
    hasUnsavedRef.current = true;
  };

  const handleRedo = () => {
    if (!draftNote || historyFutureRef.current.length === 0) return;
    const future = [...historyFutureRef.current];
    const nextSnap = future.pop()!;
    historyFutureRef.current = future;
    historyPastRef.current = [
      ...historyPastRef.current.slice(-39),
      { title: draftNote.title, blocks: cloneBlocks(draftNote.blocks) },
    ];
    setCanUndo(true);
    setCanRedo(future.length > 0);

    const restored: AnotacaoItem = {
      ...draftNote,
      title: nextSnap.title,
      blocks: cloneBlocks(nextSnap.blocks),
    };
    setDraftNote(restored);
    draftNoteRef.current = restored;
    setHasUnsavedChanges(true);
    hasUnsavedRef.current = true;
  };

  const handleMoveNoteToCategory = async (note: AnotacaoItem, targetCategoryId: string) => {
    if (note.ownerKey !== currentUserKey || note.categoryId === targetCategoryId) return;
    const updated = { ...note, categoryId: targetCategoryId };
    if (draftNote?.id === note.id) {
      setDraftNote(updated);
      draftNoteRef.current = updated;
    }
    const ok = await persistNoteNow(updated, true);
    if (ok) {
      const catName = userCategories.find((c) => c.id === targetCategoryId)?.name || 'pasta';
      showToast(`Anotação movida para "${catName}".`);
    }
  };

  const handleToggleShare = async () => {
    if (!draftNote || draftNote.ownerKey !== currentUserKey) return;
    const currentlyShared = (draftNote.sharedWith || []).includes(otherUserKey);
    const nextSharedWith: AnotacaoUserKey[] = currentlyShared ? [] : [otherUserKey];
    const updated: AnotacaoItem = {
      ...draftNote,
      sharedWith: nextSharedWith,
    };
    setDraftNote(updated);
    draftNoteRef.current = updated;
    const ok = await persistNoteNow(updated, true);
    if (ok) {
      showToast(
        currentlyShared
          ? `Compartilhamento com ${otherFirstName} removido.`
          : `Anotação compartilhada em tempo real com ${otherFirstName}!`
      );
    }
  };

  const handleDeleteNoteConfirmed = async () => {
    if (!deleteNoteTarget) return;
    const target = deleteNoteTarget;

    if (isNewDraft && draftNote?.id === target.id && !notes.some((n) => n.id === target.id)) {
      setDeleteNoteTarget(null);
      setIsNewDraft(false);
      setIsEditing(false);
      setHasUnsavedChanges(false);
      setDraftNote(null);
      setSelectedNoteId(null);
      return;
    }

    setIsDeleting(true);
    const res = await deleteAnotacaoInDb(
      target.id,
      currentUserName || getAnotacaoUserDisplayName(currentUserKey)
    );
    setIsDeleting(false);
    setDeleteNoteTarget(null);

    if (!res.success) {
      showToast(res.error || 'Erro ao excluir anotação.', 'error');
      return;
    }

    setNotes(res.db.notes);
    setCategoriesByUser(res.db.categoriesByUser);
    setSheetConfigByUser(res.db.sheetConfigByUser);

    if (selectedNoteId === target.id || draftNote?.id === target.id) {
      setIsNewDraft(false);
      setIsEditing(false);
      setHasUnsavedChanges(false);
      resetHistory();
      const { owned, sharedWithMe } = getVisibleNotesForUser(res.db.notes, currentUserKey);
      const nextList =
        selectedFolderId === SHARED_SECTION_ID
          ? sharedWithMe
          : owned.filter((n) => n.categoryId === selectedFolderId);
      setSelectedNoteId(nextList[0]?.id || null);
      setDraftNote(nextList[0] ? cloneNote(nextList[0]) : null);
    }

    showToast('Anotação excluída com sucesso.');
  };

  // CRUD de Categorias (Pastas independentes por usuária)
  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newCategoryName.trim();
    if (!name) return;
    if (userCategories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      showToast('Já existe uma pasta com esse nome.', 'error');
      return;
    }

    const newCat: AnotacaoCategory = {
      id: generateUid('cat'),
      name,
      order: userCategories.length,
      createdAt: new Date().toISOString(),
    };

    const nextList = [...userCategories, newCat];
    const res = await saveUserCategoriesInDb(
      currentUserKey,
      nextList,
      currentUserName || getAnotacaoUserDisplayName(currentUserKey)
    );

    if (!res.success) {
      showToast(res.error || 'Não foi possível criar a categoria.', 'error');
      return;
    }

    setCategoriesByUser(res.db.categoriesByUser);
    setNewCategoryName('');
    setIsCreatingCategory(false);
    setSelectedFolderId(newCat.id);
    showToast(`Categoria "${name}" criada!`);
  };

  const handleRenameCategorySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renamingCategory) return;
    const trimmed = renameCategoryValue.trim();
    if (!trimmed) return;

    const nextList = userCategories.map((c) =>
      c.id === renamingCategory.id ? { ...c, name: trimmed } : c
    );
    const res = await saveUserCategoriesInDb(
      currentUserKey,
      nextList,
      currentUserName || getAnotacaoUserDisplayName(currentUserKey)
    );
    if (!res.success) {
      showToast(res.error || 'Erro ao renomear categoria.', 'error');
      return;
    }
    setCategoriesByUser(res.db.categoriesByUser);
    setRenamingCategory(null);
    setRenameCategoryValue('');
    showToast('Categoria renomeada!');
  };

  const handleDeleteCategoryConfirmed = async () => {
    if (!deleteCategoryTarget) return;
    if (userCategories.length <= 1) {
      showToast('Mantenha pelo menos uma categoria para suas anotações.', 'error');
      setDeleteCategoryTarget(null);
      return;
    }

    const remaining = userCategories
      .filter((c) => c.id !== deleteCategoryTarget.id)
      .map((c, idx) => ({ ...c, order: idx }));

    const fallbackId =
      remaining.find((c) => c.id === 'cat_outras')?.id || remaining[0].id;

    const res = await saveUserCategoriesInDb(
      currentUserKey,
      remaining,
      currentUserName || getAnotacaoUserDisplayName(currentUserKey),
      fallbackId
    );
    setDeleteCategoryTarget(null);

    if (!res.success) {
      showToast(res.error || 'Erro ao excluir categoria.', 'error');
      return;
    }

    setNotes(res.db.notes);
    setCategoriesByUser(res.db.categoriesByUser);
    if (selectedFolderId === deleteCategoryTarget.id) {
      setSelectedFolderId(fallbackId);
    }
    showToast('Categoria excluída. Anotações preservadas.');
  };

  // Personalização da Folha Impressa
  const handleOpenPersonalize = () => {
    setPersonalizeDraft({ ...userSheetConfig });
    setIsPersonalizeOpen(true);
  };

  const handleSavePersonalize = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingPersonalize(true);
    const res = await saveUserSheetConfigInDb(
      currentUserKey,
      personalizeDraft,
      currentUserName || getAnotacaoUserDisplayName(currentUserKey)
    );
    setIsSavingPersonalize(false);

    if (!res.success) {
      showToast(res.error || 'Erro ao salvar personalização da folha.', 'error');
      return;
    }

    setSheetConfigByUser(res.db.sheetConfigByUser);
    setIsPersonalizeOpen(false);
    showToast('Personalização da folha salva no Supabase!');
  };

  // Impressão A4 (Modo A: Anotação Preenchida | Modo B: Folha em Branco)
  const triggerPrintA4 = (mode: 'print-filled' | 'print-blank') => {
    setIsPrintMenuOpen(false);
    setPrintMode(mode);
    setPrintMeasureKey((k) => k + 1);

    const styleId = 'fenix-anotacao-print-a4-portrait';
    let styleTag = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!styleTag) {
      styleTag = document.createElement('style');
      styleTag.id = styleId;
      document.head.appendChild(styleTag);
    }
    styleTag.textContent = `
      @media print {
        @page {
          size: A4 portrait;
          margin: 0mm;
        }
        * {
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
      }
    `;

    const cleanup = () => {
      document.body.classList.remove('printing-anotacao-a4');
      document.getElementById(styleId)?.remove();
      window.removeEventListener('afterprint', cleanup);
    };

    document.body.classList.add('printing-anotacao-a4');
    window.addEventListener('afterprint', cleanup);

    setTimeout(() => {
      window.print();
      setTimeout(cleanup, 1500);
    }, 180);
  };

  // Exportação PDF A4 com suporte a múltiplas páginas sem cortes
  const handleDownloadPdf = async (mode: 'print-filled' | 'print-blank') => {
    setIsPrintMenuOpen(false);
    setPdfRenderMode(mode);
    setIsExporting(true);
    showToast(mode === 'print-blank' ? 'Gerando PDF da folha em branco...' : 'Gerando PDF A4...');

    // Aguarda montagem do stage off-screen e renderização de imagens/SVG
    await new Promise((r) => setTimeout(r, 180));

    try {
      const element = document.getElementById('fenix-anotacao-pdf-stage');
      if (!element) {
        throw new Error('Estrutura de impressão não encontrada.');
      }

      const width = element.offsetWidth || 794;
      const height = element.scrollHeight || element.offsetHeight || 1122;

      let canvas: HTMLCanvasElement;
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
        const img = new Image();
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = reject;
          img.src = dataUrl;
        });
        canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || width * 2;
        canvas.height = img.naturalHeight || height * 2;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Contexto canvas indisponível.');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
      } catch {
        canvas = await html2canvas(element, {
          scale: 2,
          useCORS: true,
          allowTaint: true,
          backgroundColor: '#ffffff',
          logging: false,
          width,
          height,
        });
      }

      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      });

      const pageW = pdf.internal.pageSize.getWidth(); // 210mm
      const pageH = pdf.internal.pageSize.getHeight(); // 297mm

      if (mode === 'print-blank') {
        const imgData = canvas.toDataURL('image/png');
        pdf.addImage(imgData, 'PNG', 0, 0, pageW, pageH, undefined, 'FAST');
        pdf.save('Fenix-World-Folha-Anotacao-Em-Branco.pdf');
        showToast('PDF da folha em branco baixado!');
        return;
      }

      // Paginação automática para anotações longas sem distorcer ou cortar o layout
      const pxPerPage = Math.floor((canvas.width * pageH) / pageW);
      if (canvas.height <= pxPerPage + 28) {
        const fitScale = Math.min(pageW / canvas.width, pageH / canvas.height);
        const renderW = canvas.width * fitScale;
        const renderH = canvas.height * fitScale;
        pdf.addImage(
          canvas.toDataURL('image/png'),
          'PNG',
          (pageW - renderW) / 2,
          0,
          renderW,
          renderH,
          undefined,
          'FAST'
        );
      } else {
        let offsetY = 0;
        let pageIndex = 0;
        while (offsetY < canvas.height) {
          const sliceHeight = Math.min(pxPerPage, canvas.height - offsetY);
          const pageCanvas = document.createElement('canvas');
          pageCanvas.width = canvas.width;
          pageCanvas.height = sliceHeight;
          const pCtx = pageCanvas.getContext('2d');
          if (pCtx) {
            pCtx.fillStyle = '#FFFFFF';
            pCtx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
            pCtx.drawImage(
              canvas,
              0,
              offsetY,
              canvas.width,
              sliceHeight,
              0,
              0,
              canvas.width,
              sliceHeight
            );
          }

          if (pageIndex > 0) pdf.addPage();
          const renderMmH = (sliceHeight * pageW) / canvas.width;
          pdf.addImage(
            pageCanvas.toDataURL('image/png'),
            'PNG',
            0,
            0,
            pageW,
            renderMmH,
            undefined,
            'FAST'
          );
          offsetY += sliceHeight;
          pageIndex += 1;
        }
      }

      const safeTitle = (draftNote?.title || 'Anotacao')
        .trim()
        .replace(/[^a-zA-Z0-9À-ÿ_-]+/g, '-')
        .slice(0, 48);
      pdf.save(`Fenix-World-${safeTitle || 'Anotacao'}.pdf`);
      showToast('PDF da anotação baixado com sucesso!');
    } catch (err) {
      console.error('Erro ao gerar PDF da anotação:', err);
      showToast('Não foi possível gerar o PDF. Use a opção Imprimir.', 'error');
    } finally {
      setPdfRenderMode(null);
      setIsExporting(false);
    }
  };

  // Configuração da folha a exibir conforme dona da nota ou usuária atual
  const activeSheetConfig: AnotacaoSheetConfig = useMemo(() => {
    return sheetConfigByUser[currentUserKey] || DEFAULT_SHEET_CONFIG;
  }, [sheetConfigByUser, currentUserKey]);

  const isOwnedByCurrentUser = draftNote ? draftNote.ownerKey === currentUserKey : true;
  const isSharedWithOther = draftNote ? (draftNote.sharedWith || []).includes(otherUserKey) : false;

  const printPortalElement =
    typeof document !== 'undefined'
      ? createPortal(
          <div id="fenix-anotacao-print-root">
            {printMode === 'print-blank' ? (
              <AnotacaoFolhaDocument
                mode="print-blank"
                sheetConfig={activeSheetConfig}
                containerId="anotacao-print-blank-sheet"
                refreshTrigger={printMeasureKey}
              />
            ) : draftNote ? (
              <AnotacaoFolhaDocument
                mode="print-filled"
                title={draftNote.title}
                date={draftNote.date}
                sheetConfig={activeSheetConfig}
                containerId="anotacao-print-filled-sheet"
                refreshTrigger={[draftNote.blocks, printMeasureKey]}
              >
                <AnotacaoRichEditor
                  noteId={draftNote.id}
                  blocks={draftNote.blocks}
                  onChangeBlocks={() => {}}
                  isEditing={false}
                  readOnly
                />
              </AnotacaoFolhaDocument>
            ) : (
              <AnotacaoFolhaDocument
                mode="print-blank"
                sheetConfig={activeSheetConfig}
                containerId="anotacao-print-fallback-blank"
                refreshTrigger={printMeasureKey}
              />
            )}
          </div>,
          document.body
        )
      : null;

  return (
    <div className="w-full max-w-[1760px] mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-6">
      {/* Portal invisível na tela para impressão A4 nativa limpa */}
      {printPortalElement}

      {/* Palco off-screen para captura de PDF fiel A4 */}
      {pdfRenderMode && (
        <div
          style={{
            position: 'fixed',
            left: '-99999px',
            top: 0,
            zIndex: -1,
            pointerEvents: 'none',
            backgroundColor: '#FFFFFF',
          }}
        >
          {pdfRenderMode === 'print-blank' ? (
            <AnotacaoFolhaDocument
              mode="print-blank"
              sheetConfig={activeSheetConfig}
              containerId="fenix-anotacao-pdf-stage"
            />
          ) : draftNote ? (
            <AnotacaoFolhaDocument
              mode="print-filled"
              title={draftNote.title}
              date={draftNote.date}
              sheetConfig={activeSheetConfig}
              containerId="fenix-anotacao-pdf-stage"
            >
              <AnotacaoRichEditor
                noteId={draftNote.id}
                blocks={draftNote.blocks}
                onChangeBlocks={() => {}}
                isEditing={false}
                readOnly
              />
            </AnotacaoFolhaDocument>
          ) : null}
        </div>
      )}

      {/* Toast flutuante */}
      {toastMessage && (
        <div
          className={`fixed bottom-5 right-5 z-50 flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium border no-print ${
            toastMessage.type === 'error'
              ? 'bg-red-50 text-red-700 border-red-200'
              : 'bg-[#072B54] text-white border-blue-800'
          }`}
        >
          {toastMessage.type === 'error' ? (
            <AlertTriangle className="w-4 h-4 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 shrink-0 text-sky-300" />
          )}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* Cabeçalho principal do módulo */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3.5 sm:p-4 mb-4 no-print">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#0B3F7D] text-white flex items-center justify-center shrink-0">
              <NotebookPen className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg sm:text-xl font-bold text-slate-900">
                  Caderno Digital — Anotações Fênix World
                </h2>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold bg-blue-50 text-[#0B3F7D] border border-blue-200 rounded-md">
                  <Lock className="w-3 h-3" />
                  Caderno de {getAnotacaoUserFirstName(currentUserKey)}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Pastas independentes, editor contínuo com destaques e checklists, folha A4 e compartilhamento seletivo com {otherFirstName}.
              </p>
            </div>
          </div>

          {/* Ações principais no topo */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 sm:flex-initial min-w-[200px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Pesquisar anotações..."
                className="w-full sm:w-56 pl-9 pr-7 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-[#0B3F7D]"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={handleStartNewNote}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-[#0B3F7D] text-white hover:bg-[#083062] shadow-sm transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Nova</span>
            </button>

            <button
              type="button"
              onClick={handleOpenPersonalize}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200 transition-colors cursor-pointer"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-[#0B3F7D]" />
              <span>Personalizar Folha</span>
            </button>

            {/* Menu Imprimir / Baixar PDF (Preenchida vs Folha em Branco) */}
            <div className="relative" ref={printMenuRef}>
              <button
                type="button"
                disabled={isExporting}
                onClick={() => setIsPrintMenuOpen((prev) => !prev)}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-white text-[#0B3F7D] border border-[#0B3F7D]/40 hover:bg-blue-50 transition-colors cursor-pointer disabled:opacity-60"
              >
                {isExporting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Printer className="w-3.5 h-3.5" />
                )}
                <span>Imprimir / PDF</span>
                <ChevronDown className="w-3.5 h-3.5" />
              </button>

              {isPrintMenuOpen && (
                <div className="absolute right-0 mt-1.5 w-72 bg-white rounded-xl border border-slate-200 shadow-xl z-40 py-1.5 text-left">
                  <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Anotação Atual Preenchida
                  </div>
                  <button
                    type="button"
                    disabled={!draftNote}
                    onClick={() => triggerPrintA4('print-filled')}
                    className="w-full px-3 py-2 text-xs font-medium text-slate-700 hover:bg-blue-50 hover:text-[#0B3F7D] flex items-center gap-2.5 disabled:opacity-40 cursor-pointer"
                  >
                    <Printer className="w-4 h-4 text-[#0B3F7D]" />
                    <span>Imprimir Anotação (A4)</span>
                  </button>
                  <button
                    type="button"
                    disabled={!draftNote}
                    onClick={() => handleDownloadPdf('print-filled')}
                    className="w-full px-3 py-2 text-xs font-medium text-slate-700 hover:bg-blue-50 hover:text-[#0B3F7D] flex items-center gap-2.5 disabled:opacity-40 cursor-pointer"
                  >
                    <FileDown className="w-4 h-4 text-[#0B3F7D]" />
                    <span>Baixar PDF da Anotação</span>
                  </button>

                  <div className="my-1 border-t border-slate-100" />
                  <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Folha em Branco para Caneta
                  </div>
                  <button
                    type="button"
                    onClick={() => triggerPrintA4('print-blank')}
                    className="w-full px-3 py-2 text-xs font-medium text-slate-700 hover:bg-blue-50 hover:text-[#0B3F7D] flex items-center gap-2.5 cursor-pointer"
                  >
                    <FilePlus2 className="w-4 h-4 text-slate-600" />
                    <span>Imprimir Folha em Branco (A4)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownloadPdf('print-blank')}
                    className="w-full px-3 py-2 text-xs font-medium text-slate-700 hover:bg-blue-50 hover:text-[#0B3F7D] flex items-center gap-2.5 cursor-pointer"
                  >
                    <FileDown className="w-4 h-4 text-slate-600" />
                    <span>Baixar PDF Folha em Branco</span>
                  </button>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => loadDatabase(false)}
              title="Atualizar dados do Supabase"
              className="inline-flex items-center justify-center p-2 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Barra de erro Supabase se houver */}
        {errorBanner && (
          <div className="mt-3 p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{errorBanner}</span>
            </div>
            <button
              type="button"
              onClick={() => loadDatabase(false)}
              className="px-2.5 py-1 rounded bg-white border border-red-200 font-semibold hover:bg-red-100"
            >
              Tentar novamente
            </button>
          </div>
        )}
      </div>

      {/* Botão mobile para abrir pastas/anotações */}
      <div className="lg:hidden mb-3 flex items-center justify-between gap-2 no-print">
        <button
          type="button"
          onClick={() => setIsMobileSidebarOpen((v) => !v)}
          className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg bg-white border border-slate-200 text-slate-700 shadow-sm"
        >
          <Folder className="w-4 h-4 text-[#0B3F7D]" />
          <span>
            {isMobileSidebarOpen
              ? 'Ocultar Pastas e Anotações'
              : `Pastas & Anotações (${folderFilteredNotes.length})`}
          </span>
        </button>
        {draftNote && (
          <span className="text-xs text-slate-500 truncate max-w-[55%]">
            {draftNote.title || 'Sem título'}
          </span>
        )}
      </div>

      {/* LAYOUT PRINCIPAL: SIDEBAR (PASTAS + LISTA) + FOLHA DE EDIÇÃO */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* PAINEL ESQUERDO: PASTAS + LISTA DE ANOTAÇÕES */}
        <div
          className={`lg:col-span-3 space-y-3 no-print ${
            isMobileSidebarOpen ? 'block' : 'hidden lg:block'
          }`}
        >
          {/* Pastas / Categorias Independentes */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-3.5 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                Pastas de {getAnotacaoUserFirstName(currentUserKey)}
              </span>
              <button
                type="button"
                onClick={() => setIsCreatingCategory((v) => !v)}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0B3F7D] hover:text-blue-900 cursor-pointer"
              >
                <FolderPlus className="w-3.5 h-3.5" />
                <span>Nova pasta</span>
              </button>
            </div>

            {isCreatingCategory && (
              <form
                onSubmit={handleCreateCategory}
                className="p-2.5 bg-blue-50/70 border-b border-blue-100 flex items-center gap-1.5"
              >
                <input
                  type="text"
                  autoFocus
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="Nome da categoria..."
                  className="flex-1 min-w-0 px-2.5 py-1.5 text-xs bg-white border border-blue-200 rounded-md focus:outline-none focus:border-[#0B3F7D]"
                />
                <button
                  type="submit"
                  className="px-2.5 py-1.5 text-xs font-semibold bg-[#0B3F7D] text-white rounded-md hover:bg-[#083062]"
                >
                  Criar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsCreatingCategory(false);
                    setNewCategoryName('');
                  }}
                  className="p-1.5 text-slate-500 hover:text-slate-700"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </form>
            )}

            <div className="p-2 space-y-0.5 max-h-64 overflow-y-auto">
              {userCategories.map((cat) => {
                const count = ownedNotes.filter((n) => n.categoryId === cat.id).length;
                const active = selectedFolderId === cat.id && !searchTerm.trim();

                if (renamingCategory?.id === cat.id) {
                  return (
                    <form
                      key={cat.id}
                      onSubmit={handleRenameCategorySubmit}
                      className="flex items-center gap-1 p-1 bg-blue-50 rounded-lg"
                    >
                      <input
                        type="text"
                        autoFocus
                        value={renameCategoryValue}
                        onChange={(e) => setRenameCategoryValue(e.target.value)}
                        className="flex-1 min-w-0 px-2 py-1 text-xs bg-white border border-blue-300 rounded focus:outline-none"
                      />
                      <button
                        type="submit"
                        className="p-1 text-emerald-700 hover:bg-emerald-100 rounded"
                        title="Confirmar"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setRenamingCategory(null)}
                        className="p-1 text-slate-500 hover:bg-slate-200 rounded"
                        title="Cancelar"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </form>
                  );
                }

                return (
                  <div
                    key={cat.id}
                    className={`group flex items-center justify-between px-2.5 py-2 rounded-lg text-xs transition-colors ${
                      active
                        ? 'bg-[#0B3F7D] text-white font-semibold'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleSelectFolder(cat.id)}
                      className="flex-1 min-w-0 flex items-center gap-2 text-left cursor-pointer"
                    >
                      <Folder
                        className={`w-3.5 h-3.5 shrink-0 ${
                          active ? 'text-sky-200' : 'text-[#0B3F7D]'
                        }`}
                      />
                      <span className="truncate">{cat.name}</span>
                    </button>

                    <div className="flex items-center gap-1 shrink-0 ml-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenamingCategory(cat);
                          setRenameCategoryValue(cat.name);
                        }}
                        title="Renomear pasta"
                        className={`opacity-0 group-hover:opacity-100 p-1 rounded transition-opacity ${
                          active ? 'hover:bg-white/15 text-white' : 'hover:bg-slate-200 text-slate-500'
                        }`}
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      {userCategories.length > 1 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteCategoryTarget(cat);
                          }}
                          title="Excluir pasta"
                          className={`opacity-0 group-hover:opacity-100 p-1 rounded transition-opacity ${
                            active ? 'hover:bg-white/15 text-red-200' : 'hover:bg-red-50 text-red-500'
                          }`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                      <span
                        className={`px-1.5 py-0.5 text-[10px] font-bold rounded ${
                          active
                            ? 'bg-white/20 text-white'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {count}
                      </span>
                    </div>
                  </div>
                );
              })}

              {/* Seção Compartilhadas Comigo */}
              <div className="pt-1.5 mt-1.5 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => handleSelectFolder(SHARED_SECTION_ID)}
                  className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs transition-colors cursor-pointer ${
                    selectedFolderId === SHARED_SECTION_ID && !searchTerm.trim()
                      ? 'bg-[#0B3F7D] text-white font-semibold'
                      : 'text-slate-700 hover:bg-blue-50/70'
                  }`}
                >
                  <span className="flex items-center gap-2 truncate">
                    <Users
                      className={`w-3.5 h-3.5 shrink-0 ${
                        selectedFolderId === SHARED_SECTION_ID && !searchTerm.trim()
                          ? 'text-sky-200'
                          : 'text-[#0B3F7D]'
                      }`}
                    />
                    <span className="truncate">Compartilhadas comigo</span>
                  </span>
                  <span
                    className={`px-1.5 py-0.5 text-[10px] font-bold rounded ${
                      selectedFolderId === SHARED_SECTION_ID && !searchTerm.trim()
                        ? 'bg-white/20 text-white'
                        : sharedWithMeNotes.length > 0
                        ? 'bg-blue-100 text-[#0B3F7D]'
                        : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {sharedWithMeNotes.length}
                  </span>
                </button>
              </div>
            </div>
          </div>

          {/* Lista de Anotações da Pasta Selecionada */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-3.5 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-600 truncate">
                {searchTerm.trim()
                  ? `Resultados (${folderFilteredNotes.length})`
                  : selectedFolderId === SHARED_SECTION_ID
                  ? `Compartilhadas por ${otherFirstName}`
                  : userCategories.find((c) => c.id === selectedFolderId)?.name || 'Anotações'}
              </span>
              <span className="text-[11px] font-semibold text-slate-400">
                {folderFilteredNotes.length}
              </span>
            </div>

            {isLoading ? (
              <div className="p-8 text-center text-xs text-slate-500 flex flex-col items-center gap-2">
                <Loader2 className="w-5 h-5 animate-spin text-[#0B3F7D]" />
                <span>Carregando do Supabase...</span>
              </div>
            ) : folderFilteredNotes.length === 0 ? (
              <div className="p-6 text-center space-y-2">
                <p className="text-xs text-slate-500">
                  {searchTerm.trim()
                    ? 'Nenhuma anotação encontrada para essa busca.'
                    : selectedFolderId === SHARED_SECTION_ID
                    ? `${otherFirstName} ainda não compartilhou nenhuma anotação com você.`
                    : 'Nenhuma anotação nesta pasta ainda.'}
                </p>
                {selectedFolderId !== SHARED_SECTION_ID && !searchTerm.trim() && (
                  <button
                    type="button"
                    onClick={handleStartNewNote}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-[#0B3F7D] hover:underline cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Criar primeira anotação</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="divide-y divide-slate-100 max-h-[440px] overflow-y-auto">
                {folderFilteredNotes.map((note) => {
                  const isActive = draftNote?.id === note.id;
                  const preview = getNotePreviewText(note);
                  const stats = getNoteChecklistStats(note);
                  const sharedBadge =
                    note.ownerKey !== currentUserKey
                      ? `De ${getAnotacaoUserFirstName(note.ownerKey)}`
                      : note.sharedWith.length > 0
                      ? `Compartilhada (${otherFirstName})`
                      : null;

                  return (
                    <div
                      key={note.id}
                      onClick={() => handleSelectNote(note)}
                      className={`p-3 cursor-pointer transition-colors ${
                        isActive
                          ? 'bg-blue-50/90 border-l-4 border-l-[#0B3F7D]'
                          : 'hover:bg-slate-50 border-l-4 border-l-transparent'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="text-xs font-bold text-slate-800 line-clamp-1">
                          {note.title?.trim() || 'Sem título'}
                        </h4>
                        <span className="text-[10px] font-medium text-slate-400 shrink-0">
                          {formatAnotacaoDatePtBr(note.date)}
                        </span>
                      </div>

                      <p className="text-[11px] text-slate-500 line-clamp-2 mt-1 min-h-[16px]">
                        {preview || 'Folha em branco — clique para escrever'}
                      </p>

                      <div className="flex items-center justify-between gap-2 mt-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {sharedBadge && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-100 text-[#0B3F7D] text-[10px] font-semibold">
                              <Share2 className="w-2.5 h-2.5" />
                              {sharedBadge}
                            </span>
                          )}
                          {stats.total > 0 && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-medium">
                              <CheckSquare className="w-2.5 h-2.5 text-[#0B3F7D]" />
                              {stats.done}/{stats.total}
                            </span>
                          )}
                        </div>

                        {note.ownerKey === currentUserKey && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteNoteTarget(note);
                            }}
                            title="Excluir anotação"
                            className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ÁREA PRINCIPAL: CONTROLES DA NOTA + BARRA DE EDIÇÃO + FOLHA OFICIAL FÊNIX */}
        <div className="lg:col-span-9 space-y-3 min-w-0">
          {!draftNote ? (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-10 text-center space-y-4 no-print">
              <div className="w-14 h-14 rounded-2xl bg-blue-50 text-[#0B3F7D] flex items-center justify-center mx-auto">
                <NotebookPen className="w-7 h-7" />
              </div>
              <div className="max-w-md mx-auto space-y-1.5">
                <h3 className="text-base font-bold text-slate-800">
                  Selecione ou crie uma anotação
                </h3>
                <p className="text-xs text-slate-500">
                  Escreva livremente na folha oficial da Fênix World, destaque pontos importantes, insira checklists opcionais e imprima ou salve em PDF A4.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2.5">
                <button
                  type="button"
                  onClick={handleStartNewNote}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-[#0B3F7D] text-white hover:bg-[#083062] cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Nova Anotação</span>
                </button>
                <button
                  type="button"
                  onClick={() => triggerPrintA4('print-blank')}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  <Printer className="w-4 h-4 text-[#0B3F7D]" />
                  <span>Imprimir Folha em Branco</span>
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Barra de Contexto da Anotação (Mover pasta, Compartilhar Vanessa <-> Jhessica, Auto-save) */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2.5 no-print">
                <div className="flex flex-wrap items-center gap-2">
                  {/* Seletor de Pasta (apenas para dona da anotação) */}
                  {isOwnedByCurrentUser ? (
                    <div className="inline-flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5">
                      <FolderInput className="w-3.5 h-3.5 text-[#0B3F7D]" />
                      <select
                        value={draftNote.categoryId}
                        onChange={(e) => handleMoveNoteToCategory(draftNote, e.target.value)}
                        className="bg-transparent text-xs font-semibold text-slate-700 focus:outline-none cursor-pointer"
                        title="Mover anotação para outra categoria"
                      >
                        {userCategories.map((cat) => (
                          <option key={cat.id} value={cat.id}>
                            Pasta: {cat.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-50 border border-blue-200 text-xs font-semibold text-[#0B3F7D]">
                      <Users className="w-3.5 h-3.5" />
                      <span>Compartilhada por {getAnotacaoUserFirstName(draftNote.ownerKey)}</span>
                    </span>
                  )}

                  {/* Toggle de Compartilhamento Bidirecional (Vanessa <-> Jhessica) */}
                  {isOwnedByCurrentUser && (
                    <button
                      type="button"
                      onClick={handleToggleShare}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                        isSharedWithOther
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <Share2 className="w-3.5 h-3.5" />
                      <span>
                        {isSharedWithOther
                          ? `Compartilhada com ${otherFirstName}`
                          : `Compartilhar com ${otherFirstName}`}
                      </span>
                    </button>
                  )}
                </div>

                {/* Status de salvamento + Botões de ação */}
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`text-[11px] font-semibold flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${
                      hasUnsavedChanges
                        ? 'bg-amber-50 text-amber-800 border border-amber-200'
                        : 'text-slate-500'
                    }`}
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-[#0B3F7D]" />
                        <span>Salvando...</span>
                      </>
                    ) : hasUnsavedChanges ? (
                      <>
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                        <span>Alterações não salvas</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>{lastSavedAt ? `Salvo às ${lastSavedAt}` : 'Salvo no sistema'}</span>
                      </>
                    )}
                  </span>

                  <button
                    type="button"
                    onClick={() => persistNoteNow(draftNote, false)}
                    disabled={isSaving}
                    className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-60 cursor-pointer transition-colors ${
                      hasUnsavedChanges
                        ? 'bg-amber-600 hover:bg-amber-700 shadow-sm'
                        : 'bg-[#0B3F7D] hover:bg-[#083062]'
                    }`}
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Salvar</span>
                  </button>

                  {isEditing ? (
                    <button
                      type="button"
                      onClick={() => {
                        setIsEditing(false);
                        setIsHighlightMenuOpen(false);
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200 cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Concluir</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setIsEditing(true);
                        setTimeout(() => editorRef.current?.focusEditor(), 40);
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-blue-50 text-[#0B3F7D] hover:bg-blue-100 border border-blue-200 cursor-pointer"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      <span>Editar</span>
                    </button>
                  )}

                  {isOwnedByCurrentUser && (
                    <button
                      type="button"
                      onClick={() => setDeleteNoteTarget(draftNote)}
                      title="Excluir anotação"
                      className="inline-flex items-center justify-center p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 border border-transparent hover:border-red-200 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {hasUnsavedChanges && (
                <div className="bg-amber-50 border border-amber-300 rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-900 no-print">
                  <div className="flex items-center gap-2 font-semibold">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>
                      Você possui alterações não salvas nesta anotação. Clique em{' '}
                      <strong>Salvar</strong> para gravar no sistema.
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => persistNoteNow(draftNote, false)}
                    disabled={isSaving}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold cursor-pointer disabled:opacity-60"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Salvar agora</span>
                  </button>
                </div>
              )}

              {/* BARRA DE FERRAMENTAS COMPACTA — VISÍVEL SOMENTE DURANTE A EDIÇÃO */}
              {isEditing && (
                <div className="bg-white rounded-xl border border-blue-200 shadow-sm px-3 py-2 flex flex-wrap items-center gap-1.5 sticky top-2 z-30 no-print">
                  {/* Negrito / Itálico / Sublinhado */}
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      editorRef.current?.applyCommand('bold');
                    }}
                    title="Negrito"
                    className={`p-1.5 rounded-lg border text-xs transition-colors cursor-pointer ${
                      activeFormats.bold
                        ? 'bg-[#0B3F7D] text-white border-[#0B3F7D]'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <Bold className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      editorRef.current?.applyCommand('italic');
                    }}
                    title="Itálico"
                    className={`p-1.5 rounded-lg border text-xs transition-colors cursor-pointer ${
                      activeFormats.italic
                        ? 'bg-[#0B3F7D] text-white border-[#0B3F7D]'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <Italic className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      editorRef.current?.applyCommand('underline');
                    }}
                    title="Sublinhado"
                    className={`p-1.5 rounded-lg border text-xs transition-colors cursor-pointer ${
                      activeFormats.underline
                        ? 'bg-[#0B3F7D] text-white border-[#0B3F7D]'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <Underline className="w-4 h-4" />
                  </button>

                  <div className="w-px h-5 bg-slate-200 mx-0.5" />

                  {/* Destaque de Texto + Paleta de Cores */}
                  <div className="relative flex items-center gap-1" ref={highlightMenuRef}>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        editorRef.current?.saveSelection();
                        editorRef.current?.applyHighlight(HIGHLIGHT_COLORS[0].value);
                      }}
                      title="Destacar texto selecionado (Amarelo)"
                      className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border border-slate-200 bg-yellow-100/80 text-slate-800 hover:bg-yellow-200 text-xs font-semibold cursor-pointer"
                    >
                      <Highlighter className="w-3.5 h-3.5 text-amber-700" />
                      <span className="hidden sm:inline">Destacar</span>
                    </button>

                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        editorRef.current?.saveSelection();
                        setIsHighlightMenuOpen((v) => !v);
                      }}
                      title="Escolher cor de destaque"
                      className="p-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 cursor-pointer"
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>

                    {isHighlightMenuOpen && (
                      <div className="absolute left-0 top-full mt-1.5 bg-white rounded-xl border border-slate-200 shadow-xl p-2.5 z-40 w-56">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                          Cores de Destaque
                        </div>
                        <div className="grid grid-cols-6 gap-1.5 mb-2">
                          {HIGHLIGHT_COLORS.map((color) => (
                            <button
                              key={color.id}
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                editorRef.current?.applyHighlight(color.value);
                                setIsHighlightMenuOpen(false);
                              }}
                              title={color.label}
                              style={{
                                backgroundColor: color.value,
                                borderColor: color.border,
                              }}
                              className="w-7 h-7 rounded-md border hover:scale-105 transition-transform cursor-pointer"
                            />
                          ))}
                        </div>
                        <button
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            editorRef.current?.applyHighlight(null);
                            setIsHighlightMenuOpen(false);
                          }}
                          className="w-full py-1.5 px-2 text-xs font-medium text-slate-600 bg-slate-50 hover:bg-slate-100 rounded-md flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <Eraser className="w-3.5 h-3.5" />
                          <span>Remover destaque</span>
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="w-px h-5 bg-slate-200 mx-0.5" />

                  {/* Checklist Opcional + Listas */}
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      editorRef.current?.insertChecklist();
                    }}
                    title="Inserir checklist opcional na anotação"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-[#0B3F7D] hover:bg-blue-100 text-xs font-semibold cursor-pointer"
                  >
                    <CheckSquare className="w-3.5 h-3.5" />
                    <span>+ Checklist</span>
                  </button>

                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      editorRef.current?.applyCommand('insertUnorderedList');
                    }}
                    title="Lista com marcadores"
                    className={`p-1.5 rounded-lg border text-xs transition-colors cursor-pointer ${
                      activeFormats.unorderedList
                        ? 'bg-[#0B3F7D] text-white border-[#0B3F7D]'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <List className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      editorRef.current?.applyCommand('insertOrderedList');
                    }}
                    title="Lista numerada"
                    className={`p-1.5 rounded-lg border text-xs transition-colors cursor-pointer ${
                      activeFormats.orderedList
                        ? 'bg-[#0B3F7D] text-white border-[#0B3F7D]'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <ListOrdered className="w-4 h-4" />
                  </button>

                  <div className="w-px h-5 bg-slate-200 mx-0.5" />

                  {/* Desfazer / Refazer */}
                  <button
                    type="button"
                    disabled={!canUndo}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleUndo();
                    }}
                    title="Desfazer"
                    className="p-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
                  >
                    <Undo2 className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    disabled={!canRedo}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleRedo();
                    }}
                    title="Refazer"
                    className="p-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
                  >
                    <Redo2 className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* FOLHA DIGITAL OFICIAL FÊNIX WORLD (EDITÁVEL DIRETAMENTE) */}
              <div className="pb-6">
                <AnotacaoFolhaDocument
                  mode="interactive"
                  title={draftNote.title}
                  date={draftNote.date}
                  sheetConfig={activeSheetConfig}
                  onTitleFocus={() => setIsEditing(true)}
                  onTitleChange={handleUpdateDraftTitle}
                  onDateChange={isOwnedByCurrentUser ? handleUpdateDraftDate : undefined}
                  onBodyMouseDown={() => setIsEditing(true)}
                  refreshTrigger={draftNote.blocks}
                >
                  <AnotacaoRichEditor
                    ref={editorRef}
                    noteId={draftNote.id}
                    blocks={draftNote.blocks}
                    onChangeBlocks={handleUpdateDraftBlocks}
                    onActivateEditing={() => setIsEditing(true)}
                    onActiveFormatsChange={setActiveFormats}
                    isEditing={isEditing}
                  />
                </AnotacaoFolhaDocument>
              </div>
            </>
          )}
        </div>
      </div>

      {/* MODAL PERSONALIZAÇÃO DA FOLHA IMPRESSA */}
      {isPersonalizeOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[1px] flex items-center justify-center p-4 no-print">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-xl overflow-hidden">
            <div className="px-5 py-4 bg-[#0B3F7D] text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <SlidersHorizontal className="w-5 h-5 text-sky-200" />
                <div>
                  <h3 className="text-sm font-bold">Personalizar Folha Fênix World</h3>
                  <p className="text-[11px] text-blue-100">
                    Configurações salvas no Supabase para {getAnotacaoUserFirstName(currentUserKey)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsPersonalizeOpen(false)}
                className="p-1 rounded-lg hover:bg-white/15 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSavePersonalize} className="p-5 space-y-5 max-h-[80vh] overflow-y-auto">
              {/* Título do Cabeçalho */}
              <div className="space-y-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600">
                  Título do Cabeçalho
                </label>
                <input
                  type="text"
                  maxLength={30}
                  value={personalizeDraft.headerTitle}
                  onChange={(e) =>
                    setPersonalizeDraft((p) => ({
                      ...p,
                      headerTitle: e.target.value.toUpperCase(),
                    }))
                  }
                  placeholder="EX: ANOTAÇÃO"
                  className="w-full px-3 py-2 text-sm font-bold text-[#072B54] bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-[#0B3F7D]"
                />
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {ANOTACOES_HEADER_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() =>
                        setPersonalizeDraft((p) => ({ ...p, headerTitle: preset }))
                      }
                      className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border cursor-pointer transition-colors ${
                        personalizeDraft.headerTitle === preset
                          ? 'bg-[#0B3F7D] text-white border-[#0B3F7D]'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              {/* Ícone ao Lado do Título */}
              <div className="space-y-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600">
                  Ícone do Cabeçalho
                </label>
                <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
                  {HEADER_ICON_OPTIONS.map((opt) => {
                    const selected = personalizeDraft.headerIcon === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() =>
                          setPersonalizeDraft((p) => ({ ...p, headerIcon: opt.id }))
                        }
                        className={`flex flex-col items-center justify-center gap-1 p-2 rounded-lg border text-[10px] font-semibold transition-all cursor-pointer ${
                          selected
                            ? 'bg-blue-50 border-[#0B3F7D] text-[#0B3F7D] ring-2 ring-[#0B3F7D]/20'
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {renderHeaderIcon(opt.id, selected ? '#0B3F7D' : '#475569', 20)}
                        <span className="truncate w-full text-center">{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Estilo Visual do Cabeçalho */}
              <div className="space-y-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600">
                  Estilo Visual da Folha
                </label>
                <div className="space-y-2">
                  {HEADER_STYLE_OPTIONS.map((styleOpt) => {
                    const selected = personalizeDraft.headerStyle === styleOpt.id;
                    return (
                      <button
                        key={styleOpt.id}
                        type="button"
                        onClick={() =>
                          setPersonalizeDraft((p) => ({ ...p, headerStyle: styleOpt.id }))
                        }
                        className={`w-full text-left p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                          selected
                            ? 'bg-blue-50/70 border-[#0B3F7D] ring-2 ring-[#0B3F7D]/15'
                            : 'bg-white border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <div>
                          <div className="text-xs font-bold text-slate-800">{styleOpt.label}</div>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            {styleOpt.description}
                          </div>
                        </div>
                        {selected && <CheckCircle2 className="w-4 h-4 text-[#0B3F7D] shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsPersonalizeOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSavingPersonalize}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#0B3F7D] hover:bg-[#083062] rounded-lg disabled:opacity-60 cursor-pointer"
                >
                  {isSavingPersonalize ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  <span>Salvar Personalização</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL CONFIRMAÇÃO EXCLUIR ANOTAÇÃO */}
      {deleteNoteTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 no-print">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-sm w-full p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-red-50 text-red-600 flex items-center justify-center shrink-0">
                <Trash2 className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900">Excluir anotação?</h4>
                <p className="text-xs text-slate-500 mt-1">
                  Tem certeza que deseja excluir{' '}
                  <strong className="text-slate-700">
                    "{deleteNoteTarget.title?.trim() || 'Sem título'}"
                  </strong>
                  ? Esta ação remove a anotação permanentemente do Supabase.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteNoteTarget(null)}
                className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleDeleteNoteConfirmed}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-60 cursor-pointer"
              >
                {isDeleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Excluir</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CONFIRMAÇÃO EXCLUIR CATEGORIA */}
      {deleteCategoryTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 no-print">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-sm w-full p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900">
                  Excluir categoria "{deleteCategoryTarget.name}"?
                </h4>
                <p className="text-xs text-slate-500 mt-1">
                  As anotações dessa pasta não serão apagadas — elas serão movidas automaticamente para outra categoria disponível.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteCategoryTarget(null)}
                className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleDeleteCategoryConfirmed}
                className="px-3.5 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg cursor-pointer"
              >
                Confirmar Exclusão
              </button>
            </div>
          </div>
        </div>
      )}
      {/* MODAL CONFIRMAÇÃO ALTERAÇÕES NÃO SALVAS */}
      {pendingNavAction && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 no-print">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900">Alterações não salvas</h4>
                <p className="text-xs text-slate-600 mt-1">{pendingNavAction.title}</p>
                <p className="text-xs text-slate-500 mt-1">
                  Deseja salvar antes de continuar ou descartar as alterações feitas?
                </p>
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingNavAction(null)}
                className="px-3 py-1.5 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  const act = pendingNavAction.run;
                  setPendingNavAction(null);
                  act();
                }}
                className="px-3 py-1.5 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg cursor-pointer"
              >
                Descartar alterações
              </button>
              <button
                type="button"
                disabled={isSaving}
                onClick={async () => {
                  const act = pendingNavAction.run;
                  const currentDraft = draftNoteRef.current;
                  setPendingNavAction(null);
                  if (currentDraft) {
                    const saved = await persistNoteNow(currentDraft, false);
                    if (saved) act();
                  } else {
                    act();
                  }
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-[#0B3F7D] hover:bg-[#083062] rounded-lg disabled:opacity-60 cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Salvar e continuar</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
