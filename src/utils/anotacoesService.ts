import { getSupabaseClient, recordSelfSave, withTimeout } from './supabaseClient';

export const ANOTACOES_SUPABASE_KEY = 'fenix_anotacoes_db';

export type AnotacaoUserKey = 'vanessa' | 'jhessica';

export type AnotacaoLineType = 'text' | 'bullet' | 'check';

// Tipo legado mantido para compatibilidade e migração automática sem perda de dados
export interface AnotacaoLine {
  id: string;
  type: AnotacaoLineType;
  text: string;
  checked?: boolean;
}

export interface AnotacaoChecklistItem {
  id: string;
  text: string;
  html?: string;
  checked: boolean;
}

export type AnotacaoBlock =
  | {
      id: string;
      kind: 'text';
      html: string;
    }
  | {
      id: string;
      kind: 'checklist';
      title?: string;
      strikeCompleted?: boolean;
      items: AnotacaoChecklistItem[];
    };

export interface AnotacaoCategory {
  id: string;
  name: string;
  order: number;
  createdAt: string;
}

export type AnotacaoHeaderIconId =
  | 'clipboard-pen'
  | 'briefcase'
  | 'check-square'
  | 'target'
  | 'calendar-days'
  | 'file-text'
  | 'sparkles';

export type AnotacaoHeaderStyleId =
  | 'curvas_oficiais'
  | 'classico_barra'
  | 'minimalista_fino';

export interface AnotacaoSheetConfig {
  headerTitle: string;
  headerIcon: AnotacaoHeaderIconId;
  headerStyle: AnotacaoHeaderStyleId;
}

export interface AnotacaoItem {
  id: string;
  ownerKey: AnotacaoUserKey;
  categoryId: string;
  title: string;
  date: string; // YYYY-MM-DD
  blocks: AnotacaoBlock[];
  lines?: AnotacaoLine[]; // Campo opcional legado (populado apenas se necessário)
  author: string;
  sharedWith: AnotacaoUserKey[];
  createdAt: string;
  updatedAt: string;
  updatedBy?: string;
}

export interface AnotacoesDatabaseV2 {
  version: 2;
  notes: AnotacaoItem[];
  categoriesByUser: Record<AnotacaoUserKey, AnotacaoCategory[]>;
  deletedCategoryIdsByUser?: Record<AnotacaoUserKey, string[]>;
  sheetConfigByUser: Record<AnotacaoUserKey, AnotacaoSheetConfig>;
}

export const ANOTACOES_HEADER_PRESETS = [
  'ANOTAÇÃO',
  'NEGOCIAÇÕES',
  'PENDÊNCIAS',
  'PLANEJAMENTO',
  'METAS',
  'OUTRAS',
];

export const DEFAULT_SHEET_CONFIG: AnotacaoSheetConfig = {
  headerTitle: 'ANOTAÇÃO',
  headerIcon: 'clipboard-pen',
  headerStyle: 'curvas_oficiais',
};

export function createDefaultCategories(nowIso = new Date().toISOString()): AnotacaoCategory[] {
  return [
    { id: 'cat_negociacoes', name: 'Negociações', order: 0, createdAt: nowIso },
    { id: 'cat_pendencias', name: 'Pendências', order: 1, createdAt: nowIso },
    { id: 'cat_metas', name: 'Metas', order: 2, createdAt: nowIso },
    { id: 'cat_outras', name: 'Outras', order: 3, createdAt: nowIso },
  ];
}

