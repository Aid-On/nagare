// Use global registry to preserve identity across bundles/chunks
export const OP_META = Symbol.for('nagare.op.meta');

export type OpMeta =
  | { kind: 'map' }
  | { kind: 'filter'; predicate: (v: any) => boolean }
  | { kind: 'scan'; scanFn: (a: any, v: any) => any; initial: any }
  | { kind: 'take'; n: number }
  | { kind: 'skip'; n: number };

export function getOpMeta(op: any): OpMeta | undefined {
  return (op && (op[OP_META] as OpMeta)) || (op && (op.__nagareOp as OpMeta)) || undefined;
}

export type FusedOp<T> = ((value: T) => T | Promise<T> | undefined) & {
  [OP_META]?: OpMeta;
  __nagareOp?: OpMeta;
};
