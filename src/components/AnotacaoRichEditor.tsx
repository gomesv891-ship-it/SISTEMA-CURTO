import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import { Check, Plus, Trash2 } from 'lucide-react';
import {
  AnotacaoBlock,
  AnotacaoChecklistItem,
  createChecklistBlock,
  createTextBlock,
  escapeHtml,
  generateUid,
  sanitizeNoteHtml,
} from '../utils/anotacoesService';
import { NOTEBOOK_LINE_HEIGHT } from './AnotacaoFolhaDocument';

export const FONT_SIZE_STEPS = [12, 13, 14, 15, 16, 18, 20, 22, 24, 28] as const;
export const DEFAULT_FONT_SIZE = 16;

export const FONT_FAMILY_OPTIONS = [
  { id: 'inter', label: 'Inter (Padrão)', value: "'Inter', 'Segoe UI', Arial, sans-serif" },
  { id: 'arial', label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { id: 'georgia', label: 'Georgia', value: "Georgia, 'Times New Roman', serif" },
  { id: 'times', label: 'Times New Roman', value: "'Times New Roman', Times, serif" },
  { id: 'courier', label: 'Courier New', value: "'Courier New', Courier, monospace" },
  { id: 'verdana', label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { id: 'trebuchet', label: 'Trebuchet MS', value: "'Trebuchet MS', sans-serif" },
] as const;

export interface ActiveFormatsState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  unorderedList: boolean;
  orderedList: boolean;
  fontSize?: number;
  fontFamily?: string | null;
  textColor?: string | null;
}

export interface AnotacaoRichEditorHandle {
  focusEditor: () => void;
  saveSelection: () => void;
  applyCommand: (
    command:
      | 'bold'
      | 'italic'
      | 'underline'
      | 'strikeThrough'
      | 'insertUnorderedList'
      | 'insertOrderedList'
  ) => void;
  applyHighlight: (color: string | null) => void;
  applyTextColor: (color: string | null) => void;
  applyFontFamily: (fontFamily: string | null) => void;
  setFontSize: (px: number) => void;
  changeFontSize: (direction: 'increase' | 'decrease') => void;
  insertChecklist: () => void;
  focusLastBlock: () => void;
}

interface AnotacaoRichEditorProps {
  noteId: string;
  blocks: AnotacaoBlock[];
  onChangeBlocks: (nextBlocks: AnotacaoBlock[], flushImmediate?: boolean) => void;
  onActivateEditing?: () => void;
  onActiveFormatsChange?: (formats: ActiveFormatsState) => void;
  isEditing: boolean;
  readOnly?: boolean;
}

type EditorTarget =
  | { kind: 'text'; blockId: string }
  | { kind: 'checklist'; blockId: string; itemId: string };

const BLOCK_TAG_NAMES = new Set(['P', 'DIV', 'LI', 'UL', 'OL', 'H1', 'H2', 'H3']);

function unwrapIfEmptyInlineWrapper(el: HTMLElement) {
  const tag = el.tagName.toUpperCase();
  if (tag !== 'SPAN' && tag !== 'FONT') return;
  const styleAttr = el.getAttribute('style');
  const hasStyle = Boolean(styleAttr && styleAttr.trim());
  const hasOtherAttrs = Array.from(el.attributes).some(
    (attr) => attr.name.toLowerCase() !== 'style'
  );
  if (!hasStyle && !hasOtherAttrs) {
    const parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) {
      parent.insertBefore(el.firstChild, el);
    }
    parent.removeChild(el);
  }
}

function stripInlineStyleFromFragment(
  root: ParentNode,
  prop: 'color' | 'fontSize' | 'fontFamily'
) {
  const elements = Array.from(root.querySelectorAll('span, font, mark, b, strong, i, em, u, s, strike')) as HTMLElement[];
  for (const el of elements) {
    if (prop === 'color') {
      if (el.tagName === 'FONT') el.removeAttribute('color');
      el.style.color = '';
    } else if (prop === 'fontSize') {
      if (el.tagName === 'FONT') el.removeAttribute('size');
      el.style.fontSize = '';
      el.style.lineHeight = '';
    } else if (prop === 'fontFamily') {
      if (el.tagName === 'FONT') el.removeAttribute('face');
      el.style.fontFamily = '';
    }
    if (!el.getAttribute('style')?.trim()) {
      el.removeAttribute('style');
    }
    unwrapIfEmptyInlineWrapper(el);
  }
}

function getEffectiveFontSizeAtSelection(rootEl: HTMLElement, sel: Selection): number {
  let node: Node | null = sel.anchorNode || rootEl;
  while (node && node !== rootEl) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (el.style?.fontSize) {
        const parsed = parseFloat(el.style.fontSize);
        if (!isNaN(parsed) && parsed > 0) return parsed;
      }
    }
    node = node.parentNode;
  }
  try {
    const anchorEl =
      sel.anchorNode?.nodeType === Node.ELEMENT_NODE
        ? (sel.anchorNode as HTMLElement)
        : sel.anchorNode?.parentElement || rootEl;
    const computed = parseFloat(window.getComputedStyle(anchorEl).fontSize || '');
    if (!isNaN(computed) && computed > 0) return computed;
  } catch {}
  return DEFAULT_FONT_SIZE;
}

function getEffectiveTextColorAtSelection(rootEl: HTMLElement, sel: Selection): string | null {
  let node: Node | null = sel.anchorNode || rootEl;
  while (node && node !== rootEl) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (el.style?.color && el.style.color !== 'inherit') {
        return el.style.color;
      }
      if (el.tagName === 'FONT' && el.getAttribute('color')) {
        return el.getAttribute('color');
      }
    }
    node = node.parentNode;
  }
  return null;
}

function getEffectiveFontFamilyAtSelection(rootEl: HTMLElement, sel: Selection): string | null {
  let node: Node | null = sel.anchorNode || rootEl;
  while (node && node !== rootEl) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (el.style?.fontFamily && el.style.fontFamily !== 'inherit') {
        return el.style.fontFamily;
      }
      if (el.tagName === 'FONT' && el.getAttribute('face')) {
        return el.getAttribute('face');
      }
    }
    node = node.parentNode;
  }
  return null;
}

