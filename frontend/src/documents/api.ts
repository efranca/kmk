import { ApiFailure, request } from "../schedule/api";

export type Visibility = "everyone" | "admins" | "superadmin";

export type DocumentItem = {
  id: number;
  title: string;
  note: string | null;
  category_id: number | null;
  client_id?: number | null;
  visibility: Visibility;
  file_name: string | null;
  content_type: string | null;
  size_bytes: number | null;
  has_file: boolean;
  has_preview: boolean;
  created_by: { id: number; name: string | null };
  created_at: string;
  updated_at: string;
};
export type DocumentCategory = { id: number; name: string; icon: string | null };
export type DocumentInput = { title: string; note: string | null; category_id: number | null; client_id: number | null; visibility: Visibility };

export const previewUrl = (id: number, version: string) => `/api/documents/${id}/preview?v=${encodeURIComponent(version)}`;

export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export const fileUrl = (id: number, download = false) => `/api/documents/${id}/file${download ? "?download=1" : ""}`;

export const listDocuments = () => request<{ documents: DocumentItem[]; categories: DocumentCategory[] }>("GET", "/api/documents");
export const getDocument = async (id: number) => (await request<{ document: DocumentItem }>("GET", `/api/documents/${id}`)).document;
export const createDocument = async (input: DocumentInput, csrf: string) => (await request<{ document: DocumentItem }>("POST", "/api/documents", csrf, input)).document;
export const updateDocument = async (id: number, input: Partial<DocumentInput>, csrf: string) => (await request<{ document: DocumentItem }>("PATCH", `/api/documents/${id}`, csrf, input)).document;
export const deleteDocument = (id: number, csrf: string) => request<void>("DELETE", `/api/documents/${id}`, csrf);

export const createCategory = async (input: { name: string; icon: string | null }, csrf: string) => (await request<{ category: DocumentCategory }>("POST", "/api/document-categories", csrf, input)).category;
export const updateCategory = async (id: number, input: { name: string; icon: string | null }, csrf: string) => (await request<{ category: DocumentCategory }>("PATCH", `/api/document-categories/${id}`, csrf, input)).category;
export const deleteCategory = (id: number, csrf: string) => request<void>("DELETE", `/api/document-categories/${id}`, csrf);

/** Sends the file as the raw body (the name goes in a header, percent-encoded) and reports progress; rejects with ApiFailure. */
export function uploadFile(id: number, file: Blob, name: string, csrf: string, onProgress?: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/api/documents/${id}/file`);
    xhr.withCredentials = true;
    xhr.setRequestHeader("X-CSRF-Token", csrf);
    xhr.setRequestHeader("X-File-Name", encodeURIComponent(name));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new ApiFailure(0, "network"));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let code = "unknown";
      try {
        const body = JSON.parse(xhr.responseText);
        if (typeof body?.error === "string") code = body.error;
      } catch {
        if (xhr.status === 413) code = "file_too_large"; // refused by the proxy before the application saw it
      }
      reject(new ApiFailure(xhr.status, code));
    };
    xhr.send(file);
  });
}

/** The small picture for the tiles view (best effort: the caller ignores a failure). */
export async function uploadPreview(id: number, blob: Blob, csrf: string): Promise<void> {
  const response = await fetch(`/api/documents/${id}/preview`, { method: "PUT", credentials: "same-origin", headers: { "X-CSRF-Token": csrf, "Content-Type": "image/jpeg" }, body: blob });
  if (!response.ok) throw new Error(`preview ${response.status}`);
}