export function normalizeAnotacaoUserKey(nameOrUsername?: string | null): AnotacaoUserKey {
  const s = String(nameOrUsername || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (s.includes('jhessica') || s.includes('camargo')) {
    return 'jhessica';
  }
  return 'vanessa';
}

export function getOtherAnotacaoUserKey(userKey: AnotacaoUserKey): AnotacaoUserKey {
  return userKey === 'vanessa' ? 'jhessica' : 'vanessa';
}

export function getAnotacaoUserDisplayName(userKey: AnotacaoUserKey): string {
  return userKey === 'jhessica' ? 'Jhessica Camargo' : 'Vanessa Gomes';
}

export function getAnotacaoUserFirstName(userKey: AnotacaoUserKey): string {
  return userKey === 'jhessica' ? 'Jhessica' : 'Vanessa';
}

export function getTodayLocalDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatAnotacaoDatePtBr(dateStr: string): string {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

export function generateUid(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createTextBlock(html = ''): AnotacaoBlock {
  return {
    id: generateUid('txt'),
    kind: 'text',
    html,
  };
}

export function createChecklistBlock(
  items: AnotacaoChecklistItem[] = [{ id: generateUid('chk'), text: '', checked: false }],
  title = ''
): AnotacaoBlock {
  return {
    id: generateUid('clist'),
    kind: 'checklist',
    title,
    strikeCompleted: true,
    items,
  };
}

export function createNewAnotacaoDraft(
  authorName: string,
  ownerKey: AnotacaoUserKey,
  categoryId: string
): AnotacaoItem {
  const nowIso = new Date().toISOString();
  return {
    id: generateUid('nota'),
    ownerKey,
    categoryId: categoryId || 'cat_outras',
    title: '',
    date: getTodayLocalDate(),
    blocks: [createTextBlock('')],
    author: authorName || getAnotacaoUserDisplayName(ownerKey),
    sharedWith: [],
    createdAt: nowIso,
    updatedAt: nowIso,
    updatedBy: authorName || getAnotacaoUserDisplayName(ownerKey),
  };
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Sanitiza HTML de edição mantendo formatação segura: negrito, itálico, sublinhado,
 * tachado, listas e cores de destaque (mark / span backgroundColor).
 */
export function sanitizeNoteHtml(rawHtml: string): string {
  if (!rawHtml || typeof rawHtml !== 'string') return '';

  // Remoção rápida de tags perigosas antes do parse
  const cleanedRaw = rawHtml
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
    .replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, '');

  if (typeof document === 'undefined') {
    return cleanedRaw;
  }

  const template = document.createElement('div');
  template.innerHTML = cleanedRaw;

  const ALLOWED_TAGS = new Set([
    'B',
    'STRONG',
    'I',
    'EM',
    'U',
    'S',
    'STRIKE',
    'MARK',
    'SPAN',
    'FONT',
    'P',
    'DIV',
    'BR',
    'UL',
    'OL',
    'LI',
  ]);

  const cleanNode = (node: Node): Node | null => {
    if (node.nodeType === Node.TEXT_NODE) {
      return document.createTextNode(node.textContent || '');
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }

    const el = node as HTMLElement;
    const tag = el.tagName.toUpperCase();

    if (!ALLOWED_TAGS.has(tag)) {
      const frag = document.createDocumentFragment();
      el.childNodes.forEach((child) => {
        const cleanedChild = cleanNode(child);
        if (cleanedChild) frag.appendChild(cleanedChild);
      });
      return frag;
    }

    if (tag === 'BR') {
      return document.createElement('br');
    }

    const targetTag = tag === 'FONT' ? 'SPAN' : tag;
    const outEl = document.createElement(targetTag.toLowerCase());

    // Preserva estilos seguros (destaques, cor do texto, fonte, tamanho da fonte e text-decoration)
    const bg = el.style?.backgroundColor;
    const fontColorAttr = tag === 'FONT' ? el.getAttribute('color') : null;
    const fontFaceAttr = tag === 'FONT' ? el.getAttribute('face') : null;
    const color = el.style?.color || fontColorAttr;
    const fontFamily = el.style?.fontFamily || fontFaceAttr;
    const rawFontSize = el.style?.fontSize;
    const textDecoration = el.style?.textDecoration;
    const fontWeight = el.style?.fontWeight;
    const fontStyle = el.style?.fontStyle;

    if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
      outEl.style.backgroundColor = bg;
      if (targetTag === 'SPAN' || targetTag === 'MARK') {
        outEl.style.borderRadius = '3px';
        outEl.style.padding = '0 2px';
      }
    }
    if (color && color !== 'inherit') {
      outEl.style.color = color;
    }
    if (fontFamily && fontFamily !== 'inherit') {
      const safeFamily = fontFamily.replace(/[;{}<>]/g, '').trim();
      if (safeFamily) {
        outEl.style.fontFamily = safeFamily;
      }
    }
    if (rawFontSize) {
      const pxMatch = rawFontSize.trim().match(/^(\d+(?:\.\d+)?)px$/i);
      if (pxMatch) {
        const px = Math.min(36, Math.max(10, Math.round(parseFloat(pxMatch[1]))));
        outEl.style.fontSize = `${px}px`;
        if (px > 18) {
          outEl.style.lineHeight = `${Math.ceil(px * 1.35)}px`;
        }
      }
    }
    if (textDecoration && textDecoration !== 'none') {
      outEl.style.textDecoration = textDecoration;
    }
    if (fontWeight === 'bold' || fontWeight === '700') {
      outEl.style.fontWeight = '700';
    }
    if (fontStyle === 'italic') {
      outEl.style.fontStyle = 'italic';
    }
    if (tag === 'MARK' && !outEl.style.backgroundColor) {
      outEl.style.backgroundColor = '#FEF08A';
      outEl.style.borderRadius = '3px';
      outEl.style.padding = '0 2px';
    }

    el.childNodes.forEach((child) => {
      const cleanedChild = cleanNode(child);
      if (cleanedChild) outEl.appendChild(cleanedChild);
    });

    return outEl;
  };

  const outContainer = document.createElement('div');
  template.childNodes.forEach((child) => {
    const cleaned = cleanNode(child);
    if (cleaned) outContainer.appendChild(cleaned);
  });

  return outContainer.innerHTML;
}

export function stripHtmlToPlainText(html: string): string {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getNotePreviewText(note: AnotacaoItem): string {
  const parts: string[] = [];
  for (const block of note.blocks || []) {
    if (block.kind === 'text') {
      const plain = stripHtmlToPlainText(block.html);
      if (plain) parts.push(plain);
    } else if (block.kind === 'checklist') {
      for (const item of block.items || []) {
        if (item.text?.trim()) {
          parts.push(`${item.checked ? '☑' : '☐'} ${item.text.trim()}`);
        }
      }
    }
  }
  return parts.join(' ').trim();
}

export function getNoteChecklistStats(note: AnotacaoItem): { total: number; done: number } {
  let total = 0;
  let done = 0;
  for (const block of note.blocks || []) {
    if (block.kind === 'checklist') {
      for (const item of block.items || []) {
        if (item.text.trim() || block.items.length > 0) {
          total += 1;
          if (item.checked) done += 1;
        }
      }
    }
  }
  return { total, done };
}

/**
 * Converte linhas legadas (`lines`) no formato contínuo (`blocks`) sem perder texto, bullets ou checklists.
 */
function convertLegacyLinesToBlocks(lines: AnotacaoLine[]): AnotacaoBlock[] {
  const blocks: AnotacaoBlock[] = [];
  let htmlBuffer: string[] = [];
  let pendingListType: 'ul' | null = null;
  let pendingChecklist: AnotacaoChecklistItem[] = [];

  const flushText = () => {
    if (pendingListType === 'ul') {
      htmlBuffer.push('</ul>');
      pendingListType = null;
    }
    if (htmlBuffer.length > 0) {
      const combined = htmlBuffer.join('');
      if (combined.trim()) {
        blocks.push(createTextBlock(combined));
      }
      htmlBuffer = [];
    }
  };

  const flushChecklist = () => {
    if (pendingChecklist.length > 0) {
      blocks.push(createChecklistBlock(pendingChecklist));
      pendingChecklist = [];
    }
  };

  for (const line of lines) {
    const lineText = typeof line?.text === 'string' ? line.text : '';
    if (line?.type === 'check') {
      flushText();
      pendingChecklist.push({
        id: String(line.id || generateUid('chk')),
        text: lineText,
        checked: Boolean(line.checked),
      });
    } else if (line?.type === 'bullet') {
      flushChecklist();
      if (pendingListType !== 'ul') {
        htmlBuffer.push('<ul>');
        pendingListType = 'ul';
      }
      htmlBuffer.push(`<li>${lineText ? escapeHtml(lineText) : '<br>'}</li>`);
    } else {
      flushChecklist();
      if (pendingListType === 'ul') {
        htmlBuffer.push('</ul>');
        pendingListType = null;
      }
      if (lineText) {
        htmlBuffer.push(`<p>${escapeHtml(lineText)}</p>`);
      } else {
        htmlBuffer.push('<p><br></p>');
      }
    }
  }

  flushChecklist();
  flushText();

  if (blocks.length === 0) {
    return [createTextBlock('')];
  }
  // Garante sempre pelo menos um bloco de texto editável ao final se o último for checklist
  if (blocks[blocks.length - 1]?.kind !== 'text') {
    blocks.push(createTextBlock(''));
  }
  return blocks;
}

function normalizeDeletedCategoryIds(rawIds: unknown): string[] {
  if (!Array.isArray(rawIds)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of rawIds) {
    const id = String(raw || '').trim();
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

function normalizeCategories(rawList: unknown, deletedIds: string[] = []): AnotacaoCategory[] {
  const deletedSet = new Set(deletedIds);
  const nowIso = new Date().toISOString();
  const safeFallbackList = (): AnotacaoCategory[] => {
    const survivingDefaults = createDefaultCategories(nowIso).filter((c) => !deletedSet.has(c.id));
    if (survivingDefaults.length > 0) return survivingDefaults;
    return [{ id: 'cat_geral_ativa', name: 'Geral', order: 0, createdAt: nowIso }];
  };

  if (!Array.isArray(rawList) || rawList.length === 0) {
    return safeFallbackList();
  }

  const seenIds = new Set<string>();
  const list: AnotacaoCategory[] = [];
  rawList.forEach((raw: any, index: number) => {
    if (!raw || typeof raw !== 'object') return;
    const id = String(raw.id || '').trim() || generateUid('cat');
    const name = String(raw.name || '').trim();
    if (!name || seenIds.has(id) || deletedSet.has(id)) return;
    seenIds.add(id);
    list.push({
      id,
      name,
      order: typeof raw.order === 'number' ? raw.order : index,
      createdAt: raw.createdAt || nowIso,
    });
  });

  if (list.length === 0) return safeFallbackList();
  return list.sort((a, b) => a.order - b.order);
}

function normalizeSheetConfig(raw: unknown): AnotacaoSheetConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SHEET_CONFIG };
  const obj = raw as Record<string, any>;
  const validIcons: AnotacaoHeaderIconId[] = [
    'clipboard-pen',
    'briefcase',
    'check-square',
    'target',
    'calendar-days',
    'file-text',
    'sparkles',
  ];
  const validStyles: AnotacaoHeaderStyleId[] = [
    'curvas_oficiais',
    'classico_barra',
    'minimalista_fino',
  ];
  return {
    headerTitle:
      typeof obj.headerTitle === 'string' && obj.headerTitle.trim()
        ? obj.headerTitle.trim().slice(0, 32)
        : DEFAULT_SHEET_CONFIG.headerTitle,
    headerIcon: validIcons.includes(obj.headerIcon)
      ? obj.headerIcon
      : DEFAULT_SHEET_CONFIG.headerIcon,
    headerStyle: validStyles.includes(obj.headerStyle)
      ? obj.headerStyle
      : DEFAULT_SHEET_CONFIG.headerStyle,
  };
}

function normalizeBlocks(rawBlocks: unknown, legacyLines?: unknown, legacyContent?: unknown, idPrefix = 'nota'): AnotacaoBlock[] {
  if (Array.isArray(rawBlocks) && rawBlocks.length > 0) {
    const normalized: AnotacaoBlock[] = [];
    for (let i = 0; i < rawBlocks.length; i++) {
      const b = rawBlocks[i] as any;
      if (!b || typeof b !== 'object') continue;
      if (b.kind === 'checklist') {
        const items: AnotacaoChecklistItem[] = Array.isArray(b.items)
          ? b.items.map((it: any, idx: number) => {
              const rawText = typeof it?.text === 'string' ? it.text : String(it?.text || '');
              const cleanHtml =
                typeof it?.html === 'string' && it.html.trim()
                  ? sanitizeNoteHtml(it.html)
                  : undefined;
              const derivedText =
                cleanHtml !== undefined ? stripHtmlToPlainText(cleanHtml) || rawText : rawText;
              return {
                id: String(it?.id || `${idPrefix}_chk_${i}_${idx}`),
                text: derivedText,
                ...(cleanHtml !== undefined ? { html: cleanHtml } : {}),
                checked: Boolean(it?.checked),
              };
            })
          : [];
        normalized.push({
          id: String(b.id || `${idPrefix}_cl_${i}`),
          kind: 'checklist',
          title: typeof b.title === 'string' ? b.title : '',
          strikeCompleted: b.strikeCompleted !== false,
          items,
        });
      } else {
        normalized.push({
          id: String(b.id || `${idPrefix}_txt_${i}`),
          kind: 'text',
          html: typeof b.html === 'string' ? sanitizeNoteHtml(b.html) : '',
        });
      }
    }
    if (normalized.length > 0) {
      return normalized;
    }
  }

  if (Array.isArray(legacyLines) && legacyLines.length > 0) {
    return convertLegacyLinesToBlocks(legacyLines as AnotacaoLine[]);
  }

  if (typeof legacyContent === 'string' && legacyContent.trim()) {
    const html = legacyContent
      .split('\n')
      .map((line) => `<p>${line ? escapeHtml(line) : '<br>'}</p>`)
      .join('');
    return [createTextBlock(html)];
  }

  return [createTextBlock('')];
}

function normalizeNoteItem(
  raw: any,
  categoriesByUser: Record<AnotacaoUserKey, AnotacaoCategory[]>
): AnotacaoItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim();
  if (!id) return null;

  const author =
    typeof raw.author === 'string' && raw.author.trim() ? raw.author.trim() : 'Vanessa Gomes';
  const ownerKey: AnotacaoUserKey =
    raw.ownerKey === 'vanessa' || raw.ownerKey === 'jhessica'
      ? raw.ownerKey
      : normalizeAnotacaoUserKey(author);

  const userCategories = categoriesByUser[ownerKey] || createDefaultCategories();
  const rawCatId = typeof raw.categoryId === 'string' ? raw.categoryId.trim() : '';
  const hasCat = userCategories.some((c) => c.id === rawCatId);
  const fallbackCat =
    userCategories.find((c) => c.id === 'cat_outras')?.id || userCategories[0]?.id || 'cat_outras';
  const categoryId = hasCat ? rawCatId : fallbackCat;

  const sharedWith: AnotacaoUserKey[] = Array.isArray(raw.sharedWith)
    ? Array.from(
        new Set(
          raw.sharedWith.filter(
            (k: any): k is AnotacaoUserKey =>
              (k === 'vanessa' || k === 'jhessica') && k !== ownerKey
          )
        )
      )
    : [];

  return {
    id,
    ownerKey,
    categoryId,
    title: typeof raw.title === 'string' ? raw.title : '',
    date: typeof raw.date === 'string' && raw.date ? raw.date : getTodayLocalDate(),
    blocks: normalizeBlocks(raw.blocks, raw.lines, raw.content, id),
    author,
    sharedWith,
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || raw.createdAt || new Date().toISOString(),
    updatedBy: raw.updatedBy || author || undefined,
  };
}

export function sortAnotacoes(list: AnotacaoItem[]): AnotacaoItem[] {
  return [...list].sort((a, b) => {
    const updatedCompare = (b.updatedAt || '').localeCompare(a.updatedAt || '');
    if (updatedCompare !== 0) return updatedCompare;
    return (b.date || '').localeCompare(a.date || '');
  });
}

export function createEmptyDatabase(): AnotacoesDatabaseV2 {
  return {
    version: 2,
    notes: [],
    categoriesByUser: {
      vanessa: createDefaultCategories(),
      jhessica: createDefaultCategories(),
    },
    deletedCategoryIdsByUser: {
      vanessa: [],
      jhessica: [],
    },
    sheetConfigByUser: {
      vanessa: { ...DEFAULT_SHEET_CONFIG },
      jhessica: { ...DEFAULT_SHEET_CONFIG },
    },
  };
}

/**
 * Faz o parse completo do payload oficial (`fenix_anotacoes_db`), suportando
 * migração transparente de arrays legados (v1) para o banco estruturado (v2).
 */
export function parseAnotacoesDatabase(rawPayload: unknown): AnotacoesDatabaseV2 {
  let data = rawPayload;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return createEmptyDatabase();
    }
  }

  if (!data) {
    return createEmptyDatabase();
  }

  // Formato legado (array direto de AnotacaoItem)
  if (Array.isArray(data)) {
    const base = createEmptyDatabase();
    const seen = new Set<string>();
    const notes: AnotacaoItem[] = [];
    for (const item of data) {
      const normalized = normalizeNoteItem(item, base.categoriesByUser);
      if (normalized && !seen.has(normalized.id)) {
        seen.add(normalized.id);
        notes.push(normalized);
      }
    }
    return {
      ...base,
      notes: sortAnotacoes(notes),
    };
  }

  if (typeof data === 'object') {
    const obj = data as Record<string, any>;
    const deletedCategoryIdsByUser: Record<AnotacaoUserKey, string[]> = {
      vanessa: normalizeDeletedCategoryIds(obj.deletedCategoryIdsByUser?.vanessa),
      jhessica: normalizeDeletedCategoryIds(obj.deletedCategoryIdsByUser?.jhessica),
    };
    const categoriesByUser: Record<AnotacaoUserKey, AnotacaoCategory[]> = {
      vanessa: normalizeCategories(obj.categoriesByUser?.vanessa, deletedCategoryIdsByUser.vanessa),
      jhessica: normalizeCategories(obj.categoriesByUser?.jhessica, deletedCategoryIdsByUser.jhessica),
    };

    const sheetConfigByUser: Record<AnotacaoUserKey, AnotacaoSheetConfig> = {
      vanessa: normalizeSheetConfig(obj.sheetConfigByUser?.vanessa),
      jhessica: normalizeSheetConfig(obj.sheetConfigByUser?.jhessica),
    };

    const rawNotes = Array.isArray(obj.notes) ? obj.notes : [];
    const seen = new Set<string>();
    const notes: AnotacaoItem[] = [];
    for (const item of rawNotes) {
      const normalized = normalizeNoteItem(item, categoriesByUser);
      if (normalized && !seen.has(normalized.id)) {
        seen.add(normalized.id);
        notes.push(normalized);
      }
    }

    return {
      version: 2,
      notes: sortAnotacoes(notes),
      categoriesByUser,
      deletedCategoryIdsByUser,
      sheetConfigByUser,
    };
  }

  return createEmptyDatabase();
}

