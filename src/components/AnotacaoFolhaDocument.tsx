import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Briefcase,
  Calendar,
  CalendarDays,
  CheckSquare,
  ClipboardPen,
  FileText,
  Sparkles,
  Tag,
  Target,
} from 'lucide-react';
import { FENIX_OFFICIAL_LOGO_BASE64 } from '../assets/fenixLogoBase64';
import {
  AnotacaoHeaderIconId,
  AnotacaoHeaderStyleId,
  AnotacaoSheetConfig,
  DEFAULT_SHEET_CONFIG,
  formatAnotacaoDatePtBr,
} from '../utils/anotacoesService';

let cachedWhiteLogoDataUrl: string | null = null;
let whiteLogoPromise: Promise<string> | null = null;

/**
 * Converte a logo oficial da Fênix World para branco puro em PNG base64 em memória,
 * garantindo renderização perfeita tanto na tela quanto em window.print() e jsPDF/html2canvas.
 */
export function getWhiteFenixLogoDataUrl(): Promise<string> {
  if (cachedWhiteLogoDataUrl) {
    return Promise.resolve(cachedWhiteLogoDataUrl);
  }
  if (whiteLogoPromise) {
    return whiteLogoPromise;
  }

  whiteLogoPromise = new Promise((resolve) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      resolve(FENIX_OFFICIAL_LOGO_BASE64);
      return;
    }
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width || 311;
        canvas.height = img.naturalHeight || img.height || 152;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(FENIX_OFFICIAL_LOGO_BASE64);
          return;
        }
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d = imageData.data;
        for (let i = 0; i < d.length; i += 4) {
          const alpha = d[i + 3];
          if (alpha > 10) {
            const r = d[i];
            const g = d[i + 1];
            const b = d[i + 2];
            const isNeutralGray = Math.abs(r - g) < 18 && Math.abs(g - b) < 18 && r > 70;
            if (isNeutralGray) {
              d[i] = 226;
              d[i + 1] = 234;
              d[i + 2] = 244;
            } else {
              d[i] = 255;
              d[i + 1] = 255;
              d[i + 2] = 255;
            }
          }
        }
        ctx.putImageData(imageData, 0, 0);
        cachedWhiteLogoDataUrl = canvas.toDataURL('image/png');
        resolve(cachedWhiteLogoDataUrl);
      } catch {
        resolve(FENIX_OFFICIAL_LOGO_BASE64);
      }
    };
    img.onerror = () => resolve(FENIX_OFFICIAL_LOGO_BASE64);
    img.src = FENIX_OFFICIAL_LOGO_BASE64;
  });

  return whiteLogoPromise;
}

export function renderHeaderIcon(
  iconId: AnotacaoHeaderIconId,
  color = '#0B3F7D',
  size = 34
): React.ReactNode {
  const props = { size, strokeWidth: 2, color };
  switch (iconId) {
    case 'briefcase':
      return <Briefcase {...props} />;
    case 'check-square':
      return <CheckSquare {...props} />;
    case 'target':
      return <Target {...props} />;
    case 'calendar-days':
      return <CalendarDays {...props} />;
    case 'file-text':
      return <FileText {...props} />;
    case 'sparkles':
      return <Sparkles {...props} />;
    case 'clipboard-pen':
    default:
      return <ClipboardPen {...props} />;
  }
}

export const HEADER_ICON_OPTIONS: { id: AnotacaoHeaderIconId; label: string }[] = [
  { id: 'clipboard-pen', label: 'Anotação' },
  { id: 'briefcase', label: 'Negociações' },
  { id: 'check-square', label: 'Pendências' },
  { id: 'target', label: 'Metas' },
  { id: 'calendar-days', label: 'Planejamento' },
  { id: 'file-text', label: 'Documento' },
  { id: 'sparkles', label: 'Destaque' },
];

