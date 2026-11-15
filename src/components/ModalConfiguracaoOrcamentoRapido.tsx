import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { CatalogProduct } from '../data/productCatalog';
import { PriceTableTier } from '../types';
import {
  formatSqmPtBr,
  getQuickBudgetPisoCandidates,
  getQuickBudgetRodapeCandidates,
  parsePtBrNumeric,
  QuickBudgetRodapeHeight,
} from '../utils/pisoInsumosCalculator';
import {
  formatMlPtBr,
  getRodapeColaCatalogOptions,
} from '../utils/rodapeCalculator';
import {
  getQuickMantaProducts,
  getQuickMantaSuporteOptions,
  getQuickRipadoAcabamentos,
  getQuickRipadoColaProducts,
  getQuickRipadoProducts,
  getQuickTetoAcabamentos,
  getQuickTetoProducts,
  QuickCategoryKey,
  QuickWizardConfigState,
  QuickWizardMeasurements,
} from '../utils/orcamentoRapidoCalculator';

interface ModalConfiguracaoOrcamentoRapidoProps {
  isOpen: boolean;
  steps: QuickCategoryKey[];
  measurements: QuickWizardMeasurements;
  initialConfig: QuickWizardConfigState;
  priceTable: PriceTableTier;
  catalog: CatalogProduct[];
  onClose: () => void;
  onConfirm: (finalConfig: QuickWizardConfigState) => void;
}

const STEP_LABELS: Record<QuickCategoryKey, string> = {
  piso: 'Piso Vinílico',
  rodape: 'Rodapé',
  ripado: 'Ripado',
  teto: 'Teto Vinílico',
  manta: 'Manta Hospitalar',
};

export const ModalConfiguracaoOrcamentoRapido: React.FC<
  ModalConfiguracaoOrcamentoRapidoProps