export function parseAnotacoesPayload(rawPayload: unknown): AnotacaoItem[] {
  return parseAnotacoesDatabase(rawPayload).notes;
}

/**
 * Filtra visibilidade de anotações para o usuário ativo:
 * - Notas próprias (ownerKey === userKey)
 * - Notas compartilhadas com ele (sharedWith.includes(userKey))
 */
export function getVisibleNotesForUser(
  notes: AnotacaoItem[],
  userKey: AnotacaoUserKey
): { owned: AnotacaoItem[]; sharedWithMe: AnotacaoItem[] } {
  const owned: AnotacaoItem[] = [];
  const sharedWithMe: AnotacaoItem[] = [];
  for (const n of notes) {
    if (n.ownerKey === userKey) {
      owned.push(n);
    } else if (Array.isArray(n.sharedWith) && n.sharedWith.includes(userKey)) {
      sharedWithMe.push(n);
    }
  }
  return { owned, sharedWithMe };
}

/**
 * Busca todo o banco de anotações diretamente do Supabase (sem usar localStorage).
 */
export async function fetchAnotacoesDbFromSupabase(): Promise<{
  success: boolean;
  db: AnotacoesDatabaseV2;
  error?: string;
}> {
  const client = getSupabaseClient();
  if (!client) {
    return {
      success: false,
      db: createEmptyDatabase(),
      error: 'Conexão com o Supabase indisponível no momento.',
    };
  }

  try {
    const res = await withTimeout(
      client
        .from('fenix_kv_store')
        .select('data, updated_at')
        .eq('key', ANOTACOES_SUPABASE_KEY)
        .maybeSingle(),
      6000,
      { data: null, error: new Error('Tempo limite excedido ao carregar anotações.') } as any
    );

    if (res?.error) {
      return {
        success: false,
        db: createEmptyDatabase(),
        error: res.error.message || 'Falha ao buscar anotações no Supabase.',
      };
    }

    if (!res?.data || res.data.data === undefined || res.data.data === null) {
      return { success: true, db: createEmptyDatabase() };
    }

    return {
      success: true,
      db: parseAnotacoesDatabase(res.data.data),
    };
  } catch (err: any) {
    return {
      success: false,
      db: createEmptyDatabase(),
      error: err?.message || 'Erro inesperado ao carregar anotações.',
    };
  }
}

