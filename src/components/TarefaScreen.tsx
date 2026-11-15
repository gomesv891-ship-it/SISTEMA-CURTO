import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Home,
  CheckSquare,
  Plus,
  Calendar,
  Clock,
  AlertCircle,
  CheckCircle2,
  Search,
  PhoneCall,
  FileText,
  Users,
  Truck,
  Ruler,
  Pencil,
  MoreVertical,
  ChevronLeft,
  ChevronRight,
  X,
  Save,
  Check,
  RotateCcw,
  Trash2,
  CalendarCheck,
  Building2,
  MessageCircle,
} from 'lucide-react';
import { ClientRecord, TaskItem, TaskPriority, TaskStatus, TaskType } from '../types';
import { addClientActivity } from '../utils/activities';
import { isTaskVisibleToUser, getSellerIdForUser } from '../utils/userDataFilter';
import { sendUserNotification, markNotificationsAsReadByCondition } from '../utils/notifications';
import { getUserIdByName, getStoredAccounts, isUserRevoked } from '../utils/auth';
import { saveItemToSupabase, deleteItemFromSupabase, getSupabaseClient } from '../utils/supabaseClient';
import { UserAvatar } from './UserAvatar';

interface TarefaScreenProps {
  client?: ClientRecord | null;
  onBackToCadastro?: () => void;
  currentUserName?: string;
  onNavigateTab?: (tab: string) => void;
  initialOpenCreateTask?: boolean;
  onConsumeOpenCreateTask?: () => void;
}

// Data dinâmica atual no formato YYYY-MM-DD
const getDynamicTodayDate = () => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const normalizeTaskPriority = (priority?: string | null): TaskPriority => {
  const lower = (priority || '').trim().toLowerCase();
  if (lower === 'alta') return 'Alta';
  if (lower === 'baixa') return 'Baixa';
  return 'Normal';
};

const PRIORITY_META: Record<
  TaskPriority,
  {
    label: string;
    subtitle: string;
    shortTag: string;
    examples: string;
    dotClass: string;
    badgeClass: string;
    cardSelectedClass: string;
    helperBoxClass: string;
    filterSelectedClass: string;
  }
> = {
  Baixa: {
    label: 'Baixa',
    subtitle: 'Pode esperar',
    shortTag: 'Pode esperar',
    examples: 'Atualizar cadastro, organizar documentos e enviar materiais sem urgência.',
    dotClass: 'bg-emerald-500',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200/90',
    cardSelectedClass: 'bg-emerald-50 border-emerald-400 text-emerald-900 ring-2 ring-emerald-500/15',
    helperBoxClass: 'bg-emerald-50/70 border-emerald-200/80 text-emerald-800',
    filterSelectedClass: 'bg-emerald-50 border-emerald-300 text-emerald-800 shadow-2xs',
  },
  Normal: {
    label: 'Normal',
    subtitle: 'Prazo habitual',
    shortTag: 'Prazo habitual',
    examples: 'Retornar orçamento, confirmar informações e fazer contato com cliente.',
    dotClass: 'bg-[#0057ff]',
    badgeClass: 'bg-blue-50 text-[#0057ff] border-blue-200/90',
    cardSelectedClass: 'bg-blue-50 border-[#0057ff] text-[#071a52] ring-2 ring-blue-500/15',
    helperBoxClass: 'bg-blue-50/70 border-blue-200/80 text-[#071a52]',
    filterSelectedClass: 'bg-blue-50 border-blue-300 text-[#0057ff] shadow-2xs',
  },
  Alta: {
    label: 'Alta',
    subtitle: 'Precisa de atenção rápida',
    shortTag: 'Atenção rápida',
    examples: 'Cliente aguardando fechamento, problema de instalação ou orçamento com prazo próximo.',
    dotClass: 'bg-rose-500',
    badgeClass: 'bg-rose-50 text-rose-700 border-rose-200/90',
    cardSelectedClass: 'bg-rose-50 border-rose-400 text-rose-900 ring-2 ring-rose-500/15',
    helperBoxClass: 'bg-rose-50/70 border-rose-200/80 text-rose-800',
    filterSelectedClass: 'bg-rose-50 border-rose-300 text-rose-800 shadow-2xs',
  },
};

