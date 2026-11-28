// The rooms of a property: a starter list offered when the list is empty, and the editor's limits (the backend's).
import type { TFunction } from "i18next";

import type { ClientKind } from "../clients/api";

/** A property's kind (the same choices as a client's). */
export type PropertyKind = ClientKind;

/** The server's limits (backend/app/clients/schemas.py `RoomsIn`, `RoomIn`). */
export const ROOMS_MAX = 30;
export const ROOM_NAME_MAX = 60;

const HOUSE = ["visRoomKitchen", "visRoomLiving", "visRoomBathroom", "visRoomBedroom"];
const STARTERS: Record<PropertyKind, string[]> = {
  airbnb: [...HOUSE, "visRoomEntrance"],
  commercial: ["visRoomReception", "visRoomOffices", "visRoomWashrooms", "visRoomKitchenette"],
  post_construction: HOUSE, // most often a house or a condo
  other: ["visRoomKitchen", "visRoomBathroom"],
};

/** A suggestion in the admin's language, offered only while the list is empty; nothing is saved until the admin saves. */
export function starterRooms(kind: PropertyKind, t: TFunction): string[] {
  return (STARTERS[kind] ?? STARTERS.other).map((key) => t(key));
}