async function fetchAndMutateDb(
  currentUser: string,
  mutator: (remoteDb: AnotacoesDatabaseV2) => AnotacoesDatabaseV2
): Promise<{
  success: boolean;
  db: AnotacoesDatabaseV2;
  error?: string;
}> {
  const client = getSupabaseClient();
  if (!client) {
    return {
      success: false,
      db: createEmptyDatabase(),
      error: 'Conexão com o Supabase indisponível. Verifique sua internet e tente novamente.',
    };
  }

  try {
    const { data: remoteRow, error: fetchErr } = await withTimeout(
      client
        .from('fenix_kv_store')
        .select('data')
        .eq('key', ANOTACOES_SUPABASE_KEY)
        .maybeSingle(),
      6000,
      { data: null, error: new Error('Tempo limite ao consultar anotações no Supabase.') } as any
    );

    if (fetchErr) {
      return {
        success: false,
        db: createEmptyDatabase(),
        error: fetchErr.message || 'Erro ao consultar anotações no Supabase.',
      };
    }

    const remoteDb = remoteRow?.data
      ? parseAnotacoesDatabase(remoteRow.data)
      : createEmptyDatabase();

    const nextDb = mutator(remoteDb);
    const nowIso = new Date().toISOString();

    recordSelfSave(ANOTACOES_SUPABASE_KEY, nowIso);

    const { error: upsertErr } = await withTimeout(
      client.from('fenix_kv_store').upsert(
        {
          key: ANOTACOES_SUPABASE_KEY,
          data: nextDb,
          updated_at: nowIso,
          updated_by: currentUser || 'Usuário Fênix',
        },
        { onConflict: 'key' }
      ),
      6000,
      { error: new Error('Tempo limite ao salvar no Supabase.') } as any
    );

    if (upsertErr) {
      return {
        success: false,
        db: remoteDb,
        error: upsertErr.message || 'Erro ao salvar alterações no Supabase.',
      };
    }

    return {
      success: true,
      db: nextDb,
    };
  } catch (err: any) {
    return {
      success: false,
      db: createEmptyDatabase(),
      error: err?.message || 'Falha ao sincronizar anotações com o Supabase.',
    };
  }
}

