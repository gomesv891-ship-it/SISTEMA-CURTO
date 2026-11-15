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
  generateUid,
  sanitizeNoteHtml,
} from '../utils/anotacoesService';
import { NOTEBOOK_LINE_HEIGHT } from './AnotacaoFolhaDocument';

export interface AnotacaoRichEditorHandle {
  focusEditor: () => void;
  saveSelection: () => void;
  applyCommand: (
    command: 'bold' | 'italic' | 'underline' | 'insertUnorderedList' | 'insertOrderedList'
  ) => void;
  applyHighlight: (color: string | null) => void;
  insertChecklist: () => void;
  focusLastBlock: () => void;
}

interface AnotacaoRichEditorProps {
  noteId: string;
  blocks: AnotacaoBlock[];
  onChangeBlocks: (nextBlocks: AnotacaoBlock[], flushImmediate?: boolean) => void;
  onActivateEditing?: () => void;
  onActiveFormatsChange?: (formats: {
    bold: boolean;
    italic: boolean;
    underline: boolean;
    unorderedList: boolean;
    orderedList: boolean;
  }) => void;
  isEditing: boolean;
  readOnly?: boolean;
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

    const noteChanged = lastNoteIdRef.current !== noteId;
    const isFocused = document.activeElement === el;

    if (noteChanged || (!isFocused && block.html !== lastHtmlRef.current)) {
      el.innerHTML = block.html || '';
      lastHtmlRef.current = block.html;
      lastNoteIdRef.current = noteId;
    } else if (!isFocused && el.innerHTML !== (block.html || '')) {
      el.innerHTML = block.html || '';
      lastHtmlRef.current = block.html;
    }
  }, [noteId, block.html]);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    if (document.activeElement !== el) return;
    if (block.html !== lastHtmlRef.current) {
      el.innerHTML = block.html || '';
      lastHtmlRef.current = block.html;
    }
  }, [block.html]);

  if (readOnly) {
    return (
      <div
        className="anotacao-rich-content"
        style={{
          fontSize: '15px',
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
            .replace(/font-size\s*:[^;"']+;?/gi, '')
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
        fontSize: '15px',
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
  value: string;
  checked: boolean;
  strikeCompleted: boolean;
  autoFocus?: boolean;
  onFocus?: () => void;
  onChange: (val: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  inputRef?: (el: HTMLDivElement | null) => void;
}

const ChecklistItemEditable: React.FC<ChecklistItemEditableProps> = ({
  value,
  checked,
  strikeCompleted,
  autoFocus,
  onFocus,
  onChange,
  onKeyDown,
  inputRef,
}) => {
  const localRef = useRef<HTMLDivElement | null>(null);
  const lastTextRef = useRef<string>(value);

  useEffect(() => {
    const el = localRef.current;
    if (!el) return;
    if (document.activeElement !== el || value !== lastTextRef.current) {
      if (el.textContent !== value) {
        el.textContent = value;
      }
      lastTextRef.current = value;
    }
  }, [value]);

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
      onFocus={onFocus}
      onPaste={(e) => {
        e.preventDefault();
        const plain = e.clipboardData?.getData('text/plain') || '';
        document.execCommand('insertText', false, plain.replace(/\r?\n/g, ' '));
      }}
      onInput={(e) => {
        const text = e.currentTarget.textContent || '';
        lastTextRef.current = text;
        onChange(text);
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
        fontSize: '15px',
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
    const activeBlockIdRef = useRef<string | null>(null);
    const savedRangeRef = useRef<Range | null>(null);
    const pendingFocusChecklistItemId = useRef<string | null>(null);

    const safeBlocks = blocks.length > 0 ? blocks : [createTextBlock('')];

    const saveSelection = useCallback(() => {
      if (typeof window === 'undefined') return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      const containerNode = range.commonAncestorContainer;
      const matchedEntry = (
        Object.entries(textElsRef.current) as [string, HTMLDivElement | null][]
      ).find(([, el]) => {
        if (!el) return false;
        return el === containerNode || el.contains(containerNode);
      });
      if (matchedEntry) {
        activeBlockIdRef.current = matchedEntry[0];
        savedRangeRef.current = range.cloneRange();
      }
    }, []);

    const restoreSelectionOrFocus = useCallback((): HTMLDivElement | null => {
      const targetId =
        activeBlockIdRef.current ||
        safeBlocks.find((b) => b.kind === 'text')?.id ||
        null;
      const targetEl = targetId ? textElsRef.current[targetId] : null;
      if (!targetEl) return null;

      targetEl.focus();
      const sel = window.getSelection();
      if (sel && savedRangeRef.current) {
        try {
          if (targetEl.contains(savedRangeRef.current.commonAncestorContainer)) {
            sel.removeAllRanges();
            sel.addRange(savedRangeRef.current);
            return targetEl;
          }
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
      return targetEl;
    }, [safeBlocks]);

    const emitActiveFormats = useCallback(() => {
      if (!onActiveFormatsChange || typeof document === 'undefined') return;
      try {
        onActiveFormatsChange({
          bold: document.queryCommandState('bold'),
          italic: document.queryCommandState('italic'),
          underline: document.queryCommandState('underline'),
          unorderedList: document.queryCommandState('insertUnorderedList'),
          orderedList: document.queryCommandState('insertOrderedList'),
        });
      } catch {}
    }, [onActiveFormatsChange]);

    const syncBlockDomHtml = useCallback(
      (targetEl: HTMLDivElement, blockId: string) => {
        const html = targetEl.innerHTML;
        const nextBlocks = safeBlocks.map((b) =>
          b.id === blockId && b.kind === 'text' ? { ...b, html } : b
        );
        onChangeBlocks(nextBlocks, false);
      },
      [safeBlocks, onChangeBlocks]
    );

    const handleInsertChecklist = useCallback(() => {
      onActivateEditing?.();
      const newItem: AnotacaoChecklistItem = {
        id: generateUid('chk'),
        text: '',
        checked: false,
      };
      const newChecklist = createChecklistBlock([newItem]);
      pendingFocusChecklistItemId.current = newItem.id;

      const activeId = activeBlockIdRef.current;
      const idx = activeId ? safeBlocks.findIndex((b) => b.id === activeId) : safeBlocks.length - 1;
      const insertAfter = idx >= 0 ? idx : safeBlocks.length - 1;

      const next: AnotacaoBlock[] = [
        ...safeBlocks.slice(0, insertAfter + 1),
        newChecklist,
        ...safeBlocks.slice(insertAfter + 1),
      ];

      const insertedIdx = insertAfter + 1;
      if (next[insertedIdx + 1]?.kind !== 'text') {
        next.splice(insertedIdx + 1, 0, createTextBlock(''));
      }

      onChangeBlocks(next, true);
      setTimeout(() => {
        const input = checklistInputRefs.current[newItem.id];
        if (input) input.focus();
      }, 40);
    }, [safeBlocks, onChangeBlocks, onActivateEditing]);

    useImperativeHandle(
      ref,
      () => ({
        focusEditor: () => {
          onActivateEditing?.();
          restoreSelectionOrFocus();
        },
        focusLastBlock: () => {
          onActivateEditing?.();
          const lastText = [...safeBlocks].reverse().find((b) => b.kind === 'text');
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
        },
        saveSelection,
        applyCommand: (command) => {
          onActivateEditing?.();
          const el = restoreSelectionOrFocus();
          if (!el) return;
          try {
            document.execCommand('styleWithCSS', false, 'false');
          } catch {}
          document.execCommand(command, false);
          saveSelection();
          emitActiveFormats();
          const blockId = activeBlockIdRef.current;
          if (blockId) {
            syncBlockDomHtml(el, blockId);
          }
        },
        applyHighlight: (color) => {
          onActivateEditing?.();
          const el = restoreSelectionOrFocus();
          if (!el) return;
          const sel = window.getSelection();
          if (!sel || sel.rangeCount === 0) return;

          if (color === null) {
            try {
              document.execCommand('styleWithCSS', false, 'true');
              document.execCommand('hiliteColor', false, 'transparent');
            } catch {}
          } else {
            try {
              document.execCommand('styleWithCSS', false, 'true');
              const ok = document.execCommand('hiliteColor', false, color);
              if (!ok) {
                document.execCommand('backColor', false, color);
              }
            } catch {
              document.execCommand('backColor', false, color);
            }
          }

          saveSelection();
          emitActiveFormats();
          const blockId = activeBlockIdRef.current;
          if (blockId) {
            syncBlockDomHtml(el, blockId);
          }
        },
        insertChecklist: handleInsertChecklist,
      }),
      [
        onActivateEditing,
        restoreSelectionOrFocus,
        saveSelection,
        emitActiveFormats,
        syncBlockDomHtml,
        handleInsertChecklist,
        safeBlocks,
      ]
    );

    const handleTextBlockInput = (blockId: string, html: string) => {
      onActivateEditing?.();
      const next = safeBlocks.map((b) =>
        b.id === blockId && b.kind === 'text' ? { ...b, html } : b
      );
      onChangeBlocks(next, false);
    };

    const handleToggleCheckItem = (blockId: string, itemId: string) => {
      const next = safeBlocks.map((b) => {
        if (b.id !== blockId || b.kind !== 'checklist') return b;
        return {
          ...b,
          items: b.items.map((it) =>
            it.id === itemId ? { ...it, checked: !it.checked } : it
          ),
        };
      });
      onChangeBlocks(next, true);
    };

    const handleChangeCheckItemText = (blockId: string, itemId: string, text: string) => {
      onActivateEditing?.();
      const next = safeBlocks.map((b) => {
        if (b.id !== blockId || b.kind !== 'checklist') return b;
        return {
          ...b,
          items: b.items.map((it) => (it.id === itemId ? { ...it, text } : it)),
        };
      });
      onChangeBlocks(next, false);
    };

    const handleAddCheckItem = (blockId: string, afterItemId?: string) => {
      onActivateEditing?.();
      const newItem: AnotacaoChecklistItem = {
        id: generateUid('chk'),
        text: '',
        checked: false,
      };
      pendingFocusChecklistItemId.current = newItem.id;

      const next = safeBlocks.map((b) => {
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

      onChangeBlocks(next, true);
      setTimeout(() => {
        checklistInputRefs.current[newItem.id]?.focus();
      }, 30);
    };

    const handleDeleteCheckItem = (blockId: string, itemId: string) => {
      onActivateEditing?.();
      let focusTargetId: string | null = null;
      let next = safeBlocks
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
      onChangeBlocks(next, true);

      if (focusTargetId) {
        setTimeout(() => {
          checklistInputRefs.current[focusTargetId!]?.focus();
        }, 25);
      }
    };

    const handleRemoveChecklistBlock = (blockId: string) => {
      onActivateEditing?.();
      let next = safeBlocks.filter((b) => b.id !== blockId);
      if (next.length === 0) {
        next = [createTextBlock('')];
      }
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
                            fontSize: '15px',
                            lineHeight: `${NOTEBOOK_LINE_HEIGHT}px`,
                            minHeight: `${NOTEBOOK_LINE_HEIGHT}px`,
                            color: isDone ? '#64748B' : '#0F172A',
                            textDecoration: isDone && strikeCompleted ? 'line-through' : 'none',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            overflowWrap: 'anywhere',
                          }}
                        >
                          {item.text || '\u00A0'}
                        </div>
                      ) : (
                        <ChecklistItemEditable
                          value={item.text}
                          checked={isDone}
                          strikeCompleted={strikeCompleted}
                          autoFocus={pendingFocusChecklistItemId.current === item.id}
                          onFocus={() => onActivateEditing?.()}
                          onChange={(val) => handleChangeCheckItemText(block.id, item.id, val)}
                          onKeyDown={(e) => handleChecklistKeyDown(e, block.id, item)}
                          inputRef={(el) => {
                            checklistInputRefs.current[item.id] = el;
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
