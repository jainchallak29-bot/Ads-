// Shared data types for the plot inventory app.
// Coordinates are "map coordinates": drawing units from the CAD file,
// shifted so the layout starts near (0,0) and with Y pointing DOWN
// (screen/SVG convention). Areas/lengths are converted with the project's
// drawing unit.

export type Pt = { x: number; y: number };

export type PlotStatus = 'available' | 'booked' | 'sold';

export const PLOT_STATUSES: PlotStatus[] = ['available', 'booked', 'sold'];

export type Role = 'admin' | 'sales';

export type DrawingUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft';
export type AreaUnit = 'sqft' | 'sqyd' | 'sqm';
export type LengthUnit = 'ft' | 'm';

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Plot {
  id: string;
  number: string;
  polygon: Pt[];
  status: PlotStatus;
  /** Manually entered area in square metres; overrides the area computed from the shape. */
  areaOverrideSqm?: number | null;
  facing?: string;
  isCorner?: boolean;
  /** Rate per project area unit (e.g. ₹ per sq.yd). */
  rate?: number | null;
  /** Total price. If empty, rate × area is shown. */
  price?: number | null;
  buyerName?: string;
  buyerPhone?: string;
  /** YYYY-MM-DD */
  bookingDate?: string;
  amountReceived?: number | null;
  notes?: string;
  updatedAt?: number;
  updatedBy?: string;
  updatedByName?: string;
}

/** Fields a Sales member may change (when the admin allows it). Must match firestore.rules. */
export const SALES_EDITABLE_FIELDS = [
  'status',
  'buyerName',
  'buyerPhone',
  'bookingDate',
  'notes',
  'updatedAt',
  'updatedBy',
  'updatedByName',
] as const;

export type PlotPatch = Partial<Omit<Plot, 'id'>>;

export interface BgText {
  t: string;
  x: number;
  y: number;
  h: number;
  /** rotation in degrees, clockwise in map coordinates */
  r: number;
}

/** Non-plot linework from the CAD file (roads, boundary, trees, ...) drawn behind the plots. */
export interface LayoutData {
  /** SVG path data strings ("M x y L x y ..."), possibly split in chunks. */
  paths: string[];
  texts: BgText[];
}

export interface Project {
  id: string;
  name: string;
  location?: string;
  ownerUid: string;
  drawingUnit: DrawingUnit;
  areaUnit: AreaUnit;
  lengthUnit: LengthUnit;
  currency: string;
  salesCanEdit: boolean;
  bounds: Bounds;
  /** Offset that was subtracted from the original CAD coordinates (for exporting back). */
  origin: { x: number; y: number };
  createdAt: number;
  updatedAt: number;
  layoutVersion: number;
}

export interface Member {
  uid: string;
  role: Role;
  name: string;
  code?: string;
  joinedAt: number;
}

export interface Activity {
  id: string;
  plotId: string;
  plotNumber: string;
  action: string;
  from?: string;
  to?: string;
  by: string;
  byName: string;
  at: number;
}

export interface NewProjectInput {
  name: string;
  location?: string;
  drawingUnit: DrawingUnit;
  areaUnit: AreaUnit;
  lengthUnit: LengthUnit;
  currency: string;
  salesCanEdit: boolean;
  bounds: Bounds;
  origin: { x: number; y: number };
}

export interface ProjectCodes {
  adminCode: string;
  salesCode: string;
}

/** What this device remembers about a project it has joined. */
export interface JoinedProject {
  id: string;
  name: string;
  role: Role;
  joinedAt: number;
}