function sanitizeBlocks(blocks: AnotacaoBlock[]): AnotacaoBlock[] {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return [createTextBlock('')];
  }
  return blocks.map((b) => {
    if (b.kind === 'checklist') {
      return {
        id: b.id || generateUid('clist'),
        kind: 'checklist',
        title: typeof b.title === 'string' ? b.title : '',
        strikeCompleted: b.strikeCompleted !== false,
        items: Array.isArray(b.items)
          ? b.items.map((it) => {
              const cleanHtml =
                typeof it.html === 'string' && it.html.trim()
                  ? sanitizeNoteHtml(it.html)
                  : undefined;
              const plainText =
                cleanHtml !== undefined
                  ? stripHtmlToPlainText(cleanHtml) || (typeof it.text === 'string' ? it.text : '')
                  : typeof it.text === 'string'
                  ? it.text
                  : '';
              return {
                id: it.id || generateUid('chk'),
                text: plainText,
                ...(cleanHtml !== undefined ? { html: cleanHtml } : {}),
                checked: Boolean(it.checked),
              };
            })
          : [],
      };
    }
    return {
      id: b.id || generateUid('txt'),
      kind: 'text',
      html: sanitizeNoteHtml(b.html || ''),
    };
  });
}

/**
 * Cria ou atualiza uma anotação preservando categorias, configurações e anotações de ambas usuárias.
 */
