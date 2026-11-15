// Shared data types for the plot inventory app.
// Coordinates are "map coordinates": drawing units from the CAD file,
// shifted so the layout starts near (0,0) and with Y pointing DOWN
// (screen/SVG convention). Areas/lengths are converted with the project's
// drawing unit.

export type Pt = { x: number; y: number };

/**
 * Sale stages. 'sold' is the final stage (shown as "Sold" by default; an admin
 * can rename it, e.g. "Registered"). 'blocked' = not for sale.
 */
export type PlotStatus = 'available' | 'token' | 'booked' | 'agreement' | 'sold' | 'blocked';

export const ALL_STATUSES: PlotStatus[] = ['available', 'token', 'booked', 'agreement', 'sold', 'blocked'];
export const DEFAULT_STATUSES: PlotStatus[] = ['available', 'booked', 'sold'];

export interface StatusConfig {
  enabled: PlotStatus[];
  labels: Partial<Record<PlotStatus, string>>;
}

/** Optional features; each one can be switched off per project ("skippable"). */
export interface Features {
  /** Sales status changes become requests that an admin approves */
  approval: boolean;
  /** Base rate, block rates and premiums (corner, park facing, ...) */
  pricing: boolean;
  /** Instalments, payments and receipts (admins only) */
  payments: boolean;
  /** Brokers and commission (admins only) */
  commission: boolean;
  /** Enquiries, site visits, follow-ups */
  leads: boolean;
  /** Public customer link with QR code */
  share: boolean;
  /** Group plots into blocks / phases */
  blocks: boolean;
  /** Push notifications for bookings and approvals */
  notifications: boolean;
  /** Photos and documents on plots (needs Firebase Storage) */
  files: boolean;
  /** "You are here" on site and directions to plots */
  gps: boolean;
}

export const DEFAULT_FEATURES: Features = {
  approval: false,
  pricing: true,
  payments: true,
  commission: true,
  leads: true,
  share: true,
  blocks: true,
  notifications: true,
  files: true,
  gps: true,
};

export type PremiumKind = 'pct' | 'perUnit' | 'fixed';

export interface Premium {
  id: string;
  name: string;
  /** pct: % of the base price; perUnit: added to the rate per area unit; fixed: lump sum */
  kind: PremiumKind;
  value: number;
}

export interface Pricing {
  /** default rate per project area unit */
  baseRate: number | null;
  /** rate per block, overrides the base rate */
  blockRates: Record<string, number>;
  premiums: Premium[];
}

export interface PendingChange {
  status: PlotStatus;
  by: string;
  byName: string;
  at: number;
  note?: string;
}

export type CommissionKind = 'pct' | 'perUnit' | 'fixed';

export interface Commission {
  /** pct: % of plot price; perUnit: per area unit; fixed: lump sum */
  kind: CommissionKind;
  value: number;
}

export interface Broker {
  id: string;
  name: string;
  phone?: string;
  firm?: string;
  commission: Commission;
}

export interface Instalment {
  id: string;
  label: string;
  /** YYYY-MM-DD */
  due: string;
  amount: number;
}

export type PaymentMode = 'cash' | 'upi' | 'cheque' | 'bank' | 'other';

export interface Payment {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  amount: number;
  mode: PaymentMode;
  ref?: string;
  note?: string;
  receiptNo?: number | null;
}

export interface CommissionPayment {
  id: string;
  date: string;
  amount: number;
  note?: string;
}

/** Money details of one plot. Admins only (kept apart from the plot so Sales can't read it). */
export interface PlotAccount {
  plotId: string;
  /** Final negotiated price; empty = price list price */
  agreedPrice?: number | null;
  schedule: Instalment[];
  payments: Payment[];
  brokerId?: string | null;
  /** overrides the broker's default commission for this plot */
  commission?: Commission | null;
  commissionPayments: CommissionPayment[];
  updatedAt?: number;
  updatedByName?: string;
}

export interface Company {
  name: string;
  address?: string;
  phone?: string;
  email?: string;
  gstin?: string;
  /** small logo as a data: URI (PNG/JPEG) */
  logo?: string;
}

export type LeadStage = 'new' | 'contacted' | 'visit' | 'negotiation' | 'won' | 'lost';
export type LeadSource = 'walkin' | 'call' | 'broker' | 'online' | 'reference' | 'other';

export interface SiteVisit {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  note?: string;
  byName: string;
}

/** An enquiry from a possible buyer. */
export interface Lead {
  id: string;
  name: string;
  phone: string;
  budget?: number | null;
  source: LeadSource;
  /** plot numbers the person liked */
  interested: string[];
  stage: LeadStage;
  /** YYYY-MM-DD */
  nextFollowUp?: string;
  visits: SiteVisit[];
  notes?: string;
  assignedName?: string;
  wonPlotId?: string;
  createdBy: string;
  createdByName: string;
  createdAt: number;
  updatedAt: number;
}

/** A photo or document attached to a plot. */
export interface PlotFile {
  id: string;
  plotId: string;
  name: string;
  contentType: string;
  size: number;
  kind: 'photo' | 'doc';
  /** admins only (e.g. buyer ID, agreement) */
  private: boolean;
  uploadedBy: string;
  uploadedByName: string;
  at: number;
  /** device-only mode: where the file is kept on this phone */
  localUri?: string;
}

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
  /** Total price. If empty, it is calculated from the rate / price list. */
  price?: number | null;
  /** Block or phase, e.g. "A" or "Phase 2" */
  block?: string;
  /** ids of premiums from the project price list that apply to this plot */
  premiums?: string[];
  buyerName?: string;
  buyerPhone?: string;
  /** YYYY-MM-DD */
  bookingDate?: string;
  amountReceived?: number | null;
  notes?: string;
  updatedAt?: number;
  updatedBy?: string;
  updatedByName?: string;
  /** who made the sale (set when a plot first leaves Available) */
  soldBy?: string;
  /** a status change requested by Sales, waiting for an admin (approval feature) */
  pending?: PendingChange | null;
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
  'pending',
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
  statuses?: StatusConfig;
  features?: Partial<Features>;
  pricing?: Pricing;
  company?: Company;
  /** customer share link */
  share?: { enabled: boolean; token: string; showPrices: boolean };
  /** two reference points tying the drawing to GPS (GPS feature) */
  geo?: { points: [{ x: number; y: number; lat: number; lng: number }, { x: number; y: number; lat: number; lng: number }] } | null;
}

export interface Member {
  uid: string;
  role: Role;
  name: string;
  code?: string;
  joinedAt: number;
  /** Expo push token of this member's phone (notifications feature) */
  pushToken?: string;
  /** receive booking notifications (default on) */
  notify?: boolean;
}

export interface Activity {
  id: string;
  plotId: string;
  plotNumber: string;
  action: string;
  from?: string;
  to?: string;
  note?: string;
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
