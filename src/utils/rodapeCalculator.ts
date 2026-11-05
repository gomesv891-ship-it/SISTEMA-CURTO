/**
 * Utilitário de cálculo automático para produtos da categoria Rodapés no CRM Fênix World
 *
 * Regra:
 * Ao selecionar o produto e informar a quantidade em metros lineares,
 * o sistema identifica o comprimento de cada barra (ex: 2,40m, 2,00m, 2,16m, 1,80m etc.)
 * e calcula automaticamente quantas barras serão necessárias, sempre arredondando para cima.
 *
 * Exemplo: 20 metros desejados ÷ 2,40m por barra = 9 barras (metragem total = 21,60m).
 */

/**
 * Identifica se um produto pertence à categoria de Rodapés
 */
export function isRodapeProduct(
  productName?: string,
  categoryName?: string,
  categoryId?: string
): boolean {
  const pName = (productName || '').trim().toLowerCase();
  const cName = (categoryName || '').trim().toLowerCase();
  const cId = (categoryId || '').trim().toLowerCase();

  // Excluir colas, adesivos, massas, cantos e perfis que não são barras de rodapé
  if (
    pName.includes('cola') ||
    pName.includes('adesivo') ||
    pName.includes('massa') ||
    pName.includes('suporte canto') ||
    pName.includes('perfil de arremate') ||
    cName.includes('cola')
  ) {
    return false;
  }

  // IDs conhecidos da categoria de rodapé
  if (
    cId === '54ff2da7-1c77-458d-834e-77acaf3063f8' || // RODAPÉS POLIESTIRENO
    cId === '5359db09-6718-4c3d-908f-59317607d223' || // RODAPÉS MDF
    cId.includes('rodape') ||
    cId.includes('rodapes')
  ) {
    return true;
  }

  // Verifica categoria
  if (
    cName.includes('rodapé') ||
    cName.includes('rodape') ||
    cName.includes('rodapés') ||
    cName.includes('rodapes')
  ) {
    return true;
  }

  // Verifica nome do produto
  if (
    pName.includes('rodapé') ||
    pName.includes('rodape') ||
    pName.includes('rodapés') ||
    pName.includes('rodapes')
  ) {
    return true;
  }

  return false;
}

/**
 * Extrai automaticamente o comprimento da barra a partir do nome ou descrição do produto.
 * Exemplos:
 * - "Rodapé POLIESTIRENO Premium BRANCO 07cm (2,40m) SLIM" -> 2.40
 * - "Barras de Rodapé POLIESTIRENO Premium BRANCO 10cm (2,00m)" -> 2.00
 * - "Rodapé MDF Madebene BRANCO 15cm (2,16m)" -> 2.16
 * - "Rodapé MDF Moldufama BRANCO 07cm (1,80m)" -> 1.80
 * Se não encontrar nenhuma especificação, retorna defaultLength (2.40m padrão de mercado)
 */
export function extractBarLengthFromProductName(
  productName?: string,
  defaultLength: number = 2.4
): number {
  if (!productName) return defaultLength;

  const str = productName.trim();

  // 1. Procura padrão explícito como (2,40m), (2.40m), (2,16m), (2,00m), (1,80m)
  const matchParentheses = str.match(/\(\s*(\d+[.,]\d+)\s*m\s*\)/i);
  if (matchParentheses && matchParentheses[1]) {
    const val = parseFloat(matchParentheses[1].replace(',', '.'));
    if (!isNaN(val) && val > 0 && val < 10) {
      return val;
    }
  }

  // 2. Procura padrão com 'm' ou 'metros' ex: 2,40m, 2.40 m, 2,16m, 2m
  const matchGeneric = str.match(/(\d+[.,]?\d*)\s*m(?:etros?)?/i);
  if (matchGeneric && matchGeneric[1]) {
    const val = parseFloat(matchGeneric[1].replace(',', '.'));
    // Barras de rodapé normalmente variam entre 1.50m e 3.50m
    if (!isNaN(val) && val >= 1.0 && val <= 4.0) {
      return val;
    }
  }

  return defaultLength;
}

