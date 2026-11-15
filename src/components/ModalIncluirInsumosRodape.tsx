import React, { useEffect, useState } from 'react';
import { RodapeInsumosPlan } from '../utils/rodapeCalculator';

export interface RodapeInsumosConfirmSelection {
  includeColar: boolean;
  includeCalafetar: boolean;
  selectedCalafetarId: string;
}

interface ModalIncluirInsumosRodapeProps {
  isOpen: boolean;
  plan: RodapeInsumosPlan | null;
  hidePrices?: boolean;
  onCancel: () => void;
  onConfirmRodapeOnly: () => void;
  onConfirmWithInsumos: (selection: RodapeInsumosConfirmSelection) => void;
}

const formatCurrencyBr = (value: number): string =>
  (Number.isFinite(value) ? value : 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });

export const ModalIncluirInsumosRodape: React.FC<ModalIncluirInsumosRodapeProps> = ({
  isOpen,
  plan,
  hidePrices = false,
  onCancel,
  onConfirmRodapeOnly,
  onConfirmWithInsumos,
}) => {
  const [includeColar, setIncludeColar] = useState(true);
  const [includeCalafetar, setIncludeCalafetar] = useState(true);
  const [selectedCalafetarId, setSelectedCalafetarId] = useState('');

  useEffect(() => {
    if (!isOpen || !plan) return;
    setIncludeColar(plan.colarItems.length > 0);
    setIncludeCalafetar(plan.calafetarOptions.length > 0);
    setSelectedCalafetarId(
      plan.selectedCalafetarId || plan.calafetarOptions[0]?.productId || ''
    );
  }, [isOpen, plan]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onCancel]);

  if (!isOpen || !plan) return null;

  const hasColarProducts = plan.colarItems.length > 0;
  const hasCalafetarProducts = plan.calafetarOptions.length > 0;
  const selectedCalafetar =
    plan.calafetarOptions.find((o) => o.productId === selectedCalafetarId) ||
    plan.calafetarOptions[0];

  const canConfirmInsumos =
    (includeColar && hasColarProducts) ||
    (includeCalafetar && hasCalafetarProducts);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-2xl border border-slate-200/90 shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-6 pb-4 border-b border-slate-100">
          <h3 className="text-lg font-extrabold text-[#091122] tracking-tight">
            Deseja incluir os insumos?
          </h3>
          <p className="text-sm font-medium text-slate-600 mt-1">
            Rodapé adicionado ({plan.insumoMlDisplay || plan.effectiveMlDisplay} ml):
          </p>
        </div>

        <div className="px-6 py-4 space-y-3">
          {/* Checklist 1: Cola para colar (combinação automática com menor sobra, sem seletor de embalagem) */}
          <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2">
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeColar && hasColarProducts}
                disabled={!hasColarProducts}
                onChange={(e) => setIncludeColar(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-[#0057ff] focus:ring-[#0057ff] cursor-pointer"
              />
              <span className="text-sm font-bold text-[#091122]">
                Cola para colar
              </span>
            </label>

            {hasColarProducts ? (
              <div className="pl-6 space-y-2">
                <div className="rounded-lg bg-slate-50 border border-slate-200/70 px-3 py-2 text-xs text-slate-700 space-y-0.5">
                  <div>
                    <span className="text-slate-500">Necessário:</span>{' '}
                    <strong className="text-[#091122]">{plan.requiredKgColarDisplay}</strong>
                  </div>
                  {plan.colarQuantitySummary && (
                    <div>
                      <span className="text-slate-500">Quantidade:</span>{' '}
                      <strong className="text-[#003865]">{plan.colarQuantitySummary}</strong>
                    </div>
                  )}
                </div>

                <div className="space-y-1.5">
                  {plan.colarItems.map((item) => (
                    <div
                      key={item.productId}
                      className="flex items-start justify-between gap-2 text-xs sm:text-sm"
                    >
                      <div className="text-slate-700 leading-snug">
                        <span className="font-semibold block">
                          {item.catalogName}
                        </span>
                        {!hidePrices && (
                          <span className="text-[11px] text-slate-500">
                            {formatCurrencyBr(item.unitPrice)} / {item.unit}
                          </span>
                        )}
                      </div>
                      <span className="font-bold text-[#003865] whitespace-nowrap">
                        {item.quantityDisplay}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="pl-6 text-xs text-slate-500">
                Nenhum produto cadastrado nesta categoria.
              </p>
            )}
          </div>

          {/* Checklist 2: Cola para calafetar (bisnaga 400 g com seletor de produto cadastrado) */}
          <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeCalafetar && hasCalafetarProducts}
                  disabled={!hasCalafetarProducts}
                  onChange={(e) => setIncludeCalafetar(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-[#0057ff] focus:ring-[#0057ff] cursor-pointer"
                />
                <span className="text-sm font-bold text-[#091122]">
                  Cola para calafetar
                </span>
              </label>

              {hasCalafetarProducts && (
                <span className="text-xs sm:text-sm font-bold text-[#003865] whitespace-nowrap">
                  {plan.calafetarQuantityDisplay}
                </span>
              )}
            </div>

            {hasCalafetarProducts ? (
              <div className="pl-6 space-y-1">
                <select
                  value={selectedCalafetar?.productId || ''}
                  onChange={(e) => setSelectedCalafetarId(e.target.value)}
                  disabled={!includeCalafetar}
                  className="w-full h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-800 outline-none focus:border-[#0057ff] disabled:bg-slate-50 disabled:text-slate-400 cursor-pointer"
                >
                  {plan.calafetarOptions.map((opt) => (
                    <option key={opt.productId} value={opt.productId}>
                      {hidePrices
                        ? opt.catalogName
                        : `${opt.catalogName} — ${formatCurrencyBr(opt.unitPrice)}`}
                    </option>
                  ))}
                </select>
                {selectedCalafetar && !hidePrices && (
                  <p className="text-[11px] text-slate-500">
                    {formatCurrencyBr(selectedCalafetar.unitPrice)} / {selectedCalafetar.unit}
                  </p>
                )}
              </div>
            ) : (
              <p className="pl-6 text-xs text-slate-500">
                Nenhum produto cadastrado nesta categoria.
              </p>
            )}
          </div>
        </div>

        <div className="px-6 pb-6 pt-2 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onConfirmRodapeOnly}
            className="h-10 px-4 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs sm:text-sm font-bold transition-colors cursor-pointer"
          >
            Não, apenas o rodapé
          </button>
          <button
            type="button"
            disabled={!canConfirmInsumos}
            onClick={() =>
              onConfirmWithInsumos({
                includeColar: includeColar && hasColarProducts,
                includeCalafetar: includeCalafetar && hasCalafetarProducts,
                selectedCalafetarId: selectedCalafetar?.productId || '',
              })
            }
            className="h-10 px-5 rounded-xl bg-[#0057ff] hover:bg-[#0048db] disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-xs sm:text-sm font-bold shadow-md shadow-blue-500/20 transition-all cursor-pointer"
          >
            Sim, incluir os insumos
          </button>
        </div>
      </div>
    </div>
  );
};
