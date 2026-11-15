import type { PublicDoc } from '../publicLayout';
import type {
  Activity,
  Broker,
  PlotAccount,
  PlotStatus,
  Bounds,
  DrawingUnit,
  LayoutData,
  Member,
  NewProjectInput,
  Plot,
  PlotPatch,
  Project,
  ProjectCodes,
  Role,
} from '../types';

export type Unsub = () => void;
export type ErrCb = (e: Error) => void;

export interface Who {
  name: string;
}

export type ProjectPatch = Partial<
  Pick<Project, 'name' | 'location' | 'drawingUnit' | 'areaUnit' | 'lengthUnit' | 'currency' | 'salesCanEdit' | 'statuses' | 'features' | 'pricing' | 'company' | 'share'>
>;

export interface BulkItem {
  before: Plot;
  patch: PlotPatch;
}

export interface ShapeEdit {
  upserts: Plot[];
  deletes: string[];
  /** Human readable, e.g. "Merged 12 + 13" */
  note: string;
}

export interface LayoutReplace {
  bounds: Bounds;
  origin: { x: number; y: number };
  drawingUnit: DrawingUnit;
  layout: LayoutData;
  upserts: Plot[];
  deletes: string[];
}

/**
 * Storage + sync. Two implementations:
 *  - FirebaseBackend: real-time sync between all phones that joined a project.
 *  - LocalBackend:    this phone only (used until Firebase keys are configured).
 */
export interface Backend {
  readonly kind: 'firebase' | 'local';
  /** Signs in (anonymously) if needed; resolves with this device's user id. */
  ready(): Promise<string>;
  newId(): string;

  createProject(input: NewProjectInput, layout: LayoutData, plots: Plot[], who: Who): Promise<{ projectId: string; codes: ProjectCodes }>;
  joinProject(code: string, who: Who): Promise<{ projectId: string; role: Role; name: string }>;

  watchProject(pid: string, cb: (p: Project | null) => void, err?: ErrCb): Unsub;
  watchPlots(pid: string, cb: (plots: Plot[]) => void, err?: ErrCb): Unsub;
  watchLayout(pid: string, cb: (l: LayoutData) => void, err?: ErrCb): Unsub;
  watchMembership(pid: string, cb: (m: Member | null) => void, err?: ErrCb): Unsub;
  watchMembers(pid: string, cb: (ms: Member[]) => void, err?: ErrCb): Unsub;
  watchActivity(pid: string, plotId: string | null, cb: (a: Activity[]) => void, err?: ErrCb): Unsub;

  getCodes(pid: string): Promise<ProjectCodes>;
  updateProject(pid: string, patch: ProjectPatch): Promise<void>;
  updatePlot(pid: string, before: Plot, patch: PlotPatch, who: Who): Promise<void>;
  /** Same change for many plots at once (admin). */
  bulkUpdatePlots(pid: string, items: BulkItem[], who: Who): Promise<void>;
  applyShapeEdit(pid: string, edit: ShapeEdit, who: Who): Promise<void>;

  /** Approval feature: Sales ask for a status change; an Admin approves or rejects. */
  requestStatus(pid: string, plot: Plot, status: PlotStatus, who: Who): Promise<void>;
  cancelRequest(pid: string, plot: Plot, who: Who): Promise<void>;
  decideRequest(pid: string, plot: Plot, approve: boolean, who: Who): Promise<void>;

  /** Admin-only money data */
  watchAccounts(pid: string, cb: (a: Record<string, PlotAccount>) => void, err?: ErrCb): Unsub;
  saveAccount(pid: string, acc: PlotAccount, who: Who): Promise<void>;
  watchBrokers(pid: string, cb: (b: Broker[]) => void, err?: ErrCb): Unsub;
  saveBroker(pid: string, b: Broker): Promise<void>;
  deleteBroker(pid: string, id: string): Promise<void>;
  /** next receipt number for the project (1, 2, 3 …) */
  nextReceiptNo(pid: string): Promise<number>;

  /** Customer share link (public, read without signing in) */
  watchPublic(token: string, cb: (d: PublicDoc | null) => void, err?: ErrCb): Unsub;
  watchPublicLayout(token: string, cb: (l: LayoutData) => void, err?: ErrCb): Unsub;
  /** admin: write the public snapshot (and the background drawing when `layout` is given) */
  publishPublic(token: string, doc: Omit<PublicDoc, 'updatedAt'>, layout: LayoutData | null): Promise<void>;
  /** any member who may change statuses: keep Available / Not available up to date */
  updatePublicStatus(token: string, st: PublicDoc['st']): Promise<void>;
  unpublishPublic(token: string): Promise<void>;
  replaceLayout(pid: string, data: LayoutReplace, who: Who): Promise<void>;
  regenerateCode(pid: string, role: Role): Promise<ProjectCodes>;
  removeMember(pid: string, uid: string): Promise<void>;
  leaveProject(pid: string): Promise<void>;
  deleteProject(pid: string): Promise<void>;
}

export class UserError extends Error {}
