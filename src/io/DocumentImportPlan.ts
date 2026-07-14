import type { Document } from '../data/Document';

/** Parsing/building is side-effect free; commit is a short synchronous Command body. */
export interface DocumentImportPlan<TResult = void> {
  commit(document: Document): TResult;
}
