/** Resolves to whatever `p` rejected with; fails the test if `p` resolved. */
export async function rejectionOf(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    (v) => { throw new Error(`expected a rejection, got ${JSON.stringify(v)}`); },
    (e: unknown) => e,
  );
}