export async function saveAnotacaoInDb(
  note: AnotacaoItem,
  currentUser: string
): Promise<{
  success: boolean;
  db: AnotacoesDatabaseV2;
  savedNote?: AnotacaoItem;
  error?: string;
}> {
  let savedNoteRef: AnotacaoItem | undefined;

  const result = await fetchAndMutateDb(currentUser, (remoteDb) => {
    const nowIso = new Date().toISOString();
    const existing = remoteDb.notes.find((n) => n.id === note.id);

    const ownerKey: AnotacaoUserKey = existing?.ownerKey || note.ownerKey || normalizeAnotacaoUserKey(currentUser);
    const ownerCats = remoteDb.categoriesByUser[ownerKey] || createDefaultCategories();
    const catValid = ownerCats.some((c) => c.id === note.categoryId);
    const resolvedCategoryId = catValid
      ? note.categoryId
      : existing?.categoryId && ownerCats.some((c) => c.id === existing.categoryId)
      ? existing.categoryId
      : ownerCats[0]?.id || 'cat_outras';

    const cleanSharedWith: AnotacaoUserKey[] = Array.isArray(note.sharedWith)
      ? Array.from(
          new Set(
            note.sharedWith.filter(
              (k): k is AnotacaoUserKey =>
                (k === 'vanessa' || k === 'jhessica') && k !== ownerKey
            )
          )
        )
      : existing?.sharedWith || [];

    const savedNote: AnotacaoItem = {
      id: note.id,
      ownerKey,
      categoryId: resolvedCategoryId,
      title: typeof note.title === 'string' ? note.title : '',
      date: note.date || existing?.date || getTodayLocalDate(),
      blocks: sanitizeBlocks(note.blocks),
      author: existing?.author || note.author || currentUser || getAnotacaoUserDisplayName(ownerKey),
      sharedWith: cleanSharedWith,
      createdAt: existing?.createdAt || note.createdAt || nowIso,
      updatedAt: nowIso,
      updatedBy: currentUser || note.author || getAnotacaoUserDisplayName(ownerKey),
    };

    savedNoteRef = savedNote;

    const updatedNotes = sortAnotacoes(
      existing
        ? remoteDb.notes.map((n) => (n.id === savedNote.id ? savedNote : n))
        : [savedNote, ...remoteDb.notes]
    );

    return {
      ...remoteDb,
      notes: updatedNotes,
    };
  });

  return {
    ...result,
    savedNote: savedNoteRef,
  };
}