function applyStyledSpanToRange(
  rootEl: HTMLElement,
  sel: Selection,
  prop: 'color' | 'fontSize' | 'fontFamily',
  value: string | null
) {
  if (sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);

  const assignStyle = (el: HTMLElement, val: string) => {
    if (prop === 'color') {
      el.style.color = val;
    } else if (prop === 'fontSize') {
      el.style.fontSize = val;
      const px = parseFloat(val);
      el.style.lineHeight = px > 18 ? `${Math.ceil(px * 1.35)}px` : '';
    } else {
      el.style.fontFamily = val;
    }
  };

  const clearStyle = (el: HTMLElement) => {
    if (prop === 'color') {
      el.style.color = '';
      if (el.tagName === 'FONT') el.removeAttribute('color');
    } else if (prop === 'fontSize') {
      el.style.fontSize = '';
      el.style.lineHeight = '';
      if (el.tagName === 'FONT') el.removeAttribute('size');
    } else {
      el.style.fontFamily = '';
      if (el.tagName === 'FONT') el.removeAttribute('face');
    }
    if (!el.getAttribute('style')?.trim()) {
      el.removeAttribute('style');
    }
  };

  const hasTargetProp = (el: HTMLElement) => {
    if (prop === 'color') return Boolean(el.style?.color || el.getAttribute('color'));
    if (prop === 'fontSize') return Boolean(el.style?.fontSize || el.getAttribute('size'));
    return Boolean(el.style?.fontFamily || el.getAttribute('face'));
  };

  if (value === null) {
    if (range.collapsed) {
      let node: Node | null = range.startContainer;
      let targetAncestor: HTMLElement | null = null;
      while (node && node !== rootEl) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const htmlEl = node as HTMLElement;
          if (hasTargetProp(htmlEl)) {
            targetAncestor = htmlEl;
            break;
          }
        }
        node = node.parentNode;
      }
      if (targetAncestor) {
        if (!targetAncestor.textContent?.replace(/\u200B/g, '').trim()) {
          clearStyle(targetAncestor);
          unwrapIfEmptyInlineWrapper(targetAncestor);
        } else {
          const afterRange = document.createRange();
          afterRange.setStartAfter(targetAncestor);
          afterRange.collapse(true);
          sel.removeAllRanges();
          sel.addRange(afterRange);
        }
      }
      return;
    }

    const candidates = Array.from(
      rootEl.querySelectorAll('span, font, mark, b, strong, i, em, u, s, strike')
    ) as HTMLElement[];
    for (const htmlNode of candidates) {
      try {
        if (!range.intersectsNode(htmlNode)) continue;
      } catch {
        continue;
      }
      clearStyle(htmlNode);
      unwrapIfEmptyInlineWrapper(htmlNode);
    }
    return;
  }

  if (range.collapsed) {
    const startParent =
      range.startContainer.nodeType === Node.ELEMENT_NODE
        ? (range.startContainer as HTMLElement)
        : range.startContainer.parentElement;

    if (
      startParent &&
      rootEl.contains(startParent) &&
      startParent !== rootEl &&
      startParent.tagName === 'SPAN' &&
      (startParent.textContent || '') === '\u200B'
    ) {
      assignStyle(startParent, value);
      const r = document.createRange();
      r.selectNodeContents(startParent);
      r.collapse(false);
      sel.removeAllRanges();
      sel.addRange(r);
      return;
    }

    const span = document.createElement('span');
    assignStyle(span, value);
    const zwsp = document.createTextNode('\u200B');
    span.appendChild(zwsp);
    range.insertNode(span);
    const innerRange = document.createRange();
    innerRange.setStart(zwsp, 1);
    innerRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(innerRange);
    return;
  }

  const frag = range.extractContents();
  stripInlineStyleFromFragment(frag, prop);

  const hasBlockElement = Array.from(frag.childNodes).some(
    (n) =>
      n.nodeType === Node.ELEMENT_NODE &&
      BLOCK_TAG_NAMES.has((n as HTMLElement).tagName.toUpperCase())
  );

  const createStyledSpan = () => {
    const span = document.createElement('span');
    assignStyle(span, value);
    return span;
  };

  if (!hasBlockElement) {
    const wrapper = createStyledSpan();
    wrapper.appendChild(frag);
    range.insertNode(wrapper);
    const newRange = document.createRange();
    newRange.selectNodeContents(wrapper);
    sel.removeAllRanges();
    sel.addRange(newRange);
    return;
  }

  const wrapBlockInlineContents = (container: Node) => {
    const children = Array.from(container.childNodes);
    for (const child of children) {
      if (
        child.nodeType === Node.ELEMENT_NODE &&
        BLOCK_TAG_NAMES.has((child as HTMLElement).tagName.toUpperCase())
      ) {
        wrapBlockInlineContents(child);
      } else if (child.nodeType === Node.TEXT_NODE && !(child.textContent || '')) {
        continue;
      } else {
        const wrapper = createStyledSpan();
        container.insertBefore(wrapper, child);
        wrapper.appendChild(child);
      }
    }
  };

  wrapBlockInlineContents(frag);
  const firstNode = frag.firstChild;
  const lastNode = frag.lastChild;
  range.insertNode(frag);

  if (firstNode && lastNode) {
    try {
      const newRange = document.createRange();
      newRange.setStartBefore(firstNode);
      newRange.setEndAfter(lastNode);
      sel.removeAllRanges();
      sel.addRange(newRange);
    } catch {}
  }
}

interface EditableTextBlockProps {
  noteId: string;
  block: Extract<AnotacaoBlock, { kind: 'text' }>;
  isOnlyAndEmpty: boolean;
  readOnly: boolean;
  onFocusBlock: (blockId: string, el: HTMLDivElement) => void;
  onBlurBlock: () => void;
  onInputHtml: (blockId: string, html: string) => void;
  onSelectionChange: () => void;
  registerEl: (blockId: string, el: HTMLDivElement | null) => void;
}

