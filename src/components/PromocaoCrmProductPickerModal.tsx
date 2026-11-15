import React, { useMemo, useState, useEffect } from 'react';
import { Package, Plus, Search, X, Check, Layers } from 'lucide-react';
import {
  CatalogProduct,
  filterCatalogProducts,
  getOfficialCategories,
  searchProductsInSupabase,
} from '../data/productCatalog';
import {
  PromoCategory,
  PromoModality,
  PROMO_MODALITIES,
  detectPromoCategoryFromCrmProduct,
  extractSqmPerBoxFromProductName,
  formatCurrencyBRL,
  getCrmPriceForModality,
  loadCrmProductsForPromocoes,
} from '../utils/promocoesService';

interface PromocaoCrmProductPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  modality: PromoModality;
  defaultCategory: PromoCategory;
  onSelectCrmProduct: (data: {
    crmProduct: CatalogProduct;
    detectedCategory: PromoCategory;
    suggestedPrice: number;
    extractedSqmPerBox: number;
  }) => void;
}

export const PromocaoCrmProductPickerModal: React.FC<PromocaoCrmProductPickerModalProps> = ({
  isOpen,
  onClose,
  modality,
  defaultCategory,
  onSelectCrmProduct,
}) => {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCrmCategory, setSelectedCrmCategory] = useState<string>('all');

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setIsLoading(true);
    loadCrmProductsForPromocoes()
      .then((list) => {
        if (active) setProducts(list);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isOpen]);

  const [supabaseFiltered, setSupabaseFiltered] = useState<CatalogProduct[] | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    const timer = setTimeout(() => {
      searchProductsInSupabase(searchTerm, {
        categoryIdOrName: selectedCrmCategory,
      })
        .then((res) => {
          if (active) setSupabaseFiltered(res);
        })
        .catch(() => {});
    }, 120);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [isOpen, searchTerm, selectedCrmCategory]);

  const categories = useMemo(() => getOfficialCategories(), [isOpen, products.length]);
  const modalityMeta = PROMO_MODALITIES.find((m) => m.id === modality) || PROMO_MODALITIES[0];

  const filteredProducts = useMemo(() => {
    if (supabaseFiltered !== null) {
      return filterCatalogProducts(supabaseFiltered, searchTerm, {
        categoryIdOrName: selectedCrmCategory,
      });
    }
    return filterCatalogProducts(products, searchTerm, {
      categoryIdOrName: selectedCrmCategory,
    });
  }, [supabaseFiltered, products, searchTerm, selectedCrmCategory]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/70 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-[#0052cc] text-white flex items-center justify-center flex-shrink-0">
              <Package className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base sm:text-lg font-extrabold text-[#0B2046] truncate">
                Selecionar Produto Cadastrado no CRM
              </h3>
              <p className="text-xs text-slate-500">
                Modalidade ativa: <strong className="text-[#0052cc]">{modalityMeta.label}</strong> · O
                preço sugerido respeita a tabela oficial sem alterar o cadastro geral.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center cursor-pointer flex-shrink-0"
            aria-label="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 sm:p-5 border-b border-slate-100 bg-white grid grid-cols-1 sm:grid-cols-12 gap-3">
          <div className="sm:col-span-7 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar produto pelo nome..."
              autoFocus
              className="w-full h-10 pl-10 pr-8 rounded-xl border border-slate-200 text-sm text-slate-800 outline-none focus:border-[#0052cc]"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="sm:col-span-5 relative">
            <Layers className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <select
              value={selectedCrmCategory}
              onChange={(e) => setSelectedCrmCategory(e.target.value)}
              className="w-full h-10 pl-9 pr-3 rounded-xl border border-slate-200 text-xs sm:text-sm font-semibold text-slate-700 bg-white outline-none focus:border-[#0052cc] cursor-pointer"
            >
              <option value="all">Todas as Categorias ({products.length})</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-2">
          {isLoading ? (
            <div className="py-12 text-center text-sm text-slate-500">
              Carregando produtos cadastrados no CRM...
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="py-12 text-center rounded-2xl border border-dashed border-slate-200 text-sm text-slate-500">
              Nenhum produto encontrado com os filtros aplicados.
            </div>
          ) : (
            filteredProducts.map((prod) => {
              const suggestedPrice = getCrmPriceForModality(prod, modality);
              const detectedCategory =
                detectPromoCategoryFromCrmProduct(prod.category, prod.name) || defaultCategory;
              const extractedSqm = extractSqmPerBoxFromProductName(prod.name);

              return (
                <div
                  key={prod.id}
                  className="p-3.5 rounded-2xl border border-slate-200 hover:border-blue-300 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-500">
                      <span className="text-[#0B2046] uppercase">{prod.category}</span>
                      <span aria-hidden="true">·</span>
                      <span>Unidade: {prod.unit}</span>
                      {extractedSqm > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{extractedSqm.toLocaleString('pt-BR')} m²/cx</span>
                        </>
                      )}
                    </div>
                    <p className="text-sm font-bold text-[#0B2046] leading-snug">{prod.name}</p>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-4 border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-100">
                    <div className="text-left sm:text-right tabular-nums">
                      <div className="text-[11px] text-slate-400">Tabela {modalityMeta.shortLabel}</div>
                      <div className="text-sm font-extrabold text-[#0052cc]">
                        {formatCurrencyBRL(suggestedPrice)}
                        <span className="text-xs font-normal text-slate-500"> / {prod.unit}</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        onSelectCrmProduct({
                          crmProduct: prod,
                          detectedCategory,
                          suggestedPrice,
                          extractedSqmPerBox: extractedSqm,
                        });
                      }}
                      className="px-3.5 py-2 rounded-xl bg-[#0052cc] hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Usar na Campanha</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="px-6 py-3.5 border-t border-slate-100 bg-slate-50 flex items-center justify-between text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5 text-emerald-600" />
            Os valores podem ser ajustados na promoção sem modificar a aba Produtos.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 font-bold cursor-pointer"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