export async function deleteAnotacaoInDb(
  noteId: string,
  currentUser: string
): Promise<{
  success: boolean;
  db: AnotacoesDatabaseV2;
  error?: string;
}> {
  return fetchAndMutateDb(currentUser, (remoteDb) => ({
    ...remoteDb,
    notes: sortAnotacoes(remoteDb.notes.filter((n) => n.id !== noteId)),
  }));
}

export async function saveUserCategoriesInDb(
  userKey: AnotacaoUserKey,
  categories: AnotacaoCategory[],
  currentUser: string,
  reassignDeletedCategoryToId?: string
): Promise<{
  success: boolean;
  db: AnotacoesDatabaseV2;
  error?: string;
}> {
  return fetchAndMutateDb(currentUser, (remoteDb) => {
    const nowIso = new Date().toISOString();
    const cleanCats: AnotacaoCategory[] = categories
      .map((c, idx) => ({
        id: c.id || generateUid('cat'),
        name: c.name.trim(),
        order: idx,
        createdAt: c.createdAt || nowIso,
      }))
      .filter((c) => Boolean(c.name));

    const prevDeleted = remoteDb.deletedCategoryIdsByUser?.[userKey] || [];
    const prevActiveIds = (remoteDb.categoriesByUser[userKey] || []).map((c) => c.id);
    const nextActiveIdSet = new Set(cleanCats.map((c) => c.id));
    const removedIds = prevActiveIds.filter((id) => !nextActiveIdSet.has(id));
    const nextDeletedIds = Array.from(
      new Set([...prevDeleted.filter((id) => !nextActiveIdSet.has(id)), ...removedIds])
    );

    const finalCats =
      cleanCats.length > 0 ? cleanCats : normalizeCategories([], nextDeletedIds);
    const validIds = new Set(finalCats.map((c) => c.id));
    const fallbackId =
      (reassignDeletedCategoryToId && validIds.has(reassignDeletedCategoryToId)
        ? reassignDeletedCategoryToId
        : null) ||
      finalCats.find((c) => c.id === 'cat_outras')?.id ||
      finalCats[0].id;

    // Atualiza categoria das notas do usuário caso alguma pasta tenha sido excluída
    const nextNotes = remoteDb.notes.map((n) => {
      if (n.ownerKey === userKey && !validIds.has(n.categoryId)) {
        return { ...n, categoryId: fallbackId, updatedAt: nowIso };
      }
      return n;
    });

    return {
      ...remoteDb,
      notes: nextNotes,
      categoriesByUser: {
        ...remoteDb.categoriesByUser,
        [userKey]: finalCats,
      },
      deletedCategoryIdsByUser: {
        vanessa: remoteDb.deletedCategoryIdsByUser?.vanessa || [],
        jhessica: remoteDb.deletedCategoryIdsByUser?.jhessica || [],
        [userKey]: nextDeletedIds,
      },
    };
  });
}

export async function saveUserSheetConfigInDb(
  userKey: AnotacaoUserKey,
  config: AnotacaoSheetConfig,
  currentUser: string
): Promise<{
  success: boolean;
  db: AnotacoesDatabaseV2;
  error?: string;
}> {
  return fetchAndMutateDb(currentUser, (remoteDb) => ({
    ...remoteDb,
    sheetConfigByUser: {
      ...remoteDb.sheetConfigByUser,
      [userKey]: normalizeSheetConfig(config),
    },
  }));
}
