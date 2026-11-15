import React, { useEffect } from 'react';
import { PisoInsumosPlan } from '../utils/pisoInsumosCalculator';

interface ModalIncluirInsumosPisoProps {
  isOpen: boolean;
  plan: PisoInsumosPlan | null;
  onCancel: () => void;
  onConfirmPisoOnly: () => void;
  onConfirmWithInsumos: () => void;
}

export const ModalIncluirInsumosPiso: React.FC<ModalIncluirInsumosPisoProps> = ({
  isOpen,
  plan,
  onCancel,
  onConfirmPisoOnly,
  onConfirmWithInsumos,
}) => {
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
            Piso Vinílico adicionado ({plan.realSqmDisplay} m²):
          </p>
        </div>

        <div className="px-6 py-4">
          <div className="rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-slate-600">
                  <th className="py-2.5 px-4 text-left">Insumo</th>
                  <th className="py-2.5 px-4 text-right">Quantidade</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {plan.insumos.map((item) => (
                  <tr key={item.kind} className="bg-white">
                    <td className="py-2.5 px-4 font-semibold text-slate-800">
                      {item.modalLabel}
                    </td>
                    <td className="py-2.5 px-4 text-right font-bold text-[#003865]">
                      {item.quantityDisplay}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="px-6 pb-6 pt-2 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onConfirmPisoOnly}
            className="h-10 px-4 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs sm:text-sm font-bold transition-colors cursor-pointer"
          >
            Não, apenas o piso
          </button>
          <button
            type="button"
            onClick={onConfirmWithInsumos}
            className="h-10 px-5 rounded-xl bg-[#0057ff] hover:bg-[#0048db] text-white text-xs sm:text-sm font-bold shadow-md shadow-blue-500/20 transition-all cursor-pointer"
          >
            Sim, incluir os insumos
          </button>
        </div>
      </div>
    </div>
  );
};
