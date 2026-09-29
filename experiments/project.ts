/** Mask taxonomy axes from composites for projection ablations (no new fixture version). */
export function maskAxes(
  symbols: string[],
  axes: string[],
  decode: (composite: string) => (string | null)[],
  compact: (atoms: (string | null)[]) => string,
): string[] {
  const drop = new Set(axes);
  return symbols.map((symbol) => {
    const atoms = decode(symbol).map((atom) => {
      if (!atom) return null;
      const axis = atom.split(":")[0];
      return axis && drop.has(axis) ? null : atom;
    });
    return compact(atoms);
  });
}
