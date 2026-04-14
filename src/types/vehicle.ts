export type VehicleStatus =
  | "activa"
  | "in_service"
  | "indisponibila"
  | "avariata";

export interface VehicleImageItem {
  id: string;
  url: string;
  path: string;
  fileName: string;
  createdAt: number;
  thumbUrl?: string;
  thumbPath?: string;
}

export interface VehicleItem {
  id: string;
  plateNumber: string;
  brand: string;
  model: string;
  year: string;
  vin: string;
  fuelType: string;

  status: VehicleStatus;
  currentKm: number;

  ownerUserId: string;
  ownerUserName: string;
  ownerThemeKey?: string | null;

  currentDriverUserId: string;
  currentDriverUserName: string;
  currentDriverThemeKey?: string | null;

  maintenanceNotes: string;
  nextServiceKm: number;
  nextItpDate: string;
  nextRcaDate: string;

  coverImageUrl: string;
  coverThumbUrl: string;
  images: VehicleImageItem[];

  createdAt: number;
  updatedAt: number;
}

export interface VehicleFormValues {
  plateNumber: string;
  brand: string;
  model: string;
  year: string;
  vin: string;
  fuelType: string;

  status: VehicleStatus;
  currentKm: number;

  ownerUserId: string;
  ownerUserName: string;
  ownerThemeKey?: string | null;

  currentDriverUserId: string;
  currentDriverUserName: string;
  currentDriverThemeKey?: string | null;

  maintenanceNotes: string;
  nextServiceKm: number;
  nextItpDate: string;
  nextRcaDate: string;

  coverImageUrl: string;
  coverThumbUrl: string;
  images: VehicleImageItem[];
}

export interface VehicleEventItem {
  id: string;
  vehicleId: string;
  type:
    | "created"
    | "updated"
    | "driver_changed"
    | "images_updated"
    | "claimed";
  message: string;
  createdAt: number;
  actorUserId?: string;
  actorUserName?: string;
  actorUserThemeKey?: string | null;
}