export interface RodapeCalculationResult {
  metrosDesejados: number;
  comprimentoBarra: number;
  barrasNecessarias: number;
  metragemTotalFornecida: number;
  sobraMetros: number;
  valorTotal: number;
  textoResumo: string;
}

/**
 * Realiza o cálculo automático de barras de rodapé
 *
 * @param metrosLineares Quantidade em metros lineares desejada pelo cliente (ex: 20m)
 * @param comprimentoBarra Comprimento da barra em metros (ex: 2.40m)
 * @param precoUnitario Preço por barra (ex: 24.90)
 */
export function calculateRodapeBarras(
  metrosLineares: number,
  comprimentoBarra: number = 2.4,
  precoUnitario: number = 0
): RodapeCalculationResult {
  const ml = Math.max(0, Number(metrosLineares) || 0);
  const barLen = Math.max(0.1, Number(comprimentoBarra) || 2.4);
  const unitPrice = Math.max(0, Number(precoUnitario) || 0);

  // Arredonda SEMPRE para cima
  const barras = ml > 0 ? Math.ceil(ml / barLen) : 0;
  const metragemTotal = Math.round(barras * barLen * 100) / 100;
  const sobra = Math.max(0, Math.round((metragemTotal - ml) * 100) / 100);
  const valorTotal = Math.round(barras * unitPrice * 100) / 100;

  const barLenFormatted = barLen.toFixed(2).replace('.', ',');
  const mlFormatted = ml.toFixed(2).replace('.', ',');
  const totalMlFormatted = metragemTotal.toFixed(2).replace('.', ',');

  const textoResumo = ml > 0
    ? `${barras} ${barras === 1 ? 'barra' : 'barras'} de ${barLenFormatted}m (${totalMlFormatted}m para ${mlFormatted}m lineares)`
    : '';

  return {
    metrosDesejados: ml,
    comprimentoBarra: barLen,
    barrasNecessarias: barras,
    metragemTotalFornecida: metragemTotal,
    sobraMetros: sobra,
    valorTotal,
    textoResumo,
  };
}

/**
 * Tenta extrair metros lineares e comprimento de barra de um subtítulo previamente gerado
 */
export function parseRodapeDetails(subtitle?: string): { metrosDesejados?: number; comprimentoBarra?: number } | null {
  if (!subtitle) return null;
  const matchMeters = subtitle.match(/para\s+([0-9.,]+)\s*m/i) || subtitle.match(/([0-9.,]+)\s*m\s*lineares/i);
  const matchBar = subtitle.match(/de\s+([0-9.,]+)\s*m/i);

  const metrosDesejados = matchMeters ? parseFloat(matchMeters[1].replace(',', '.')) : undefined;
  const comprimentoBarra = matchBar ? parseFloat(matchBar[1].replace(',', '.')) : undefined;

  if (metrosDesejados || comprimentoBarra) {
    return { metrosDesejados, comprimentoBarra };
  }
  return null;
}

/**
 * Converte valor digitado no campo Quantidade (metros lineares) em barras necessárias,
 * arredondando sempre para cima.
 * Exemplo: 20 metros informados com barra de 2,40m -> 9 barras
 */
export function convertMetrosToBarras(
  inputVal: string | number,
  productName?: string,
  customBarLen?: number
): { barras: number; barLen: number; metros: number } | null {
  if (inputVal === '' || inputVal === null || inputVal === undefined) return null;
  const rawStr = String(inputVal).trim().replace(/\./g, '').replace(',', '.');
  const metros = parseFloat(rawStr);
  if (isNaN(metros) || metros <= 0) return null;

  const barLen = Math.max(
    0.1,
    customBarLen || extractBarLengthFromProductName(productName, 2.4)
  );

  const barras = Math.ceil(metros / barLen);
  return { barras, barLen, metros };
}
