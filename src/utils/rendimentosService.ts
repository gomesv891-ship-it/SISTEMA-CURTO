import { getSupabaseClient } from './supabaseClient';

export interface RendimentoItem {
  id: string;
  produto: string;
  rendimento: string;
  unidade: string;
  observacao?: string;
  createdAt: string;
  updatedAt: string;
}

export const RENDIMENTOS_STORAGE_KEY = 'fenix_calculadora_rendimentos';

export const UNIDADES_PADRAO_RENDIMENTO = [
  'm²/caixa',
  'm²/balde',
  'm²/rolo',
  'm²/unidade',
  'm²/bisnaga',
  'm/barra',
  'm/rolo',
  'kg/m²',
  'unidade',
];

// Cache em memória inicializado a partir do armazenamento local para disponibilidade imediata mesmo offline
let memoryCache: RendimentoItem[] = (() => {
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(RENDIMENTOS_STORAGE_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (Array.isArray(p)) return deduplicateList(p);
      }
    } catch {}
  }
  return [];
})();

/**
 * Helper interno para remover duplicidades preservando a integridade pelo ID
 */
function deduplicateList(list: RendimentoItem[]): RendimentoItem[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const result: RendimentoItem[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object' || !item.id) continue;
    const cleanId = String(item.id).trim();
    if (!seen.has(cleanId)) {
      seen.add(cleanId);
      result.push({
        id: cleanId,
        produto: String(item.produto || '').trim(),
        rendimento: String(item.rendimento || '').trim(),
        unidade: String(item.unidade || '').trim(),
        observacao: item.observacao ? String(item.observacao).trim() : '',
        createdAt: item.createdAt || new Date().toISOString(),
        updatedAt: item.updatedAt || new Date().toISOString(),
      });
    }
  }
  return result;
}

/**
 * Retorna os rendimentos do cache em memória atual.
 */
export function getStoredRendimentos(): RendimentoItem[] {
  return [...memoryCache];
}

/**
 * Carrega a lista oficial de rendimentos diretamente do Supabase.
 * - Proteção total anti-wipe: nunca descarta dados locais se a nuvem retornar vazio ou erro.
 * - Sincroniza e unifica com cache persistente.
 */
export async function loadRendimentosFromSupabase(): Promise<RendimentoItem[]> {
  const client = getSupabaseClient();
  if (!client) {
    return [...memoryCache];
  }

  try {
    const { data: row, error } = await client
      .from('fenix_kv_store')
      .select('data')
      .eq('key', RENDIMENTOS_STORAGE_KEY)
      .maybeSingle();

    if (error) {
      console.warn('Erro ao consultar rendimentos no Supabase:', error);
      return [...memoryCache];
    }

    let remoteList: any = null;
    if (row && row.data !== undefined) {
      let rData = row.data;
      if (typeof rData === 'string') {
        try {
          rData = JSON.parse(rData);
        } catch {
          rData = [];
        }
      }
      if (Array.isArray(rData)) {
        remoteList = rData;
      }
    }

    let localList: RendimentoItem[] = [];
    try {
      const raw = localStorage.getItem(RENDIMENTOS_STORAGE_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (Array.isArray(p)) localList = deduplicateList(p);
      }
    } catch {}

    if (Array.isArray(remoteList) && remoteList.length > 0) {
      // Mescla inteligente preservando eventuais registros locais novos
      const map = new Map<string, RendimentoItem>();
      for (const loc of localList) {
        if (loc && loc.id) map.set(loc.id, loc);
      }
      for (const rem of remoteList) {
        if (rem && rem.id) map.set(rem.id, rem);
      }
      memoryCache = Array.from(map.values());
      try {
        localStorage.setItem(RENDIMENTOS_STORAGE_KEY, JSON.stringify(memoryCache));
      } catch {}
      return [...memoryCache];
    } else if (localList.length > 0) {
      // Supabase ainda não tem dados, mas local possui: preserva e sincroniza para a nuvem
      memoryCache = localList;
      try {
        await client.from('fenix_kv_store').upsert({
          key: RENDIMENTOS_STORAGE_KEY,
          data: localList,
          updated_at: new Date().toISOString(),
          updated_by: 'Sistema Fênix',
        }, { onConflict: 'key' });
      } catch {}
      return [...memoryCache];
    }

    memoryCache = [];
    return [];
  } catch (err) {
    console.warn('Falha na requisição de rendimentos ao Supabase:', err);
    return [...memoryCache];
  }
}

/**
 * Salva ou atualiza um cadastro de rendimento diretamente no Supabase.
 * - Produto, Rendimento, Unidade e Observação são persistidos na nuvem e no cache persistente.
 * - Não cria duplicados.
 * - Ao editar, atualiza o registro existente mantendo o ID.
 */
