import type { SellerType } from "../searches/index.js";
/** Allowlisted public vehicle evidence. No seller identity, contacts or payment data. */
export interface StandvirtualDetailEvidence {
  warranty: string | null;
  inspection: string | null;
  equipment: string[];
  importStatus: "imported" | "national" | null;
  sellerType: SellerType | null;
  postedDate: string | null;
}
