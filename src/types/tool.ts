export type ToolStatus = "depozit" | "atribuita" | "defecta" | "pierduta";

export interface AppUser {
  id: string;
  uid?: string;
  fullName: string;
  email?: string;
  active?: boolean;
  role?: string;
  themeKey?: string | null;
}

export interface ToolImageItem {
  id: string;
  url: string;
  path: string;
  fileName: string;
  createdAt: number;
  thumbUrl?: string;
  thumbPath?: string;
}

export interface ToolItem {
  id: string;
  name: string;
  internalCode: string;
  qrCodeValue: string;
  status: ToolStatus;
  coverThumbUrl: string;

  ownerUserId: string;
  ownerUserName: string;
  ownerThemeKey?: string | null;

  currentHolderUserId: string;
  currentHolderUserName: string;
  currentHolderThemeKey?: string | null;
  pendingHolderUserId?: string;
  pendingHolderUserName?: string;
  pendingHolderThemeKey?: string | null;
  pendingHolderRequestedAt?: number;

  locationType: "depozit" | "utilizator";
  locationLabel: string;

  description: string;

  warrantyText: string;
  warrantyUntil: string;

  coverImageUrl: string;
  imageUrls: string[];
  images: ToolImageItem[];

  createdAt: number;
  updatedAt: number;
}

export interface ToolEventItem {
  id: string;
  toolId: string;
  type:
    | "created"
    | "updated"
    | "status_changed"
    | "assigned_changed"
    | "images_updated"
    | "qr_updated"
    | "holder_changed";
  message: string;
  createdAt: number;
  actorUserId?: string;
  actorUserName?: string;
  actorUserThemeKey?: string | null;
}

export interface ToolFormValues {
  name: string;
  internalCode: string;
  qrCodeValue: string;
  status: ToolStatus;
  coverThumbUrl: string;

  ownerUserId: string;
  ownerUserName: string;
  ownerThemeKey?: string | null;

  currentHolderUserId: string;
  currentHolderUserName: string;
  currentHolderThemeKey?: string | null;
  pendingHolderUserId?: string;
  pendingHolderUserName?: string;
  pendingHolderThemeKey?: string | null;
  pendingHolderRequestedAt?: number;

  locationType: "depozit" | "utilizator";
  locationLabel: string;

  description: string;
  warrantyText: string;
  warrantyUntil: string;

  coverImageUrl: string;
  imageUrls: string[];
  images: ToolImageItem[];
}