export const HEADER_STYLE_OPTIONS: {
  id: AnotacaoHeaderStyleId;
  label: string;
  description: string;
}[] = [
  {
    id: 'curvas_oficiais',
    label: 'Curvas Oficiais Fênix',
    description: 'Ondas curvas em azul-marinho e cinza prateado (modelo oficial)',
  },
  {
    id: 'classico_barra',
    label: 'Faixa Executiva Azul',
    description: 'Barra superior corporativa contínua com logo em branco',
  },
  {
    id: 'minimalista_fino',
    label: 'Minimalista Corporativo',
    description: 'Cabeçalho limpo com filete azul e foco máximo na escrita',
  },
];

export const NOTEBOOK_LINE_HEIGHT = 32;

/**
 * Calcula posições Y exatas para cada pauta horizontal do caderno sincronizadas ao conteúdo real:
 * - Cada linha visual renderizada (inclusive parágrafos quebrados, listas e checklists) gera sua pauta
 *   logo abaixo da linha de base/descendentes, evitando qualquer sobreposição com texto.
 * - Linhas em branco / espaços extras mantêm espaçamento uniforme de `lineHeight` até o fim da folha.
 */
function measureSynchronizedLineYs(
  contentEl: HTMLElement | null,
  minRuledHeight: number,
  isBlankSheet: boolean,
  lineHeight = NOTEBOOK_LINE_HEIGHT
): number[] {
  if (isBlankSheet || !contentEl) {
    const count = Math.max(1, Math.floor(minRuledHeight / lineHeight));
    const lines: number[] = [];
    for (let i = 1; i <= count; i++) {
      lines.push(i * lineHeight - 1);
    }
    return lines;
  }

  const cRect = contentEl.getBoundingClientRect();
  if (!cRect || cRect.width === 0) {
    const count = Math.max(1, Math.floor(minRuledHeight / lineHeight));
    const fallback: number[] = [];
    for (let i = 1; i <= count; i++) {
      fallback.push(i * lineHeight - 1);
    }
    return fallback;
  }

  interface LineCluster {
    top: number;
    bottom: number;
    midY: number;
  }

  const visualLineClusters: LineCluster[] = [];

  const registerRect = (topRel: number, bottomRel: number) => {
    const midRel = (topRel + bottomRel) / 2;
    const existing = visualLineClusters.find(
      (c) => Math.abs(c.midY - midRel) < lineHeight * 0.45
    );
    if (existing) {
      if (bottomRel > existing.bottom) existing.bottom = bottomRel;
      if (topRel < existing.top) existing.top = topRel;
      existing.midY = (existing.top + existing.bottom) / 2;
    } else {
      visualLineClusters.push({ top: topRel, bottom: bottomRel, midY: midRel });
    }
  };

  // 1. Mede todas as linhas visuais reais de nós de texto (parágrafos, quebras por largura, listas, destaques e checklists)
  try {
    const walker = document.createTreeWalker(contentEl, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        if (!node.textContent || node.textContent.length === 0) {
          return NodeFilter.FILTER_REJECT;
        }
        const parentEl = node.parentElement;
        if (!parentEl) return NodeFilter.FILTER_REJECT;
        if (parentEl.closest('.no-rule-measure')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const range = document.createRange();
    let currentNode = walker.nextNode();
    while (currentNode) {
      range.selectNodeContents(currentNode);
      const rects = range.getClientRects();
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        if (r.height < 4 || r.width < 0.5) continue;
        registerRect(r.top - cRect.top, r.bottom - cRect.top);
      }
      currentNode = walker.nextNode();
    }
  } catch {
    // Fallback silencioso se Range não estiver disponível
  }

  // Para cada linha visual de texto, alinha a pauta exatamente na base da caixa de 32px
  // e garante folga mínima de 5px abaixo dos descendentes/sublinhados para evitar sobreposição.
  const collectedYs: number[] = [];
  for (const cluster of visualLineClusters) {
    const lineBoxRuleY = Math.round(cluster.midY + lineHeight / 2) - 1;
    const safeBelowGlyph = Math.round(cluster.bottom) + 5;
    collectedYs.push(Math.max(lineBoxRuleY, safeBelowGlyph));
  }

  const hasRuleNear = (targetY: number, tolerance = 14) =>
    collectedYs.some((y) => Math.abs(y - targetY) <= tolerance);

  // 2. Varre blocos e quebras vazias (<div><br></div>, <p><br></p>, <li>, <br> em bloco contínuo,
  //    cabeçalho de checklist e itens vazios) garantindo todas as pautas intermediárias sem lacunas.
  const blockRows = contentEl.querySelectorAll(
    'p, div, li, blockquote, h1, h2, h3, .anotacao-checklist-header, .anotacao-checklist-editable, .rich-text-editor'
  );
  blockRows.forEach((el) => {
    const htmlEl = el as HTMLElement;
    if (
      htmlEl.classList.contains('fenix-ruled-lines-layer') ||
      htmlEl.closest('.fenix-ruled-lines-layer')
    ) {
      return;
    }
    const rect = htmlEl.getBoundingClientRect();
    if (rect.height < 12) return;

    const elTop = rect.top - cRect.top;
    const elBottom = rect.bottom - cRect.top;
    const elHeight = elBottom - elTop;

    if (htmlEl.classList.contains('anotacao-checklist-header')) {
      const y = Math.round(elBottom) - 1;
      if (!hasRuleNear(y, 15)) {
        collectedYs.push(y);
      }
      return;
    }

    const slots = Math.max(1, Math.round(elHeight / lineHeight));
    for (let s = 1; s <= slots; s++) {
      const slotRuleY = Math.round(elTop + s * lineHeight) - 1;
      if (!hasRuleNear(slotRuleY, 15)) {
        collectedYs.push(slotRuleY);
      }
    }
  });

  // Ordena e remove duplicidades próximas mantendo espaçamento limpo
  collectedYs.sort((a, b) => a - b);
  const dedupedYs: number[] = [];
  for (const y of collectedYs) {
    if (y < 14) continue;
    const prev = dedupedYs[dedupedYs.length - 1];
    if (prev === undefined || y - prev >= 18) {
      dedupedYs.push(y);
    } else {
      dedupedYs[dedupedYs.length - 1] = Math.max(prev, y);
    }
  }

  // 3. Completa uniformemente com pautas de `lineHeight` até o final da área pautada
  const measuredHeight = Math.max(contentEl.scrollHeight || 0, contentEl.offsetHeight || 0);
  const targetHeight = Math.max(minRuledHeight, measuredHeight);
  let nextY =
    dedupedYs.length > 0
      ? Math.max(dedupedYs[dedupedYs.length - 1] + lineHeight, lineHeight - 1)
      : lineHeight - 1;

  while (nextY <= targetHeight) {
    dedupedYs.push(nextY);
    nextY += lineHeight;
  }

  return dedupedYs;
}

interface AnotacaoFolhaDocumentProps {
  mode: 'interactive' | 'print-filled' | 'print-blank';
  title?: string;
  date?: string; // YYYY-MM-DD
  sheetConfig?: AnotacaoSheetConfig;
  onTitleChange?: (newTitle: string) => void;
  onDateChange?: (newDate: string) => void;
  onTitleFocus?: () => void;
  onBodyMouseDown?: () => void;
  children?: React.ReactNode;
  containerId?: string;
  minLines?: number;
  refreshTrigger?: unknown;
}

export const AnotacaoFolhaDocument: React.FC<AnotacaoFolhaDocumentProps> = ({
  mode,
  title = '',
  date = '',
  sheetConfig = DEFAULT_SHEET_CONFIG,
  onTitleChange,
  onDateChange,
  onTitleFocus,
  onBodyMouseDown,
  children,
  containerId,
  minLines,
  refreshTrigger,
}) => {
  const [whiteLogoSrc, setWhiteLogoSrc] = useState<string>(
    cachedWhiteLogoDataUrl || FENIX_OFFICIAL_LOGO_BASE64
  );

  useEffect(() => {
    let active = true;
    getWhiteFenixLogoDataUrl().then((url) => {
      if (active) setWhiteLogoSrc(url);
    });
    return () => {
      active = false;
    };
  }, []);

  const isBlank = mode === 'print-blank';
  const isPrint = mode === 'print-filled' || mode === 'print-blank';

  // Na folha em branco: título padrão obrigatório "ANOTAÇÃO" e campos de título/data vazios
  const headerTitle = isBlank
    ? 'ANOTAÇÃO'
    : (sheetConfig?.headerTitle || 'ANOTAÇÃO').toUpperCase();
  const headerIcon: AnotacaoHeaderIconId = sheetConfig?.headerIcon || 'clipboard-pen';
  const headerStyle: AnotacaoHeaderStyleId = sheetConfig?.headerStyle || 'curvas_oficiais';

  const formattedDate = isBlank ? '' : formatAnotacaoDatePtBr(date);
  const displayTitle = isBlank ? '' : title;

  const defaultLineCount = isBlank ? 25 : minLines ?? (isPrint ? 24 : 20);
  const minRuledHeight = defaultLineCount * NOTEBOOK_LINE_HEIGHT;

  const contentLayerRef = useRef<HTMLDivElement | null>(null);
  const [lineYs, setLineYs] = useState<number[]>(() =>
    measureSynchronizedLineYs(null, minRuledHeight, true, NOTEBOOK_LINE_HEIGHT)
  );
  const rafRef = useRef<number | null>(null);

  const recomputeLines = useCallback(() => {
    const next = measureSynchronizedLineYs(
      contentLayerRef.current,
      minRuledHeight,
      isBlank,
      NOTEBOOK_LINE_HEIGHT
    );
    setLineYs((prev) => {
      if (prev.length === next.length && prev.every((v, idx) => v === next[idx])) {
        return prev;
      }
      return next;
    });
  }, [minRuledHeight, isBlank]);

  const scheduleRecomputeLines = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      recomputeLines();
    });
  }, [recomputeLines]);

  useLayoutEffect(() => {
    recomputeLines();
  }, [recomputeLines, children, refreshTrigger, title, mode]);

  useEffect(() => {
    const el = contentLayerRef.current;
    if (!el || isBlank) return;

    const mutationObserver = new MutationObserver(() => {
      scheduleRecomputeLines();
    });
    mutationObserver.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['style', 'class'],
    });

    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            scheduleRecomputeLines();
          })
        : null;
    resizeObserver?.observe(el);

    window.addEventListener('resize', scheduleRecomputeLines);
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      document.fonts.ready.then(() => {
        scheduleRecomputeLines();
      }).catch(() => {});
    }

    return () => {
      mutationObserver.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener('resize', scheduleRecomputeLines);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [isBlank, scheduleRecomputeLines]);

  const isCurvas = headerStyle === 'curvas_oficiais';
  const isBarra = headerStyle === 'classico_barra';
  const isMinimal = headerStyle === 'minimalista_fino';

  const uid = containerId || mode;
  const maxRuleY =
    lineYs.length > 0 ? Math.max(minRuledHeight, lineYs[lineYs.length - 1] + 4) : minRuledHeight;

  return (
    <div
      id={containerId}
      style={{
        width: isPrint ? '794px' : '100%',
        maxWidth: isPrint ? '794px' : '100%',
        minHeight: isBlank ? '1122px' : isPrint ? '1122px' : '1040px',
        margin: '0 auto',
        backgroundColor: '#FFFFFF',
        color: '#0F172A',
        fontFamily: "'Inter', 'Segoe UI', Arial, sans-serif",
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        border: isPrint ? 'none' : '1px solid #CBD5E1',
        borderRadius: isPrint ? '0px' : '10px',
        overflow: 'hidden',
        boxShadow: isPrint ? 'none' : '0 14px 36px -12px rgba(7, 43, 84, 0.16)',
      }}
    >
      {/* CABEÇALHO FÊNIX WORLD */}
      {isCurvas && (
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: '112px',
            flexShrink: 0,
            backgroundColor: '#FFFFFF',
          }}
        >
          <svg
            viewBox="0 0 800 120"
            preserveAspectRatio="none"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '112px',
              display: 'block',
            }}
          >
            <defs>
              <linearGradient id={`hdrNavy_${uid}`} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#052348" />
                <stop offset="55%" stopColor="#093E7D" />
                <stop offset="100%" stopColor="#1470C7" />
              </linearGradient>
              <linearGradient id={`hdrSilver_${uid}`} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#94A3B8" />
                <stop offset="60%" stopColor="#CBD5E1" />
                <stop offset="100%" stopColor="#E2E8F0" />
              </linearGradient>
              <linearGradient id={`swoosh_${uid}`} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#0C68C6" />
                <stop offset="55%" stopColor="#094287" />
                <stop offset="100%" stopColor="#177CE0" />
              </linearGradient>
            </defs>

            <path
              d="M 0 0 L 560 0 C 485 18, 428 62, 342 86 C 248 112, 128 84, 0 112 Z"
              fill={`url(#hdrSilver_${uid})`}
              opacity="0.72"
            />
            <path
              d="M 0 0 L 542 0 C 468 20, 412 58, 326 78 C 234 99, 120 74, 0 98 Z"
              fill={`url(#hdrNavy_${uid})`}
            />
          </svg>

          <div
            style={{
              position: 'relative',
              zIndex: 2,
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              padding: '12px 28px 0 28px',
              height: '100%',
              boxSizing: 'border-box',
            }}
          >
            <div style={{ paddingTop: '2px', paddingLeft: '6px' }}>
              <img
                src={whiteLogoSrc}
                alt="Fênix World"
                style={{
                  height: '62px',
                  width: 'auto',
                  objectFit: 'contain',
                  display: 'block',
                  filter:
                    whiteLogoSrc === FENIX_OFFICIAL_LOGO_BASE64
                      ? 'brightness(0) invert(1)'
                      : 'none',
                }}
              />
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                paddingTop: '12px',
                minWidth: '280px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '10px',
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                  {renderHeaderIcon(headerIcon, '#072F62', 34)}
                </span>
                <span
                  style={{
                    fontSize: headerTitle.length > 14 ? '25px' : '31px',
                    fontWeight: 900,
                    letterSpacing: '0.03em',
                    color: '#072F62',
                    lineHeight: 1.05,
                    fontStyle: 'italic',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {headerTitle}
                </span>
              </div>

              <svg
                viewBox="0 0 280 14"
                style={{ width: '250px', height: '12px', marginTop: '4px', display: 'block' }}
              >
                <path
                  d="M 4 11 Q 140 0 276 11 Q 140 6 4 11 Z"
                  fill={`url(#swoosh_${uid})`}
                />
              </svg>
            </div>
          </div>
        </div>
      )}

      {isBarra && (
        <div
          style={{
            width: '100%',
            background: 'linear-gradient(90deg, #052348 0%, #0A4488 65%, #1269C2 100%)',
            padding: '14px 28px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '4px solid #CBD5E1',
            flexShrink: 0,
            boxSizing: 'border-box',
          }}
        >
          <img
            src={whiteLogoSrc}
            alt="Fênix World"
            style={{
              height: '56px',
              width: 'auto',
              objectFit: 'contain',
              display: 'block',
              filter:
                whiteLogoSrc === FENIX_OFFICIAL_LOGO_BASE64
                  ? 'brightness(0) invert(1)'
                  : 'none',
            }}
          />
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              backgroundColor: '#FFFFFF',
              borderRadius: '10px',
              padding: '8px 18px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
            }}
          >
            {renderHeaderIcon(headerIcon, '#072F62', 26)}
            <span
              style={{
                fontSize: headerTitle.length > 14 ? '20px' : '24px',
                fontWeight: 900,
                letterSpacing: '0.03em',
                color: '#072F62',
              }}
            >
              {headerTitle}
            </span>
          </div>
        </div>
      )}

      {isMinimal && (
        <div
          style={{
            width: '100%',
            backgroundColor: '#FFFFFF',
            padding: '16px 28px 10px 28px',
            borderBottom: '2.5px solid #0B3F7D',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
            boxSizing: 'border-box',
          }}
        >
          <img
            src={FENIX_OFFICIAL_LOGO_BASE64}
            alt="Fênix World"
            style={{ height: '52px', width: 'auto', objectFit: 'contain', display: 'block' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {renderHeaderIcon(headerIcon, '#0B3F7D', 28)}
            <span
              style={{
                fontSize: headerTitle.length > 14 ? '22px' : '26px',
                fontWeight: 900,
                letterSpacing: '0.03em',
                color: '#072F62',
              }}
            >
              {headerTitle}
            </span>
          </div>
        </div>
      )}

      {/* CORPO INTERNO: METADADOS (TÍTULO + DATA) + ÁREA PAUTADA SINCRONIZADA */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          padding: '12px 24px 12px 24px',
          boxSizing: 'border-box',
        }}
      >
        {/* LINHA DE TÍTULO E DATA */}
        <div
          style={{
            display: 'flex',
            alignItems: 'stretch',
            gap: '12px',
            marginBottom: '12px',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              flex: 1,
              minWidth: 0,
              height: '38px',
              borderRadius: '10px',
              border: '1.6px solid #0B3F7D',
              backgroundColor: '#EAF2FC',
              display: 'flex',
              alignItems: 'stretch',
              overflow: 'hidden',
              boxSizing: 'border-box',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '7px',
                background: 'linear-gradient(135deg, #062F64 0%, #0C55A4 100%)',
                color: '#FFFFFF',
                padding: '0 26px 0 14px',
                fontWeight: 800,
                fontSize: '14px',
                letterSpacing: '0.01em',
                flexShrink: 0,
                clipPath: 'polygon(0 0, 100% 0, 87% 100%, 0% 100%)',
              }}
            >
              <Tag size={15} strokeWidth={2.2} color="#FFFFFF" />
              <span>Título:</span>
            </div>

            <div
              style={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                alignItems: 'center',
                padding: '0 12px 0 4px',
              }}
            >
              {mode === 'interactive' ? (
                <input
                  type="text"
                  value={title}
                  onFocus={onTitleFocus}
                  onChange={(e) => onTitleChange?.(e.target.value)}
                  placeholder="Digite o título da anotação..."
                  style={{
                    width: '100%',
                    border: 'none',
                    outline: 'none',
                    backgroundColor: 'transparent',
                    fontSize: '14.5px',
                    fontWeight: 700,
                    color: '#072B54',
                  }}
                />
              ) : (
                <span
                  style={{
                    fontSize: '14.5px',
                    fontWeight: 700,
                    color: '#072B54',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {displayTitle}
                </span>
              )}
            </div>
          </div>

          {mode === 'interactive' ? (
            <div
              style={{
                width: onDateChange ? '220px' : '208px',
                flexShrink: 0,
                height: '38px',
                borderRadius: '10px',
                border: '1.6px solid #0B3F7D',
                backgroundColor: '#F4F8FE',
                display: 'flex',
                alignItems: 'center',
                gap: '7px',
                padding: '0 12px',
                boxSizing: 'border-box',
              }}
            >
              <Calendar size={16} strokeWidth={2.2} color="#072F62" style={{ flexShrink: 0 }} />
              <span
                style={{
                  fontSize: '14px',
                  fontWeight: 800,
                  color: '#072F62',
                  flexShrink: 0,
                }}
              >
                Data:
              </span>
              {onDateChange ? (
                <input
                  type="date"
                  value={date || ''}
                  onFocus={onTitleFocus}
                  onChange={(e) => onDateChange(e.target.value)}
                  aria-label="Data da anotação"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    border: 'none',
                    outline: 'none',
                    backgroundColor: 'transparent',
                    fontSize: '13.5px',
                    fontWeight: 700,
                    color: '#072F62',
                    fontFamily: 'inherit',
                    cursor: 'pointer',
                  }}
                />
              ) : (
                <span
                  style={{
                    fontSize: '14px',
                    fontWeight: 700,
                    color: '#072F62',
                    letterSpacing: '0.02em',
                  }}
                >
                  {formattedDate}
                </span>
              )}
            </div>
          ) : isBlank ? (
            <div
              style={{
                width: '158px',
                flexShrink: 0,
                height: '38px',
                borderRadius: '10px',
                border: '1.6px solid #0B3F7D',
                backgroundColor: '#F4F8FE',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0 14px',
                boxSizing: 'border-box',
              }}
            >
              <span
                style={{
                  fontSize: '14px',
                  fontWeight: 700,
                  color: '#072F62',
                  letterSpacing: '0.02em',
                }}
              >
                {formattedDate}
              </span>
            </div>
          ) : null}
        </div>

        {/* QUADRO CENTRAL COM PAUTAS SINCRONIZADAS AO DOM DO TEXTO E CHECKLISTS */}
        <div
          onMouseDown={onBodyMouseDown}
          style={{
            flex: 1,
            border: '1.8px solid #0B3F7D',
            borderRadius: '14px',
            backgroundColor: '#FFFFFF',
            padding: '16px 22px 18px 22px',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
          }}
        >
          <div
            className="fenix-ruled-content-area"
            style={{
              flex: 1,
              position: 'relative',
              minHeight: `${maxRuleY}px`,
              fontSize: '16px',
              lineHeight: `${NOTEBOOK_LINE_HEIGHT}px`,
              color: '#0F172A',
            }}
          >
            {/* Camada dinâmica de pautas horizontais alinhadas ao espaçamento real de cada linha */}
            <div
              aria-hidden="true"
              className="fenix-ruled-lines-layer"
              style={{
                position: 'absolute',
                inset: 0,
                pointerEvents: 'none',
                zIndex: 0,
              }}
            >
              {lineYs.map((y, idx) => (
                <div
                  key={idx}
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    top: `${y}px`,
                    height: '1px',
                    backgroundColor: '#77A4DA',
                  }}
                />
              ))}
            </div>

            {/* Camada do conteúdo editável / imprimível */}
            <div
              ref={contentLayerRef}
              style={{
                position: 'relative',
                zIndex: 1,
                fontSize: '16px',
                lineHeight: `${NOTEBOOK_LINE_HEIGHT}px`,
                color: '#0F172A',
              }}
            >
              {children}
            </div>
          </div>
        </div>
      </div>

      {/* RODAPÉ OFICIAL FÊNIX WORLD */}
      <div
        style={{
          width: '100%',
          height: isMinimal ? '26px' : '64px',
          flexShrink: 0,
          backgroundColor: '#FFFFFF',
          overflow: 'hidden',
        }}
      >
        {isMinimal ? (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'flex-end',
            }}
          >
            <div
              style={{
                width: '100%',
                height: '8px',
                background: 'linear-gradient(90deg, #072B54 0%, #0D64BD 60%, #CBD5E1 100%)',
              }}
            />
          </div>
        ) : (
          <svg
            viewBox="0 0 800 72"
            preserveAspectRatio="none"
            style={{ width: '100%', height: '64px', display: 'block' }}
          >
            <defs>
              <linearGradient id={`ftrNavy_${uid}`} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#072B54" />
                <stop offset="55%" stopColor="#0A4B95" />
                <stop offset="100%" stopColor="#1371C8" />
              </linearGradient>
              <linearGradient id={`ftrSilver_${uid}`} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#E2E8F0" />
                <stop offset="60%" stopColor="#CBD5E1" />
                <stop offset="100%" stopColor="#94A3B8" />
              </linearGradient>
            </defs>
            <path
              d="M 0 38 C 190 64, 470 42, 800 4 L 800 72 L 0 72 Z"
              fill={`url(#ftrSilver_${uid})`}
              opacity="0.85"
            />
            <path
              d="M 0 46 C 220 70, 500 50, 800 14 L 800 72 L 0 72 Z"
              fill={`url(#ftrNavy_${uid})`}
            />
            <path
              d="M 420 72 C 570 50, 690 36, 800 28 L 800 32 C 690 42, 575 56, 442 72 Z"
              fill="#E2E8F0"
              opacity="0.7"
            />
          </svg>
        )}
      </div>
    </div>
  );
};
