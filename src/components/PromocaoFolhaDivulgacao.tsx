import React from 'react';
import { Calendar, CreditCard, Tag } from 'lucide-react';
import { FENIX_OFFICIAL_LOGO_BASE64 } from '../assets/fenixLogoBase64';
import {
  PromoCampaign,
  PromoCategoryConfig,
  PromoModality,
  PromoOfferItem,
  PromoSheetModel,
  PROMO_MODALITIES,
  SEM_CATEGORIA_ID,
  computeLotMetrics,
  formatCurrencyBRL,
  formatDateBR,
  formatSqmBR,
  formatTierRangeLabel,
  getCampaignCategories,
  getDefaultSheetSettings,
  getOfferUnitPrice,
  getTierRangeSignature,
  splitCampaignBadgeTitle,
} from '../utils/promocoesService';

interface PromocaoFolhaDivulgacaoProps {
  campaign: PromoCampaign;
  modality: PromoModality;
  includedCategories?: Record<string, boolean>;
  sheetModel?: PromoSheetModel;
  showModalityLabel?: boolean;
  showSubcategories?: boolean;
  density?: 'padrao' | 'compacto';
  id?: string;
}

export const PromocaoFolhaDivulgacao: React.FC<PromocaoFolhaDivulgacaoProps> = ({
  campaign,
  modality,
  includedCategories,
  sheetModel,
  showModalityLabel,
  showSubcategories,
  density,
  id = 'promocao-folha-a4',
}) => {
  const defaults = getDefaultSheetSettings(
    campaign.showSubcategoriesOnSheet !== undefined ? Boolean(campaign.showSubcategoriesOnSheet) : true
  );
  const settings = campaign.sheetSettings || defaults;

  const activeModel: PromoSheetModel = sheetModel || settings.model || 'oficial_colorido';
  const isMono = activeModel === 'pb_economico';
  const isCompact = activeModel === 'compacto_a4' || density === 'compacto' || settings.density === 'compacto';
  const showAudience = showModalityLabel !== undefined ? showModalityLabel : Boolean(settings.showModalityLabel);
  const groupSubcategories =
    showSubcategories !== undefined
      ? showSubcategories
      : settings.showSubcategories !== undefined
      ? Boolean(settings.showSubcategories)
      : campaign.showSubcategoriesOnSheet !== undefined
      ? Boolean(campaign.showSubcategoriesOnSheet)
      : true;

  const catEnabled: Record<string, boolean> = includedCategories || settings.includedCategories || defaults.includedCategories;

  const palette = isMono
    ? {
        primary: '#111827',
        primaryDark: '#030712',
        primaryBorder: '#1f2937',
        badgeTop: '#1f2937',
        badgeBottom: '#111827',
        waveBack: '#d1d5db',
        waveFrontStart: '#374151',
        waveFrontMid: '#1f2937',
        waveFrontEnd: '#111827',
        subHeaderBg: '#e5e7eb',
        subHeaderBorder: '#6b7280',
        cellBorder: '#9ca3af',
        text: '#030712',
        mutedText: '#374151',
      }
    : {
        primary: '#0B3F7D',
        primaryDark: '#072B54',
        primaryBorder: '#0B3F7D',
        badgeTop: '#0A3F7D',
        badgeBottom: '#1E242B',
        waveBack: '#cbd5e1',
        waveFrontStart: '#0C63B8',
        waveFrontMid: '#0B437D',
        waveFrontEnd: '#072B54',
        subHeaderBg: 'linear-gradient(180deg, #f1f5f9 0%, #dce4ee 100%)',
        subHeaderBorder: '#94a3b8',
        cellBorder: '#cbd5e1',
        text: '#0f172a',
        mutedText: '#334155',
      };

  const cellPad = isCompact ? '3px 8px' : '5px 10px';
  const numCellPad = isCompact ? '3px 5px' : '5px 7px';
  const headerFontSize = isCompact ? '14.5px' : '17px';
  const headerPad = isCompact ? '4px 14px' : '5.5px 16px';
  const bodyFontSize = isCompact ? '11.2px' : '12.5px';
  const thFontSize = isCompact ? '11.2px' : '12.5px';
  const sectionGap = isCompact ? '8px' : '12px';

  const modalityMeta = PROMO_MODALITIES.find((m) => m.id === modality) || PROMO_MODALITIES[0];
  const badgeTitle = splitCampaignBadgeTitle(
    campaign.name,
    campaign.badgeTopText,
    campaign.badgeBottomText
  );

  const campaignCategories = React.useMemo(
    () => getCampaignCategories(campaign),
    [campaign]
  );
  const configuredCategoryIds = React.useMemo(
    () => new Set(campaignCategories.map((c) => c.id)),
    [campaignCategories]
  );

  const modalityOffers = (campaign.offersByModality?.[modality] || [])
    .filter((o) => o.active !== false)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const getPisoRowsForCategory = (catId: string) =>
    modalityOffers
      .filter((o) => o.category === catId)
      .map((offer) => {
        const lot = offer.lotId
          ? campaign.lots.find((l) => l.id === offer.lotId)
          : undefined;
        if (!lot) return null;
        const metrics = computeLotMetrics(lot);
        if (!metrics.isAvailable) return null;
        const subId = offer.subcategoryId || lot.subcategoryId;
        const subName = subId
          ? campaign.subcategories.find((s) => s.id === subId)?.name || ''
          : '';
        return {
          offer,
          lot,
          metrics,
          subName,
          description: offer.description?.trim() || lot.description,
          priceSqm: Number(offer.priceSqm ?? offer.price ?? 0),
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

  const pisoCategoryConfig = campaignCategories.find((c) => c.id === 'piso_vinilico');
  const pisoUsesSpecialLotTable =
    Boolean(pisoCategoryConfig) &&
    pisoCategoryConfig!.pricingType === 'unitario' &&
    catEnabled.piso_vinilico !== false;

  const pisoRows = pisoUsesSpecialLotTable ? getPisoRowsForCategory('piso_vinilico') : [];

  const groupedPisoRows = React.useMemo(() => {
    if (!groupSubcategories) {
      return [{ subName: '', items: pisoRows }];
    }
    const groups: { subName: string; items: typeof pisoRows; order: number }[] = [];
    const subOrderMap = new Map<string, number>();
    campaign.subcategories
      .filter((s) => s.category === 'piso_vinilico')
      .forEach((s, i) => subOrderMap.set(s.name, Number.isFinite(s.order) ? s.order : i));

    const map = new Map<string, typeof pisoRows>();
    for (const row of pisoRows) {
      const key = row.subName || '';
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key)!.push(row);
    }
    map.forEach((items, subName) => {
      groups.push({
        subName,
        items,
        order: subName ? subOrderMap.get(subName) ?? 9998 : 9999,
      });
    });
    groups.sort((a, b) => a.order - b.order);
    return groups.map(({ subName, items }) => ({ subName, items }));
  }, [pisoRows, groupSubcategories, campaign.subcategories]);

  const orphanOffers = modalityOffers.filter(
    (o) => o.category === SEM_CATEGORIA_ID || !configuredCategoryIds.has(o.category)
  );

  const dynamicSections = React.useMemo(() => {
    const list: { cat: PromoCategoryConfig; rows: PromoOfferItem[]; isSpecialPiso: boolean }[] = [];
    campaignCategories.forEach((cat) => {
      const isEnabled = catEnabled[cat.id] !== false;
      if (!isEnabled) return;
      if (cat.id === 'piso_vinilico' && cat.pricingType === 'unitario') {
        if (pisoRows.length > 0) {
          list.push({ cat, rows: [], isSpecialPiso: true });
        }
        return;
      }
      const rows = modalityOffers.filter((o) => o.category === cat.id);
      if (rows.length > 0) {
        list.push({ cat, rows, isSpecialPiso: false });
      }
    });
    if (catEnabled[SEM_CATEGORIA_ID] === true && orphanOffers.length > 0) {
      list.push({
        cat: {
          id: SEM_CATEGORIA_ID,
          label: 'Outros Itens',
          unit: 'unidade',
          pricingType: 'unitario',
          order: 99999,
        },
        rows: orphanOffers,
        isSpecialPiso: false,
      });
    }
    return list;
  }, [campaignCategories, catEnabled, pisoRows.length, modalityOffers, orphanOffers]);

  const hasAnyItem = dynamicSections.length > 0;

  const commercialCondition = (campaign.conditionsByModality?.[modality] || '').trim();
  const paymentCondition = (campaign.paymentConditionText || '').trim();
  const hasPaymentCondition = Boolean(paymentCondition);
  const hasCustomValidity = Boolean(campaign.validityText && campaign.validityText.trim());
  const startFormatted = formatDateBR(campaign.startDate);
  const endFormatted = formatDateBR(campaign.endDate);

  return (
    <div
      id={id}
      style={{
        width: '794px',
        minWidth: '794px',
        maxWidth: '794px',
        minHeight: '1123px',
        backgroundColor: '#ffffff',
        color: palette.text,
        fontFamily: "'Plus Jakarta Sans', 'Segoe UI', Arial, sans-serif",
        boxSizing: 'border-box',
        position: 'relative',
        overflow: 'hidden',
        border: '1px solid #d5e0ec',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}
    >
      {/* BLOCO SUPERIOR: CABEÇALHO + ONDA + CONTEÚDO DAS TABELAS */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {/* CABEÇALHO OFICIAL: LOGO FÊNIX WORLD | IDENTIFICAÇÃO DA CAMPANHA */}
        <div
          style={{
            padding: isCompact ? '12px 28px 6px 28px' : '16px 28px 8px 28px',
            backgroundColor: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '22px',
          }}
        >
          {/* Logo Oficial Fênix World */}
          <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            <img
              src={FENIX_OFFICIAL_LOGO_BASE64}
              alt="Fênix World"
              style={{
                height: isCompact ? '64px' : '74px',
                width: 'auto',
                objectFit: 'contain',
                display: 'block',
                filter: isMono ? 'grayscale(100%) contrast(1.15)' : 'none',
              }}
            />
          </div>

          {/* Divisória vertical */}
          <div
            style={{
              width: '2px',
              height: isCompact ? '54px' : '62px',
              backgroundColor: palette.primary,
              flexShrink: 0,
            }}
          />

          {/* Identificação da Campanha (Tag Icon + Fitas Inclinadas conforme modelo oficial) */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              flexShrink: 0,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transform: 'rotate(-14deg)',
                color: palette.primary,
              }}
            >
              <Tag size={isCompact ? 44 : 50} strokeWidth={2.3} color={palette.primary} />
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                transform: 'rotate(-2.2deg)',
                gap: '3px',
              }}
            >
              <div
                style={{
                  backgroundColor: palette.badgeTop,
                  color: '#ffffff',
                  padding: isCompact ? '2px 14px' : '3px 16px',
                  borderRadius: '6px',
                  fontSize: isCompact ? '18px' : '20px',
                  fontWeight: 900,
                  letterSpacing: '0.06em',
                  lineHeight: 1.1,
                  fontStyle: 'italic',
                  whiteSpace: 'nowrap',
                }}
              >
                {badgeTitle.top}
              </div>
              <div
                style={{
                  backgroundColor: palette.badgeBottom,
                  color: '#ffffff',
                  padding: isCompact ? '3px 16px' : '4px 18px',
                  borderRadius: '7px',
                  fontSize: isCompact ? '24px' : '27px',
                  fontWeight: 900,
                  letterSpacing: '0.05em',
                  lineHeight: 1.05,
                  fontStyle: 'italic',
                  whiteSpace: 'nowrap',
                }}
              >
                {badgeTitle.bottom}
              </div>
            </div>
          </div>
        </div>

        {/* ONDA SUPERIOR INSTITUCIONAL */}
        <div style={{ width: '100%', lineHeight: 0, marginTop: '-2px' }}>
          <svg
            viewBox="0 0 794 34"
            width="794"
            height="34"
            preserveAspectRatio="none"
            style={{ display: 'block', width: '100%', height: '32px' }}
          >
            <defs>
              <linearGradient id={`fenixPromoTopBlue-${id}`} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor={palette.waveFrontStart} />
                <stop offset="50%" stopColor={palette.waveFrontMid} />
                <stop offset="100%" stopColor={palette.waveFrontEnd} />
              </linearGradient>
            </defs>
            <path
              d="M0,26 C220,4 540,34 794,6 L794,16 C540,42 220,12 0,32 Z"
              fill={palette.waveBack}
            />
            <path
              d="M0,22 C230,0 535,30 794,2 L794,11 C535,36 230,8 0,28 Z"
              fill={`url(#fenixPromoTopBlue-${id})`}
            />
          </svg>
        </div>

        {/* IDENTIFICAÇÃO OPCIONAL DO PÚBLICO (CONTROLADA EM EDITAR LAYOUT) */}
        {showAudience && (
          <div
            style={{
              padding: '2px 6px 6px 6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: `1px solid ${palette.cellBorder}`,
              margin: '0 22px 8px 22px',
            }}
          >
            <span
              style={{
                fontSize: '10.5px',
                fontWeight: 700,
                color: palette.mutedText,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
              }}
            >
              Tabela Comercial Promocional
            </span>
            <span
              style={{
                fontSize: '11.5px',
                fontWeight: 800,
                color: palette.primary,
                letterSpacing: '0.07em',
                textTransform: 'uppercase',
              }}
            >
              Público: {modalityMeta.label}
            </span>
          </div>
        )}

        {/* CORPO PRINCIPAL DAS CATEGORIAS */}
        <div
          style={{
            padding: '4px 22px 10px 22px',
            display: 'flex',
            flexDirection: 'column',
            gap: sectionGap,
          }}
        >
          {!hasAnyItem && (
            <div
              style={{
                border: `1.5px dashed ${palette.cellBorder}`,
                borderRadius: '14px',
                padding: '36px 24px',
                textAlign: 'center',
                color: palette.mutedText,
                fontSize: '13px',
              }}
            >
              Nenhum produto disponível selecionado para o público{' '}
              <strong style={{ color: palette.primary }}>{modalityMeta.label}</strong> nesta folha.
            </div>
          )}

          {dynamicSections.map(({ cat, rows, isSpecialPiso }) => {
            if (isSpecialPiso) {
              return (
                <div
                  key={cat.id}
                  style={{
                    border: `1.5px solid ${palette.primaryBorder}`,
                    borderRadius: '14px',
                    overflow: 'hidden',
                    backgroundColor: '#ffffff',
                    pageBreakInside: 'avoid',
                  }}
                >
                  <div
                    style={{
                      backgroundColor: palette.primary,
                      color: '#ffffff',
                      padding: headerPad,
                      fontSize: headerFontSize,
                      fontWeight: 800,
                      letterSpacing: '0.03em',
                      textTransform: 'uppercase',
                    }}
                  >
                    {cat.label}
                  </div>

                  <table
                    style={{
                      width: '100%',
                      borderCollapse: 'collapse',
                      tableLayout: 'auto',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    <thead>
                      <tr
                        style={{
                          background: palette.subHeaderBg,
                          borderBottom: `1px solid ${palette.subHeaderBorder}`,
                        }}
                      >
                        <th
                          style={{
                            padding: cellPad,
                            fontSize: thFontSize,
                            fontWeight: 700,
                            color: palette.text,
                            textAlign: 'center',
                            borderRight: `1px solid ${palette.cellBorder}`,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          Descrição
                        </th>
                        <th
                          style={{
                            width: '1%',
                            padding: numCellPad,
                            fontSize: thFontSize,
                            fontWeight: 700,
                            color: palette.text,
                            textAlign: 'center',
                            borderRight: `1px solid ${palette.cellBorder}`,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          Caixas
                        </th>
                        <th
                          style={{
                            width: '1%',
                            padding: numCellPad,
                            fontSize: thFontSize,
                            fontWeight: 700,
                            color: palette.text,
                            textAlign: 'center',
                            borderRight: `1px solid ${palette.cellBorder}`,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          Total (m²)
                        </th>
                        <th
                          style={{
                            width: '1%',
                            padding: numCellPad,
                            fontSize: thFontSize,
                            fontWeight: 700,
                            color: palette.text,
                            textAlign: 'center',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          Preço ({cat.unit})
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupedPisoRows.map((group, gIdx) => (
                        <React.Fragment key={`${group.subName}_${gIdx}`}>
                          {groupSubcategories && group.subName && (
                            <tr
                              style={{
                                backgroundColor: isMono ? '#e5e7eb' : '#e8f0fa',
                                borderBottom: `1px solid ${palette.cellBorder}`,
                              }}
                            >
                              <td
                                colSpan={4}
                                style={{
                                  padding: isCompact ? '3.5px 10px' : '4.5px 12px',
                                  fontSize: isCompact ? '10.5px' : '11.5px',
                                  fontWeight: 800,
                                  color: palette.primary,
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.04em',
                                  textAlign: 'left',
                                }}
                              >
                                {group.subName}
                              </td>
                            </tr>
                          )}
                          {group.items.map((row, idx) => (
                            <tr
                              key={row.offer.id}
                              style={{
                                backgroundColor: '#ffffff',
                                borderBottom:
                                  gIdx === groupedPisoRows.length - 1 &&
                                  idx === group.items.length - 1
                                    ? 'none'
                                    : `1px solid ${palette.cellBorder}`,
                              }}
                            >
                              <td
                                style={{
                                  padding: cellPad,
                                  fontSize: bodyFontSize,
                                  fontWeight: 700,
                                  color: palette.text,
                                  borderRight: `1px solid ${palette.cellBorder}`,
                                  textAlign: 'left',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {row.description}
                              </td>
                              <td
                                style={{
                                  width: '1%',
                                  padding: numCellPad,
                                  fontSize: bodyFontSize,
                                  fontWeight: 700,
                                  color: palette.text,
                                  borderRight: `1px solid ${palette.cellBorder}`,
                                  textAlign: 'center',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {row.metrics.availableBoxes}
                              </td>
                              <td
                                style={{
                                  width: '1%',
                                  padding: numCellPad,
                                  fontSize: bodyFontSize,
                                  fontWeight: 700,
                                  color: palette.text,
                                  borderRight: `1px solid ${palette.cellBorder}`,
                                  textAlign: 'center',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {formatSqmBR(row.metrics.availableSqm)}
                              </td>
                              <td
                                style={{
                                  width: '1%',
                                  padding: numCellPad,
                                  fontSize: bodyFontSize,
                                  fontWeight: 700,
                                  color: palette.text,
                                  textAlign: 'center',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {formatCurrencyBRL(row.priceSqm)}
                              </td>
                            </tr>
                          ))}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            }

            if (cat.pricingType === 'escalonado') {
              const rangeMap = new Map<
                string,
                { sig: string; minQty: number; maxQty?: number | null }
              >();
              (cat.defaultRanges || []).forEach((r) => {
                const sig = getTierRangeSignature(r);
                if (!rangeMap.has(sig)) {
                  rangeMap.set(sig, { sig, minQty: r.minQty, maxQty: r.maxQty ?? null });
                }
              });
              rows.forEach((offer) => {
                (offer.tiers || []).forEach((t) => {
                  const sig = getTierRangeSignature(t);
                  if (!rangeMap.has(sig)) {
                    rangeMap.set(sig, { sig, minQty: t.minQty, maxQty: t.maxQty ?? null });
                  }
                });
              });
              const rangeCols = Array.from(rangeMap.values()).sort((a, b) => {
                if (a.minQty !== b.minQty) return a.minQty - b.minQty;
                return (a.maxQty ?? Infinity) - (b.maxQty ?? Infinity);
              });
              const hasBasePrice = rows.some((o) => Number(o.priceNormal) > 0);

              return (
                <div
                  key={cat.id}
                  style={{
                    border: `1.5px solid ${palette.primaryBorder}`,
                    borderRadius: '14px',
                    overflow: 'hidden',
                    backgroundColor: '#ffffff',
                    pageBreakInside: 'avoid',
                  }}
                >
                  <div
                    style={{
                      backgroundColor: palette.primary,
                      color: '#ffffff',
                      padding: headerPad,
                      fontSize: headerFontSize,
                      fontWeight: 800,
                      letterSpacing: '0.03em',
                      textTransform: 'uppercase',
                    }}
                  >
                    {cat.label}
                  </div>

                  <table
                    style={{
                      width: '100%',
                      borderCollapse: 'collapse',
                      tableLayout: 'auto',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    <thead>
                      <tr
                        style={{
                          background: palette.subHeaderBg,
                          borderBottom: `1px solid ${palette.subHeaderBorder}`,
                        }}
                      >
                        <th
                          style={{
                            padding: cellPad,
                            fontSize: thFontSize,
                            fontWeight: 700,
                            color: palette.text,
                            textAlign: 'center',
                            borderRight: `1px solid ${palette.cellBorder}`,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          Descrição
                        </th>
                        {hasBasePrice && (
                          <th
                            style={{
                              width: '1%',
                              padding: numCellPad,
                              fontSize: thFontSize,
                              fontWeight: 700,
                              color: palette.text,
                              textAlign: 'center',
                              borderRight:
                                rangeCols.length > 0 ? `1px solid ${palette.cellBorder}` : 'none',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            Preço ({cat.unit})
                          </th>
                        )}
                        {rangeCols.map((col, cIdx) => (
                          <th
                            key={col.sig}
                            style={{
                              width: '1%',
                              padding: numCellPad,
                              fontSize: thFontSize,
                              fontWeight: 700,
                              color: palette.text,
                              textAlign: 'center',
                              borderRight:
                                cIdx < rangeCols.length - 1
                                  ? `1px solid ${palette.cellBorder}`
                                  : 'none',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {formatTierRangeLabel(col, cat.unit)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((offer, idx) => (
                        <tr
                          key={offer.id}
                          style={{
                            backgroundColor: '#ffffff',
                            borderBottom:
                              idx === rows.length - 1 ? 'none' : `1px solid ${palette.cellBorder}`,
                          }}
                        >
                          <td
                            style={{
                              padding: cellPad,
                              fontSize: bodyFontSize,
                              fontWeight: 700,
                              color: palette.text,
                              borderRight: `1px solid ${palette.cellBorder}`,
                              textAlign: 'left',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {offer.description}
                            {offer.specs ? (
                              <span style={{ fontWeight: 500, color: palette.mutedText }}>
                                {' '}
                                ({offer.specs})
                              </span>
                            ) : null}
                          </td>
                          {hasBasePrice && (
                            <td
                              style={{
                                width: '1%',
                                padding: numCellPad,
                                fontSize: bodyFontSize,
                                fontWeight: 700,
                                color: palette.text,
                                borderRight:
                                  rangeCols.length > 0 ? `1px solid ${palette.cellBorder}` : 'none',
                                textAlign: 'center',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {Number(offer.priceNormal) > 0
                                ? formatCurrencyBRL(offer.priceNormal)
                                : '—'}
                            </td>
                          )}
                          {rangeCols.map((col, cIdx) => {
                            const matched = (offer.tiers || []).find(
                              (t) => getTierRangeSignature(t) === col.sig
                            );
                            return (
                              <td
                                key={col.sig}
                                style={{
                                  width: '1%',
                                  padding: numCellPad,
                                  fontSize: bodyFontSize,
                                  fontWeight: 700,
                                  color: palette.text,
                                  borderRight:
                                    cIdx < rangeCols.length - 1
                                      ? `1px solid ${palette.cellBorder}`
                                      : 'none',
                                  textAlign: 'center',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {matched ? formatCurrencyBRL(matched.price) : '—'}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            }

            return (
              <div
                key={cat.id}
                style={{
                  border: `1.5px solid ${palette.primaryBorder}`,
                  borderRadius: '14px',
                  overflow: 'hidden',
                  backgroundColor: '#ffffff',
                  pageBreakInside: 'avoid',
                }}
              >
                <div
                  style={{
                    backgroundColor: palette.primary,
                    color: '#ffffff',
                    padding: headerPad,
                    fontSize: headerFontSize,
                    fontWeight: 800,
                    letterSpacing: '0.03em',
                    textTransform: 'uppercase',
                  }}
                >
                  {cat.label}
                </div>

                <table
                  style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    tableLayout: 'auto',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  <thead>
                    <tr
                      style={{
                        background: palette.subHeaderBg,
                        borderBottom: `1px solid ${palette.subHeaderBorder}`,
                      }}
                    >
                      <th
                        style={{
                          padding: cellPad,
                          fontSize: thFontSize,
                          fontWeight: 700,
                          color: palette.text,
                          textAlign: 'center',
                          borderRight: `1px solid ${palette.cellBorder}`,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        Descrição
                      </th>
                      <th
                        style={{
                          width: '1%',
                          padding: numCellPad,
                          fontSize: thFontSize,
                          fontWeight: 700,
                          color: palette.text,
                          textAlign: 'center',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        Preço ({cat.unit})
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((offer, idx) => (
                      <tr
                        key={offer.id}
                        style={{
                          backgroundColor: '#ffffff',
                          borderBottom:
                            idx === rows.length - 1 ? 'none' : `1px solid ${palette.cellBorder}`,
                        }}
                      >
                        <td
                          style={{
                            padding: cellPad,
                            fontSize: bodyFontSize,
                            fontWeight: 700,
                            color: palette.text,
                            borderRight: `1px solid ${palette.cellBorder}`,
                            textAlign: 'left',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {offer.description}
                          {offer.specs ? (
                            <span style={{ fontWeight: 500, color: palette.mutedText }}>
                              {' '}
                              ({offer.specs})
                            </span>
                          ) : null}
                        </td>
                        <td
                          style={{
                            width: '1%',
                            padding: numCellPad,
                            fontSize: bodyFontSize,
                            fontWeight: 700,
                            color: palette.text,
                            textAlign: 'center',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {formatCurrencyBRL(getOfferUnitPrice(offer, cat))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}

        </div>
      </div>

      {/* BLOCO INFERIOR ANCORADO NO FIM DA PÁGINA A4: VALIDADE + PAGAMENTO + CONDIÇÕES + ONDA INFERIOR */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '4px 22px 8px 22px' }}>
          <div
            style={{
              backgroundColor: palette.primary,
              color: '#ffffff',
              borderRadius: '10px',
              padding: isCompact ? '7px 16px' : '9px 18px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: hasPaymentCondition ? 'center' : 'flex-start',
              flexWrap: 'wrap',
              gap: isCompact ? '10px' : '14px',
            }}
          >
            {/* Validade */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: isCompact ? '8px' : '10px',
              }}
            >
              <Calendar
                size={isCompact ? 19 : 22}
                strokeWidth={2.2}
                color="#ffffff"
                style={{ flexShrink: 0 }}
              />
              <div
                style={{
                  fontSize: isCompact ? '12px' : '13px',
                  fontWeight: 600,
                  letterSpacing: '0.015em',
                }}
              >
                {hasCustomValidity ? (
                  campaign.validityText
                ) : (
                  <>
                    Válida de <strong style={{ fontWeight: 800 }}>{startFormatted}</strong> a{' '}
                    <strong style={{ fontWeight: 800 }}>{endFormatted}</strong>, ou enquanto
                    durarem os estoques.
                  </>
                )}
              </div>
            </div>

            {/* Barra separadora + Condição de Pagamento (exibida apenas se preenchida) */}
            {hasPaymentCondition && (
              <>
                <div
                  style={{
                    width: '1.5px',
                    height: isCompact ? '18px' : '22px',
                    backgroundColor: 'rgba(255, 255, 255, 0.55)',
                    flexShrink: 0,
                  }}
                />
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: isCompact ? '8px' : '10px',
                  }}
                >
                  <CreditCard
                    size={isCompact ? 19 : 22}
                    strokeWidth={2.2}
                    color="#ffffff"
                    style={{ flexShrink: 0 }}
                  />
                  <div
                    style={{
                      fontSize: isCompact ? '12px' : '13px',
                      fontWeight: 700,
                      letterSpacing: '0.015em',
                    }}
                  >
                    {paymentCondition}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* CONDIÇÕES COMERCIAIS (EXIBIDO APÓS A VALIDADE, SEM PREFIXO AUTOMÁTICO) */}
        {commercialCondition && (
          <div style={{ padding: '0 22px 8px 22px' }}>
            <div
              style={{
                padding: isCompact ? '5px 14px' : '7px 16px',
                borderRadius: '8px',
                border: `1px solid ${palette.cellBorder}`,
                backgroundColor: '#f8fafc',
                fontSize: isCompact ? '11px' : '11.8px',
                fontWeight: 500,
                color: palette.text,
                lineHeight: 1.45,
                whiteSpace: 'pre-line',
              }}
            >
              {commercialCondition}
            </div>
          </div>
        )}

        {/* ONDA INFERIOR INSTITUCIONAL */}
        <div style={{ width: '100%', lineHeight: 0 }}>
          <svg
            viewBox="0 0 794 36"
            width="794"
            height="36"
            preserveAspectRatio="none"
            style={{ display: 'block', width: '100%', height: '34px' }}
          >
            <defs>
              <linearGradient id={`fenixPromoBottomBlue-${id}`} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor={palette.waveFrontEnd} />
                <stop offset="55%" stopColor={palette.waveFrontMid} />
                <stop offset="100%" stopColor={palette.waveFrontStart} />
              </linearGradient>
            </defs>
            <path d="M0,18 C210,4 520,28 794,4 L794,36 L0,36 Z" fill={palette.waveBack} />
            <path
              d="M0,22 C230,8 510,32 794,9 L794,36 L0,36 Z"
              fill={`url(#fenixPromoBottomBlue-${id})`}
            />
          </svg>
        </div>
      </div>
    </div>
  );
};