> = ({
  isOpen,
  steps,
  measurements,
  initialConfig,
  priceTable,
  catalog,
  onClose,
  onConfirm,
}) => {
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [config, setConfig] = useState<QuickWizardConfigState>(initialConfig);
  const [stepError, setStepError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setCurrentStepIdx(0);
    setConfig(initialConfig);
    setStepError(null);
  }, [isOpen, initialConfig]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const activeCategory: QuickCategoryKey | undefined = steps[currentStepIdx];

  // Candidatos dinâmicos do catálogo
  const pisoCandidates = useMemo(
    () => getQuickBudgetPisoCandidates(config.piso.pisoType, catalog),
    [config.piso.pisoType, catalog]
  );

  const rodapeCandidates = useMemo(
    () => getQuickBudgetRodapeCandidates(config.rodape.height, catalog),
    [config.rodape.height, catalog]
  );

  const rodapeColaOptions = useMemo(() => {
    const selectedRodape =
      rodapeCandidates.find((p) => p.id === config.rodape.productId) ||
      rodapeCandidates[0];
    return getRodapeColaCatalogOptions(
      priceTable,
      selectedRodape?.name || 'Rodapé',
      catalog
    );
  }, [rodapeCandidates, config.rodape.productId, priceTable, catalog]);

  const ripadoCandidates = useMemo(
    () => getQuickRipadoProducts(catalog),
    [catalog]
  );

  const activeRipadoProduct = useMemo(
    () =>
      ripadoCandidates.find((p) => p.id === config.ripado.productId) ||
      ripadoCandidates[0] ||
      null,
    [ripadoCandidates, config.ripado.productId]
  );

  const ripadoAcabamentos = useMemo(
    () => getQuickRipadoAcabamentos(activeRipadoProduct, catalog),
    [activeRipadoProduct, catalog]
  );

  const ripadoColaProducts = useMemo(
    () => getQuickRipadoColaProducts(catalog),
    [catalog]
  );

  const tetoCandidates = useMemo(() => getQuickTetoProducts(catalog), [catalog]);

  const tetoAcabamentos = useMemo(
    () => getQuickTetoAcabamentos(catalog),
    [catalog]
  );

  const mantaCandidates = useMemo(() => getQuickMantaProducts(catalog), [catalog]);

  const mantaSuporteOptions = useMemo(
    () => getQuickMantaSuporteOptions(catalog),
    [catalog]
  );

  // Auto-seleciona primeiro produto válido quando a lista muda
  useEffect(() => {
    if (!isOpen) return;
    setConfig((prev) => {
      let changed = false;
      const next = { ...prev };

      if (
        pisoCandidates.length > 0 &&
        !pisoCandidates.some((p) => p.id === prev.piso.productId)
      ) {
        next.piso = { ...prev.piso, productId: pisoCandidates[0].id };
        changed = true;
      }

      if (
        rodapeCandidates.length > 0 &&
        !rodapeCandidates.some((p) => p.id === prev.rodape.productId)
      ) {
        next.rodape = { ...prev.rodape, productId: rodapeCandidates[0].id };
        changed = true;
      }

      if (
        rodapeColaOptions.calafetarOptions.length > 0 &&
        !rodapeColaOptions.calafetarOptions.some(
          (o) => o.productId === prev.rodape.calafetarProductId
        )
      ) {
        next.rodape = {
          ...(changed ? next.rodape : prev.rodape),
          calafetarProductId: rodapeColaOptions.calafetarOptions[0].productId,
        };
        changed = true;
      }

      if (
        ripadoCandidates.length > 0 &&
        !ripadoCandidates.some((p) => p.id === prev.ripado.productId)
      ) {
        next.ripado = { ...prev.ripado, productId: ripadoCandidates[0].id };
        changed = true;
      }

      if (
        ripadoAcabamentos.length > 0 &&
        !ripadoAcabamentos.some((p) => p.id === prev.ripado.acabamentoProductId)
      ) {
        next.ripado = {
          ...(changed ? next.ripado : prev.ripado),
          acabamentoProductId: ripadoAcabamentos[0].id,
        };
        changed = true;
      }

      if (
        tetoCandidates.length > 0 &&
        !tetoCandidates.some((p) => p.id === prev.teto.productId)
      ) {
        next.teto = { ...prev.teto, productId: tetoCandidates[0].id };
        changed = true;
      }

      if (
        tetoAcabamentos.length > 0 &&
        !tetoAcabamentos.some((p) => p.id === prev.teto.acabamentoProductId)
      ) {
        next.teto = {
          ...(changed ? next.teto : prev.teto),
          acabamentoProductId: tetoAcabamentos[0].id,
        };
        changed = true;
      }

      if (
        mantaCandidates.length > 0 &&
        !mantaCandidates.some((p) => p.id === prev.manta.productId)
      ) {
        next.manta = { ...prev.manta, productId: mantaCandidates[0].id };
        changed = true;
      }

      if (
        mantaSuporteOptions.length > 0 &&
        !mantaSuporteOptions.some((p) => p.id === prev.manta.suporteProductId)
      ) {
        next.manta = {
          ...(changed ? next.manta : prev.manta),
          suporteProductId: mantaSuporteOptions[0].id,
        };
        changed = true;
      }

      return changed ? next : prev;
    });
  }, [
    isOpen,
    pisoCandidates,
    rodapeCandidates,
    rodapeColaOptions.calafetarOptions,
    ripadoCandidates,
    ripadoAcabamentos,
    tetoCandidates,
    tetoAcabamentos,
    mantaCandidates,
    mantaSuporteOptions,
  ]);

  if (!isOpen || steps.length === 0 || !activeCategory) return null;

  const getStepSubtitle = (cat: QuickCategoryKey): string => {
    switch (cat) {
      case 'piso':
        return `${formatSqmPtBr(measurements.pisoSqm)} m²`;
      case 'rodape':
        return `${formatMlPtBr(measurements.rodapeMl)} ml`;
      case 'ripado':
        if (measurements.ripado.mode === 'lxA') {
          return `${formatSqmPtBr(measurements.ripado.widthMeters)} × ${formatSqmPtBr(
            measurements.ripado.heightMeters
          )} m`;
        }
        return `${formatSqmPtBr(measurements.ripado.areaM2)} m²`;
      case 'teto':
        return `${formatSqmPtBr(measurements.tetoSqm)} m²`;
      case 'manta':
        return `${formatSqmPtBr(measurements.mantaSqm)} m²`;
    }
  };

  const validateCurrentStep = (): boolean => {
    setStepError(null);

    if (activeCategory === 'piso') {
      if (pisoCandidates.length === 0) {
        setStepError('Nenhum piso cadastrado encontrado para o tipo selecionado.');
        return false;
      }
      return true;
    }

    if (activeCategory === 'rodape') {
      if (rodapeCandidates.length === 0) {
        setStepError('Nenhum rodapé cadastrado encontrado para a altura selecionada.');
        return false;
      }
      return true;
    }

    if (activeCategory === 'ripado') {
      if (ripadoCandidates.length === 0) {
        setStepError('Nenhum ripado cadastrado encontrado no catálogo.');
        return false;
      }
      if (config.ripado.includeAcabamento) {
        if (ripadoAcabamentos.length === 0) {
          setStepError('Nenhuma barra de acabamento cadastrada para esta linha de ripado.');
          return false;
        }
        const qty = parsePtBrNumeric(config.ripado.acabamentoQty);
        if (qty <= 0) {
          setStepError('Informe a quantidade da barra de acabamento.');
          return false;
        }
      }
      return true;
    }

    if (activeCategory === 'teto') {
      if (tetoCandidates.length === 0) {
        setStepError('Nenhum teto vinílico cadastrado encontrado no catálogo.');
        return false;
      }
      if (config.teto.includeAcabamento) {
        if (tetoAcabamentos.length === 0) {
          setStepError('Nenhum acabamento de teto vinílico cadastrado no catálogo.');
          return false;
        }
        const qty = parsePtBrNumeric(config.teto.acabamentoQty);
        if (qty <= 0) {
          setStepError('Informe a quantidade do acabamento.');
          return false;
        }
      }
      return true;
    }

    if (activeCategory === 'manta') {
      if (mantaCandidates.length === 0) {
        setStepError('Nenhuma manta hospitalar cadastrada encontrada no catálogo.');
        return false;
      }
      if (config.manta.includeAcabamentos) {
        const ml = parsePtBrNumeric(config.manta.acabamentoMl);
        if (ml <= 0) {
          setStepError('Informe a metragem linear (ml) para os acabamentos.');
          return false;
        }
        if (mantaSuporteOptions.length === 0) {
          setStepError('Nenhuma opção de Suporte Canto Curvo cadastrada no catálogo.');
          return false;
        }
      }
      return true;
    }

    return true;
  };

  const handleNextOrFinish = () => {
    if (!validateCurrentStep()) return;

    if (currentStepIdx < steps.length - 1) {
      setCurrentStepIdx((idx) => idx + 1);
      setStepError(null);
    } else {
      onConfirm(config);
    }
  };

  const handleBack = () => {
    if (currentStepIdx > 0) {
      setCurrentStepIdx((idx) => idx - 1);
      setStepError(null);
    }
  };

  const isLastStep = currentStepIdx === steps.length - 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl border border-slate-200/90 shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabeçalho com indicador de etapas */}
        <div className="px-6 py-4 bg-[#0B2046] text-white flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <h3 className="text-base sm:text-lg font-extrabold tracking-tight truncate">
              Configuração do Orçamento Rápido
            </h3>
            <span className="px-2.5 py-0.5 rounded-full bg-white/15 text-sky-100 text-xs font-bold whitespace-nowrap">
              Etapa {currentStepIdx + 1} de {steps.length}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors cursor-pointer shrink-0"
            aria-label="Fechar configuração"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Corpo: Lista de produtos à esquerda + Configuração central (sem painel lateral à direita) */}
        <div className="flex-1 flex flex-col md:flex-row min-h-[340px] overflow-hidden">
          {/* Lista de produtos à esquerda */}
          <aside className="w-full md:w-60 bg-slate-50 border-b md:border-b-0 md:border-r border-slate-200 p-4 space-y-1.5 overflow-y-auto shrink-0">
            {steps.map((stepKey, idx) => {
              const isActive = idx === currentStepIdx;
              const isCompleted = idx < currentStepIdx;
              return (
                <button
                  key={stepKey}
                  type="button"
                  onClick={() => {
                    if (idx <= currentStepIdx) {
                      setCurrentStepIdx(idx);
                      setStepError(null);
                    }
                  }}
                  className={`w-full text-left px-3.5 py-2.5 rounded-xl border transition-all flex items-center justify-between gap-2 ${
                    isActive
                      ? 'bg-[#0057ff] border-[#0057ff] text-white shadow-sm'
                      : isCompleted
                      ? 'bg-white border-emerald-200 text-slate-800 hover:bg-emerald-50/50 cursor-pointer'
                      : 'bg-white/60 border-slate-200 text-slate-500 cursor-default'
                  }`}
                >
                  <div className="min-w-0">
                    <span className="block text-xs font-extrabold truncate">
                      {STEP_LABELS[stepKey]}
                    </span>
                    <span
                      className={`block text-[11px] font-medium truncate ${
                        isActive ? 'text-blue-100' : 'text-slate-500'
                      }`}
                    >
                      {getStepSubtitle(stepKey)}
                    </span>
                  </div>
                  {isCompleted && (
                    <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                      <Check className="w-3 h-3 stroke-[2.5]" />
                    </span>
                  )}
                </button>
              );
            })}
          </aside>

          {/* Configuração central */}
          <div className="flex-1 p-5 sm:p-6 overflow-y-auto space-y-5">
            <div className="border-b border-slate-100 pb-3">
              <h4 className="text-base font-extrabold text-[#091122]">
                {STEP_LABELS[activeCategory]}
              </h4>
            </div>

            {/* ===================================================== */}
            {/* ETAPA: PISO VINÍLICO                                  */}
            {/* ===================================================== */}
            {activeCategory === 'piso' && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 block">
                    Tipo
                  </label>
                  <div className="grid grid-cols-2 gap-2 bg-slate-50 p-1 rounded-xl border border-slate-200">
                    {(['colado', 'clicado'] as const).map((t) => {
                      const active = config.piso.pisoType === t;
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() => {
                            setStepError(null);
                            setConfig((prev) => ({
                              ...prev,
                              piso: { ...prev.piso, pisoType: t },
                            }));
                          }}
                          className={`h-10 rounded-lg text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                            active
                              ? 'bg-[#0057ff] text-white shadow-xs'
                              : 'text-slate-600 hover:bg-white'
                          }`}
                        >
                          {t === 'colado' ? 'Colado' : 'Clicado'}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 block">
                    Produto
                  </label>
                  {pisoCandidates.length > 0 ? (
                    <select
                      value={config.piso.productId || pisoCandidates[0].id}
                      onChange={(e) => {
                        setStepError(null);
                        setConfig((prev) => ({
                          ...prev,
                          piso: { ...prev.piso, productId: e.target.value },
                        }));
                      }}
                      className="w-full h-11 rounded-xl border border-slate-300 bg-white px-3 text-xs sm:text-sm font-semibold text-slate-800 outline-none focus:border-[#0057ff] cursor-pointer"
                    >
                      {pisoCandidates.map((prod) => (
                        <option key={prod.id} value={prod.id}>
                          {prod.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-xs text-rose-600 font-semibold">
                      Nenhum piso {config.piso.pisoType} cadastrado no catálogo.
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 block">
                    Incluir os insumos?
                  </label>
                  <div className="grid grid-cols-2 gap-2 bg-slate-50 p-1 rounded-xl border border-slate-200">
                    <button
                      type="button"
                      onClick={() =>
                        setConfig((prev) => ({
                          ...prev,
                          piso: { ...prev.piso, includeInsumos: true },
                        }))
                      }
                      className={`h-10 rounded-lg text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                        config.piso.includeInsumos
                          ? 'bg-[#0057ff] text-white shadow-xs'
                          : 'text-slate-600 hover:bg-white'
                      }`}
                    >
                      Sim
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setConfig((prev) => ({
                          ...prev,
                          piso: { ...prev.piso, includeInsumos: false },
                        }))
                      }
                      className={`h-10 rounded-lg text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                        !config.piso.includeInsumos
                          ? 'bg-slate-800 text-white shadow-xs'
                          : 'text-slate-600 hover:bg-white'
                      }`}
                    >
                      Não
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ===================================================== */}
            {/* ETAPA: RODAPÉ                                         */}
            {/* ===================================================== */}
            {activeCategory === 'rodape' && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 block">
                    Altura
                  </label>
                  <div className="grid grid-cols-4 gap-1.5 bg-slate-50 p-1 rounded-xl border border-slate-200">
                    {(['07cm', '10cm', '12cm', '15cm'] as QuickBudgetRodapeHeight[]).map(
                      (h) => {
                        const active = config.rodape.height === h;
                        return (
                          <button
                            key={h}
                            type="button"
                            onClick={() => {
                              setStepError(null);
                              setConfig((prev) => ({
                                ...prev,
                                rodape: { ...prev.rodape, height: h },
                              }));
                            }}
                            className={`h-10 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                              active
                                ? 'bg-[#0057ff] text-white shadow-xs'
                                : 'text-slate-600 hover:bg-white'
                            }`}
                          >
                            {h.replace('cm', ' cm')}
                          </button>
                        );
                      }
                    )}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 block">
                    Produto
                  </label>
                  {rodapeCandidates.length > 0 ? (
                    <select
                      value={config.rodape.productId || rodapeCandidates[0].id}
                      onChange={(e) => {
                        setStepError(null);
                        setConfig((prev) => ({
                          ...prev,
                          rodape: { ...prev.rodape, productId: e.target.value },
                        }));
                      }}
                      className="w-full h-11 rounded-xl border border-slate-300 bg-white px-3 text-xs sm:text-sm font-semibold text-slate-800 outline-none focus:border-[#0057ff] cursor-pointer"
                    >
                      {rodapeCandidates.map((prod) => (
                        <option key={prod.id} value={prod.id}>
                          {prod.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-xs text-rose-600 font-semibold">
                      Nenhum rodapé de {config.rodape.height.replace('cm', ' cm')} cadastrado no catálogo.
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 block">
                    Incluir os insumos?
                  </label>
                  <div className="grid grid-cols-2 gap-2 bg-slate-50 p-1 rounded-xl border border-slate-200">
                    <button
                      type="button"
                      onClick={() =>
                        setConfig((prev) => ({
                          ...prev,
                          rodape: { ...prev.rodape, includeInsumos: true },
                        }))
                      }
                      className={`h-10 rounded-lg text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                        config.rodape.includeInsumos
                          ? 'bg-[#0057ff] text-white shadow-xs'
                          : 'text-slate-600 hover:bg-white'
                      }`}
                    >
                      Sim
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setConfig((prev) => ({
                          ...prev,
                          rodape: { ...prev.rodape, includeInsumos: false },
                        }))
                      }
                      className={`h-10 rounded-lg text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                        !config.rodape.includeInsumos
                          ? 'bg-slate-800 text-white shadow-xs'
                          : 'text-slate-600 hover:bg-white'
                      }`}
                    >
                      Não
                    </button>
                  </div>
                </div>

                {config.rodape.includeInsumos && (
                  <div className="space-y-2.5 pt-1">
                    <label className="flex items-center gap-2.5 p-3 rounded-xl border border-slate-200 bg-white cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={config.rodape.includeColar}
                        onChange={(e) =>
                          setConfig((prev) => ({
                            ...prev,
                            rodape: {
                              ...prev.rodape,
                              includeColar: e.target.checked,
                            },
                          }))
                        }
                        className="w-4 h-4 rounded border-slate-300 text-[#0057ff] focus:ring-[#0057ff] cursor-pointer"
                      />
                      <span className="text-xs sm:text-sm font-bold text-[#091122]">
                        Cola para colar
                      </span>
                    </label>

                    <div className="p-3 rounded-xl border border-slate-200 bg-white space-y-2.5">
                      <label className="flex items-center gap-2.5 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={config.rodape.includeCalafetar}
                          onChange={(e) =>
                            setConfig((prev) => ({
                              ...prev,
                              rodape: {
                                ...prev.rodape,
                                includeCalafetar: e.target.checked,
                              },
                            }))
                          }
                          className="w-4 h-4 rounded border-slate-300 text-[#0057ff] focus:ring-[#0057ff] cursor-pointer"
                        />
                        <span className="text-xs sm:text-sm font-bold text-[#091122]">
                          Cola para calafetar
                        </span>
                      </label>

                      {config.rodape.includeCalafetar && (
                        <div className="pl-6">
                          {rodapeColaOptions.calafetarOptions.length > 0 ? (
                            <select
                              value={
                                config.rodape.calafetarProductId ||
                                rodapeColaOptions.calafetarOptions[0].productId
                              }
                              onChange={(e) =>
                                setConfig((prev) => ({
                                  ...prev,
                                  rodape: {
                                    ...prev.rodape,
                                    calafetarProductId: e.target.value,
                                  },
                                }))
                              }
                              className="w-full h-10 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-800 outline-none focus:border-[#0057ff] cursor-pointer"
                            >
                              {rodapeColaOptions.calafetarOptions.map((opt) => (
                                <option key={opt.productId} value={opt.productId}>
                                  {opt.catalogName}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <p className="text-xs text-slate-500">
                              Nenhum produto cadastrado nesta categoria.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ===================================================== */}
            {/* ETAPA: RIPADO                                         */}
            {/* ===================================================== */}
            {activeCategory === 'ripado' && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 block">
                    Produto
                  </label>
                  {ripadoCandidates.length > 0 ? (
                    <select
                      value={config.ripado.productId || ripadoCandidates[0].id}
                      onChange={(e) => {
                        setStepError(null);
                        setConfig((prev) => ({
                          ...prev,
                          ripado: {
                            ...prev.ripado,
                            productId: e.target.value,
                            acabamentoProductId: '',
                          },
                        }));
                      }}
                      className="w-full h-11 rounded-xl border border-slate-300 bg-white px-3 text-xs sm:text-sm font-semibold text-slate-800 outline-none focus:border-[#0057ff] cursor-pointer"
                    >
                      {ripadoCandidates.map((prod) => (
                        <option key={prod.id} value={prod.id}>
                          {prod.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-xs text-rose-600 font-semibold">
                      Nenhum ripado cadastrado encontrado no catálogo.
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 block">
                    Incluir os insumos?
                  </label>
                  <div className="grid grid-cols-2 gap-2 bg-slate-50 p-1 rounded-xl border border-slate-200">
                    <button
                      type="button"
                      onClick={() =>
                        setConfig((prev) => ({
                          ...prev,
                          ripado: { ...prev.ripado, includeInsumos: true },
                        }))
                      }
                      className={`h-10 rounded-lg text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                        config.ripado.includeInsumos
                          ? 'bg-[#0057ff] text-white shadow-xs'
                          : 'text-slate-600 hover:bg-white'
                      }`}
                    >
                      Sim
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setConfig((prev) => ({
                          ...prev,
                          ripado: { ...prev.ripado, includeInsumos: false },
                        }))
                      }
                      className={`h-10 rounded-lg text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                        !config.ripado.includeInsumos
                          ? 'bg-slate-800 text-white shadow-xs'
                          : 'text-slate-600 hover:bg-white'
                      }`}
                    >
                      Não
                    </button>
                  </div>
                  {config.ripado.includeInsumos && ripadoColaProducts.length === 0 && (
                    <p className="text-xs text-amber-700 font-medium">
                      Cola específica para Ripado não encontrada no catálogo.
                    </p>
                  )}
                </div>

                <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-3">
                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={config.ripado.includeAcabamento}
                      onChange={(e) => {
                        setStepError(null);
                        setConfig((prev) => ({
                          ...prev,
                          ripado: {
                            ...prev.ripado,
                            includeAcabamento: e.target.checked,
                          },
                        }));
                      }}
                      className="w-4 h-4 rounded border-slate-300 text-[#0057ff] focus:ring-[#0057ff] cursor-pointer"
                    />
                    <span className="text-xs sm:text-sm font-bold text-[#091122]">
                      Incluir Barra de Acabamento
                    </span>
                  </label>

                  {config.ripado.includeAcabamento && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pl-6">
                      <div className="sm:col-span-2 space-y-1">
                        <label className="text-[11px] font-bold text-slate-600 block">
                          Barra de Acabamento
                        </label>
                        {ripadoAcabamentos.length > 0 ? (
                          <select
                            value={
                              config.ripado.acabamentoProductId ||
                              ripadoAcabamentos[0].id
                            }
                            onChange={(e) => {
                              setStepError(null);
                              setConfig((prev) => ({
                                ...prev,
                                ripado: {
                                  ...prev.ripado,
                                  acabamentoProductId: e.target.value,
                                },
                              }));
                            }}
                            className="w-full h-10 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-800 outline-none focus:border-[#0057ff] cursor-pointer"
                          >
                            {ripadoAcabamentos.map((prod) => (
                              <option key={prod.id} value={prod.id}>
                                {prod.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <p className="text-xs text-rose-600 font-semibold">
                            Nenhuma barra de acabamento encontrada para esta linha.
                          </p>
                        )}
                      </div>

                      <div className="space-y-1">
                        <label className="text-[11px] font-bold text-slate-600 block">
                          Quantidade
                        </label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={config.ripado.acabamentoQty}
                          onChange={(e) => {
                            setStepError(null);
                            setConfig((prev) => ({
                              ...prev,
                              ripado: {
                                ...prev.ripado,
                                acabamentoQty: e.target.value,
                              },
                            }));
                          }}
                          placeholder="Ex: 2"
                          className="w-full h-10 rounded-lg border border-slate-300 bg-white px-3 text-xs sm:text-sm font-bold text-slate-900 outline-none focus:border-[#0057ff]"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ===================================================== */}
            {/* ETAPA: TETO VINÍLICO                                  */}
            {/* ===================================================== */}
            {activeCategory === 'teto' && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 block">
                    Produto
                  </label>
                  {tetoCandidates.length > 0 ? (
                    <select
                      value={config.teto.productId || tetoCandidates[0].id}
                      onChange={(e) => {
                        setStepError(null);
                        setConfig((prev) => ({
                          ...prev,
                          teto: { ...prev.teto, productId: e.target.value },
                        }));
                      }}
                      className="w-full h-11 rounded-xl border border-slate-300 bg-white px-3 text-xs sm:text-sm font-semibold text-slate-800 outline-none focus:border-[#0057ff] cursor-pointer"
                    >
                      {tetoCandidates.map((prod) => (
                        <option key={prod.id} value={prod.id}>
                          {prod.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-xs text-rose-600 font-semibold">
                      Nenhum teto vinílico cadastrado encontrado no catálogo.
                    </p>
                  )}
                </div>

                <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-3">
                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={config.teto.includeAcabamento}
                      onChange={(e) => {
                        setStepError(null);
                        setConfig((prev) => ({
                          ...prev,
                          teto: {
                            ...prev.teto,
                            includeAcabamento: e.target.checked,
                          },
                        }));
                      }}
                      className="w-4 h-4 rounded border-slate-300 text-[#0057ff] focus:ring-[#0057ff] cursor-pointer"
                    />
                    <span className="text-xs sm:text-sm font-bold text-[#091122]">
                      Incluir acabamento
                    </span>
                  </label>

                  {config.teto.includeAcabamento && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pl-6">
                      <div className="sm:col-span-2 space-y-1">
                        <label className="text-[11px] font-bold text-slate-600 block">
                          Acabamento
                        </label>
                        {tetoAcabamentos.length > 0 ? (
                          <select
                            value={
                              config.teto.acabamentoProductId ||
                              tetoAcabamentos[0].id
                            }
                            onChange={(e) => {
                              setStepError(null);
                              setConfig((prev) => ({
                                ...prev,
                                teto: {
                                  ...prev.teto,
                                  acabamentoProductId: e.target.value,
                                },
                              }));
                            }}
                            className="w-full h-10 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-800 outline-none focus:border-[#0057ff] cursor-pointer"
                          >
                            {tetoAcabamentos.map((prod) => (
                              <option key={prod.id} value={prod.id}>
                                {prod.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <p className="text-xs text-rose-600 font-semibold">
                            Nenhum acabamento de teto cadastrado no catálogo.
                          </p>
                        )}
                      </div>

                      <div className="space-y-1">
                        <label className="text-[11px] font-bold text-slate-600 block">
                          Quantidade
                        </label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={config.teto.acabamentoQty}
                          onChange={(e) => {
                            setStepError(null);
                            setConfig((prev) => ({
                              ...prev,
                              teto: {
                                ...prev.teto,
                                acabamentoQty: e.target.value,
                              },
                            }));
                          }}
                          placeholder="Ex: 4"
                          className="w-full h-10 rounded-lg border border-slate-300 bg-white px-3 text-xs sm:text-sm font-bold text-slate-900 outline-none focus:border-[#0057ff]"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ===================================================== */}
            {/* ETAPA: MANTA HOSPITALAR                               */}
            {/* ===================================================== */}
            {activeCategory === 'manta' && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 block">
                    Produto
                  </label>
                  {mantaCandidates.length > 0 ? (
                    <select
                      value={config.manta.productId || mantaCandidates[0].id}
                      onChange={(e) => {
                        setStepError(null);
                        setConfig((prev) => ({
                          ...prev,
                          manta: { ...prev.manta, productId: e.target.value },
                        }));
                      }}
                      className="w-full h-11 rounded-xl border border-slate-300 bg-white px-3 text-xs sm:text-sm font-semibold text-slate-800 outline-none focus:border-[#0057ff] cursor-pointer"
                    >
                      {mantaCandidates.map((prod) => (
                        <option key={prod.id} value={prod.id}>
                          {prod.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-xs text-rose-600 font-semibold">
                      Nenhuma manta hospitalar cadastrada no catálogo.
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 block">
                    Incluir os insumos?
                  </label>
                  <div className="grid grid-cols-2 gap-2 bg-slate-50 p-1 rounded-xl border border-slate-200">
                    <button
                      type="button"
                      onClick={() =>
                        setConfig((prev) => ({
                          ...prev,
                          manta: { ...prev.manta, includeInsumos: true },
                        }))
                      }
                      className={`h-10 rounded-lg text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                        config.manta.includeInsumos
                          ? 'bg-[#0057ff] text-white shadow-xs'
                          : 'text-slate-600 hover:bg-white'
                      }`}
                    >
                      Sim
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setConfig((prev) => ({
                          ...prev,
                          manta: { ...prev.manta, includeInsumos: false },
                        }))
                      }
                      className={`h-10 rounded-lg text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                        !config.manta.includeInsumos
                          ? 'bg-slate-800 text-white shadow-xs'
                          : 'text-slate-600 hover:bg-white'
                      }`}
                    >
                      Não
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 block">
                    Incluir acabamentos?
                  </label>
                  <div className="grid grid-cols-2 gap-2 bg-slate-50 p-1 rounded-xl border border-slate-200">
                    <button
                      type="button"
                      onClick={() => {
                        setStepError(null);
                        setConfig((prev) => ({
                          ...prev,
                          manta: { ...prev.manta, includeAcabamentos: true },
                        }));
                      }}
                      className={`h-10 rounded-lg text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                        config.manta.includeAcabamentos
                          ? 'bg-[#0057ff] text-white shadow-xs'
                          : 'text-slate-600 hover:bg-white'
                      }`}
                    >
                      Sim
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setStepError(null);
                        setConfig((prev) => ({
                          ...prev,
                          manta: { ...prev.manta, includeAcabamentos: false },
                        }));
                      }}
                      className={`h-10 rounded-lg text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                        !config.manta.includeAcabamentos
                          ? 'bg-slate-800 text-white shadow-xs'
                          : 'text-slate-600 hover:bg-white'
                      }`}
                    >
                      Não
                    </button>
                  </div>
                </div>

                {config.manta.includeAcabamentos && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 rounded-xl border border-slate-200 bg-white">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700 block">
                        Metragem linear (ml)
                      </label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={config.manta.acabamentoMl}
                        onChange={(e) => {
                          setStepError(null);
                          setConfig((prev) => ({
                            ...prev,
                            manta: {
                              ...prev.manta,
                              acabamentoMl: e.target.value,
                            },
                          }));
                        }}
                        placeholder="Ex: 45"
                        className="w-full h-10 rounded-lg border border-slate-300 bg-white px-3 text-xs sm:text-sm font-bold text-slate-900 outline-none focus:border-[#0057ff]"
                      />
                    </div>

                    <div className="sm:col-span-2 space-y-1">
                      <label className="text-xs font-bold text-slate-700 block">
                        Suporte Canto Curvo
                      </label>
                      {mantaSuporteOptions.length > 0 ? (
                        <select
                          value={
                            config.manta.suporteProductId ||
                            mantaSuporteOptions[0].id
                          }
                          onChange={(e) => {
                            setStepError(null);
                            setConfig((prev) => ({
                              ...prev,
                              manta: {
                                ...prev.manta,
                                suporteProductId: e.target.value,
                              },
                            }));
                          }}
                          className="w-full h-10 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-800 outline-none focus:border-[#0057ff] cursor-pointer"
                        >
                          {mantaSuporteOptions.map((prod) => (
                            <option key={prod.id} value={prod.id}>
                              {prod.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <p className="text-xs text-rose-600 font-semibold">
                          Nenhuma opção de Suporte Canto Curvo cadastrada.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {stepError && (
              <p className="text-xs font-semibold text-rose-600">{stepError}</p>
            )}
          </div>
        </div>

        {/* Rodapé com Voltar, Cancelar e Próximo/Finalizar */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="h-10 px-4 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs sm:text-sm font-bold transition-colors cursor-pointer"
          >
            Cancelar
          </button>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={handleBack}
              disabled={currentStepIdx === 0}
              className="h-10 px-4 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed text-slate-700 text-xs sm:text-sm font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Voltar</span>
            </button>

            <button
              type="button"
              onClick={handleNextOrFinish}
              className="h-10 px-5 rounded-xl bg-[#0057ff] hover:bg-[#0048db] text-white text-xs sm:text-sm font-bold shadow-md shadow-blue-500/20 flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <span>{isLastStep ? 'Finalizar' : 'Próximo'}</span>
              {!isLastStep && <ChevronRight className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
