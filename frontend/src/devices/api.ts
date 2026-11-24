import { request } from "../schedule/api";

export type DeviceSession = {
  id: string;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string;
  ip: string | null;
  country: string | null;
  city: string | null;
  current: boolean;
};
export type DeviceGroup = {
  user: { id: number; name: string | null; username: string; role: "user" | "admin" | "superadmin"; avatar_url: string | null };
  sessions: DeviceSession[];
};

export const listDevices = () => request<{ users: DeviceGroup[] }>("GET", "/api/admin/devices").then((r) => r.users);
export const endDevice = (id: string, csrf: string) => request<void>("DELETE", `/api/admin/devices/${encodeURIComponent(id)}`, csrf);
export const endAllDevices = (userId: number, csrf: string) => request<void>("POST", `/api/admin/users/${userId}/devices/logout-all`, csrf);
