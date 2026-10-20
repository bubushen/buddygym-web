// «4.060», «12.480,5»: in italiano Intl non separa le migliaia sotto 10.000, il design sì.
export function thousands(value) {
  const [whole, decimals] = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1, useGrouping: false }).format(value).split(',');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${decimals ? `,${decimals}` : ''}`;
}