export const TarefaScreen: React.FC<TarefaScreenProps> = ({
  client,
  onBackToCadastro,
  currentUserName = 'Vanessa Gomes',
  onNavigateTab,
  initialOpenCreateTask,
  onConsumeOpenCreateTask,
}) => {
  // Tasks State with localStorage persistence
  const [tasks, setTasks] = useState<TaskItem[]>(() => {
    try {
      const stored = localStorage.getItem('fenix_tarefas_db');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch {
      // ignore
    }
    return [];
  });

  // Clients list for linking in modal/drawer
  const [registeredClients, setRegisteredClients] = useState<ClientRecord[]>([]);

  useEffect(() => {
    const loadClients = () => {
      try {
        const stored = localStorage.getItem('fenix_clients_db');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed)) {
            setRegisteredClients(parsed);
          }
        }
      } catch {
        // ignore
      }
    };
    loadClients();
    window.addEventListener('fenix_clients_updated', loadClients);
    window.addEventListener('storage', loadClients);
    return () => {
      window.removeEventListener('fenix_clients_updated', loadClients);
      window.removeEventListener('storage', loadClients);
    };
  }, []);

  const isLoadedRef = useRef(false);

  // Initial load from central Supabase
  useEffect(() => {
    const fetchRemote = async () => {
      try {
        const client = getSupabaseClient();
        if (client) {
          const { data: row } = await client
            .from('fenix_kv_store')
            .select('data')
            .eq('key', 'fenix_tarefas_db')
            .maybeSingle();

          if (row && Array.isArray(row.data)) {
            setTasks(row.data);
            try {
              localStorage.setItem('fenix_tarefas_db', JSON.stringify(row.data));
            } catch {}
          }
        }
      } catch (err) {
        console.warn('Erro ao carregar tarefas remotas:', err);
      } finally {
        isLoadedRef.current = true;
      }
    };
    fetchRemote();
  }, []);

  // Listen for remote updates across users and tabs
  useEffect(() => {
    const handleTasksUpdate = () => {
      // Se o drawer estiver aberto digitando/editando, não interrompe a edição
      if (isDrawerOpenRef.current) return;
      try {
        const stored = localStorage.getItem('fenix_tarefas_db');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed)) {
            setTasks((prev) => {
              if (JSON.stringify(prev) === JSON.stringify(parsed)) return prev;
              return parsed;
            });
          }
        }
      } catch (err) {
        console.warn('Erro ao atualizar tarefas remotas:', err);
      }
    };

    window.addEventListener('fenix_tarefas_updated', handleTasksUpdate);
    window.addEventListener('storage', handleTasksUpdate);
    return () => {
      window.removeEventListener('fenix_tarefas_updated', handleTasksUpdate);
      window.removeEventListener('storage', handleTasksUpdate);
    };
  }, []);

  // Active Filter: 'Todas' | 'Pendentes' | 'Hoje' | 'Atrasadas' | 'Concluídas'
  const [activeFilter, setActiveFilter] = useState<'Todas' | 'Pendentes' | 'Hoje' | 'Atrasadas' | 'Concluídas'>('Todas');
  const [searchTerm, setSearchTerm] = useState('');

  // Priority Filter in Agenda
  const [priorityFilter, setPriorityFilter] = useState<'Todas' | TaskPriority>('Todas');

  // Checkbox selection
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);

  // Pagination (8 items per page)
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8;

  // Modal State
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const isDrawerOpenRef = useRef(false);
  isDrawerOpenRef.current = isDrawerOpen;
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const clientDropdownRef = useRef<HTMLDivElement | null>(null);

  // Form State
  const [formTitle, setFormTitle] = useState('');
  const [formClientId, setFormClientId] = useState('');
  const [formClientName, setFormClientName] = useState('');
  const [formClientCompany, setFormClientCompany] = useState('');
  const [formClientPhone, setFormClientPhone] = useState('');
  const [formDueDate, setFormDueDate] = useState<string>(getDynamicTodayDate);
  const [formDueTime, setFormDueTime] = useState('15:00');
  const [formPriority, setFormPriority] = useState<TaskPriority>('Normal');
  const [formObservation, setFormObservation] = useState('');
  const [clientSearchQuery, setClientSearchQuery] = useState('');
  const [isClientSelectOpen, setIsClientSelectOpen] = useState(false);
  const [formResponsavel, setFormResponsavel] = useState<string>(currentUserName || 'Vanessa Gomes');
  const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({});

  const isDirector = (currentUserName || '').toLowerCase().includes('eder');

  const responsibleOptions = useMemo(() => {
    const base = [
      { value: 'Vanessa Gomes', label: 'Vanessa Gomes (Vendedora)' },
      { value: 'Jhessica Camargo', label: 'Jhessica Camargo (Vendedora)' },
      { value: 'Geral', label: 'Geral (Equipe)' },
    ];
    const seen = new Set(base.map((o) => o.value.toLowerCase()));
    try {
      const accounts = getStoredAccounts();
      Object.values(accounts).forEach((acc) => {
        if (!acc?.name || !acc.active || isUserRevoked(acc.name)) return;
        const lower = acc.name.trim().toLowerCase();
        if (!seen.has(lower)) {
          seen.add(lower);
          base.push({
            value: acc.name,
            label: acc.cargo ? `${acc.name} (${acc.cargo})` : acc.name,
          });
        }
      });
    } catch {
      // ignore
    }
    if (formResponsavel && !seen.has(formResponsavel.trim().toLowerCase())) {
      base.push({ value: formResponsavel, label: formResponsavel });
    }
    return base;
  }, [formResponsavel]);

  useEffect(() => {
    if (!isClientSelectOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (clientDropdownRef.current && !clientDropdownRef.current.contains(e.target as Node)) {
        setIsClientSelectOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isClientSelectOpen]);

  // Toast feedback
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Context Action Menu state (Portal com posicionamento inteligente e sem overflow)
  interface ActionMenuCoords {
    top?: number;
    bottom?: number;
    left: number;
    openUpward: boolean;
  }
  const [actionMenuTask, setActionMenuTask] = useState<TaskItem | null>(null);
  const [actionMenuCoords, setActionMenuCoords] = useState<ActionMenuCoords | null>(null);
  const actionMenuPortalRef = useRef<HTMLDivElement | null>(null);

  const handleOpenActionMenu = (e: React.MouseEvent<HTMLButtonElement>, task: TaskItem) => {
    e.stopPropagation();
    if (actionMenuTask?.id === task.id) {
      setActionMenuTask(null);
      setActionMenuCoords(null);
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const MENU_WIDTH = 224; // 14rem
    const APPROX_MENU_HEIGHT = 195;

    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;

    // Abre para cima se não houver espaço confortável abaixo e houver mais espaço acima
    const openUpward = spaceBelow < APPROX_MENU_HEIGHT && spaceAbove > spaceBelow;

    let left = rect.right - MENU_WIDTH;
    if (left < 10) left = 10;
    if (left + MENU_WIDTH > window.innerWidth - 10) {
      left = window.innerWidth - MENU_WIDTH - 10;
    }

    if (openUpward) {
      setActionMenuCoords({
        bottom: window.innerHeight - rect.top + 6,
        left,
        openUpward: true,
      });
    } else {
      setActionMenuCoords({
        top: rect.bottom + 6,
        left,
        openUpward: false,
      });
    }

    setActionMenuTask(task);
  };

  // Fecha o menu ao clicar fora, ao rolar a página/tabela ou redimensionar
  useEffect(() => {
    if (!actionMenuTask) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (actionMenuPortalRef.current && actionMenuPortalRef.current.contains(e.target as Node)) {
        return;
      }
      setActionMenuTask(null);
      setActionMenuCoords(null);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActionMenuTask(null);
        setActionMenuCoords(null);
      }
    };

    const handleCloseMenu = () => {
      setActionMenuTask(null);
      setActionMenuCoords(null);
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleCloseMenu, true);
    window.addEventListener('resize', handleCloseMenu);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleCloseMenu, true);
      window.removeEventListener('resize', handleCloseMenu);
    };
  }, [actionMenuTask]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3500);
  };

  // Helper date checker dinâmico para a data de hoje
  const isDateToday = (dateStr: string) => {
    const today = getDynamicTodayDate();
    return dateStr === today || dateStr === 'Hoje';
  };

  // Scoped Tasks based on User Visibility Rule:
  // "A listagem deve considerar tarefas em que o usuário seja CRIADOR OU RESPONSÁVEL.
  // Quando uma tarefa for atribuída a outro usuário, ela deve aparecer para os dois.
  // Deve existir apenas UMA tarefa, sem duplicação."
  const userScopedTasks = useMemo(() => {
    return tasks.filter((task) => isTaskVisibleToUser(task, currentUserName));
  }, [tasks, currentUserName]);

  // Compute Metrics dynamically based on user scoped tasks
  const metrics = useMemo(() => {
    let todas = 0;
    let pendentes = 0;
    let hoje = 0;
    let atrasadas = 0;
    let concluidas = 0;

    userScopedTasks.forEach((t) => {
      if (t.status === 'Concluída') {
        concluidas++;
      } else {
        todas++;
        pendentes++;
        if (t.status === 'Atrasada') {
          atrasadas++;
        } else if (isDateToday(t.dueDate)) {
          hoje++;
        }
      }
    });

    return { todas, pendentes, hoje, atrasadas, concluidas };
  }, [userScopedTasks]);

  // Combined Clients list for dropdown (from storage + sample fallback)
  const allAvailableClients = useMemo(() => {
    const map = new Map<string, { id: string; name: string; segment: string; phone: string }>();

    // Add registered clients
    registeredClients.forEach((c) => {
      map.set(c.id, {
        id: c.id,
        name: c.name,
        segment: c.clientType || 'Cliente',
        phone: c.whatsapp || '',
      });
    });

    // Add sample clients if missing
    const fallbackList = [
      { id: 'cli_1', name: 'Construtora Horizonte', segment: 'Construtora', phone: '(11) 98765-4321' },
      { id: 'cli_2', name: 'Juliana Mendes', segment: 'Residencial', phone: '(11) 97222-3344' },
      { id: 'cli_3', name: 'Clínica Bem Estar', segment: 'Comercial', phone: '(11) 3456-7890' },
      { id: 'cli_4', name: 'Roberto Silva', segment: 'Residencial', phone: '(11) 97654-3210' },
      { id: 'cli_5', name: 'Eng. Marcos Vinicius', segment: 'Engenheiro', phone: '(11) 98111-2233' },
      { id: 'cli_6', name: 'Studio ArqDesign', segment: 'Arquiteto', phone: '(11) 94321-8765' },
      { id: 'cli_7', name: 'Escritório Prime', segment: 'Comercial', phone: '(11) 2345-6789' },
      { id: 'cli_8', name: 'Reforma Express ME', segment: 'Instalador', phone: '(11) 96333-4455' },
      { id: 'cli_9', name: 'Hospital São Lucas', segment: 'Comercial', phone: '(11) 91234-5678' },
      { id: 'cli_10', name: 'Condomínio Grand Ville', segment: 'Construtora', phone: '(11) 95444-5566' },
      { id: 'cli_11', name: 'Padaria Bella Villa', segment: 'Comercial', phone: '(11) 93210-9876' },
    ];

    fallbackList.forEach((item) => {
      if (!map.has(item.id)) {
        map.set(item.id, item);
      }
    });

    return Array.from(map.values());
  }, [registeredClients]);

  // Open Modal for creating new task
  const handleOpenNewTask = () => {
    setEditingTaskId(null);
    setFormTitle('');
    if (client) {
      setFormClientId(client.id);
      setFormClientName(client.name);
      setFormClientCompany(client.clientType || 'Cliente');
      setFormClientPhone(client.whatsapp || '');
    } else {
      setFormClientId('');
      setFormClientName('');
      setFormClientCompany('');
      setFormClientPhone('');
    }
    setClientSearchQuery('');
    setFormDueDate(getDynamicTodayDate());
    setFormDueTime('15:00');
    setFormPriority('Normal');
    setFormResponsavel(currentUserName || 'Vanessa Gomes');
    setFormObservation('');
    setFormErrors({});
    setIsClientSelectOpen(false);
    setIsDrawerOpen(true);
  };

  const consumeOpenTaskRef = useRef(onConsumeOpenCreateTask);
  consumeOpenTaskRef.current = onConsumeOpenCreateTask;

  useEffect(() => {
    if (initialOpenCreateTask) {
      handleOpenNewTask();
      consumeOpenTaskRef.current?.();
    }
  }, [initialOpenCreateTask, client]);

  // Open Modal for editing existing task
  const handleEditTask = (task: TaskItem) => {
    setEditingTaskId(task.id);
    setFormTitle(task.title);
    setFormClientId(task.clientId || '');
    setFormClientName(task.clientName || '');
    setFormClientCompany(task.clientCompanyOrSegment || '');
    setFormClientPhone(task.clientPhone || '');
    setClientSearchQuery('');
    setFormDueDate(task.dueDate === 'Hoje' ? getDynamicTodayDate() : task.dueDate);
    setFormDueTime(task.dueTime || '15:00');
    setFormPriority(normalizeTaskPriority(task.priority));
    setFormResponsavel(task.responsavel || task.atribuidoA || task.criadoPor || currentUserName || 'Vanessa Gomes');
    setFormObservation(
      task.observation ||
        (task.description &&
        task.description !== task.title &&
        task.description !== 'Atividade agendada via SISTEMA FÊNIX WORLD'
          ? task.description
          : '')
    );
    setFormErrors({});
    setIsClientSelectOpen(false);
    setActionMenuTask(null);
    setActionMenuCoords(null);
    setIsDrawerOpen(true);
  };

  // Toggle complete task
  const handleToggleTaskStatus = (task: TaskItem) => {
    const isNowCompleted = task.status !== 'Concluída';
    const newStatus: TaskStatus = isNowCompleted ? 'Concluída' : 'Pendente';
    
    const updatedTask: TaskItem = {
      ...task,
      status: newStatus,
      completedAt: isNowCompleted
        ? new Date().toLocaleDateString('pt-BR') + ' ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
        : undefined,
    };

    setTasks((prev) => {
      const next = prev.map((t) => (t.id === task.id ? updatedTask : t));
      try {
        localStorage.setItem('fenix_tarefas_db', JSON.stringify(next));
      } catch {}
      return next;
    });
    saveItemToSupabase('fenix_tarefas_db', updatedTask, 'id', currentUserName).catch(() => {});

    // Se foi marcada como concluída, encerra as notificações pendentes no sino
    if (isNowCompleted) {
      markNotificationsAsReadByCondition((n) => n.metadata?.taskId === task.id);
    }

    // Se Éder ou o responsável alterar status ou concluir a tarefa, Vanessa (criadora) visualiza a atualização e é notificada
    if (task.criadoPor && task.criadoPor !== currentUserName) {
      sendUserNotification({
        category: 'Tarefas',
        title: `Tarefa ${isNowCompleted ? 'concluída' : 'reaberta'} por ${currentUserName}`,
        description: `A tarefa "${task.title}" foi marcada como ${newStatus.toLowerCase()} por ${currentUserName}.`,
        targetTab: 'Tarefas',
        recipientName: task.criadoPor,
        recipientId: (task as any).criadoPorId || (task as any).creatorId || getUserIdByName(task.criadoPor) || undefined,
        authorName: currentUserName,
        authorId: getUserIdByName(currentUserName) || undefined,
        metadata: { taskId: task.id, clientName: task.clientName },
      });
    } else if (task.responsavel && task.responsavel !== currentUserName) {
      sendUserNotification({
        category: 'Tarefas',
        title: `Tarefa ${isNowCompleted ? 'concluída' : 'reaberta'} por ${currentUserName}`,
        description: `A tarefa "${task.title}" foi marcada como ${newStatus.toLowerCase()} por ${currentUserName}.`,
        targetTab: 'Tarefas',
        recipientName: task.responsavel,
        recipientId: task.responsavelId || getUserIdByName(task.responsavel) || undefined,
        authorName: currentUserName,
        authorId: getUserIdByName(currentUserName) || undefined,
        metadata: { taskId: task.id, clientName: task.clientName },
      });
    }

    if (task.clientId) {
      addClientActivity({
        clientId: task.clientId,
        type: isNowCompleted ? 'tarefa_concluida' : 'status_alterado',
        title: isNowCompleted ? 'Tarefa concluída' : 'Tarefa reaberta',
        description: task.title,
        date: new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }),
        userName: currentUserName,
        relevantInfo: isNowCompleted ? 'Marcada como concluída no painel de tarefas' : 'Reaberta como pendente',
      });
    }

    showToast(isNowCompleted ? 'Tarefa marcada como concluída!' : 'Tarefa reaberta como pendente.');
    setActionMenuTask(null);
    setActionMenuCoords(null);
  };

  // Delete single task
  const handleDeleteTask = async (taskId: string) => {
    const res = await deleteItemFromSupabase('fenix_tarefas_db', taskId, 'id', currentUserName);
    if (!res.success) {
      showToast(res.error || 'Erro ao excluir tarefa.');
      return;
    }
    setTasks((prev) => {
      const next = prev.filter((t) => t.id !== taskId);
      try {
        localStorage.setItem('fenix_tarefas_db', JSON.stringify(next));
      } catch {}
      return next;
    });
    setSelectedTaskIds((prev) => prev.filter((id) => id !== taskId));
    markNotificationsAsReadByCondition((n) => n.metadata?.taskId === taskId);
    setActionMenuTask(null);
    setActionMenuCoords(null);
    showToast('✓ Tarefa excluída com sucesso.');
  };

  // Batch actions
  const handleBatchComplete = () => {
    if (selectedTaskIds.length === 0) return;
    setTasks((prev) => {
      const next = prev.map((t) => {
        if (selectedTaskIds.includes(t.id)) {
          const completed: TaskItem = {
            ...t,
            status: 'Concluída',
            completedAt: new Date().toLocaleDateString('pt-BR') + ' ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
          };
          saveItemToSupabase('fenix_tarefas_db', completed, 'id', currentUserName).catch(() => {});
          return completed;
        }
        return t;
      });
      try {
        localStorage.setItem('fenix_tarefas_db', JSON.stringify(next));
      } catch {}
      return next;
    });
    markNotificationsAsReadByCondition((n) => selectedTaskIds.includes(n.metadata?.taskId));
    showToast(`${selectedTaskIds.length} tarefas marcadas como concluídas.`);
    setSelectedTaskIds([]);
  };

  const handleBatchDelete = () => {
    if (selectedTaskIds.length === 0) return;
    if (window.confirm(`Tem certeza que deseja excluir as ${selectedTaskIds.length} tarefas selecionadas?`)) {
      selectedTaskIds.forEach((id) => {
        deleteItemFromSupabase('fenix_tarefas_db', id, 'id', currentUserName).catch(() => {});
      });
      setTasks((prev) => {
        const next = prev.filter((t) => !selectedTaskIds.includes(t.id));
        try {
          localStorage.setItem('fenix_tarefas_db', JSON.stringify(next));
        } catch {}
        return next;
      });
      showToast(`${selectedTaskIds.length} tarefas excluídas.`);
      setSelectedTaskIds([]);
    }
  };

  // Save Task in Modal
  const handleSaveTask = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors: { [key: string]: string } = {};

    if (!formTitle.trim()) {
      errors.title = 'Informe o nome da tarefa';
    }
    // O campo "Cliente" é busca opcional. Se preenchido, deve corresponder a um cliente cadastrado
    const matchedClient = formClientName.trim()
      ? allAvailableClients.find(
          (c) =>
            c.name.toLowerCase() === formClientName.trim().toLowerCase() ||
            (formClientId && c.id === formClientId)
        )
      : null;

    if (formClientName.trim() && !matchedClient) {
      errors.client = 'Selecione um cliente da lista ou deixe em branco';
    }
    if (!formResponsavel.trim()) {
      errors.responsavel = 'Informe o responsável';
    }
    if (!formDueDate) {
      errors.dueDate = 'Informe a data';
    }
    if (!formDueTime.trim()) {
      errors.dueTime = 'Informe o horário';
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    // Determine default status based on date and scheduled time (regra dos 10 minutos)
    let derivedStatus: TaskStatus = 'Pendente';
    const cleanDueDate = formDueDate.includes('T') ? formDueDate.split('T')[0] : formDueDate;
    const cleanDueTime = formDueTime.trim();
    const scheduledDateTime = new Date(`${cleanDueDate}T${cleanDueTime.length === 5 ? cleanDueTime : `${cleanDueTime}:00`}`);
    if (!isNaN(scheduledDateTime.getTime())) {
      const diffMs = Date.now() - scheduledDateTime.getTime();
      // Se já decorreram mais de 10 minutos após o horário programado: Atrasada
      if (diffMs >= 10 * 60 * 1000) {
        derivedStatus = 'Atrasada';
      }
    }

    const resolvedClientId = matchedClient ? matchedClient.id : '';
    const resolvedClientName = matchedClient ? matchedClient.name : '';
    const resolvedClientCompany = matchedClient ? matchedClient.segment : '';
    const resolvedClientPhone = matchedClient ? matchedClient.phone : '';
    const cleanObs = formObservation.trim();

    if (editingTaskId) {
      const myId = getUserIdByName(currentUserName) || undefined;
      const respId = getUserIdByName(formResponsavel) || getSellerIdForUser(formResponsavel) || undefined;

      const currentTask = tasks.find((t) => t.id === editingTaskId);
      const originalCreator = currentTask?.criadoPor;

      const updatedTaskRecord: TaskItem = {
        ...currentTask,
        id: editingTaskId,
        title: formTitle.trim(),
        type: currentTask?.type || 'outro',
        description: cleanObs || '',
        clientId: resolvedClientId,
        clientName: resolvedClientName,
        clientCompanyOrSegment: resolvedClientCompany,
        clientPhone: resolvedClientPhone,
        dueDate: formDueDate,
        dueTime: cleanDueTime,
        priority: formPriority,
        status: currentTask?.status === 'Concluída' ? 'Concluída' : derivedStatus,
        observation: cleanObs,
        responsavel: formResponsavel,
        atribuidoA: formResponsavel,
        responsavelId: respId,
        atribuidoAId: respId,
        criadoPor: currentTask?.criadoPor || currentUserName,
        criadoPorId: (currentTask as any)?.criadoPorId || (currentTask as any)?.creatorId || myId,
        creatorId: (currentTask as any)?.creatorId || (currentTask as any)?.criadoPorId || myId,
      };

      const res = await saveItemToSupabase('fenix_tarefas_db', updatedTaskRecord, 'id', currentUserName);
      if (!res.success) {
        showToast(res.error || 'Erro ao salvar alterações da tarefa. Seus dados foram preservados.');
        return;
      }

      setTasks((prev) => {
        const next = prev.map((t) => (t.id === editingTaskId ? updatedTaskRecord : t));
        try {
          localStorage.setItem('fenix_tarefas_db', JSON.stringify(next));
        } catch {}
        return next;
      });

      if (formResponsavel && formResponsavel !== currentUserName) {
        sendUserNotification({
          category: 'Tarefas',
          title: `Tarefa atualizada por ${currentUserName}`,
          description: `${formTitle.trim()}. Vencimento: ${formDueDate} ${cleanDueTime}. Prioridade: ${formPriority}.`,
          targetTab: 'Tarefas',
          recipientName: formResponsavel,
          recipientId: getUserIdByName(formResponsavel) || undefined,
          authorName: currentUserName,
          authorId: getUserIdByName(currentUserName) || undefined,
          metadata: { taskId: editingTaskId, clientName: resolvedClientName },
        });
      }

      if (originalCreator && originalCreator !== currentUserName && originalCreator !== formResponsavel) {
        sendUserNotification({
          category: 'Tarefas',
          title: `Tarefa atualizada por ${currentUserName}`,
          description: `${formTitle.trim()}. Vencimento: ${formDueDate} ${cleanDueTime}. Observação: ${cleanObs || 'Atualizada'}.`,
          targetTab: 'Tarefas',
          recipientName: originalCreator,
          recipientId: (currentTask as any)?.criadoPorId || (currentTask as any)?.creatorId || getUserIdByName(originalCreator) || undefined,
          authorName: currentUserName,
          authorId: getUserIdByName(currentUserName) || undefined,
          metadata: { taskId: editingTaskId, clientName: resolvedClientName },
        });
      }
      showToast('Tarefa atualizada com sucesso!');
    } else {
      const myId = getUserIdByName(currentUserName) || undefined;
      const respId = getUserIdByName(formResponsavel) || getSellerIdForUser(formResponsavel) || undefined;

      const newTask: TaskItem = {
        id: `task_${Date.now()}`,
        title: formTitle.trim(),
        type: 'outro',
        description: cleanObs || '',
        clientId: resolvedClientId,
        clientName: resolvedClientName,
        clientCompanyOrSegment: resolvedClientCompany,
        clientPhone: resolvedClientPhone,
        dueDate: formDueDate,
        dueTime: cleanDueTime,
        priority: formPriority,
        status: derivedStatus,
        observation: cleanObs,
        criadoPor: currentUserName,
        criadoPorId: myId,
        creatorId: myId,
        responsavel: formResponsavel,
        atribuidoA: formResponsavel,
        responsavelId: respId,
        atribuidoAId: respId,
        createdAt: new Date().toISOString(),
      };

      const res = await saveItemToSupabase('fenix_tarefas_db', newTask, 'id', currentUserName);
      if (!res.success) {
        showToast(res.error || 'Erro ao cadastrar tarefa. Seus dados foram preservados.');
        return;
      }

      setTasks((prev) => {
        const next = [newTask, ...prev];
        try {
          localStorage.setItem('fenix_tarefas_db', JSON.stringify(next));
        } catch {}
        return next;
      });

      // Notificar usuário destinatário da tarefa se atribuído a outro membro da equipe
      if (newTask.responsavel && newTask.responsavel !== currentUserName) {
        sendUserNotification({
          category: 'Tarefas',
          title: `Tarefa atribuída por ${currentUserName}`,
          description: `${newTask.title}. Vencimento: ${newTask.dueDate} ${newTask.dueTime || ''}. Prioridade: ${newTask.priority}.`,
          targetTab: 'Tarefas',
          recipientName: newTask.responsavel,
          recipientId: getUserIdByName(newTask.responsavel) || undefined,
          authorName: currentUserName,
          authorId: getUserIdByName(currentUserName) || undefined,
          metadata: { taskId: newTask.id, clientName: newTask.clientName },
        });
      }

      // Add to client activities history when a client is linked
      if (newTask.clientId) {
        addClientActivity({
          clientId: newTask.clientId,
          type: 'tarefa_criada',
          title: 'Tarefa agendada',
          description: newTask.title,
          date: new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }),
          userName: currentUserName,
          relevantInfo: `Vencimento: ${newTask.dueDate} ${newTask.dueTime || ''} | Prioridade: ${newTask.priority} | Responsável: ${newTask.responsavel || currentUserName}`,
        });
      }

      showToast('Nova tarefa criada com sucesso!');
    }

    setIsDrawerOpen(false);
  };

  // Filter Tasks List from userScopedTasks (guarantees creator + assignee visibility)
  const filteredTasks = useMemo(() => {
    const result = userScopedTasks.filter((task) => {
      // 1. Search Query
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase();
        const matchesTitle = task.title.toLowerCase().includes(query);
        const matchesClient = (task.clientName || '').toLowerCase().includes(query);
        const matchesDesc = task.description?.toLowerCase().includes(query);
        const matchesObs = task.observation?.toLowerCase().includes(query);
        const matchesResp = (task.responsavel || task.atribuidoA || '').toLowerCase().includes(query);
        const matchesCriador = (task.criadoPor || '').toLowerCase().includes(query);
        if (!matchesTitle && !matchesClient && !matchesDesc && !matchesObs && !matchesResp && !matchesCriador) {
          return false;
        }
      }

      // 2. Quick Filter Pills
      if (activeFilter === 'Todas') {
        if (task.status === 'Concluída') return false;
      } else if (activeFilter === 'Pendentes') {
        if (task.status === 'Concluída') return false;
      } else if (activeFilter === 'Hoje') {
        if (!isDateToday(task.dueDate)) return false;
        if (task.status === 'Concluída') return false;
      } else if (activeFilter === 'Atrasadas') {
        if (task.status !== 'Atrasada') return false;
      } else if (activeFilter === 'Concluídas') {
        if (task.status !== 'Concluída') return false;
      }

      // 3. Priority Filter
      if (priorityFilter !== 'Todas' && normalizeTaskPriority(task.priority) !== priorityFilter) {
        return false;
      }

      return true;
    });

    // REGRA OFICIAL: Exibir primeiro as tarefas com status "Pendentes"
    return [...result].sort((a, b) => {
      const isPendA = (a.status || '').toLowerCase().includes('pendente') ? 0 : 1;
      const isPendB = (b.status || '').toLowerCase().includes('pendente') ? 0 : 1;
      return isPendA - isPendB;
    });
  }, [userScopedTasks, searchTerm, activeFilter, priorityFilter]);

  // Pagination calculations
  const totalPages = Math.max(1, Math.ceil(filteredTasks.length / itemsPerPage));
  const currentTasks = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredTasks.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredTasks, currentPage, itemsPerPage]);

  // Adjust page if out of bounds
  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [totalPages, currentPage]);

  // Helper renderers
  const renderTaskTypeIcon = (type?: TaskType) => {
    switch (type) {
      case 'ligacao':
        return (
          <div className="w-10 h-10 rounded-xl bg-sky-50 text-[#0057ff] flex items-center justify-center flex-shrink-0 border border-sky-100/80 shadow-2xs" title="Ligação / Contato">
            <PhoneCall className="w-4 h-4 stroke-[2.2]" />
          </div>
        );
      case 'proposta':
        return (
          <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center flex-shrink-0 border border-indigo-100/80 shadow-2xs" title="Proposta / Catálogo">
            <FileText className="w-4 h-4 stroke-[2.2]" />
          </div>
        );
      case 'reuniao':
        return (
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center flex-shrink-0 border border-amber-100/80 shadow-2xs" title="Reunião / Visita">
            <Users className="w-4 h-4 stroke-[2.2]" />
          </div>
        );
      case 'entrega':
        return (
          <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center flex-shrink-0 border border-purple-100/80 shadow-2xs" title="Entrega / Despacho">
            <Truck className="w-4 h-4 stroke-[2.2]" />
          </div>
        );
      case 'medicao':
        return (
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center flex-shrink-0 border border-emerald-100/80 shadow-2xs" title="Medição Técnica">
            <Ruler className="w-4 h-4 stroke-[2.2]" />
          </div>
        );
      default:
        return (
          <div className="w-10 h-10 rounded-xl bg-blue-50/70 text-[#0057ff] flex items-center justify-center flex-shrink-0 border border-blue-100 shadow-2xs" title="Tarefa">
            <CheckSquare className="w-4 h-4 stroke-[2.2]" />
          </div>
        );
    }
  };

  const renderPriorityBadge = (priority?: TaskPriority) => {
    const normalized = normalizeTaskPriority(priority);
    const meta = PRIORITY_META[normalized];
    return (
      <span
        title={`${meta.label} — ${meta.subtitle}. Exemplos: ${meta.examples}`}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border ${meta.badgeClass}`}
      >
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${meta.dotClass}`} />
        <span>{meta.label}</span>
      </span>
    );
  };

  const renderStatusBadge = (status: TaskStatus) => {
    switch (status) {
      case 'Pendente':
        return (
          <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-blue-50 text-[#0057ff] border border-blue-200/80">
            Pendente
          </span>
        );
      case 'Atrasada':
        return (
          <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-red-50 text-red-600 border border-red-200/80">
            Atrasada
          </span>
        );
      case 'Concluída':
        return (
          <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/80">
            Concluída
          </span>
        );
    }
  };

  // Format date display (e.g., 'Hoje', '22/08/2026')
  const formatDateDisplay = (dateStr: string) => {
    if (!dateStr) return 'Hoje';
    const today = getDynamicTodayDate();
    if (dateStr === 'Hoje' || dateStr === today) {
      return 'Hoje';
    }
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return dateStr;
  };

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 xl:px-10 py-6 space-y-6">
      {/* Toast Feedback */}
      {toastMessage && (
        <div className="fixed top-20 right-5 z-50 p-4 rounded-xl bg-[#0c1e3c] text-white shadow-xl flex items-center gap-3 animate-in fade-in duration-200 border border-slate-700">
          <CheckCircle2 className="w-5 h-5 text-sky-400 flex-shrink-0" />
          <span className="text-xs sm:text-sm font-semibold">{toastMessage}</span>
        </div>
      )}

      {/* 1. Breadcrumb e Cabeçalho da Página */}
      <div className="space-y-3">
        <nav className="flex items-center gap-1.5 text-xs sm:text-sm font-normal text-slate-500">
          <Home className="w-4 h-4 text-[#0057ff]" />
          <span
            onClick={onBackToCadastro}
            className="text-[#0057ff] font-medium cursor-pointer hover:underline"
          >
            Início
          </span>
          <span className="text-slate-400 font-normal">›</span>
          <span className="text-slate-800 font-medium">Tarefas</span>
        </nav>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-blue-50 text-[#0057ff] flex items-center justify-center flex-shrink-0 shadow-xs border border-blue-100">
              <CheckSquare className="w-6 h-6 stroke-[2.3]" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-[#071a52] tracking-tight">
                Tarefas
              </h1>
              <p className="text-xs sm:text-sm text-slate-500 font-normal mt-0.5">
                Organize seus próximos contatos e atividades.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleOpenNewTask}
            className="h-10 px-5 rounded-xl bg-[#0057ff] hover:bg-blue-700 text-white font-bold text-xs sm:text-sm flex items-center justify-center shadow-sm transition-all cursor-pointer self-start sm:self-center"
          >
            <span>Nova Tarefa</span>
          </button>
        </div>
      </div>

      {/* 2. Cards de Resumo (Métricas Rápidas no Topo) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
        {/* Todas */}
        <div
          onClick={() => setActiveFilter('Todas')}
          className={`bg-white rounded-2xl border p-4 shadow-xs flex items-center justify-between gap-3 cursor-pointer transition-all ${
            activeFilter === 'Todas'
              ? 'border-[#0057ff] ring-2 ring-blue-500/10'
              : 'border-slate-200/90 hover:border-slate-300'
          }`}
        >
          <div>
            <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Todas
            </span>
            <span className="text-2xl font-black text-[#071a52] mt-0.5 block">
              {metrics.todas}
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-[#0057ff] flex items-center justify-center flex-shrink-0 border border-blue-100/70">
            <Calendar className="w-5 h-5 stroke-[2.2]" />
          </div>
        </div>

        {/* Pendentes */}
        <div
          onClick={() => setActiveFilter('Pendentes')}
          className={`bg-white rounded-2xl border p-4 shadow-xs flex items-center justify-between gap-3 cursor-pointer transition-all ${
            activeFilter === 'Pendentes'
              ? 'border-[#0057ff] ring-2 ring-blue-500/10'
              : 'border-slate-200/90 hover:border-slate-300'
          }`}
        >
          <div>
            <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Pendentes
            </span>
            <span className="text-2xl font-black text-[#0057ff] mt-0.5 block">
              {metrics.pendentes}
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center flex-shrink-0 border border-sky-100/70">
            <Clock className="w-5 h-5 stroke-[2.2]" />
          </div>
        </div>

        {/* Hoje */}
        <div
          onClick={() => setActiveFilter('Hoje')}
          className={`bg-white rounded-2xl border p-4 shadow-xs flex items-center justify-between gap-3 cursor-pointer transition-all ${
            activeFilter === 'Hoje'
              ? 'border-[#0057ff] ring-2 ring-blue-500/10'
              : 'border-slate-200/90 hover:border-slate-300'
          }`}
        >
          <div>
            <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Hoje
            </span>
            <span className="text-2xl font-black text-indigo-600 mt-0.5 block">
              {metrics.hoje}
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center flex-shrink-0 border border-indigo-100/70">
            <CalendarCheck className="w-5 h-5 stroke-[2.2]" />
          </div>
        </div>

        {/* Atrasadas */}
        <div
          onClick={() => setActiveFilter('Atrasadas')}
          className={`bg-white rounded-2xl border p-4 shadow-xs flex items-center justify-between gap-3 cursor-pointer transition-all ${
            activeFilter === 'Atrasadas'
              ? 'border-red-500 ring-2 ring-red-500/10'
              : 'border-slate-200/90 hover:border-slate-300'
          }`}
        >
          <div>
            <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Atrasadas
            </span>
            <span className="text-2xl font-black text-red-600 mt-0.5 block">
              {metrics.atrasadas}
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-red-50 text-red-600 flex items-center justify-center flex-shrink-0 border border-red-100/70">
            <AlertCircle className="w-5 h-5 stroke-[2.2]" />
          </div>
        </div>

        {/* Concluídas */}
        <div
          onClick={() => setActiveFilter('Concluídas')}
          className={`bg-white rounded-2xl border p-4 shadow-xs flex items-center justify-between gap-3 cursor-pointer transition-all ${
            activeFilter === 'Concluídas'
              ? 'border-emerald-500 ring-2 ring-emerald-500/10'
              : 'border-slate-200/90 hover:border-slate-300'
          }`}
        >
          <div>
            <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Concluídas
            </span>
            <span className="text-2xl font-black text-emerald-600 mt-0.5 block">
              {metrics.concluidas}
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center flex-shrink-0 border border-emerald-100/70">
            <CheckCircle2 className="w-5 h-5 stroke-[2.2]" />
          </div>
        </div>
      </div>

      {/* 3. Barra de Filtros e Busca */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 pt-1">
        {/* Pílulas / Abas de Filtro Rápido */}
        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
          {(['Todas', 'Pendentes', 'Hoje', 'Atrasadas', 'Concluídas'] as const).map((filterName) => {
            const isActive = activeFilter === filterName;
            return (
              <button
                key={filterName}
                type="button"
                onClick={() => setActiveFilter(filterName)}
                className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer select-none ${
                  isActive
                    ? 'bg-[#071a52] text-white shadow-xs'
                    : 'bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-50 border border-slate-200/90'
                }`}
              >
                <span>{filterName}</span>
                {filterName === 'Todas' && <span className="ml-1.5 opacity-80">({metrics.todas})</span>}
                {filterName === 'Pendentes' && <span className="ml-1.5 opacity-80">({metrics.pendentes})</span>}
                {filterName === 'Hoje' && <span className="ml-1.5 opacity-80">({metrics.hoje})</span>}
                {filterName === 'Atrasadas' && <span className="ml-1.5 opacity-80">({metrics.atrasadas})</span>}
                {filterName === 'Concluídas' && <span className="ml-1.5 opacity-80">({metrics.concluidas})</span>}
              </button>
            );
          })}
        </div>

        {/* Input de Busca + Filtro de Prioridade na Agenda */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          {/* Filtro direto por Prioridade */}
          <div className="flex items-center gap-1 bg-white border border-slate-200/90 rounded-xl p-1 h-10 shadow-2xs overflow-x-auto">
            <span className="text-[11px] font-bold text-slate-400 px-2 whitespace-nowrap">
              Prioridade:
            </span>
            <button
              type="button"
              onClick={() => setPriorityFilter('Todas')}
              className={`px-2.5 h-7.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                priorityFilter === 'Todas'
                  ? 'bg-[#071a52] text-white shadow-2xs'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              Todas
            </button>
            {(['Baixa', 'Normal', 'Alta'] as const).map((prio) => {
              const meta = PRIORITY_META[prio];
              const isSelected = priorityFilter === prio;
              return (
                <button
                  key={prio}
                  type="button"
                  onClick={() => setPriorityFilter(isSelected ? 'Todas' : prio)}
                  title={`${meta.label} — ${meta.subtitle}`}
                  className={`px-2.5 h-7.5 rounded-lg text-xs font-bold border transition-all cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap ${
                    isSelected
                      ? meta.filterSelectedClass
                      : 'border-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${meta.dotClass}`} />
                  <span>{meta.label}</span>
                </button>
              );
            })}
          </div>

          <div className="relative flex-1 sm:w-72">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar tarefa ou cliente..."
              className="w-full h-10 pl-9.5 pr-8 rounded-xl border border-slate-200 bg-white text-xs sm:text-sm text-slate-800 placeholder-slate-400 outline-none focus:border-[#0057ff] focus:ring-2 focus:ring-blue-500/10 transition-all"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
                title="Limpar busca"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Barra de Ações em Lote (Quando houver checkboxes marcados) */}
      {selectedTaskIds.length > 0 && (
        <div className="p-3 sm:px-4 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-between gap-3 animate-in fade-in duration-150">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-[#0057ff] text-white text-xs font-bold flex items-center justify-center">
              {selectedTaskIds.length}
            </span>
            <span className="text-xs sm:text-sm font-bold text-[#071a52]">
              {selectedTaskIds.length === 1 ? 'tarefa selecionada' : 'tarefas selecionadas'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleBatchComplete}
              className="px-3 py-1.5 rounded-lg bg-[#0057ff] hover:bg-blue-600 text-white text-xs font-bold transition-all shadow-2xs flex items-center gap-1.5 cursor-pointer"
            >
              <Check className="w-3.5 h-3.5 stroke-[3]" />
              <span>Concluir Selecionadas</span>
            </button>
            <button
              type="button"
              onClick={handleBatchDelete}
              className="px-3 py-1.5 rounded-lg bg-white border border-red-200 text-red-600 hover:bg-red-50 text-xs font-bold transition-all shadow-2xs flex items-center gap-1.5 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Excluir</span>
            </button>
          </div>
        </div>
      )}

      {/* 4. Tabela de Tarefas (Ocupando toda a largura) */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[850px]">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200/80 text-[11px] font-bold text-slate-500 uppercase tracking-wider select-none">
                <th className="py-3.5 px-4 w-12 text-center">
                  <input
                    type="checkbox"
                    checked={
                      currentTasks.length > 0 &&
                      currentTasks.every((t) => selectedTaskIds.includes(t.id))
                    }
                    onChange={(e) => {
                      if (e.target.checked) {
                        const newIds = Array.from(
                          new Set([...selectedTaskIds, ...currentTasks.map((t) => t.id)])
                        );
                        setSelectedTaskIds(newIds);
                      } else {
                        const currentIds = currentTasks.map((t) => t.id);
                        setSelectedTaskIds((prev) => prev.filter((id) => !currentIds.includes(id)));
                      }
                    }}
                    className="w-4 h-4 rounded border-slate-300 text-[#0057ff] focus:ring-blue-500 cursor-pointer accent-[#0057ff]"
                    title="Selecionar todas desta página"
                  />
                </th>
                <th className="py-3.5 px-4">Tarefa</th>
                <th className="py-3.5 px-4">Cliente</th>
                <th className="py-3.5 px-4">Responsável</th>
                <th className="py-3.5 px-4">Cadastrado por</th>
                <th className="py-3.5 px-4">Data / Hora</th>
                <th className="py-3.5 px-4">Prioridade</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs sm:text-sm">
              {currentTasks.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 px-4 text-center">
                    <div className="max-w-xs mx-auto space-y-2">
                      <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
                        <CheckSquare className="w-6 h-6" />
                      </div>
                      <p className="text-sm font-bold text-slate-700">Nenhuma tarefa encontrada</p>
                      <p className="text-xs text-slate-400">
                        Não há tarefas correspondentes ao filtro ou busca selecionada.
                      </p>
                      <button
                        type="button"
                        onClick={handleOpenNewTask}
                        className="mt-3 px-4 py-2 rounded-xl bg-[#0057ff] hover:bg-blue-600 text-white text-xs font-bold transition-all shadow-sm inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Criar Nova Tarefa</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                currentTasks.map((task) => {
                  const isSelected = selectedTaskIds.includes(task.id);
                  const isCompleted = task.status === 'Concluída';

                  return (
                    <tr
                      key={task.id}
                      className={`hover:bg-slate-50/70 transition-colors ${
                        isSelected ? 'bg-blue-50/40' : ''
                      } ${isCompleted ? 'opacity-70' : ''}`}
                    >
                      {/* Checkbox de Seleção */}
                      <td className="py-3.5 px-4 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedTaskIds((prev) => [...prev, task.id]);
                            } else {
                              setSelectedTaskIds((prev) => prev.filter((id) => id !== task.id));
                            }
                          }}
                          className="w-4 h-4 rounded border-slate-300 text-[#0057ff] focus:ring-blue-500 cursor-pointer accent-[#0057ff]"
                        />
                      </td>

                      {/* Tarefa: Ícone + Título em negrito + Observação/Detalhe abaixo */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-start gap-3">
                          {renderTaskTypeIcon(task.type)}
                          <div className="min-w-0">
                            <span
                              className={`block font-bold text-[#071a52] text-xs sm:text-sm tracking-tight ${
                                isCompleted ? 'line-through text-slate-400' : ''
                              }`}
                            >
                              {task.title}
                            </span>
                            {(task.observation ||
                              (task.description &&
                                task.description !== task.title &&
                                task.description !== 'Atividade agendada via SISTEMA FÊNIX WORLD')) && (
                              <p className="text-[11px] sm:text-xs text-slate-500 line-clamp-1 mt-0.5">
                                {task.observation || task.description}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Cliente: Nome do contato/cliente em negrito + Empresa/Segmento logo abaixo */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {task.clientName ? (
                          <div>
                            <span className="block font-bold text-[#071a52] text-xs sm:text-sm">
                              {task.clientName}
                            </span>
                            {task.clientCompanyOrSegment && (
                              <span className="text-[11px] text-slate-400 font-medium">
                                {task.clientCompanyOrSegment}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400 italic font-medium">
                            Sem cliente vinculado
                          </span>
                        )}
                      </td>

                      {/* Responsável (Avatar Oficial + Nome) */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="inline-flex items-center gap-2 px-2 py-1 rounded-xl bg-slate-50 border border-slate-200/80 text-xs font-semibold text-slate-800 shadow-2xs">
                          <UserAvatar
                            userName={task.responsavel || task.atribuidoA || currentUserName}
                            size="xs"
                          />
                          <span>{task.responsavel || task.atribuidoA || currentUserName}</span>
                        </div>
                      </td>

                      {/* Cadastrado por (Avatar Oficial + Nome) */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <UserAvatar userName={task.criadoPor} size="xs" />
                          <span className="text-xs text-slate-600 font-medium">
                            {task.criadoPor || 'Sistema'}
                          </span>
                        </div>
                      </td>

                      {/* Data / Hora: Badge com ícone de calendário, data e horário */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-xl bg-slate-50 border border-slate-200/80 text-xs text-slate-700">
                          <Calendar className="w-3.5 h-3.5 text-[#0057ff]" />
                          <span className="font-bold">{formatDateDisplay(task.dueDate)}</span>
                          {task.dueTime && (
                            <>
                              <span className="text-slate-300">•</span>
                              <span className="font-semibold text-slate-500">{task.dueTime}</span>
                            </>
                          )}
                        </div>
                      </td>

                      {/* Prioridade: Badge pastel arredondado */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {renderPriorityBadge(task.priority)}
                      </td>

                      {/* Status: Tag de status */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {renderStatusBadge(task.status)}
                      </td>

                      {/* Ações: Contextuais de clique rápido */}
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          {/* Discar / WhatsApp */}
                          {task.clientPhone && (
                            <a
                              href={`https://wa.me/55${task.clientPhone.replace(/\D/g, '')}`}
                              target="_blank"
                              rel="noreferrer"
                              className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                              title={`Abrir WhatsApp com ${task.clientName} (${task.clientPhone})`}
                            >
                              <MessageCircle className="w-4 h-4" />
                            </a>
                          )}

                          {/* Alternar Status (Concluir / Reabrir) */}
                          <button
                            type="button"
                            onClick={() => handleToggleTaskStatus(task)}
                            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                              isCompleted
                                ? 'text-emerald-600 hover:text-slate-500 hover:bg-slate-100'
                                : 'text-slate-400 hover:text-emerald-600 hover:bg-emerald-50'
                            }`}
                            title={isCompleted ? 'Reabrir tarefa como pendente' : 'Marcar tarefa como concluída'}
                          >
                            <CheckCircle2 className={`w-4 h-4 ${isCompleted ? 'fill-emerald-100' : ''}`} />
                          </button>

                          {/* Editar Tarefa */}
                          <button
                            type="button"
                            onClick={() => handleEditTask(task)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-[#0057ff] hover:bg-blue-50 transition-colors cursor-pointer"
                            title="Editar detalhes da tarefa"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>

                          {/* Botão Três Pontinhos Modernizado */}
                          <button
                            type="button"
                            onClick={(e) => handleOpenActionMenu(e, task)}
                            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                              actionMenuTask?.id === task.id
                                ? 'bg-blue-100 text-[#0057ff] ring-2 ring-blue-500/20'
                                : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
                            }`}
                            title="Mais opções da tarefa"
                            aria-expanded={actionMenuTask?.id === task.id}
                          >
                            <MoreVertical className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Paginação no Rodapé */}
        <div className="px-4 py-3.5 bg-slate-50/80 border-t border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 select-none">
          <span className="text-xs text-slate-500 font-medium">
            Mostrando{' '}
            <strong className="text-slate-700">
              {filteredTasks.length === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1}
            </strong>{' '}
            a{' '}
            <strong className="text-slate-700">
              {Math.min(currentPage * itemsPerPage, filteredTasks.length)}
            </strong>{' '}
            de <strong className="text-slate-700">{filteredTasks.length}</strong> tarefas
          </span>

          <div className="flex items-center gap-1.5 self-center sm:self-auto">
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className={`p-1.5 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
                currentPage === 1
                  ? 'border-slate-200 text-slate-300 cursor-not-allowed bg-white'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
              title="Página anterior"
            >
              <ChevronLeft className="w-4 h-4 stroke-[2.2]" />
            </button>

            {Array.from({ length: totalPages }).map((_, idx) => {
              const pageNumber = idx + 1;
              const isCurrent = pageNumber === currentPage;
              return (
                <button
                  key={pageNumber}
                  type="button"
                  onClick={() => setCurrentPage(pageNumber)}
                  className={`w-8 h-8 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    isCurrent
                      ? 'bg-[#0057ff] text-white shadow-xs'
                      : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  {pageNumber}
                </button>
              );
            })}

            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className={`p-1.5 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
                currentPage === totalPages
                  ? 'border-slate-200 text-slate-300 cursor-not-allowed bg-white'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
              title="Próxima página"
            >
              <ChevronRight className="w-4 h-4 stroke-[2.2]" />
            </button>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 5. JANELA MODAL COMPACTA "NOVA TAREFA / EDITAR TAREFA"                    */}
      {/* ========================================================================= */}
      {isDrawerOpen && (
        <div
          className="fixed inset-0 z-50 bg-[#071a52]/45 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setIsDrawerOpen(false);
            }
          }}
        >
          <div
            className="w-full max-w-[600px] bg-white rounded-2xl shadow-2xl border border-slate-200/90 flex flex-col max-h-[94vh] overflow-hidden animate-in zoom-in-95 duration-150"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-nova-tarefa-titulo"
          >
            {/* Modal Header (Padrão Azul-Marinho Fênix World) */}
            <div className="px-5 py-3.5 bg-[#071a52] text-white flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-white/10 text-white border border-white/15 flex items-center justify-center flex-shrink-0">
                  <CheckSquare className="w-4.5 h-4.5 stroke-[2.2]" />
                </div>
                <div>
                  <h2 id="modal-nova-tarefa-titulo" className="text-sm sm:text-base font-extrabold tracking-tight text-white">
                    {editingTaskId ? 'Editar Tarefa' : 'Nova Tarefa'}
                  </h2>
                  <p className="text-[11px] text-blue-100/85">
                    {editingTaskId
                      ? 'Atualize os dados e a prioridade da tarefa'
                      : 'Preencha os campos abaixo para agendar a tarefa'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsDrawerOpen(false)}
                className="p-1.5 text-blue-100 hover:text-white rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
                title="Fechar"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </div>

            {/* Modal Form Body (7 campos na ordem oficial, layout compacto sem rolagem desnecessária) */}
            <form id="task-form" onSubmit={handleSaveTask} className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {/* 1. Nome da tarefa (principal e obrigatório) */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-[#071a52] flex items-center justify-between">
                  <span>
                    Nome da tarefa <span className="text-rose-500">*</span>
                  </span>
                  {formErrors.title && (
                    <span className="text-rose-600 text-[11px] font-semibold">{formErrors.title}</span>
                  )}
                </label>
                <div className="relative">
                  <CheckSquare className="w-4 h-4 text-[#0057ff] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={formTitle}
                    onChange={(e) => {
                      setFormTitle(e.target.value);
                      if (formErrors.title) setFormErrors((prev) => ({ ...prev, title: '' }));
                    }}
                    placeholder="Ex.: Retornar orçamento ou confirmar instalação"
                    className={`w-full h-9.5 pl-9 pr-3 rounded-xl border bg-white text-xs sm:text-sm font-semibold text-slate-800 placeholder-slate-400 outline-none transition-all ${
                      formErrors.title
                        ? 'border-rose-400 focus:border-rose-500 focus:ring-2 focus:ring-rose-500/15'
                        : 'border-slate-200 focus:border-[#0057ff] focus:ring-2 focus:ring-blue-500/10'
                    }`}
                    autoFocus
                  />
                </div>
              </div>

              {/* 2. Cliente (busca opcional) */}
              <div ref={clientDropdownRef} className="space-y-1 relative">
                <label className="text-xs font-bold text-[#071a52] flex items-center justify-between">
                  <span>
                    Cliente <span className="text-slate-400 font-normal">(busca opcional)</span>
                  </span>
                  {formErrors.client && (
                    <span className="text-rose-600 text-[11px] font-semibold">{formErrors.client}</span>
                  )}
                </label>

                <div className="relative">
                  <Building2 className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={formClientName}
                    onFocus={() => setIsClientSelectOpen(true)}
                    onChange={(e) => {
                      const val = e.target.value;
                      setFormClientName(val);
                      setClientSearchQuery(val);
                      setFormClientId('');
                      setFormClientCompany('');
                      setFormClientPhone('');
                      setIsClientSelectOpen(true);
                      if (formErrors.client) setFormErrors((prev) => ({ ...prev, client: '' }));
                    }}
                    placeholder="Buscar cliente cadastrado (opcional)..."
                    className={`w-full h-9.5 pl-9 pr-8 rounded-xl border bg-white text-xs sm:text-sm font-medium text-slate-800 placeholder-slate-400 outline-none transition-all ${
                      formErrors.client
                        ? 'border-rose-400 focus:border-rose-500 focus:ring-2 focus:ring-rose-500/15'
                        : 'border-slate-200 focus:border-[#0057ff] focus:ring-2 focus:ring-blue-500/10'
                    }`}
                  />
                  {formClientName && (
                    <button
                      type="button"
                      onClick={() => {
                        setFormClientName('');
                        setClientSearchQuery('');
                        setFormClientId('');
                        setFormClientCompany('');
                        setFormClientPhone('');
                        if (formErrors.client) setFormErrors((prev) => ({ ...prev, client: '' }));
                      }}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
                      title="Limpar cliente"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Dropdown de busca de clientes */}
                {isClientSelectOpen && (
                  <div className="absolute left-0 right-0 top-[62px] z-30 bg-white rounded-xl border border-slate-200 shadow-xl max-h-40 overflow-y-auto py-1">
                    {(() => {
                      const query = (clientSearchQuery || formClientName || '').trim().toLowerCase();
                      const filtered = allAvailableClients.filter((c) =>
                        query
                          ? c.name.toLowerCase().includes(query) ||
                            c.segment.toLowerCase().includes(query) ||
                            c.phone.toLowerCase().includes(query)
                          : true
                      );
                      if (filtered.length === 0) {
                        return (
                          <p className="p-3 text-xs text-slate-400 text-center">
                            Nenhum cliente encontrado. Deixe em branco se não houver cliente vinculado.
                          </p>
                        );
                      }
                      return filtered.map((c) => (
                        <div
                          key={c.id}
                          onClick={() => {
                            setFormClientId(c.id);
                            setFormClientName(c.name);
                            setFormClientCompany(c.segment);
                            setFormClientPhone(c.phone);
                            setClientSearchQuery('');
                            setIsClientSelectOpen(false);
                            if (formErrors.client) setFormErrors((prev) => ({ ...prev, client: '' }));
                          }}
                          className="px-3 py-1.5 hover:bg-blue-50 cursor-pointer flex items-center justify-between gap-2 transition-colors"
                        >
                          <div className="min-w-0">
                            <span className="text-xs font-bold text-[#071a52] block truncate">{c.name}</span>
                            <span className="text-[10px] text-slate-400 font-medium">{c.segment}</span>
                          </div>
                          {c.phone && (
                            <span className="text-[10px] font-mono text-slate-400 flex-shrink-0">{c.phone}</span>
                          )}
                        </div>
                      ));
                    })()}
                  </div>
                )}
              </div>

              {/* 3. Responsável * | 4. Data * | 5. Horário * */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                {/* 3. Responsável (obrigatório) */}
                <div className="sm:col-span-5 space-y-1">
                  <label className="text-xs font-bold text-[#071a52] flex items-center justify-between">
                    <span>
                      Responsável <span className="text-rose-500">*</span>
                    </span>
                    {formErrors.responsavel && (
                      <span className="text-rose-600 text-[10px] font-semibold">{formErrors.responsavel}</span>
                    )}
                  </label>
                  <div className="relative flex items-center">
                    <div className="absolute left-2.5 pointer-events-none flex items-center">
                      <UserAvatar userName={formResponsavel} size="xs" />
                    </div>
                    <select
                      value={formResponsavel}
                      onChange={(e) => {
                        setFormResponsavel(e.target.value);
                        if (formErrors.responsavel) setFormErrors((prev) => ({ ...prev, responsavel: '' }));
                      }}
                      className={`w-full h-9.5 pl-9 pr-2.5 rounded-xl border bg-white text-xs font-semibold text-slate-800 outline-none transition-all cursor-pointer ${
                        formErrors.responsavel
                          ? 'border-rose-400 focus:border-rose-500'
                          : 'border-slate-200 focus:border-[#0057ff]'
                      }`}
                    >
                      {responsibleOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* 4. Data (obrigatória) */}
                <div className="sm:col-span-4 space-y-1">
                  <label className="text-xs font-bold text-[#071a52] flex items-center justify-between">
                    <span>
                      Data <span className="text-rose-500">*</span>
                    </span>
                    {formErrors.dueDate && (
                      <span className="text-rose-600 text-[10px] font-semibold">{formErrors.dueDate}</span>
                    )}
                  </label>
                  <div className="relative">
                    <Calendar className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="date"
                      value={formDueDate}
                      onChange={(e) => {
                        setFormDueDate(e.target.value);
                        if (formErrors.dueDate) setFormErrors((prev) => ({ ...prev, dueDate: '' }));
                      }}
                      className={`w-full h-9.5 pl-8.5 pr-2 rounded-xl border bg-white text-xs font-semibold text-slate-800 outline-none transition-all ${
                        formErrors.dueDate
                          ? 'border-rose-400 focus:border-rose-500'
                          : 'border-slate-200 focus:border-[#0057ff]'
                      }`}
                    />
                  </div>
                </div>

                {/* 5. Horário (obrigatório) */}
                <div className="sm:col-span-3 space-y-1">
                  <label className="text-xs font-bold text-[#071a52] flex items-center justify-between">
                    <span>
                      Horário <span className="text-rose-500">*</span>
                    </span>
                    {formErrors.dueTime && (
                      <span className="text-rose-600 text-[10px] font-semibold">{formErrors.dueTime}</span>
                    )}
                  </label>
                  <div className="relative">
                    <Clock className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="time"
                      value={formDueTime}
                      onChange={(e) => {
                        setFormDueTime(e.target.value);
                        if (formErrors.dueTime) setFormErrors((prev) => ({ ...prev, dueTime: '' }));
                      }}
                      className={`w-full h-9.5 pl-8.5 pr-2 rounded-xl border bg-white text-xs font-semibold text-slate-800 outline-none transition-all ${
                        formErrors.dueTime
                          ? 'border-rose-400 focus:border-rose-500'
                          : 'border-slate-200 focus:border-[#0057ff]'
                      }`}
                    />
                  </div>
                </div>
              </div>

              {/* 6. Prioridade (Baixa, Normal, Alta com identificação visual e orientação) */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[#071a52] block">
                  Prioridade <span className="text-rose-500">*</span>
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['Baixa', 'Normal', 'Alta'] as const).map((p) => {
                    const meta = PRIORITY_META[p];
                    const isSelected = formPriority === p;
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setFormPriority(p)}
                        className={`px-3 py-2 rounded-xl border text-left transition-all cursor-pointer flex flex-col gap-0.5 ${
                          isSelected
                            ? meta.cardSelectedClass
                            : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1.5">
                          <span className="inline-flex items-center gap-1.5 text-xs font-extrabold">
                            <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${meta.dotClass}`} />
                            <span>{meta.label}</span>
                          </span>
                          {isSelected && <Check className="w-3.5 h-3.5 flex-shrink-0 stroke-[2.8]" />}
                        </div>
                        <span className="text-[10px] font-medium opacity-85 leading-tight">
                          {meta.shortTag}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className={`px-3 py-1.5 rounded-lg border text-[11px] leading-snug ${PRIORITY_META[formPriority].helperBoxClass}`}>
                  <span className="font-bold">
                    {PRIORITY_META[formPriority].label.toUpperCase()} — {PRIORITY_META[formPriority].subtitle}:
                  </span>{' '}
                  <span>{PRIORITY_META[formPriority].examples}</span>
                </div>
              </div>

              {/* 7. Observações (campo opcional) */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-[#071a52]">
                    Observações <span className="text-slate-400 font-normal">(opcional)</span>
                  </label>
                  <span className="text-[10px] font-mono text-slate-400">
                    {formObservation.length}/500
                  </span>
                </div>
                <textarea
                  value={formObservation}
                  maxLength={500}
                  onChange={(e) => setFormObservation(e.target.value)}
                  rows={2}
                  placeholder="Informações adicionais, contexto ou lembretes..."
                  className="w-full p-2.5 rounded-xl border border-slate-200 bg-white text-xs sm:text-sm font-medium text-slate-800 placeholder-slate-400 outline-none focus:border-[#0057ff] focus:ring-2 focus:ring-blue-500/10 transition-all resize-none"
                />
              </div>
            </form>

            {/* Modal Footer: Cancelar e Salvar Tarefa */}
            <div className="px-5 py-3 bg-slate-50 border-t border-slate-200/80 flex items-center justify-end gap-2.5 flex-shrink-0">
              <button
                type="button"
                onClick={() => setIsDrawerOpen(false)}
                className="px-4 h-9.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 font-bold text-xs sm:text-sm transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                form="task-form"
                className="px-5 h-9.5 rounded-xl bg-[#0057ff] hover:bg-blue-700 text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-sm shadow-blue-600/20 transition-all cursor-pointer"
              >
                <Save className="w-4 h-4 stroke-[2.3]" />
                <span>Salvar Tarefa</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Portal do Menu de Ações das Tarefas (Fora do container da tabela, imune a overflow:hidden e com auto-posicionamento para cima/baixo) */}
      {actionMenuTask && actionMenuCoords && typeof document !== 'undefined' && createPortal(
        <div
          ref={actionMenuPortalRef}
          style={{
            position: 'fixed',
            left: `${actionMenuCoords.left}px`,
            ...(actionMenuCoords.openUpward
              ? { bottom: `${actionMenuCoords.bottom}px` }
              : { top: `${actionMenuCoords.top}px` }),
            zIndex: 99999,
          }}
          className="w-56 bg-white rounded-2xl border border-slate-200/90 shadow-2xl p-1.5 text-left animate-in fade-in zoom-in-95 duration-100 space-y-0.5 select-none"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-2.5 py-1.5 border-b border-slate-100 mb-1 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
              Opções da Tarefa
            </span>
            {actionMenuCoords.openUpward && (
              <span className="text-[9px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                Acima
              </span>
            )}
          </div>

          {/* Concluir ou Reabrir */}
          <button
            type="button"
            onClick={() => {
              handleToggleTaskStatus(actionMenuTask);
              setActionMenuTask(null);
              setActionMenuCoords(null);
            }}
            className="w-full px-2.5 py-2 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 transition-colors cursor-pointer group"
          >
            <div
              className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors ${
                actionMenuTask.status === 'Concluída'
                  ? 'bg-amber-50 text-amber-600 group-hover:bg-amber-100'
                  : 'bg-emerald-50 text-emerald-600 group-hover:bg-emerald-100'
              }`}
            >
              {actionMenuTask.status === 'Concluída' ? (
                <RotateCcw className="w-3.5 h-3.5" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5" />
              )}
            </div>
            <div className="flex flex-col text-left">
              <span className="font-bold text-slate-800">
                {actionMenuTask.status === 'Concluída' ? 'Reabrir Tarefa' : 'Concluir Tarefa'}
              </span>
              <span className="text-[10px] text-slate-400 font-normal">
                {actionMenuTask.status === 'Concluída' ? 'Voltar para pendente' : 'Marcar como finalizada'}
              </span>
            </div>
          </button>

          {/* Editar Tarefa */}
          <button
            type="button"
            onClick={() => {
              handleEditTask(actionMenuTask);
              setActionMenuTask(null);
              setActionMenuCoords(null);
            }}
            className="w-full px-2.5 py-2 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 transition-colors cursor-pointer group"
          >
            <div className="w-7 h-7 rounded-lg bg-blue-50 text-[#0057ff] group-hover:bg-blue-100 flex items-center justify-center flex-shrink-0 transition-colors">
              <Pencil className="w-3.5 h-3.5" />
            </div>
            <div className="flex flex-col text-left">
              <span className="font-bold text-slate-800">Editar Tarefa</span>
              <span className="text-[10px] text-slate-400 font-normal">
                Alterar dados ou prazo
              </span>
            </div>
          </button>

          <div className="border-t border-slate-100 my-1" />

          {/* Excluir Tarefa */}
          <button
            type="button"
            onClick={() => {
              handleDeleteTask(actionMenuTask.id);
              setActionMenuTask(null);
              setActionMenuCoords(null);
            }}
            className="w-full px-2.5 py-2 rounded-xl text-xs font-semibold text-rose-600 hover:bg-rose-50 flex items-center gap-2.5 transition-colors cursor-pointer group"
          >
            <div className="w-7 h-7 rounded-lg bg-rose-50 text-rose-600 group-hover:bg-rose-100 flex items-center justify-center flex-shrink-0 transition-colors">
              <Trash2 className="w-3.5 h-3.5" />
            </div>
            <div className="flex flex-col text-left">
              <span className="font-bold text-rose-600">Excluir Tarefa</span>
              <span className="text-[10px] text-rose-400 font-normal">
                Remover permanentemente
              </span>
            </div>
          </button>
        </div>,
        document.body
      )}
    </div>
  );
};