export async function saveRendimento(
  itemData: {
    produto: string;
    rendimento: string;
    unidade: string;
    observacao?: string;
  },
  existingId?: string
): Promise<RendimentoItem> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Falha ao conectar ao servidor do Supabase. Verifique a conexão.');
  }

  const now = new Date().toISOString();
  const user =
    (typeof localStorage !== 'undefined' && (localStorage.getItem('fenix_active_user_name') || localStorage.getItem('fenix_saved_username'))) ||
    'Usuário Fênix';

  // 1. Busca a lista mais recente do Supabase para evitar conflitos de concorrência
  let currentList: RendimentoItem[] = [];
  try {
    const { data: row } = await client
      .from('fenix_kv_store')
      .select('data')
      .eq('key', RENDIMENTOS_STORAGE_KEY)
      .maybeSingle();

    if (row && row.data !== undefined) {
      let rData = row.data;
      if (typeof rData === 'string') {
        try {
          rData = JSON.parse(rData);
        } catch {}
      }
      if (Array.isArray(rData)) {
        currentList = deduplicateList(rData);
      }
    }
  } catch {
    // fallback
  }

  // Mescla com cache local para não perder nenhum registro
  const baseMap = new Map<string, RendimentoItem>();
  for (const it of memoryCache) {
    if (it && it.id) baseMap.set(it.id, it);
  }
  for (const it of currentList) {
    if (it && it.id) baseMap.set(it.id, it);
  }
  const mergedList = Array.from(baseMap.values());

  // 2. Prepara o item salvo: localiza por ID ou pelo nome do produto
  let savedItem: RendimentoItem;
  const targetId = existingId ? String(existingId).trim() : undefined;
  const existingIndex = mergedList.findIndex(
    (i) => (targetId && String(i.id).trim() === targetId) || (!targetId && i.produto.toLowerCase().trim() === itemData.produto.toLowerCase().trim())
  );

  if (existingIndex >= 0) {
    const matchedId = mergedList[existingIndex].id;
    savedItem = {
      id: matchedId,
      produto: itemData.produto.trim(),
      rendimento: itemData.rendimento.trim(),
      unidade: itemData.unidade.trim(),
      observacao: itemData.observacao?.trim() || '',
      createdAt: mergedList[existingIndex].createdAt || now,
      updatedAt: now,
    };
    mergedList[existingIndex] = savedItem;
  } else {
    savedItem = {
      id: targetId || `rend_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      produto: itemData.produto.trim(),
      rendimento: itemData.rendimento.trim(),
      unidade: itemData.unidade.trim(),
      observacao: itemData.observacao?.trim() || '',
      createdAt: now,
      updatedAt: now,
    };
    mergedList.unshift(savedItem);
  }

  // 3. Remove duplicidades
  const finalizedList = deduplicateList(mergedList);

  // 4. Persiste diretamente no Supabase fenix_kv_store
  const { error: upsertErr } = await client
    .from('fenix_kv_store')
    .upsert(
      {
        key: RENDIMENTOS_STORAGE_KEY,
        data: finalizedList,
        updated_at: now,
        updated_by: user,
      },
      { onConflict: 'key' }
    );

  if (upsertErr) {
    console.error('Erro no Supabase ao salvar rendimento:', upsertErr);
    throw new Error(upsertErr.message || 'Erro ao persistir rendimento no Supabase.');
  }

  // 5. Atualiza o cache em memória e localStorage imediatamente
  memoryCache = finalizedList;
  try {
    localStorage.setItem(RENDIMENTOS_STORAGE_KEY, JSON.stringify(finalizedList));
  } catch {}

  // 6. Notifica o sistema para atualização visual em tempo real
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('fenix_rendimentos_updated', { detail: { items: finalizedList } })
    );
  }

  return savedItem;
}

/**
 * Remove definitivamente um item de rendimento no Supabase.
 */
export async function deleteRendimento(id: string): Promise<boolean> {
  if (!id) return false;

  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Falha ao conectar ao servidor do Supabase.');
  }

  const now = new Date().toISOString();
  const user =
    (typeof localStorage !== 'undefined' && (localStorage.getItem('fenix_active_user_name') || localStorage.getItem('fenix_saved_username'))) ||
    'Usuário Fênix';

  // 1. Busca lista remota atual
  let currentList: RendimentoItem[] = [];
  try {
    const { data: row } = await client
      .from('fenix_kv_store')
      .select('data')
      .eq('key', RENDIMENTOS_STORAGE_KEY)
      .maybeSingle();

    if (row && row.data !== undefined) {
      let rData = row.data;
      if (typeof rData === 'string') {
        try {
          rData = JSON.parse(rData);
        } catch {}
      }
      if (Array.isArray(rData)) {
        currentList = deduplicateList(rData);
      }
    }
  } catch {
    // fallback
  }

  const baseMap = new Map<string, RendimentoItem>();
  for (const it of memoryCache) {
    if (it && it.id) baseMap.set(it.id, it);
  }
  for (const it of currentList) {
    if (it && it.id) baseMap.set(it.id, it);
  }
  const cleanTargetId = String(id).trim();
  const filtered = Array.from(baseMap.values()).filter((item) => String(item.id).trim() !== cleanTargetId);

  // 2. Atualiza diretamente o Supabase
  const { error } = await client
    .from('fenix_kv_store')
    .upsert(
      {
        key: RENDIMENTOS_STORAGE_KEY,
        data: filtered,
        updated_at: now,
        updated_by: user,
      },
      { onConflict: 'key' }
    );

  if (error) {
    console.error('Erro ao excluir rendimento no Supabase:', error);
    throw new Error(error.message || 'Erro ao excluir rendimento no Supabase.');
  }

  // 3. Atualiza cache em memória, localStorage e dispara evento
  memoryCache = filtered;
  try {
    localStorage.setItem(RENDIMENTOS_STORAGE_KEY, JSON.stringify(filtered));
  } catch {}
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('fenix_rendimentos_updated', { detail: { items: filtered } })
    );
  }

  return true;
}

/**
 * Limpa todos os rendimentos no Supabase.
 */
export async function clearAllRendimentos(): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;

  const now = new Date().toISOString();
  const user =
    (typeof localStorage !== 'undefined' && (localStorage.getItem('fenix_active_user_name') || localStorage.getItem('fenix_saved_username'))) ||
    'Usuário Fênix';

  const { error } = await client
    .from('fenix_kv_store')
    .upsert(
      {
        key: RENDIMENTOS_STORAGE_KEY,
        data: [],
        updated_at: now,
        updated_by: user,
      },
      { onConflict: 'key' }
    );

  if (error) return false;

  memoryCache = [];
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('fenix_rendimentos_updated', { detail: { items: [] } })
    );
  }

  return true;
}