const EditableTextBlock: React.FC<EditableTextBlockProps> = ({
  noteId,
  block,
  isOnlyAndEmpty,
  readOnly,
  onFocusBlock,
  onBlurBlock,
  onInputHtml,
  onSelectionChange,
  registerEl,
}) => {
  const elRef = useRef<HTMLDivElement | null>(null);
  const lastHtmlRef = useRef<string>(block.html);
  const lastNoteIdRef = useRef<string>(noteId);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;

    const nextHtml = block.html || '';
    const noteChanged = lastNoteIdRef.current !== noteId;

    if (noteChanged) {
      el.innerHTML = nextHtml;
      lastHtmlRef.current = nextHtml;
      lastNoteIdRef.current = noteId;
      return;
    }

    if (el.innerHTML !== nextHtml) {
      el.innerHTML = nextHtml;
      lastHtmlRef.current = nextHtml;
    }
  }, [noteId, block.html]);

  if (readOnly) {
    return (
      <div
        className="anotacao-rich-content"
        style={{
          fontSize: `${DEFAULT_FONT_SIZE}px`,
          lineHeight: `${NOTEBOOK_LINE_HEIGHT}px`,
          color: '#0F172A',
          wordBreak: 'break-word',
          overflowWrap: 'anywhere',
          minHeight: block.html ? `${NOTEBOOK_LINE_HEIGHT}px` : '0px',
        }}
        dangerouslySetInnerHTML={{ __html: sanitizeNoteHtml(block.html || '') }}
      />
    );
  }

  return (
    <div
      ref={(node) => {
        elRef.current = node;
        registerEl(block.id, node);
      }}
      contentEditable
      suppressContentEditableWarning
      spellCheck
      data-placeholder={
        isOnlyAndEmpty
          ? 'Clique aqui e comece a escrever livremente na folha...'
          : 'Continue escrevendo...'
      }
      onFocus={(e) => {
        onFocusBlock(block.id, e.currentTarget);
        onSelectionChange();
      }}
      onBlur={() => {
        onBlurBlock();
      }}
      onPaste={(e) => {
        const htmlData = e.clipboardData?.getData('text/html');
        const plainData = e.clipboardData?.getData('text/plain') || '';
        if (htmlData) {
          e.preventDefault();
          const cleaned = sanitizeNoteHtml(htmlData)
            .replace(/line-height\s*:[^;"']+;?/gi, '')
            .replace(/margin[^:]*:[^;"']+;?/gi, '')
            .replace(/padding[^:]*:[^;"']+;?/gi, '');
          document.execCommand('insertHTML', false, cleaned || plainData);
          const nextHtml = e.currentTarget.innerHTML;
          lastHtmlRef.current = nextHtml;
          onInputHtml(block.id, nextHtml);
          onSelectionChange();
        }
      }}
      onMouseUp={onSelectionChange}
      onKeyUp={onSelectionChange}
      onInput={(e) => {
        const html = e.currentTarget.innerHTML;
        lastHtmlRef.current = html;
        onInputHtml(block.id, html);
        onSelectionChange();
      }}
      className="anotacao-rich-content rich-text-editor"
      style={{
        outline: 'none',
        fontSize: `${DEFAULT_FONT_SIZE}px`,
        lineHeight: `${NOTEBOOK_LINE_HEIGHT}px`,
        color: '#0F172A',
        minHeight: `${NOTEBOOK_LINE_HEIGHT}px`,
        wordBreak: 'break-word',
        overflowWrap: 'anywhere',
        cursor: 'text',
      }}
    />
  );
};

interface ChecklistItemEditableProps {
  noteId: string;
  value: string;
  html?: string;
  checked: boolean;
  strikeCompleted: boolean;
  autoFocus?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  onSelectionChange?: () => void;
  onChange: (text: string, html: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  inputRef?: (el: HTMLDivElement | null) => void;
}

const ChecklistItemEditable: React.FC<ChecklistItemEditableProps> = ({
  noteId,
  value,
  html,
  checked,
  strikeCompleted,
  autoFocus,
  onFocus,
  onBlur,
  onSelectionChange,
  onChange,
  onKeyDown,
  inputRef,
}) => {
  const localRef = useRef<HTMLDivElement | null>(null);
  const lastHtmlRef = useRef<string>(html ?? (value ? escapeHtml(value) : ''));
  const lastNoteIdRef = useRef<string>(noteId);

  useEffect(() => {
    const el = localRef.current;
    if (!el) return;
    const expectedHtml = html !== undefined ? html : value ? escapeHtml(value) : '';
    const noteChanged = lastNoteIdRef.current !== noteId;

    if (noteChanged) {
      el.innerHTML = expectedHtml;
      lastHtmlRef.current = expectedHtml;
      lastNoteIdRef.current = noteId;
      return;
    }

    if (el.innerHTML !== expectedHtml && (document.activeElement !== el || expectedHtml !== lastHtmlRef.current)) {
      el.innerHTML = expectedHtml;
      lastHtmlRef.current = expectedHtml;
    }
  }, [noteId, value, html]);

  useEffect(() => {
    if (autoFocus && localRef.current) {
      const el = localRef.current;
      el.focus();
      try {
        const sel = window.getSelection();
        if (sel) {
          const range = document.createRange();
          range.selectNodeContents(el);
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      } catch {}
    }
  }, [autoFocus]);

  return (
    <div
      ref={(el) => {
        localRef.current = el;
        if (inputRef) inputRef(el);
      }}
      contentEditable
      suppressContentEditableWarning
      spellCheck
      data-placeholder="Item do checklist..."
      onFocus={() => {
        onFocus?.();
        onSelectionChange?.();
      }}
      onBlur={() => {
        onBlur?.();
      }}
      onPaste={(e) => {
        const htmlData = e.clipboardData?.getData('text/html');
        const plain = e.clipboardData?.getData('text/plain') || '';
        e.preventDefault();
        if (htmlData) {
          const cleaned = sanitizeNoteHtml(htmlData)
            .replace(/<\/?(?:p|div|li|ul|ol)[^>]*>/gi, ' ')
            .replace(/<br\s*\/?>/gi, ' ')
            .replace(/line-height\s*:[^;"']+;?/gi, '')
            .replace(/margin[^:]*:[^;"']+;?/gi, '')
            .replace(/padding[^:]*:[^;"']+;?/gi, '')
            .trim();
          document.execCommand('insertHTML', false, cleaned || escapeHtml(plain.replace(/\r?\n/g, ' ')));
        } else {
          document.execCommand('insertText', false, plain.replace(/\r?\n/g, ' '));
        }
        const nextHtml = e.currentTarget.innerHTML;
        const nextText = e.currentTarget.textContent || '';
        lastHtmlRef.current = nextHtml;
        onChange(nextText, nextHtml);
        onSelectionChange?.();
      }}
      onMouseUp={onSelectionChange}
      onKeyUp={onSelectionChange}
      onInput={(e) => {
        const nextHtml = e.currentTarget.innerHTML;
        const nextText = e.currentTarget.textContent || '';
        lastHtmlRef.current = nextHtml;
        onChange(nextText, nextHtml);
        onSelectionChange?.();
      }}
      onKeyDown={onKeyDown}
      className="anotacao-checklist-editable"
      style={{
        width: '100%',
        backgroundColor: 'transparent',
        border: 'none',
        outline: 'none',
        padding: 0,
        margin: 0,
        fontSize: `${DEFAULT_FONT_SIZE}px`,
        lineHeight: `${NOTEBOOK_LINE_HEIGHT}px`,
        minHeight: `${NOTEBOOK_LINE_HEIGHT}px`,
        color: checked ? '#64748B' : '#0F172A',
        textDecoration: checked && strikeCompleted ? 'line-through' : 'none',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        overflowWrap: 'anywhere',
        cursor: 'text',
      }}
    />
  );
};

export const AnotacaoRichEditor = forwardRef<AnotacaoRichEditorHandle, AnotacaoRichEditorProps>(
  (
    {
      noteId,
      blocks,
      onChangeBlocks,
      onActivateEditing,
      onActiveFormatsChange,
      isEditing,
      readOnly = false,
    },
    ref
  ) => {
    const textElsRef = useRef<Record<string, HTMLDivElement | null>>({});
    const checklistInputRefs = useRef<Record<string, HTMLDivElement | null>>({});
    const checklistBlockMapRef = useRef<Record<string, string>>({});
    const activeBlockIdRef = useRef<string | null>(null);
    const activeTargetRef = useRef<EditorTarget | null>(null);
    const savedRangeRef = useRef<Range | null>(null);
    const pendingFocusChecklistItemId = useRef<string | null>(null);

    const safeBlocks = blocks.length > 0 ? blocks : [createTextBlock('')];
    const latestBlocksRef = useRef<AnotacaoBlock[]>(safeBlocks);
    latestBlocksRef.current = safeBlocks;

    const getTargetElement = useCallback((target: EditorTarget | null): HTMLDivElement | null => {
      if (!target) return null;
      if (target.kind === 'text') {
        return textElsRef.current[target.blockId] || null;
      }
      return checklistInputRefs.current[target.itemId] || null;
    }, []);

    const findChecklistBlockIdForItem = useCallback((itemId: string): string | null => {
      if (checklistBlockMapRef.current[itemId]) {
        return checklistBlockMapRef.current[itemId];
      }
      for (const b of latestBlocksRef.current) {
        if (b.kind === 'checklist' && b.items.some((it) => it.id === itemId)) {
          return b.id;
        }
      }
      return null;
    }, []);

    const saveSelection = useCallback(() => {
      if (typeof window === 'undefined') return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      const containerNode = range.commonAncestorContainer;

      const matchedTextEntry = (
        Object.entries(textElsRef.current) as [string, HTMLDivElement | null][]
      ).find(([, el]) => Boolean(el && (el === containerNode || el.contains(containerNode))));

      if (matchedTextEntry) {
        activeBlockIdRef.current = matchedTextEntry[0];
        activeTargetRef.current = { kind: 'text', blockId: matchedTextEntry[0] };
        savedRangeRef.current = range.cloneRange();
        return;
      }

      const matchedChecklistEntry = (
        Object.entries(checklistInputRefs.current) as [string, HTMLDivElement | null][]
      ).find(([, el]) => Boolean(el && (el === containerNode || el.contains(containerNode))));

      if (matchedChecklistEntry) {
        const itemId = matchedChecklistEntry[0];
        const blockId = findChecklistBlockIdForItem(itemId);
        if (blockId) {
          activeBlockIdRef.current = blockId;
          activeTargetRef.current = { kind: 'checklist', blockId, itemId };
          savedRangeRef.current = range.cloneRange();
        }
      }
    }, [findChecklistBlockIdForItem]);

    const emitActiveFormats = useCallback(() => {
      if (!onActiveFormatsChange || typeof document === 'undefined') return;
      try {
        const sel = window.getSelection();
        const activeEl = getTargetElement(activeTargetRef.current);
        let fontSize = DEFAULT_FONT_SIZE;
        let textColor: string | null = null;
        let fontFamily: string | null = null;
        if (sel && sel.rangeCount > 0 && activeEl && activeEl.contains(sel.anchorNode)) {
          fontSize = Math.round(getEffectiveFontSizeAtSelection(activeEl, sel));
          textColor = getEffectiveTextColorAtSelection(activeEl, sel);
          fontFamily = getEffectiveFontFamilyAtSelection(activeEl, sel);
        }
        onActiveFormatsChange({
          bold: document.queryCommandState('bold'),
          italic: document.queryCommandState('italic'),
          underline: document.queryCommandState('underline'),
          strike: document.queryCommandState('strikeThrough'),
          unorderedList: document.queryCommandState('insertUnorderedList'),
          orderedList: document.queryCommandState('insertOrderedList'),
          fontSize,
          fontFamily,
          textColor,
        });
      } catch {}
    }, [onActiveFormatsChange, getTargetElement]);

    useEffect(() => {
      const handleDocSelectionChange = () => {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return;
        const containerNode = sel.getRangeAt(0).commonAncestorContainer;
        const insideText = (
          Object.values(textElsRef.current) as (HTMLDivElement | null)[]
        ).some((el) => el && (el === containerNode || el.contains(containerNode)));
        const insideChecklist = (
          Object.values(checklistInputRefs.current) as (HTMLDivElement | null)[]
        ).some((el) => el && (el === containerNode || el.contains(containerNode)));

        if (insideText || insideChecklist) {
          saveSelection();
          emitActiveFormats();
        }
      };
      document.addEventListener('selectionchange', handleDocSelectionChange);
      return () => document.removeEventListener('selectionchange', handleDocSelectionChange);
    }, [saveSelection, emitActiveFormats]);

    const restoreSelectionOrFocus = useCallback(
      (options?: { preferTextBlock?: boolean }): { el: HTMLDivElement; target: EditorTarget } | null => {
        const currentBlocks = latestBlocksRef.current;
        let resolvedTarget = activeTargetRef.current;
        let targetEl = getTargetElement(resolvedTarget);

        if (options?.preferTextBlock && resolvedTarget?.kind === 'checklist') {
          const checkIdx = currentBlocks.findIndex((b) => b.id === resolvedTarget!.blockId);
          const nextTextBlock =
            currentBlocks.slice(checkIdx + 1).find((b) => b.kind === 'text') ||
            currentBlocks.find((b) => b.kind === 'text');
          if (nextTextBlock) {
            resolvedTarget = { kind: 'text', blockId: nextTextBlock.id };
            targetEl = textElsRef.current[nextTextBlock.id] || null;
          }
        }

        if (!targetEl || !targetEl.isConnected) {
          const fallbackBlockId =
            activeBlockIdRef.current && textElsRef.current[activeBlockIdRef.current]
              ? activeBlockIdRef.current
              : currentBlocks.find((b) => b.kind === 'text' && textElsRef.current[b.id])?.id || null;

          if (fallbackBlockId && textElsRef.current[fallbackBlockId]) {
            resolvedTarget = { kind: 'text', blockId: fallbackBlockId };
            targetEl = textElsRef.current[fallbackBlockId]!;
          } else {
            const firstChecklist = currentBlocks.find((b) => b.kind === 'checklist' && b.items.length > 0);
            if (firstChecklist && firstChecklist.kind === 'checklist') {
              const firstItemId = firstChecklist.items[0].id;
              const checkEl = checklistInputRefs.current[firstItemId];
              if (checkEl) {
                resolvedTarget = {
                  kind: 'checklist',
                  blockId: firstChecklist.id,
                  itemId: firstItemId,
                };
                targetEl = checkEl;
              }
            }
          }
        }

        if (!targetEl || !resolvedTarget) return null;

        activeTargetRef.current = resolvedTarget;
        activeBlockIdRef.current = resolvedTarget.blockId;

        if (document.activeElement !== targetEl) {
          targetEl.focus({ preventScroll: true });
        }

        const sel = window.getSelection();
        if (
          sel &&
          savedRangeRef.current &&
          savedRangeRef.current.startContainer.isConnected &&
          targetEl.contains(savedRangeRef.current.commonAncestorContainer)
        ) {
          try {
            sel.removeAllRanges();
            sel.addRange(savedRangeRef.current);
            return { el: targetEl, target: resolvedTarget };
          } catch {}
        }

        if (sel) {
          const r = document.createRange();
          r.selectNodeContents(targetEl);
          r.collapse(false);
          sel.removeAllRanges();
          sel.addRange(r);
          savedRangeRef.current = r.cloneRange();
        }
        return { el: targetEl, target: resolvedTarget };
      },
      [getTargetElement]
    );

    const syncTargetDom = useCallback(
      (targetEl: HTMLDivElement, target: EditorTarget, flushImmediate = false) => {
        const currentBlocks = latestBlocksRef.current;
        if (target.kind === 'text') {
          const html = targetEl.innerHTML;
          const current = currentBlocks.find((b) => b.id === target.blockId && b.kind === 'text');
          if (current && current.kind === 'text' && current.html === html) {
            return;
          }
          const nextBlocks = currentBlocks.map((b) =>
            b.id === target.blockId && b.kind === 'text' ? { ...b, html } : b
          );
          latestBlocksRef.current = nextBlocks;
          onChangeBlocks(nextBlocks, flushImmediate);
          return;
        }

        const html = targetEl.innerHTML;
        const text = targetEl.textContent || '';
        const nextBlocks = currentBlocks.map((b) => {
          if (b.id !== target.blockId || b.kind !== 'checklist') return b;
          return {
            ...b,
            items: b.items.map((it) =>
              it.id === target.itemId ? { ...it, text, html } : it
            ),
          };
        });
        latestBlocksRef.current = nextBlocks;
        onChangeBlocks(nextBlocks, flushImmediate);
      },
      [onChangeBlocks]
    );

    const handleInsertChecklist = useCallback(() => {
      onActivateEditing?.();
      const newItem: AnotacaoChecklistItem = {
        id: generateUid('chk'),
        text: '',
        html: '',
        checked: false,
      };
      const newChecklist = createChecklistBlock([newItem]);
      pendingFocusChecklistItemId.current = newItem.id;

      const currentBlocks = latestBlocksRef.current;
      const activeId = activeTargetRef.current?.blockId || activeBlockIdRef.current;
      const idx = activeId ? currentBlocks.findIndex((b) => b.id === activeId) : currentBlocks.length - 1;
      const insertAfter = idx >= 0 ? idx : currentBlocks.length - 1;

      const next: AnotacaoBlock[] = [
        ...currentBlocks.slice(0, insertAfter + 1),
        newChecklist,
        ...currentBlocks.slice(insertAfter + 1),
      ];

      const insertedIdx = insertAfter + 1;
      if (next[insertedIdx + 1]?.kind !== 'text') {
        next.splice(insertedIdx + 1, 0, createTextBlock(''));
      }

      checklistBlockMapRef.current[newItem.id] = newChecklist.id;
      activeBlockIdRef.current = newChecklist.id;
      activeTargetRef.current = {
        kind: 'checklist',
        blockId: newChecklist.id,
        itemId: newItem.id,
      };

      latestBlocksRef.current = next;
      onChangeBlocks(next, true);
      setTimeout(() => {
        const input = checklistInputRefs.current[newItem.id];
        if (input) {
          input.focus();
          saveSelection();
          emitActiveFormats();
        }
      }, 40);
    }, [onChangeBlocks, onActivateEditing, saveSelection, emitActiveFormats]);

    useImperativeHandle(
      ref,
      () => ({
        focusEditor: () => {
          onActivateEditing?.();
          restoreSelectionOrFocus();
        },
        focusLastBlock: () => {
          onActivateEditing?.();
          const lastText = [...latestBlocksRef.current].reverse().find((b) => b.kind === 'text');
          if (!lastText) return;
          const el = textElsRef.current[lastText.id];
          if (!el) return;
          el.focus();
          const sel = window.getSelection();
          if (sel) {
            const r = document.createRange();
            r.selectNodeContents(el);
            r.collapse(false);
            sel.removeAllRanges();
            sel.addRange(r);
            savedRangeRef.current = r.cloneRange();
          }
          activeBlockIdRef.current = lastText.id;
          activeTargetRef.current = { kind: 'text', blockId: lastText.id };
          emitActiveFormats();
        },
        saveSelection,
        applyCommand: (command) => {
          onActivateEditing?.();
          const isListCommand =
            command === 'insertUnorderedList' || command === 'insertOrderedList';

          // Listas com marcadores / numeradas funcionam em bloco de texto mesmo quando o cursor estava em um checklist
          if (isListCommand && activeTargetRef.current?.kind === 'checklist') {
            const checkBlockId = activeTargetRef.current.blockId;
            const currentBlocks = latestBlocksRef.current;
            const checkIdx = currentBlocks.findIndex((b) => b.id === checkBlockId);
            const nextBlock = checkIdx >= 0 ? currentBlocks[checkIdx + 1] : undefined;

            if (!nextBlock || nextBlock.kind !== 'text') {
              const newText = createTextBlock('');
              const updatedBlocks: AnotacaoBlock[] = [
                ...currentBlocks.slice(0, checkIdx + 1),
                newText,
                ...currentBlocks.slice(checkIdx + 1),
              ];
              latestBlocksRef.current = updatedBlocks;
              onChangeBlocks(updatedBlocks, true);
              setTimeout(() => {
                const newEl = textElsRef.current[newText.id];
                if (!newEl) return;
                newEl.focus({ preventScroll: true });
                activeBlockIdRef.current = newText.id;
                activeTargetRef.current = { kind: 'text', blockId: newText.id };
                try {
                  document.execCommand('styleWithCSS', false, 'false');
                } catch {}
                document.execCommand(command, false);
                saveSelection();
                emitActiveFormats();
                syncTargetDom(newEl, { kind: 'text', blockId: newText.id }, true);
              }, 30);
              return;
            }
          }

          const resolved = restoreSelectionOrFocus({ preferTextBlock: isListCommand });
          if (!resolved) return;

          try {
            document.execCommand('styleWithCSS', false, 'false');
          } catch {}
          document.execCommand(command, false);
          saveSelection();
          emitActiveFormats();
          syncTargetDom(resolved.el, resolved.target, true);
        },
        applyHighlight: (color) => {
          onActivateEditing?.();
          const resolved = restoreSelectionOrFocus();
          if (!resolved) return;
          const { el, target } = resolved;
          const sel = window.getSelection();
          if (!sel || sel.rangeCount === 0) return;

          const range = sel.getRangeAt(0);

          if (color === null) {
            if (range.collapsed) {
              let node: Node | null = range.startContainer;
              let highlightEl: HTMLElement | null = null;
              while (node && node !== el) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                  const htmlEl = node as HTMLElement;
                  if (htmlEl.tagName === 'MARK' || htmlEl.style?.backgroundColor) {
                    highlightEl = htmlEl;
                    break;
                  }
                }
                node = node.parentNode;
              }
              if (highlightEl) {
                const afterRange = document.createRange();
                afterRange.setStartAfter(highlightEl);
                afterRange.collapse(true);
                sel.removeAllRanges();
                sel.addRange(afterRange);
                if (!highlightEl.textContent?.replace(/\u200B/g, '').trim()) {
                  highlightEl.remove();
                }
              }
            } else {
              try {
                document.execCommand('styleWithCSS', false, 'true');
                document.execCommand('hiliteColor', false, 'transparent');
              } catch {}
              const nodes = Array.from(el.querySelectorAll('mark, span')) as HTMLElement[];
              for (const htmlNode of nodes) {
                try {
                  if (!range.intersectsNode(htmlNode)) continue;
                } catch {
                  continue;
                }
                if (htmlNode.tagName === 'MARK') {
                  const parent = htmlNode.parentNode;
                  if (parent) {
                    while (htmlNode.firstChild) {
                      parent.insertBefore(htmlNode.firstChild, htmlNode);
                    }
                    parent.removeChild(htmlNode);
                  }
                } else if (htmlNode.style?.backgroundColor) {
                  htmlNode.style.backgroundColor = '';
                  htmlNode.style.padding = '';
                  htmlNode.style.borderRadius = '';
                  if (!htmlNode.getAttribute('style')?.trim()) {
                    htmlNode.removeAttribute('style');
                  }
                  unwrapIfEmptyInlineWrapper(htmlNode);
                }
              }
            }
          } else if (range.collapsed) {
            const mark = document.createElement('mark');
            mark.style.backgroundColor = color;
            mark.style.borderRadius = '3px';
            mark.style.padding = '0 2px';
            const zwsp = document.createTextNode('\u200B');
            mark.appendChild(zwsp);
            range.insertNode(mark);
            const innerRange = document.createRange();
            innerRange.setStart(zwsp, 1);
            innerRange.collapse(true);
            sel.removeAllRanges();
            sel.addRange(innerRange);
          } else {
            // Limpa apenas <mark> / backgroundColor no trecho mantendo cor da fonte, tamanho, negrito, itálico, sublinhado e tachado
            const frag = range.extractContents();
            const nestedHighlights = Array.from(frag.querySelectorAll('mark, span')) as HTMLElement[];
            for (const nh of nestedHighlights) {
              if (nh.tagName === 'MARK') {
                const parent = nh.parentNode;
                if (parent) {
                  while (nh.firstChild) parent.insertBefore(nh.firstChild, nh);
                  parent.removeChild(nh);
                }
              } else if (nh.style?.backgroundColor) {
                nh.style.backgroundColor = '';
                nh.style.borderRadius = '';
                nh.style.padding = '';
                if (!nh.getAttribute('style')?.trim()) nh.removeAttribute('style');
                unwrapIfEmptyInlineWrapper(nh);
              }
            }
            const hasBlock = Array.from(frag.childNodes).some(
              (n) =>
                n.nodeType === Node.ELEMENT_NODE &&
                BLOCK_TAG_NAMES.has((n as HTMLElement).tagName.toUpperCase())
            );
            const createMark = () => {
              const mark = document.createElement('mark');
              mark.style.backgroundColor = color;
              mark.style.borderRadius = '3px';
              mark.style.padding = '0 2px';
              return mark;
            };
            if (!hasBlock) {
              const mark = createMark();
              mark.appendChild(frag);
              range.insertNode(mark);
              const newRange = document.createRange();
              newRange.selectNodeContents(mark);
              sel.removeAllRanges();
              sel.addRange(newRange);
            } else {
              const wrapInlineInMark = (container: Node) => {
                const children = Array.from(container.childNodes);
                for (const child of children) {
                  if (
                    child.nodeType === Node.ELEMENT_NODE &&
                    BLOCK_TAG_NAMES.has((child as HTMLElement).tagName.toUpperCase())
                  ) {
                    wrapInlineInMark(child);
                  } else if (child.nodeType === Node.TEXT_NODE && !(child.textContent || '')) {
                    continue;
                  } else {
                    const mark = createMark();
                    container.insertBefore(mark, child);
                    mark.appendChild(child);
                  }
                }
              };
              wrapInlineInMark(frag);
              const firstNode = frag.firstChild;
              const lastNode = frag.lastChild;
              range.insertNode(frag);
              if (firstNode && lastNode) {
                try {
                  const newRange = document.createRange();
                  newRange.setStartBefore(firstNode);
                  newRange.setEndAfter(lastNode);
                  sel.removeAllRanges();
                  sel.addRange(newRange);
                } catch {}
              }
            }
          }

          saveSelection();
          emitActiveFormats();
          syncTargetDom(el, target, true);
        },
        applyTextColor: (color) => {
          onActivateEditing?.();
          const resolved = restoreSelectionOrFocus();
          if (!resolved) return;
          const sel = window.getSelection();
          if (!sel || sel.rangeCount === 0) return;

          applyStyledSpanToRange(resolved.el, sel, 'color', color);
          saveSelection();
          emitActiveFormats();
          syncTargetDom(resolved.el, resolved.target, true);
        },
        applyFontFamily: (fontFamily) => {
          onActivateEditing?.();
          const resolved = restoreSelectionOrFocus();
          if (!resolved) return;
          const sel = window.getSelection();
          if (!sel || sel.rangeCount === 0) return;

          applyStyledSpanToRange(resolved.el, sel, 'fontFamily', fontFamily);
          saveSelection();
          emitActiveFormats();
          syncTargetDom(resolved.el, resolved.target, true);
        },
        setFontSize: (px) => {
          onActivateEditing?.();
          const resolved = restoreSelectionOrFocus();
          if (!resolved) return;
          const sel = window.getSelection();
          if (!sel || sel.rangeCount === 0) return;

          const clamped = Math.min(36, Math.max(10, Math.round(px)));
          applyStyledSpanToRange(resolved.el, sel, 'fontSize', `${clamped}px`);
          saveSelection();
          emitActiveFormats();
          syncTargetDom(resolved.el, resolved.target, true);
        },
        changeFontSize: (direction) => {
          onActivateEditing?.();
          const resolved = restoreSelectionOrFocus();
          if (!resolved) return;
          const sel = window.getSelection();
          if (!sel || sel.rangeCount === 0) return;

          const currentPx = getEffectiveFontSizeAtSelection(resolved.el, sel);
          let nearestIdx = 0;
          let bestDiff = Infinity;
          FONT_SIZE_STEPS.forEach((step, idx) => {
            const diff = Math.abs(step - currentPx);
            if (diff < bestDiff) {
              bestDiff = diff;
              nearestIdx = idx;
            }
          });

          const nextIdx =
            direction === 'increase'
              ? Math.min(FONT_SIZE_STEPS.length - 1, nearestIdx + 1)
              : Math.max(0, nearestIdx - 1);
          const nextPx = FONT_SIZE_STEPS[nextIdx];

          applyStyledSpanToRange(resolved.el, sel, 'fontSize', `${nextPx}px`);
          saveSelection();
          emitActiveFormats();
          syncTargetDom(resolved.el, resolved.target, true);
        },
        insertChecklist: handleInsertChecklist,
      }),
      [
        onActivateEditing,
        restoreSelectionOrFocus,
        saveSelection,
        emitActiveFormats,
        syncTargetDom,
        handleInsertChecklist,
        onChangeBlocks,
      ]
    );

    const handleTextBlockInput = (blockId: string, html: string) => {
      onActivateEditing?.();
      const next = latestBlocksRef.current.map((b) =>
        b.id === blockId && b.kind === 'text' ? { ...b, html } : b
      );
      latestBlocksRef.current = next;
      onChangeBlocks(next, false);
    };

    const handleToggleCheckItem = (blockId: string, itemId: string) => {
      const next = latestBlocksRef.current.map((b) => {
        if (b.id !== blockId || b.kind !== 'checklist') return b;
        return {
          ...b,
          items: b.items.map((it) =>
            it.id === itemId ? { ...it, checked: !it.checked } : it
          ),
        };
      });
      latestBlocksRef.current = next;
      onChangeBlocks(next, true);
    };

    const handleChangeCheckItem = (blockId: string, itemId: string, text: string, html: string) => {
      onActivateEditing?.();
      const next = latestBlocksRef.current.map((b) => {
        if (b.id !== blockId || b.kind !== 'checklist') return b;
        return {
          ...b,
          items: b.items.map((it) => (it.id === itemId ? { ...it, text, html } : it)),
        };
      });
      latestBlocksRef.current = next;
      onChangeBlocks(next, false);
    };

    const handleAddCheckItem = (blockId: string, afterItemId?: string) => {
      onActivateEditing?.();
      const newItem: AnotacaoChecklistItem = {
        id: generateUid('chk'),
        text: '',
        html: '',
        checked: false,
      };
      pendingFocusChecklistItemId.current = newItem.id;
      checklistBlockMapRef.current[newItem.id] = blockId;

      const next = latestBlocksRef.current.map((b) => {
        if (b.id !== blockId || b.kind !== 'checklist') return b;
        if (!afterItemId) {
          return { ...b, items: [...b.items, newItem] };
        }
        const idx = b.items.findIndex((i) => i.id === afterItemId);
        if (idx < 0) return { ...b, items: [...b.items, newItem] };
        return {
          ...b,
          items: [...b.items.slice(0, idx + 1), newItem, ...b.items.slice(idx + 1)],
        };
      });

      activeBlockIdRef.current = blockId;
      activeTargetRef.current = { kind: 'checklist', blockId, itemId: newItem.id };
      latestBlocksRef.current = next;
      onChangeBlocks(next, true);
      setTimeout(() => {
        const input = checklistInputRefs.current[newItem.id];
        if (input) {
          input.focus();
          saveSelection();
          emitActiveFormats();
        }
      }, 30);
    };

    const handleDeleteCheckItem = (blockId: string, itemId: string) => {
      onActivateEditing?.();
      let focusTargetId: string | null = null;
      let focusBlockId: string = blockId;
      let next = latestBlocksRef.current
        .map((b) => {
          if (b.id !== blockId || b.kind !== 'checklist') return b;
          const idx = b.items.findIndex((i) => i.id === itemId);
          if (idx > 0) focusTargetId = b.items[idx - 1].id;
          else if (b.items.length > 1) focusTargetId = b.items[1].id;
          const remaining = b.items.filter((i) => i.id !== itemId);
          return { ...b, items: remaining };
        })
        .filter((b) => !(b.kind === 'checklist' && b.items.length === 0));

      if (next.length === 0) {
        next = [createTextBlock('')];
      }
      if (activeTargetRef.current?.kind === 'checklist' && activeTargetRef.current.itemId === itemId) {
        if (focusTargetId) {
          activeTargetRef.current = {
            kind: 'checklist',
            blockId: focusBlockId,
            itemId: focusTargetId,
          };
        } else {
          const fallbackText = next.find((b) => b.kind === 'text');
          activeTargetRef.current = fallbackText ? { kind: 'text', blockId: fallbackText.id } : null;
          activeBlockIdRef.current = fallbackText?.id || null;
        }
      }

      latestBlocksRef.current = next;
      onChangeBlocks(next, true);

      if (focusTargetId) {
        setTimeout(() => {
          checklistInputRefs.current[focusTargetId!]?.focus();
          saveSelection();
          emitActiveFormats();
        }, 25);
      }
    };

    const handleRemoveChecklistBlock = (blockId: string) => {
      onActivateEditing?.();
      let next = latestBlocksRef.current.filter((b) => b.id !== blockId);
      if (next.length === 0) {
        next = [createTextBlock('')];
      }
      if (activeTargetRef.current?.blockId === blockId) {
        const fallbackText = next.find((b) => b.kind === 'text');
        activeTargetRef.current = fallbackText ? { kind: 'text', blockId: fallbackText.id } : null;
        activeBlockIdRef.current = fallbackText?.id || null;
      }
      latestBlocksRef.current = next;
      onChangeBlocks(next, true);
    };

    const handleChecklistKeyDown = (
      e: React.KeyboardEvent<HTMLDivElement>,
      blockId: string,
      item: AnotacaoChecklistItem
    ) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleAddCheckItem(blockId, item.id);
      } else if (e.key === 'Backspace' && (e.currentTarget.textContent || '') === '') {
        e.preventDefault();
        handleDeleteCheckItem(blockId, item.id);
      }
    };

    const onlyOneEmptyText =
      safeBlocks.length === 1 &&
      safeBlocks[0].kind === 'text' &&
      !safeBlocks[0].html.replace(/<br\s*\/?>/gi, '').trim();

    return (
      <div
        onClick={(e) => {
          if (readOnly) return;
          if (e.target === e.currentTarget) {
            onActivateEditing?.();
            const lastText = [...safeBlocks].reverse().find((b) => b.kind === 'text');
            if (lastText) {
              const el = textElsRef.current[lastText.id];
              el?.focus();
            }
          }
        }}
        style={{
          minHeight: readOnly ? undefined : '544px',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {safeBlocks.map((block) => {
          if (block.kind === 'text') {
            return (
              <EditableTextBlock
                key={block.id}
                noteId={noteId}
                block={block}
                isOnlyAndEmpty={onlyOneEmptyText}
                readOnly={readOnly}
                registerEl={(id, el) => {
                  textElsRef.current[id] = el;
                }}
                onFocusBlock={(id) => {
                  activeBlockIdRef.current = id;
                  activeTargetRef.current = { kind: 'text', blockId: id };
                  onActivateEditing?.();
                }}
                onBlurBlock={() => {
                  saveSelection();
                }}
                onInputHtml={handleTextBlockInput}
                onSelectionChange={() => {
                  saveSelection();
                  emitActiveFormats();
                }}
              />
            );
          }

          // BLOCO CHECKLIST OPCIONAL SINCRONIZADO ÀS PAUTAS DE 32px
          const strikeCompleted = block.strikeCompleted !== false;
          return (
            <div
              key={block.id}
              className="anotacao-checklist-block"
              style={{
                position: 'relative',
                margin: 0,
                marginLeft: '2px',
                padding: 0,
                paddingLeft: '10px',
                borderLeft: '2.5px solid #BFDBFE',
              }}
            >
              {!readOnly && isEditing && (
                <div
                  className="no-print no-rule-measure anotacao-checklist-header"
                  style={{
                    height: `${NOTEBOOK_LINE_HEIGHT}px`,
                    lineHeight: `${NOTEBOOK_LINE_HEIGHT}px`,
                    boxSizing: 'border-box',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                    paddingLeft: '2px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                        color: '#0B3F7D',
                        backgroundColor: '#EAF2FC',
                        border: '1px solid #BFDBFE',
                        borderRadius: '4px',
                        padding: '1px 7px',
                        lineHeight: '18px',
                      }}
                    >
                      Checklist
                    </span>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => handleAddCheckItem(block.id)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '3px',
                        fontSize: '11.5px',
                        fontWeight: 600,
                        color: '#0B3F7D',
                        backgroundColor: '#FFFFFF',
                        border: '1px solid #93C5FD',
                        borderRadius: '4px',
                        padding: '1px 7px',
                        lineHeight: '18px',
                        cursor: 'pointer',
                      }}
                    >
                      <Plus size={12} />
                      <span>Novo item</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleRemoveChecklistBlock(block.id)}
                    title="Remover este checklist"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: '11px',
                      fontWeight: 600,
                      color: '#DC2626',
                      backgroundColor: '#FEF2F2',
                      border: '1px solid #FECACA',
                      borderRadius: '4px',
                      padding: '1px 7px',
                      lineHeight: '18px',
                      cursor: 'pointer',
                    }}
                  >
                    <Trash2 size={11} />
                    <span>Excluir checklist</span>
                  </button>
                </div>
              )}

              {block.items.map((item) => {
                const isDone = Boolean(item.checked);
                const itemHtml =
                  item.html !== undefined
                    ? sanitizeNoteHtml(item.html)
                    : item.text
                    ? escapeHtml(item.text)
                    : '&nbsp;';

                return (
                  <div
                    key={item.id}
                    className="anotacao-checklist-row"
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '10px',
                      minHeight: `${NOTEBOOK_LINE_HEIGHT}px`,
                      lineHeight: `${NOTEBOOK_LINE_HEIGHT}px`,
                      paddingLeft: '2px',
                    }}
                  >
                    {readOnly ? (
                      <span
                        aria-hidden="true"
                        className="no-rule-measure anotacao-checkbox-box"
                        style={{
                          width: '17px',
                          height: '17px',
                          marginTop: '7.5px',
                          flexShrink: 0,
                          borderRadius: '4px',
                          border: `1.8px solid ${isDone ? '#0B3F7D' : '#1E5494'}`,
                          backgroundColor: isDone ? '#0B3F7D' : '#FFFFFF',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          boxSizing: 'border-box',
                        }}
                      >
                        {isDone && <Check size={12} strokeWidth={3} color="#FFFFFF" />}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handleToggleCheckItem(block.id, item.id)}
                        aria-label={isDone ? 'Desmarcar item' : 'Marcar item'}
                        className="no-rule-measure anotacao-checkbox-box"
                        style={{
                          width: '17px',
                          height: '17px',
                          marginTop: '7.5px',
                          flexShrink: 0,
                          borderRadius: '4px',
                          border: `1.8px solid ${isDone ? '#0B3F7D' : '#1E5494'}`,
                          backgroundColor: isDone ? '#0B3F7D' : '#FFFFFF',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          padding: 0,
                        }}
                      >
                        {isDone && <Check size={12} strokeWidth={3} color="#FFFFFF" />}
                      </button>
                    )}

                    <div style={{ flex: 1, minWidth: 0 }}>
                      {readOnly ? (
                        <div
                          className="anotacao-checklist-editable"
                          style={{
                            fontSize: `${DEFAULT_FONT_SIZE}px`,
                            lineHeight: `${NOTEBOOK_LINE_HEIGHT}px`,
                            minHeight: `${NOTEBOOK_LINE_HEIGHT}px`,
                            color: isDone ? '#64748B' : '#0F172A',
                            textDecoration: isDone && strikeCompleted ? 'line-through' : 'none',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            overflowWrap: 'anywhere',
                          }}
                          dangerouslySetInnerHTML={{ __html: itemHtml }}
                        />
                      ) : (
                        <ChecklistItemEditable
                          noteId={noteId}
                          value={item.text}
                          html={item.html}
                          checked={isDone}
                          strikeCompleted={strikeCompleted}
                          autoFocus={pendingFocusChecklistItemId.current === item.id}
                          onFocus={() => {
                            activeBlockIdRef.current = block.id;
                            activeTargetRef.current = {
                              kind: 'checklist',
                              blockId: block.id,
                              itemId: item.id,
                            };
                            onActivateEditing?.();
                          }}
                          onBlur={() => {
                            saveSelection();
                          }}
                          onSelectionChange={() => {
                            saveSelection();
                            emitActiveFormats();
                          }}
                          onChange={(text, nextHtml) =>
                            handleChangeCheckItem(block.id, item.id, text, nextHtml)
                          }
                          onKeyDown={(e) => handleChecklistKeyDown(e, block.id, item)}
                          inputRef={(el) => {
                            checklistInputRefs.current[item.id] = el;
                            checklistBlockMapRef.current[item.id] = block.id;
                            if (el && pendingFocusChecklistItemId.current === item.id) {
                              pendingFocusChecklistItemId.current = null;
                            }
                          }}
                        />
                      )}
                    </div>

                    {!readOnly && isEditing && (
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handleDeleteCheckItem(block.id, item.id)}
                        title="Remover item"
                        className="no-print no-rule-measure"
                        style={{
                          marginTop: '6px',
                          width: '20px',
                          height: '20px',
                          flexShrink: 0,
                          borderRadius: '4px',
                          border: 'none',
                          backgroundColor: 'transparent',
                          color: '#94A3B8',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    );
  }
);

AnotacaoRichEditor.displayName = 'AnotacaoRichEditor';
