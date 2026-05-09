export interface ConvUnit {
  label: string;
  toBase: (v: number) => number;
  fromBase: (v: number) => number;
}

export interface ConvCategory {
  name: string;
  units: ConvUnit[];
}

function lin(factor: number): Pick<ConvUnit, 'toBase' | 'fromBase'> {
  return { toBase: v => v * factor, fromBase: v => v / factor };
}

export const CONV_CATEGORIES: ConvCategory[] = [
  {
    name: 'Area',
    units: [
      { label: 'mm²',  ...lin(1e-6) },
      { label: 'cm²',  ...lin(1e-4) },
      { label: 'm²',   ...lin(1) },
      { label: 'km²',  ...lin(1e6) },
      { label: 'in²',  ...lin(6.4516e-4) },
      { label: 'ft²',  ...lin(0.092903) },
      { label: 'yd²',  ...lin(0.836127) },
      { label: 'acre', ...lin(4046.86) },
      { label: 'ha',   ...lin(10000) },
    ],
  },
  {
    name: 'Data',
    units: [
      { label: 'bit', ...lin(0.125) },
      { label: 'B',   ...lin(1) },
      { label: 'KB',  ...lin(1024) },
      { label: 'MB',  ...lin(1048576) },
      { label: 'GB',  ...lin(1073741824) },
      { label: 'TB',  ...lin(1099511627776) },
      { label: 'PB',  ...lin(1125899906842624) },
    ],
  },
  {
    name: 'Energy',
    units: [
      { label: 'J',    ...lin(1) },
      { label: 'kJ',   ...lin(1000) },
      { label: 'cal',  ...lin(4.184) },
      { label: 'kcal', ...lin(4184) },
      { label: 'Wh',   ...lin(3600) },
      { label: 'kWh',  ...lin(3600000) },
      { label: 'BTU',  ...lin(1055.06) },
      { label: 'eV',   ...lin(1.60218e-19) },
    ],
  },
  {
    name: 'Force',
    units: [
      { label: 'N',   ...lin(1) },
      { label: 'kN',  ...lin(1000) },
      { label: 'lbf', ...lin(4.44822) },
      { label: 'kgf', ...lin(9.80665) },
      { label: 'dyn', ...lin(1e-5) },
    ],
  },
  {
    name: 'Length',
    units: [
      { label: 'mm',  ...lin(0.001) },
      { label: 'cm',  ...lin(0.01) },
      { label: 'm',   ...lin(1) },
      { label: 'km',  ...lin(1000) },
      { label: 'in',  ...lin(0.0254) },
      { label: 'ft',  ...lin(0.3048) },
      { label: 'yd',  ...lin(0.9144) },
      { label: 'mi',  ...lin(1609.344) },
      { label: 'nmi', ...lin(1852) },
    ],
  },
  {
    name: 'Power',
    units: [
      { label: 'W',     ...lin(1) },
      { label: 'kW',    ...lin(1000) },
      { label: 'MW',    ...lin(1e6) },
      { label: 'HP',    ...lin(745.7) },
      { label: 'BTU/h', ...lin(0.293071) },
    ],
  },
  {
    name: 'Pressure',
    units: [
      { label: 'Pa',   ...lin(1) },
      { label: 'kPa',  ...lin(1000) },
      { label: 'MPa',  ...lin(1e6) },
      { label: 'bar',  ...lin(100000) },
      { label: 'atm',  ...lin(101325) },
      { label: 'psi',  ...lin(6894.76) },
      { label: 'mmHg', ...lin(133.322) },
    ],
  },
  {
    name: 'Speed',
    units: [
      { label: 'm/s',  ...lin(1) },
      { label: 'km/h', ...lin(1 / 3.6) },
      { label: 'mph',  ...lin(0.44704) },
      { label: 'knot', ...lin(0.514444) },
      { label: 'ft/s', ...lin(0.3048) },
    ],
  },
  {
    name: 'Temp',
    units: [
      { label: '°C', toBase: v => v,              fromBase: v => v },
      { label: '°F', toBase: v => (v - 32) * 5/9, fromBase: v => v * 9/5 + 32 },
      { label: 'K',  toBase: v => v - 273.15,      fromBase: v => v + 273.15 },
      { label: '°R', toBase: v => (v - 491.67) * 5/9, fromBase: v => (v + 273.15) * 9/5 },
    ],
  },
  {
    name: 'Time',
    units: [
      { label: 'ms',    ...lin(0.001) },
      { label: 's',     ...lin(1) },
      { label: 'min',   ...lin(60) },
      { label: 'h',     ...lin(3600) },
      { label: 'day',   ...lin(86400) },
      { label: 'week',  ...lin(604800) },
      { label: 'month', ...lin(2629746) },
      { label: 'year',  ...lin(31556952) },
    ],
  },
  {
    name: 'Volume',
    units: [
      { label: 'ml',      ...lin(0.001) },
      { label: 'L',       ...lin(1) },
      { label: 'm³',      ...lin(1000) },
      { label: 'tsp',     ...lin(0.00492892) },
      { label: 'tbsp',    ...lin(0.0147868) },
      { label: 'fl oz',   ...lin(0.0295735) },
      { label: 'cup',     ...lin(0.236588) },
      { label: 'pt',      ...lin(0.473176) },
      { label: 'qt',      ...lin(0.946353) },
      { label: 'gal',     ...lin(3.78541) },
      { label: 'imp gal', ...lin(4.54609) },
    ],
  },
  {
    name: 'Weight',
    units: [
      { label: 'mg',    ...lin(1e-6) },
      { label: 'g',     ...lin(0.001) },
      { label: 'kg',    ...lin(1) },
      { label: 'tonne', ...lin(1000) },
      { label: 'oz',    ...lin(0.0283495) },
      { label: 'lb',    ...lin(0.453592) },
      { label: 'stone', ...lin(6.35029) },
    ],
  },
];
