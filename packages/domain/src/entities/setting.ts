/** A persisted, non-sensitive application preference. */
export interface Setting {
  key: string;
  value: string;
  createdAt: string;
  updatedAt: string;
}
